import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  corsHeaders,
  extractOperationalERPAvailabilityWarnings,
  getFacturaProveedorTipoFromMatchEvidence,
  getValidationErrorsForFactura,
  integerValue,
  jsonResponse,
  loadAndResolveFacturaERPAccountingRules,
  mergeValidationIssues,
  normalizeFrcPayload,
  normalizePunteoPayload,
  normalizeFrrPayload,
  requestIdValue,
  requireRouteUser,
  rpcErrorStatus,
  syncFacturaERPAccountingMatchEvidence,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const asObjectArray = (value: unknown): JsonObject[] | null =>
  Array.isArray(value)
    ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = asObject(await req.json());
    const contractVersion = integerValue(body.contract_version, FACTURAS_RECIBIDAS_CONTRACT_VERSION);
    if (contractVersion !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return jsonResponse({ error: "contract_version=2 es requerido" }, 422);
    }

    const requestId = requestIdValue(body.request_id);
    const facturaId = String(body.factura_id ?? body.id ?? "").trim();
    if (!facturaId) return jsonResponse({ error: "factura_id es requerido" }, 422);

    const expectedVersion = integerValue(
      body.expected_version ?? body.row_version ?? body.version,
      null,
    );
    if (!expectedVersion || expectedVersion < 1) {
      return jsonResponse({ error: "expected_version es requerido" }, 422);
    }

    const facturaInput = asObject(body.cabecera ?? body.factura ?? body.frr ?? body);
    const frr = normalizeFrrPayload(facturaInput, { partial: true });
    const { data: current, error: currentError } = await auth.serviceClient
      .from("facturasrecibidas")
      .select("*")
      .eq("id", facturaId)
      .single();
    if (currentError || !current) {
      return jsonResponse({ error: currentError?.message ?? "Factura no encontrada." }, currentError ? 500 : 404);
    }

    const validationBase = { ...(current as JsonObject), ...frr };
    const accountingRules = await loadAndResolveFacturaERPAccountingRules(
      auth.serviceClient,
      validationBase,
      getFacturaProveedorTipoFromMatchEvidence(
        validationBase.match_evidence,
        validationBase.FRR_idproveedor,
      ),
    );
    const resolvedMatchEvidence = syncFacturaERPAccountingMatchEvidence(
      validationBase.match_evidence,
      accountingRules,
    );
    const structuralIssues = await getValidationErrorsForFactura(accountingRules.factura);
    const preservedOperationalWarnings = extractOperationalERPAvailabilityWarnings(
      current.validation_errors,
      { providerPreflightVerified: body.provider_preflight_verified === true },
    );
    const validationErrors = mergeValidationIssues(
      [...accountingRules.issues, ...structuralIssues],
      preservedOperationalWarnings,
    );
    const explicitEstado = typeof body.estado === "string"
      ? body.estado
      : typeof facturaInput.estado === "string"
        ? facturaInput.estado
        : null;
    const nextEstado = explicitEstado ??
      (validationErrors.some((error) => error.severity === "error") ? "pendiente_revision" : "validada");

    const ctbInput = asObjectArray(body.ctb);
    const punteosInput = asObjectArray(body.punteos);
    const ctb = ctbInput?.map((linea, index) => normalizeFrcPayload(linea, index + 1)) ?? null;
    const punteos = punteosInput?.map((punteo, index) => normalizePunteoPayload(punteo, index + 1)) ?? null;

    const { data, error } = await auth.serviceClient.rpc("save_factura_recibida_v2", {
      p_factura_id: facturaId,
      p_expected_version: expectedVersion,
      p_factura: {
        ...frr,
        ...accountingRules.applied,
        proveedor_nombre: body.proveedor_nombre ?? facturaInput.proveedor_nombre ?? current.proveedor_nombre ?? null,
        proveedor_nif: body.proveedor_nif ?? facturaInput.proveedor_nif ?? current.proveedor_nif ?? null,
        estado: nextEstado,
        match_evidence: resolvedMatchEvidence,
        validation_errors: validationErrors,
      },
      p_ctb: ctb,
      p_punteos: punteos,
      p_actor: auth.user.id,
      p_request_id: requestId,
      p_change_source: "edge_update",
      p_reason: typeof body.reason === "string" ? body.reason : null,
    });

    if (error) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          error: error.message,
        },
        rpcErrorStatus(error.message),
      );
    }

    const result = asObject(data);
    return jsonResponse({
      contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
      request_id: requestId,
      ...result,
      version: integerValue(result.version, expectedVersion + 1),
      validation_errors: validationErrors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, rpcErrorStatus(message));
  }
});
