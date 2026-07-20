import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  cleanBase64,
  corsHeaders,
  createServiceClient,
  ensureArchivoPdf,
  getValidationErrorsForFactura,
  integerValue,
  jsonResponse,
  applyGastosToFrr,
  normalizeFrcPayload,
  normalizeConfidence,
  normalizePunteoPayload,
  normalizeFrrPayload,
  numberValue,
  pick,
  requestIdValue,
  requireAgentToken,
  rpcErrorStatus,
  sanitizeAuditValue,
  text,
  timestampValue,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const asArray = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.filter((item): item is JsonObject => item && typeof item === "object" && !Array.isArray(item)) : [];

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => text(item, null)).filter((item): item is string => Boolean(item)).slice(0, 25)
    : [];

const normalizeOnePayload = (raw: JsonObject) => {
  const extraction = asObject(raw.extraction ?? raw.cabecera ?? raw.factura ?? raw.invoice ?? raw);
  const fileName = text(pick(raw, ["file_name", "filename", "source_pdf_name", "nombre_archivo", "pdf_nombre"]), "factura-recibida.pdf");
  const pdfBase64 = cleanBase64(pick(raw, ["file_base64", "pdf_base64", "b64_pdf", "B64_PDF", "pdf", "data"]));
  const email = asObject(raw.email);
  const rawMetadata = asObject(raw.metadata);
  const source = text(
    pick(raw, ["source", "workflow", "origin"]),
    text(
      pick(rawMetadata, ["source", "workflow", "origin"]),
      text(pick(extraction, ["source", "workflow", "origin"]), null),
    ),
  );
  const frr = applyGastosToFrr(normalizeFrrPayload(extraction), extraction.gastos ?? raw.gastos);

  const proveedorNombre = text(pick(extraction, ["proveedor_nombre", "nombre_proveedor", "acreedor_nombre", "FRR_proveedor_nombre"]), null);
  const proveedorNif = text(pick(extraction, ["proveedor_nif", "nif_proveedor", "acreedor_nif", "cif"]), null);
  const lineasRaw =
    asArray(extraction.ctb).length > 0
      ? asArray(extraction.ctb)
      : asArray(extraction.lineas_ctb).length > 0
        ? asArray(extraction.lineas_ctb)
        : asArray(raw.ctb);

  const ctb = lineasRaw.map((linea, index) =>
    normalizeFrcPayload(linea, index + 1, { preserveRemoteIds: source === "apiCampojoyma-read-sample" })
  );
  const punteos = asArray(extraction.punteos ?? raw.punteos).map((punteo, index) =>
    normalizePunteoPayload(punteo, index + 1),
  );

  const sourcePageNumber = integerValue(pick(raw, ["source_page_number", "page_number"]), null);
  const sourcePageCount = integerValue(pick(raw, ["source_page_count", "page_count"]), null);

  const metadata = {
    proveedor_nombre: proveedorNombre,
    proveedor_nif: proveedorNif,
    source_pdf_name: text(pick(raw, ["source_pdf_name", "file_name", "filename"]), fileName),
    source_page_number: sourcePageNumber,
    source_page_count: sourcePageCount,
    email_from: text(pick(email, ["from", "from_email", "sender"]), null),
    email_subject: text(pick(email, ["subject", "asunto"]), null),
    email_received_at: timestampValue(pick(email, ["date", "received_at", "fecha"]), null),
    confidence: normalizeConfidence(
      pick(rawMetadata, ["confidence", "confianza"]) ??
        pick(extraction, ["confidence", "confianza"]),
    ),
  };

  const auditMetadata = {
    confidence: metadata.confidence,
    warnings: asStringArray(rawMetadata.warnings ?? extraction.warnings),
    raw_text_summary: text(rawMetadata.raw_text_summary ?? extraction.raw_text_summary, null),
  };

  const matchEvidence = asObject(
    sanitizeAuditValue(
      rawMetadata.match_evidence ??
        (extraction as JsonObject).match_evidence ??
        (extraction as JsonObject).matching,
    ),
  );

  return {
    frr,
    ctb,
    punteos,
    extraction,
    pdfBase64,
    fileName,
    metadata,
    auditMetadata,
    matchEvidence,
    source,
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const tokenResult = await requireAgentToken(req);
  if (!tokenResult.ok) return tokenResult.response;

  try {
    const body = await req.json();
    const envelope = asObject(body);
    const contractVersion = integerValue(envelope.contract_version, FACTURAS_RECIBIDAS_CONTRACT_VERSION);
    if (contractVersion !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return jsonResponse({ error: "contract_version=2 es requerido" }, 422);
    }
    const inputs: JsonObject[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.facturas)
        ? body.facturas
        : [body];

    const supabase = createServiceClient();
    const results: unknown[] = [];
    const errors: unknown[] = [];

    for (const [index, input] of inputs.entries()) {
      try {
        const requestId = requestIdValue(input.request_id ?? (inputs.length === 1 ? envelope.request_id : null));
        const normalized = normalizeOnePayload(input);
        const pdfResult = await ensureArchivoPdf(supabase, normalized.pdfBase64, normalized.fileName);

        const duplicateCandidates = [];
        if (pdfResult.archivoPdfId) {
          const { data: pdfDup } = await supabase
            .from("facturasrecibidas")
            .select("id")
            .eq("archivo_pdf_id", pdfResult.archivoPdfId)
            .limit(1);
          if (pdfDup?.[0]?.id) duplicateCandidates.push(pdfDup[0].id);
        }

        if (normalized.frr.FRR_idproveedor && normalized.frr.FRR_numerofactura) {
          const { data: supplierDup } = await supabase
            .from("facturasrecibidas")
            .select("id")
            .eq("FRR_idproveedor", normalized.frr.FRR_idproveedor)
            .eq("FRR_numerofactura", normalized.frr.FRR_numerofactura)
            .neq("estado", "duplicada")
            .limit(1);
          if (supplierDup?.[0]?.id) duplicateCandidates.push(supplierDup[0].id);
        }

        const baseValidationErrors = await getValidationErrorsForFactura(supabase, normalized.frr);
        const warningErrors = normalized.auditMetadata.warnings.map((message) => ({
          field: "metadata.warnings",
          message,
          severity: "warning" as const,
        }));
        const validationErrors = [
          ...baseValidationErrors,
          ...warningErrors.filter(
            (warning) => !baseValidationErrors.some((issue) => issue.message === warning.message),
          ),
        ];
        const duplicateOf = duplicateCandidates[0] ?? null;
        const nextEstado = duplicateOf
          ? "duplicada"
          : validationErrors.some((error) => error.severity === "error")
            ? "pendiente_revision"
            : "validada";

        const { data: saved, error: insertError } = await supabase.rpc("create_factura_recibida_v2", {
          p_factura: {
            ...normalized.metadata,
            ...normalized.frr,
            archivo_pdf_id: pdfResult.archivoPdfId,
            duplicada_de: duplicateOf,
            estado: nextEstado,
            source_kind: normalized.source === "apiCampojoyma-read-sample" ? "erp_reference" : "n8n_draft",
            remote_frr_id: integerValue((normalized.extraction as JsonObject).remote_id, null),
            is_readonly_reference: normalized.source === "apiCampojoyma-read-sample",
            match_status: normalized.source === "apiCampojoyma-read-sample" ? "reference" : "matched",
            match_evidence: normalized.matchEvidence,
            extraction: {
              ...normalized.extraction,
              metadata: normalized.auditMetadata,
            },
            validation_errors: validationErrors,
          },
          p_ctb: normalized.ctb,
          p_punteos: normalized.punteos,
          p_actor: null,
          p_request_id: requestId,
          p_change_source: normalized.source === "apiCampojoyma-read-sample" ? "erp_import" : "ingest",
          p_reason: "Ingesta autenticada desde agente/n8n",
        });

        if (insertError || !saved) throw insertError ?? new Error("No se pudo insertar factura recibida.");
        const result = asObject(saved);
        const factura = asObject(result.factura);

        results.push({
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          factura_id: factura.id,
          estado: factura.estado,
          archivo_pdf_id: factura.archivo_pdf_id,
          version: result.version,
          pdf_reutilizado: pdfResult.reused,
          duplicada_de: duplicateOf,
          validation_errors: validationErrors,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ index, error: message, status: rpcErrorStatus(message) });
      }
    }

    return jsonResponse(
      {
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        success: errors.length === 0,
        facturas_created: results.length,
        results,
        errors: errors.length > 0 ? errors : undefined,
      },
      errors.length > 0 && results.length === 0 ? 400 : errors.length > 0 ? 207 : 200,
    );
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
