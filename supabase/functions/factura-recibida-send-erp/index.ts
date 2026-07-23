import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  ERPWriterRelationsMatchSnapshot,
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  buildERPDuplicateConsulta,
  buildERPContractV2,
  corsHeaders,
  getFacturaSyncEntryDecision,
  getSelectedPunteoPreflightIssues,
  getERPProviderPreflightIssues,
  getValidationErrorsForFactura,
  integerValue,
  hasBlockingERPValidationErrors,
  isEligibleERPCommitAttempt,
  jsonResponse,
  loadAndResolveFacturaERPAccountingRules,
  mergeValidationIssues,
  normalizeAccountingReadback,
  normalizeFrcPayload,
  normalizePunteoPayload,
  parseERPArrayEnvelope,
  parseERPProviderDetailResponse,
  parseJsonResponse,
  requestIdValue,
  requireRouteUser,
  rpcErrorStatus,
  signJwtHs256,
  text,
  toERPCtbPayload,
  toERPFacturaPayload,
  toERPSelectedPunteosPayload,
  unwrapERPObject,
  upstreamResult,
  validateAccountingReadback,
  validateERPDuplicateSearchResponse,
  validateERPReadbackAgainstWrite,
  validateERPWriteRequestV2,
  validateERPWriteResponseV2,
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

    const { data: factura, error: facturaError } = await auth.serviceClient
      .from("facturasrecibidas")
      .select("*")
      .eq("id", facturaId)
      .single();
    if (facturaError || !factura) {
      return jsonResponse(
        { error: facturaError?.message ?? "Factura no encontrada." },
        facturaError ? 500 : 404,
      );
    }

    const entryDecision = getFacturaSyncEntryDecision(factura as JsonObject, requestId);
    if (entryDecision.mode === "replay") {
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        request_id: requestId,
        ok: true,
        idempotent_replay: true,
        factura,
        version: integerValue((factura as JsonObject).row_version, null),
        response: (factura as JsonObject).erp_response ?? null,
      });
    }
    if (entryDecision.mode === "blocked_sent") {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_ALREADY_SENT",
          error: "La factura ya fue enviada con otro request_id.",
          factura,
        },
        409,
      );
    }
    if (entryDecision.mode === "blocked_in_flight") {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_SYNC_IN_FLIGHT",
          reconciliation_required: true,
          error: "Hay un envio ERP en curso; no se iniciara otro writer.",
          factura,
        },
        202,
      );
    }
    if (entryDecision.mode === "blocked_reconciliation") {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_RECONCILIATION_INVALID_STATE",
          reconciliation_required: true,
          error: "La sincronizacion ambigua no conserva un request_id original valido.",
          factura,
        },
        409,
      );
    }
    const reconciliationMode = entryDecision.mode === "reconcile";
    const syncRequestId = entryDecision.syncRequestId;
    activeRequestId = syncRequestId;

    const jwtSecret = Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET")?.trim();
    let writeWebhookUrl = Deno.env.get("N8N_CAMPOJOYMA_WRITE_WEBHOOK_URL")?.trim();
    const readWebhookUrl = Deno.env.get("N8N_CAMPOJOYMA_READ_WEBHOOK_URL")?.trim();
    if (writeWebhookUrl && readWebhookUrl && writeWebhookUrl === readWebhookUrl) {
      console.warn(
        "N8N_CAMPOJOYMA_WRITE_WEBHOOK_URL apunta al webhook de lectura; se usa el webhook v2 documentado.",
      );
      writeWebhookUrl = DEFAULT_WRITE_WEBHOOK_URL_V2;
    }
    if (!jwtSecret || !readWebhookUrl || (!reconciliationMode && !writeWebhookUrl)) {
      return jsonResponse(
        {
          error:
            "Faltan secretos o URLs n8n requeridos para la operacion ERP.",
        },
        500,
      );
    }

    let parsedWriteUrl: URL | null = null;
    let parsedReadUrl: URL;
    try {
      parsedWriteUrl = writeWebhookUrl ? new URL(writeWebhookUrl) : null;
      parsedReadUrl = new URL(readWebhookUrl);
    } catch {
      return jsonResponse({ error: "Las URLs n8n de lectura/escritura no son validas." }, 500);
    }
    if ((parsedWriteUrl && parsedWriteUrl.protocol !== "https:") || parsedReadUrl.protocol !== "https:") {
      return jsonResponse({ error: "Los webhooks n8n deben usar HTTPS." }, 500);
    }
    if (parsedWriteUrl && parsedWriteUrl.toString() === parsedReadUrl.toString()) {
      return jsonResponse(
        { error: "El webhook v2 de escritura debe ser distinto del webhook de lectura." },
        500,
      );
    }
    const jwt = await signJwtHs256(
      jwtSecret,
      parseExpSeconds(Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS")),
    );

    const callReadResponse = async (consulta: string) => {
      const url = new URL(readWebhookUrl);
      url.searchParams.set("consulta", consulta);
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      const parsed = await parseJsonResponse(response);
      return {
        response,
        ...parsed,
        result: upstreamResult(response, parsed.payload),
      };
    };

    const callRead = async (consulta: string) => {
      const call = await callReadResponse(consulta);
      if (!call.result.ok) {
        throw new Error(call.result.message ?? `Lectura ERP HTTP ${call.response.status}`);
      }
      return call.payload;
    };

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

    const punteoPreflightIssues = getSelectedPunteoPreflightIssues(
      (punteos ?? []) as JsonObject[],
    );
    if (!reconciliationMode && punteoPreflightIssues.length > 0) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_PUNTEOS_INVALID",
          error: "Los punteos seleccionados no tienen identidades ERP validas y unicas.",
          validation_errors: punteoPreflightIssues,
        },
        422,
      );
    }

    let authoritativeFactura = factura as JsonObject;
    if (!reconciliationMode) {
      const accountingRules = await loadAndResolveFacturaERPAccountingRules(
        auth.serviceClient,
        factura as JsonObject,
      );
      authoritativeFactura = accountingRules.factura;
      const structuralIssues = await getValidationErrorsForFactura(authoritativeFactura);
      const validationErrors = mergeValidationIssues(
        [...accountingRules.issues, ...structuralIssues],
        [],
      );
      const blockingErrors = validationErrors.filter((error) => error.severity === "error");
      if (blockingErrors.length > 0) {
        return jsonResponse(
          {
            contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
            request_id: requestId,
            code: accountingRules.issues.length > 0
              ? "ERP_RULE_CONFLICT"
              : "ERP_VALIDATION_FAILED",
            error: "La factura no supera la validacion.",
            validation_errors: validationErrors,
          },
          422,
        );
      }
    }

    const cabecera = toERPFacturaPayload(authoritativeFactura);
    const ctbPayload = (ctb ?? []).map((linea, index) =>
      toERPCtbPayload(linea as JsonObject, index + 1)
    );
    const punteosPayload = toERPSelectedPunteosPayload(
      (punteos ?? []) as JsonObject[],
    );
    const dryRunPayload = buildERPContractV2({
      requestId: syncRequestId,
      dryRun: true,
      cabecera,
      ctb: ctbPayload,
      punteos: punteosPayload,
    });

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
          p_request_id: syncRequestId,
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

    const readERPReadback = async (
      remoteFacturaId: number,
      expectedFactura: JsonObject,
    ): Promise<JsonObject> => {
      const accountingRequested = String(expectedFactura.FRR_Contabilizar ?? "N") === "S";
      const [headerRaw, ctbRaw, punteosRaw, accountingRaw] = await Promise.all([
        callRead(`facturasrecibidas/${remoteFacturaId}`),
        callRead(`facturasrecibidas/${remoteFacturaId}/ctb`),
        callRead(`facturasrecibidas/${remoteFacturaId}/punteos?include_lines=true`),
        accountingRequested
          ? callRead(`facturasrecibidas/${remoteFacturaId}/asiento`)
          : Promise.resolve({ status: "not_requested" }),
      ]);
      const ctbEnvelope = parseERPArrayEnvelope(ctbRaw, ["items", "ctb", "results", "data"]);
      if (!ctbEnvelope.ok) throw new Error(`Readback CTB invalido: ${ctbEnvelope.error}`);
      const punteosEnvelope = parseERPArrayEnvelope(
        punteosRaw,
        ["items", "punteos", "results", "data"],
      );
      if (!punteosEnvelope.ok) {
        throw new Error(`Readback de punteos invalido: ${punteosEnvelope.error}`);
      }
      return {
        factura: unwrapERPObject(headerRaw),
        ctb: ctbEnvelope.items.map((linea, index) =>
          normalizeFrcPayload(linea, index + 1, { preserveRemoteIds: true })
        ),
        punteos: punteosEnvelope.items.map((punteo, index) =>
          normalizePunteoPayload(punteo, index + 1)
        ),
        accounting: normalizeAccountingReadback(accountingRaw),
      };
    };

    if (reconciliationMode) {
      const { data: attempts, error: attemptError } = await auth.serviceClient
        .from("facturasrecibidas_sync_attempts")
        .select("request_id, phase, status, request_payload, response_payload")
        .eq("factura_id", facturaId)
        .eq("request_id", syncRequestId)
        .in("phase", ["dry_run", "commit"]);
      if (attemptError) throw attemptError;
      const attemptRows = Array.isArray(attempts) ? attempts as JsonObject[] : [];
      const commitAttempt = attemptRows.find((attempt) => attempt.phase === "commit");
      const dryRunAttempt = attemptRows.find((attempt) => attempt.phase === "dry_run");
      if (!commitAttempt || !isEligibleERPCommitAttempt(commitAttempt as JsonObject, syncRequestId)) {
        return jsonResponse(
          {
            contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
            request_id: syncRequestId,
            requested_request_id: requestId,
            code: "ERP_RECONCILIATION_NOT_ELIGIBLE",
            reconciliation_required: true,
            error: "No existe un intento commit ambiguo o confirmado que se pueda reconciliar.",
          },
          409,
        );
      }

      await finishPhase({
        phase: "reconcile",
        status: "in_progress",
        response: { requested_request_id: requestId },
      });

      if (text(dryRunAttempt?.status, null) !== "succeeded") {
        const message = "El intento dry_run original no consta como completado.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return jsonResponse({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          requested_request_id: requestId,
          code: "ERP_RECONCILIATION_INVALID_SNAPSHOT",
          reconciliation_required: true,
          error: message,
        }, 202);
      }
      const originalRequest = validateERPWriteRequestV2(dryRunAttempt?.request_payload, {
        requestId: syncRequestId,
        expectedDryRun: true,
      });
      if (!originalRequest.ok) {
        const message = originalRequest.errors.join(" ");
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return jsonResponse({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          requested_request_id: requestId,
          code: "ERP_RECONCILIATION_INVALID_SNAPSHOT",
          reconciliation_required: true,
          error: message,
        }, 202);
      }
      const snapshotPunteoIssues = getSelectedPunteoPreflightIssues(
        originalRequest.punteos.map((punteo) => ({ ...punteo, S: true })),
      );
      if (snapshotPunteoIssues.length > 0) {
        const message = "El request original contiene punteos sin identidad ERP valida y unica.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return jsonResponse({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          requested_request_id: requestId,
          code: "ERP_RECONCILIATION_INVALID_SNAPSHOT",
          reconciliation_required: true,
          validation_errors: snapshotPunteoIssues,
          error: message,
        }, 202);
      }
      if (!ERPWriterRelationsMatchSnapshot({
        currentCtb: ctbPayload,
        currentPunteos: punteosPayload,
        snapshotCtb: originalRequest.ctb,
        snapshotPunteos: originalRequest.punteos,
      })) {
        const message = "CTB o punteos locales ya no coinciden con el request original.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return jsonResponse({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          requested_request_id: requestId,
          code: "ERP_RECONCILIATION_LOCAL_DRIFT",
          reconciliation_required: true,
          error: message,
        }, 202);
      }
      const reconciliationCabecera = originalRequest.cabecera;
      const reconciliationCtb = originalRequest.ctb;
      const reconciliationPunteos = originalRequest.punteos;

      let reconciledRemoteId = integerValue(
        (factura as JsonObject).remote_frr_id ?? (factura as JsonObject).FRR_id,
        null,
      );
      if ((!reconciledRemoteId || reconciledRemoteId <= 0) && commitAttempt.status === "succeeded") {
        const committedResponse = validateERPWriteResponseV2(commitAttempt.response_payload, {
          requestId: syncRequestId,
          expectedDryRun: false,
        });
        if (committedResponse.ok) reconciledRemoteId = committedResponse.remoteFacturaId;
      }
      if (!reconciledRemoteId || reconciledRemoteId <= 0) {
        const duplicateConsulta = buildERPDuplicateConsulta(reconciliationCabecera);
        if (!duplicateConsulta) {
          const message = "Faltan datos para localizar la factura ambigua en el ERP.";
          await finishPhase({ phase: "reconcile", status: "unknown", error: message });
          return jsonResponse({
            contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
            request_id: syncRequestId,
            requested_request_id: requestId,
            reconciliation_required: true,
            error: message,
          }, 202);
        }
        let duplicateCall: Awaited<ReturnType<typeof callReadResponse>>;
        try {
          duplicateCall = await callReadResponse(duplicateConsulta);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Busqueda ERP no disponible.";
          await finishPhase({ phase: "reconcile", status: "unknown", error: message });
          return jsonResponse({
            contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
            request_id: syncRequestId,
            requested_request_id: requestId,
            reconciliation_required: true,
            error: "No se pudo localizar de forma unica la factura ambigua.",
            details: message,
          }, 202);
        }
        const duplicateValidation = duplicateCall.result.ok
          ? validateERPDuplicateSearchResponse(duplicateCall.payload, reconciliationCabecera)
          : null;
        if (
          !duplicateValidation?.ok ||
          duplicateValidation.total !== 1 ||
          duplicateValidation.candidates.length !== 1
        ) {
          const message = duplicateValidation?.error ??
            "La busqueda ERP no devolvio exactamente un candidato coincidente.";
          await finishPhase({
            phase: "reconcile",
            status: "unknown",
            response: duplicateCall.payload,
            httpStatus: duplicateCall.response.status,
            error: message,
          });
          return jsonResponse({
            contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
            request_id: syncRequestId,
            requested_request_id: requestId,
            reconciliation_required: true,
            error: message,
          }, 202);
        }
        reconciledRemoteId = integerValue(duplicateValidation.candidates[0].FRR_id, null);
      }

      if (!reconciledRemoteId || reconciledRemoteId <= 0) {
        const message = "No se pudo determinar un FRR_id unico para reconciliar.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return jsonResponse({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          requested_request_id: requestId,
          reconciliation_required: true,
          error: message,
        }, 202);
      }

      const reconciledWriteResponse = {
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        request_id: syncRequestId,
        ok: true,
        dry_run: false,
        FRR_id: reconciledRemoteId,
        reconciled: true,
      };
      let reconciledReadback: JsonObject;
      try {
        reconciledReadback = await readERPReadback(reconciledRemoteId, reconciliationCabecera);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Readback ERP no disponible.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return jsonResponse({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          requested_request_id: requestId,
          reconciliation_required: true,
          remote_frr_id: reconciledRemoteId,
          error: "La factura candidata no se pudo confirmar mediante readback.",
          details: message,
        }, 202);
      }

      if (String(reconciliationCabecera.FRR_Contabilizar ?? "N") === "S") {
        const accountingCheck = validateAccountingReadback(asObject(reconciledReadback.accounting));
        if (!accountingCheck.ok) {
          const message = "El asiento solicitado no esta confirmado como created con Debe/Haber cuadrado.";
          await finishPhase({
            phase: "reconcile",
            status: "unknown",
            response: reconciledReadback,
            error: message,
          });
          return jsonResponse({
            contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
            request_id: syncRequestId,
            requested_request_id: requestId,
            reconciliation_required: true,
            remote_frr_id: reconciledRemoteId,
            accounting: accountingCheck,
            error: message,
          }, 202);
        }
      }

      const reconciliationReadbackCheck = validateERPReadbackAgainstWrite({
        remoteFacturaId: reconciledRemoteId,
        cabecera: reconciliationCabecera,
        ctb: reconciliationCtb,
        punteos: reconciliationPunteos,
        readback: reconciledReadback,
      });
      if (!reconciliationReadbackCheck.ok) {
        const message = "El candidato ERP no coincide exactamente con el payload local confirmado.";
        await finishPhase({
          phase: "reconcile",
          status: "unknown",
          response: reconciledReadback,
          error: message,
        });
        return jsonResponse({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          requested_request_id: requestId,
          code: "ERP_READBACK_MISMATCH",
          reconciliation_required: true,
          remote_frr_id: reconciledRemoteId,
          validation_errors: reconciliationReadbackCheck.errors,
          error: message,
        }, 202);
      }

      const { data: finalized, error: finalizeError } = await auth.serviceClient.rpc(
        "finalize_factura_recibida_sync_v2",
        {
          p_factura_id: facturaId,
          p_request_id: syncRequestId,
          p_write_response: reconciledWriteResponse,
          p_readback: reconciledReadback,
          p_actor: auth.user.id,
        },
      );
      if (finalizeError) {
        await finishPhase({
          phase: "reconcile",
          status: "unknown",
          response: reconciledReadback,
          error: finalizeError.message,
        });
        return jsonResponse({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          requested_request_id: requestId,
          reconciliation_required: true,
          remote_frr_id: reconciledRemoteId,
          error: finalizeError.message,
        }, 202);
      }
      await finishPhase({
        phase: "reconcile",
        status: "succeeded",
        response: reconciledReadback,
      });
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        request_id: syncRequestId,
        requested_request_id: requestId,
        ok: true,
        dry_run: false,
        reconciled: true,
        ...asObject(finalized),
        response: reconciledWriteResponse,
        readback: reconciledReadback,
      });
    }

    const proveedorId = integerValue(authoritativeFactura.FRR_idproveedor, null);
    let providerCall: Awaited<ReturnType<typeof callReadResponse>>;
    try {
      providerCall = await callReadResponse(`acreedores/${proveedorId}`);
    } catch (error) {
      const details = error instanceof Error ? error.message : "La API ERP no esta disponible.";
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_PROVIDER_UNAVAILABLE",
          error: "No se pudo validar el acreedor contra el ERP.",
          details,
        },
        503,
      );
    }

    const providerStatus = integerValue(
      asObject(providerCall.payload).status ?? asObject(providerCall.payload).status_code,
      providerCall.response.status,
    );
    if (!providerCall.result.ok) {
      if (providerCall.response.status === 404 || providerStatus === 404) {
        return jsonResponse(
          {
            contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
            request_id: requestId,
            code: "ERP_PROVIDER_NOT_FOUND",
            error: "El acreedor seleccionado no existe en el ERP.",
            validation_errors: [{
              field: "FRR_idproveedor",
              message: "El acreedor seleccionado no existe en el ERP.",
              severity: "error",
            }],
          },
          422,
        );
      }
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_PROVIDER_UNAVAILABLE",
          error: "No se pudo validar el acreedor contra el ERP.",
          details: providerCall.result.message,
        },
        503,
      );
    }

    const providerDetail = parseERPProviderDetailResponse(providerCall.payload);
    if (!providerDetail.ok) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_PROVIDER_INVALID_RESPONSE",
          error: "El ERP devolvio un detalle de acreedor no verificable.",
          details: providerDetail.error,
        },
        503,
      );
    }

    const providerIssues = getERPProviderPreflightIssues(authoritativeFactura, providerDetail.provider);
    if (providerIssues.length > 0) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_PROVIDER_MISMATCH",
          error: "El acreedor o su cuenta no coinciden con el maestro ERP.",
          validation_errors: providerIssues,
        },
        422,
      );
    }

    const duplicateConsulta = buildERPDuplicateConsulta(authoritativeFactura);
    if (!duplicateConsulta) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_DUPLICATE_CHECK_INCOMPLETE",
          error: "Faltan datos para comprobar el duplicado exacto en el ERP.",
        },
        422,
      );
    }

    let duplicateCall: Awaited<ReturnType<typeof callReadResponse>>;
    try {
      duplicateCall = await callReadResponse(duplicateConsulta);
    } catch (error) {
      const details = error instanceof Error ? error.message : "La API ERP no esta disponible.";
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_DUPLICATE_CHECK_UNAVAILABLE",
          error: "No se pudo comprobar si la factura ya existe en el ERP.",
          details,
        },
        503,
      );
    }
    if (!duplicateCall.result.ok) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_DUPLICATE_CHECK_UNAVAILABLE",
          error: "No se pudo comprobar si la factura ya existe en el ERP.",
          details: duplicateCall.result.message,
        },
        503,
      );
    }

    const duplicateValidation = validateERPDuplicateSearchResponse(
      duplicateCall.payload,
      authoritativeFactura,
    );
    if (!duplicateValidation.ok) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_DUPLICATE_CHECK_UNAVAILABLE",
          error: "El ERP devolvio una respuesta de duplicados no verificable.",
          details: duplicateValidation.error,
        },
        503,
      );
    }
    const duplicateCandidates = duplicateValidation.candidates;
    const duplicateTotal = duplicateValidation.total!;
    if (duplicateTotal > 0 || duplicateCandidates.length > 0) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: "ERP_DUPLICATE_FOUND",
          error: "La factura ya existe en el ERP para la misma empresa, ejercicio, proveedor y numero.",
          duplicate_total: duplicateTotal,
          duplicate_candidates: duplicateCandidates,
        },
        409,
      );
    }

    const { data: beginData, error: beginError } = await auth.serviceClient.rpc(
      "begin_factura_recibida_sync_v2",
      {
        p_factura_id: facturaId,
        p_expected_version: expectedVersion,
        p_request_id: syncRequestId,
        p_payload: dryRunPayload,
        p_actor: auth.user.id,
      },
    );
    if (beginError) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: syncRequestId,
          error: beginError.message,
        },
        rpcErrorStatus(beginError.message),
      );
    }
    const begin = asObject(beginData);
    if (begin.replayed === true && begin.terminal === true) {
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        request_id: syncRequestId,
        ok: true,
        idempotent_replay: true,
        factura: begin.factura,
        version: begin.version,
        response: begin.response,
      });
    }

    const callWrite = async (payload: JsonObject) => {
      const response = await fetch(writeWebhookUrl!, {
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

    const dryRunContract = validateERPWriteResponseV2(dryRunCall.payload, {
      requestId,
      expectedDryRun: true,
    });
    const dryRunHasBlockingValidation = hasBlockingERPValidationErrors(dryRunCall.payload);
    if (
      !dryRunCall.response.ok ||
      !dryRunCall.result.ok ||
      !dryRunContract.ok ||
      dryRunHasBlockingValidation
    ) {
      const message = !dryRunCall.response.ok || !dryRunCall.result.ok
        ? dryRunCall.result.message ?? `Dry-run ERP HTTP ${dryRunCall.response.status}`
        : dryRunContract.errors.length > 0
          ? dryRunContract.errors.join(" ")
          : "El dry-run ERP contiene errores de validacion.";
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

    const commitContract = validateERPWriteResponseV2(commitCall.payload, {
      requestId,
      expectedDryRun: false,
    });
    const commitHasBlockingValidation = hasBlockingERPValidationErrors(commitCall.payload);
    if (
      !commitCall.response.ok ||
      !commitCall.result.ok ||
      !commitContract.ok ||
      commitHasBlockingValidation
    ) {
      const ambiguous = commitCall.response.status >= 500 ||
        (commitCall.response.ok &&
          (!commitCall.result.ok || !commitContract.ok || commitHasBlockingValidation));
      const message = !commitCall.response.ok || !commitCall.result.ok
        ? commitCall.result.message ?? `Escritura ERP HTTP ${commitCall.response.status}`
        : commitContract.errors.length > 0
          ? commitContract.errors.join(" ")
          : "La escritura ERP contiene errores de validacion.";
      const state = await finishPhase({
        phase: "commit",
        status: ambiguous ? "unknown" : "failed",
        response: commitCall.payload,
        httpStatus: commitCall.response.status,
        error: message,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          ok: false,
          reconciliation_required: ambiguous,
          error: message,
          response: commitCall.payload,
          factura: state.factura,
          version: state.version,
        },
        ambiguous ? 202 : commitCall.response.status,
      );
    }

    const remoteFacturaId = commitContract.remoteFacturaId!;

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

    let readback: JsonObject;
    try {
      const accountingRequested = String(authoritativeFactura.FRR_Contabilizar ?? "N") === "S";
      const [headerRaw, ctbRaw, punteosRaw, accountingRaw] = await Promise.all([
        callRead(`facturasrecibidas/${remoteFacturaId}`),
        callRead(`facturasrecibidas/${remoteFacturaId}/ctb`),
        callRead(`facturasrecibidas/${remoteFacturaId}/punteos?include_lines=true`),
        accountingRequested
          ? callRead(`facturasrecibidas/${remoteFacturaId}/asiento`)
          : Promise.resolve({ status: "not_requested" }),
      ]);
      const ctbEnvelope = parseERPArrayEnvelope(ctbRaw, ["items", "ctb", "results", "data"]);
      if (!ctbEnvelope.ok) {
        throw new Error(`Readback CTB invalido: ${ctbEnvelope.error}`);
      }
      const punteosEnvelope = parseERPArrayEnvelope(
        punteosRaw,
        ["items", "punteos", "results", "data"],
      );
      if (!punteosEnvelope.ok) {
        throw new Error(`Readback de punteos invalido: ${punteosEnvelope.error}`);
      }
      readback = {
        factura: unwrapERPObject(headerRaw),
        ctb: ctbEnvelope.items.map((linea, index) =>
          normalizeFrcPayload(linea, index + 1, { preserveRemoteIds: true })
        ),
        punteos: punteosEnvelope.items.map((punteo, index) =>
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

    if (String(authoritativeFactura.FRR_Contabilizar ?? "N") === "S") {
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

    const readbackCheck = validateERPReadbackAgainstWrite({
      remoteFacturaId,
      cabecera,
      ctb: ctbPayload,
      punteos: punteosPayload,
      readback,
    });
    if (!readbackCheck.ok) {
      const state = await finishPhase({
        phase: "readback",
        status: "unknown",
        response: readback,
        error: "El readback no coincide exactamente con la cabecera, CTB o punteos enviados.",
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          reconciliation_required: true,
          remote_frr_id: remoteFacturaId,
          code: "ERP_READBACK_MISMATCH",
          error: "La factura fue escrita, pero su lectura no coincide con el payload confirmado.",
          validation_errors: readbackCheck.errors,
          factura: state.factura,
          version: state.version,
        },
        202,
      );
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
