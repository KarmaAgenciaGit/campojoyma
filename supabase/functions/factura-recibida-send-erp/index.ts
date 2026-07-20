import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  buildERPContractV2,
  corsHeaders,
  extractRemoteFacturaId,
  getValidationErrorsForFactura,
  integerValue,
  jsonResponse,
  normalizeAccountingReadback,
  normalizeFrcPayload,
  normalizePunteoPayload,
  parseJsonResponse,
  requestIdValue,
  requireRouteUser,
  rpcErrorStatus,
  signJwtHs256,
  text,
  toERPCtbPayload,
  toERPFacturaPayload,
  toERPPunteoPayload,
  unwrapERPArray,
  unwrapERPObject,
  upstreamResult,
  validateAccountingReadback,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";

const DEFAULT_EXP_SECONDS = 300;
const UPSTREAM_TIMEOUT_MS = 30_000;
// URL canonica del webhook v2 de escritura (no es un secreto: exige JWT firmado).
// Se usa solo si el secreto N8N_CAMPOJOYMA_WRITE_WEBHOOK_URL apunta por error al webhook de lectura.
const DEFAULT_WRITE_WEBHOOK_URL_V2 =
  "https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma-facturas-write-v2";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};

const parseExpSeconds = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_EXP_SECONDS;
};

const hasBlockingUpstreamValidation = (payload: unknown) => {
  const object = asObject(payload);
  const candidates = object.validation_errors ?? object.validations ?? object.errors;
  if (!Array.isArray(candidates)) return false;
  return candidates.some((item) => {
    const issue = asObject(item);
    return issue.severity !== "warning" && issue.valid !== true;
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  let activeFacturaId: string | null = null;
  let activeRequestId: string | null = null;

  try {
    const body = asObject(await req.json());
    const contractVersion = integerValue(body.contract_version, FACTURAS_RECIBIDAS_CONTRACT_VERSION);
    if (contractVersion !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return jsonResponse({ error: "contract_version=2 es requerido" }, 422);
    }

    const facturaId = text(body.factura_id ?? body.id, null);
    const expectedVersion = integerValue(
      body.expected_version ?? body.row_version ?? body.version,
      null,
    );
    const requestId = requestIdValue(body.request_id);
    activeFacturaId = facturaId;
    activeRequestId = requestId;

    if (!facturaId) return jsonResponse({ error: "factura_id es requerido" }, 422);
    if (!expectedVersion || expectedVersion < 1) {
      return jsonResponse({ error: "expected_version es requerido" }, 422);
    }

    const jwtSecret = Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET")?.trim();
    let writeWebhookUrl = Deno.env.get("N8N_CAMPOJOYMA_WRITE_WEBHOOK_URL")?.trim();
    const readWebhookUrl = Deno.env.get("N8N_CAMPOJOYMA_READ_WEBHOOK_URL")?.trim();
    if (writeWebhookUrl && readWebhookUrl && writeWebhookUrl === readWebhookUrl) {
      console.warn(
        "N8N_CAMPOJOYMA_WRITE_WEBHOOK_URL apunta al webhook de lectura; se usa el webhook v2 documentado.",
      );
      writeWebhookUrl = DEFAULT_WRITE_WEBHOOK_URL_V2;
    }
    if (!jwtSecret || !writeWebhookUrl || !readWebhookUrl) {
      return jsonResponse(
        {
          error:
            "Faltan N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET, N8N_CAMPOJOYMA_WRITE_WEBHOOK_URL o N8N_CAMPOJOYMA_READ_WEBHOOK_URL.",
        },
        500,
      );
    }

    let parsedWriteUrl: URL;
    let parsedReadUrl: URL;
    try {
      parsedWriteUrl = new URL(writeWebhookUrl);
      parsedReadUrl = new URL(readWebhookUrl);
    } catch {
      return jsonResponse({ error: "Las URLs n8n de lectura/escritura no son validas." }, 500);
    }
    if (parsedWriteUrl.protocol !== "https:" || parsedReadUrl.protocol !== "https:") {
      return jsonResponse({ error: "Los webhooks n8n deben usar HTTPS." }, 500);
    }
    if (parsedWriteUrl.toString() === parsedReadUrl.toString()) {
      return jsonResponse(
        { error: "El webhook v2 de escritura debe ser distinto del webhook de lectura." },
        500,
      );
    }
    const jwt = await signJwtHs256(
      jwtSecret,
      parseExpSeconds(Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS")),
    );

    const { data: factura, error: facturaError } = await auth.serviceClient
      .from("facturasrecibidas")
      .select("*")
      .eq("id", facturaId)
      .single();
    if (facturaError || !factura) {
      return jsonResponse({ error: facturaError?.message ?? "Factura no encontrada." }, facturaError ? 500 : 404);
    }

    const [{ data: ctb, error: ctbError }, { data: punteos, error: punteosError }] = await Promise.all([
      auth.serviceClient
        .from("facturasrecibidas_ctb")
        .select("*")
        .eq("factura_id", facturaId)
        .order("posicion", { ascending: true }),
      auth.serviceClient
        .from("facturasrecibidas_punteos")
        .select("*")
        .eq("factura_id", facturaId)
        .order("posicion", { ascending: true }),
    ]);
    if (ctbError) throw ctbError;
    if (punteosError) throw punteosError;

    const validationErrors = await getValidationErrorsForFactura(auth.serviceClient, factura);
    const blockingErrors = validationErrors.filter((error) => error.severity === "error");
    if (blockingErrors.length > 0) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          error: "La factura no supera la validacion.",
          validation_errors: validationErrors,
        },
        422,
      );
    }

    const cabecera = toERPFacturaPayload(factura as JsonObject);
    const ctbPayload = (ctb ?? []).map((linea, index) =>
      toERPCtbPayload(linea as JsonObject, index + 1)
    );
    const punteosPayload = (punteos ?? []).map((punteo, index) =>
      toERPPunteoPayload(punteo as JsonObject, index + 1)
    );
    const dryRunPayload = buildERPContractV2({
      requestId,
      dryRun: true,
      cabecera,
      ctb: ctbPayload,
      punteos: punteosPayload,
    });

    const { data: beginData, error: beginError } = await auth.serviceClient.rpc(
      "begin_factura_recibida_sync_v2",
      {
        p_factura_id: facturaId,
        p_expected_version: expectedVersion,
        p_request_id: requestId,
        p_payload: dryRunPayload,
        p_actor: auth.user.id,
      },
    );
    if (beginError) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          error: beginError.message,
        },
        rpcErrorStatus(beginError.message),
      );
    }

    const begin = asObject(beginData);
    if (begin.replayed === true && begin.terminal === true) {
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        request_id: requestId,
        idempotent_replay: true,
        factura: begin.factura,
        version: begin.version,
        response: begin.response,
      });
    }

    const finishPhase = async ({
      phase,
      status,
      response = null,
      httpStatus = null,
      error = null,
    }: {
      phase: "dry_run" | "commit" | "readback" | "reconcile";
      status: "in_progress" | "succeeded" | "failed" | "unknown";
      response?: unknown;
      httpStatus?: number | null;
      error?: string | null;
    }) => {
      const { data, error: rpcError } = await auth.serviceClient.rpc(
        "finish_factura_recibida_sync_v2",
        {
          p_factura_id: facturaId,
          p_request_id: requestId,
          p_phase: phase,
          p_status: status,
          p_response: response,
          p_http_status: httpStatus,
          p_error: error,
          p_actor: auth.user.id,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      return asObject(data);
    };

    const callWrite = async (payload: JsonObject) => {
      const response = await fetch(writeWebhookUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const parsed = await parseJsonResponse(response);
      return { response, ...parsed, result: upstreamResult(response, parsed.payload) };
    };

    let dryRunCall;
    try {
      dryRunCall = await callWrite(dryRunPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dry-run no disponible";
      await finishPhase({ phase: "dry_run", status: "failed", error: message });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          error: message,
        },
        504,
      );
    }

    if (!dryRunCall.result.ok || hasBlockingUpstreamValidation(dryRunCall.payload)) {
      const message = dryRunCall.result.message ?? "El dry-run ERP no fue valido";
      await finishPhase({
        phase: "dry_run",
        status: "failed",
        response: dryRunCall.payload,
        httpStatus: dryRunCall.response.status,
        error: message,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          error: message,
          validation: dryRunCall.payload,
        },
        dryRunCall.response.ok ? 422 : dryRunCall.response.status,
      );
    }
    await finishPhase({
      phase: "dry_run",
      status: "succeeded",
      response: dryRunCall.payload,
      httpStatus: dryRunCall.response.status,
    });

    const commitPayload = buildERPContractV2({
      requestId,
      dryRun: false,
      cabecera,
      ctb: ctbPayload,
      punteos: punteosPayload,
    });
    await finishPhase({ phase: "commit", status: "in_progress", response: commitPayload });

    let commitCall;
    try {
      commitCall = await callWrite(commitPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Resultado de escritura desconocido";
      const state = await finishPhase({
        phase: "commit",
        status: "unknown",
        error: message,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          ok: false,
          reconciliation_required: true,
          error: "El ERP puede haber creado la factura. No se reenviara hasta reconciliar.",
          details: message,
          factura: state.factura,
          version: state.version,
        },
        202,
      );
    }

    if (!commitCall.result.ok) {
      const ambiguous = commitCall.response.status >= 500;
      const state = await finishPhase({
        phase: "commit",
        status: ambiguous ? "unknown" : "failed",
        response: commitCall.payload,
        httpStatus: commitCall.response.status,
        error: commitCall.result.message,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          ok: false,
          reconciliation_required: ambiguous,
          error: commitCall.result.message,
          response: commitCall.payload,
          factura: state.factura,
          version: state.version,
        },
        ambiguous ? 202 : commitCall.response.status,
      );
    }

    const remoteFacturaId = extractRemoteFacturaId(commitCall.payload);
    if (!remoteFacturaId) {
      const state = await finishPhase({
        phase: "commit",
        status: "unknown",
        response: commitCall.payload,
        httpStatus: commitCall.response.status,
        error: "La respuesta confirmada no contiene FRR_id positivo.",
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          reconciliation_required: true,
          error: "La escritura no se puede identificar con seguridad.",
          response: commitCall.payload,
          factura: state.factura,
          version: state.version,
        },
        202,
      );
    }

    const normalizedWriteResponse = {
      ...asObject(commitCall.payload),
      ok: true,
      dry_run: false,
      FRR_id: remoteFacturaId,
    };
    await finishPhase({
      phase: "commit",
      status: "succeeded",
      response: normalizedWriteResponse,
      httpStatus: commitCall.response.status,
    });
    await finishPhase({ phase: "readback", status: "in_progress" });

    const callRead = async (consulta: string) => {
      const url = new URL(readWebhookUrl);
      url.searchParams.set("consulta", consulta);
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const parsed = await parseJsonResponse(response);
      const result = upstreamResult(response, parsed.payload);
      if (!result.ok) throw new Error(result.message ?? `Readback HTTP ${response.status}`);
      return parsed.payload;
    };

    let readback: JsonObject;
    try {
      const accountingRequested = String(factura.FRR_Contabilizar ?? "N") === "S";
      const [headerRaw, ctbRaw, punteosRaw, accountingRaw] = await Promise.all([
        callRead(`facturasrecibidas/${remoteFacturaId}`),
        callRead(`facturasrecibidas/${remoteFacturaId}/ctb`),
        callRead(`facturasrecibidas/${remoteFacturaId}/punteos?include_lines=true`),
        accountingRequested
          ? callRead(`facturasrecibidas/${remoteFacturaId}/asiento`)
          : Promise.resolve({ status: "not_requested" }),
      ]);
      readback = {
        factura: unwrapERPObject(headerRaw),
        ctb: unwrapERPArray(ctbRaw).map((linea, index) =>
          normalizeFrcPayload(linea, index + 1, { preserveRemoteIds: true })
        ),
        punteos: unwrapERPArray(punteosRaw).map((punteo, index) =>
          normalizePunteoPayload(punteo, index + 1)
        ),
        accounting: normalizeAccountingReadback(accountingRaw),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Readback ERP no disponible";
      const state = await finishPhase({
        phase: "readback",
        status: "unknown",
        response: normalizedWriteResponse,
        error: message,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          ok: false,
          reconciliation_required: true,
          remote_frr_id: remoteFacturaId,
          error: "La factura fue escrita, pero no se pudo confirmar su lectura completa.",
          details: message,
          factura: state.factura,
          version: state.version,
        },
        202,
      );
    }

    if (String(factura.FRR_Contabilizar ?? "N") === "S") {
      const accountingCheck = validateAccountingReadback(asObject(readback.accounting));
      if (!accountingCheck.ok) {
        const state = await finishPhase({
          phase: "readback",
          status: "unknown",
          response: readback,
          error:
            "El ERP no devolvio un asiento creado con ID tecnico, numero visible y apuntes Debe/Haber cuadrados.",
        });
        return jsonResponse(
          {
            contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
            request_id: requestId,
            reconciliation_required: true,
            remote_frr_id: remoteFacturaId,
            accounting: accountingCheck,
            error:
              "La factura fue creada, pero el asiento contable completo aun no esta confirmado.",
            factura: state.factura,
            version: state.version,
          },
          202,
        );
      }
    }

    const { data: finalized, error: finalizeError } = await auth.serviceClient.rpc(
      "finalize_factura_recibida_sync_v2",
      {
        p_factura_id: facturaId,
        p_request_id: requestId,
        p_write_response: normalizedWriteResponse,
        p_readback: readback,
        p_actor: auth.user.id,
      },
    );
    if (finalizeError) {
      const state = await finishPhase({
        phase: "readback",
        status: "unknown",
        response: readback,
        error: finalizeError.message,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          reconciliation_required: true,
          remote_frr_id: remoteFacturaId,
          error: finalizeError.message,
          factura: state.factura,
          version: state.version,
        },
        202,
      );
    }

    return jsonResponse({
      contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
      request_id: requestId,
      ok: true,
      dry_run: false,
      ...asObject(finalized),
      response: normalizedWriteResponse,
      readback,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (activeFacturaId && activeRequestId && /Timeout|timed out|aborted/i.test(message)) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: activeRequestId,
          reconciliation_required: true,
          error: message,
        },
        202,
      );
    }
    return jsonResponse({ error: message }, rpcErrorStatus(message));
  }
});
