import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  corsHeaders,
  createServiceClient,
  ensureArchivoPdf,
  fetchERPReadConsulta,
  getFacturaERPDocumentedReferenceIssues,
  getFacturaProveedorTipoFromMatchEvidence,
  getValidationErrorsForFactura,
  loadAndResolveFacturaERPAccountingRules,
  mergeValidationIssues,
  integerValue,
  isValidRequestId,
  jsonResponse,
  requireAgentToken,
  requestHasServiceRoleCredential,
  resolveFacturaIngestAuthority,
  resolveFacturaProveedorTipo,
  rpcErrorStatus,
  syncFacturaERPAccountingMatchEvidence,
  text,
  verifyFacturaERPExactMAPunteos,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";
import {
  extractionObject,
  normalizeFacturaExtractionPayload,
} from "../_shared/factura-recibida-extraction.ts";

const asObject = extractionObject;

type IngestErrorCategory =
  | "validation"
  | "environment"
  | "conflict"
  | "transport"
  | "accounting";

type IngestErrorEnvelope = JsonObject & {
  code: string;
  category: IngestErrorCategory;
  user_message: string;
  technical_details: JsonObject;
  retryable: boolean;
  reconciliation_required: boolean;
  request_id: string | null;
  target_id: null;
  dataset_epoch: null;
  status: number;
};

const buildIngestError = ({
  status,
  code,
  category,
  userMessage,
  requestId,
  retryable = false,
  extra = {},
}: {
  status: number;
  code: string;
  category: IngestErrorCategory;
  userMessage: string;
  requestId: string | null;
  retryable?: boolean;
  extra?: JsonObject;
}): IngestErrorEnvelope => ({
  contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  code,
  category,
  user_message: userMessage,
  error: userMessage,
  technical_details: {},
  retryable,
  reconciliation_required: false,
  request_id: requestId,
  target_id: null,
  dataset_epoch: null,
  status,
  ...extra,
});

const ingestErrorResponse = (
  input: Parameters<typeof buildIngestError>[0],
) => {
  const error = buildIngestError(input);
  return jsonResponse(error, error.status);
};

const classifyIngestError = (
  message: string,
  requestId: string | null,
  index: number,
): IngestErrorEnvelope => {
  const status = rpcErrorStatus(message);
  if (message.includes("contract_version")) {
    return buildIngestError({
      status: 422,
      code: "invalid_contract",
      category: "validation",
      userMessage: "contract_version=2 es requerido en cada factura.",
      requestId,
      extra: { index },
    });
  }
  if (message.includes("request_id")) {
    return buildIngestError({
      status: 422,
      code: "invalid_request_id",
      category: "validation",
      userMessage: "Cada factura debe incluir un request_id UUID explícito.",
      requestId,
      extra: { index },
    });
  }
  if (/duplicad|unique|conflict/i.test(message) || status === 409) {
    return buildIngestError({
      status: 409,
      code: /duplicad|unique/i.test(message)
        ? "duplicate_invoice"
        : "idempotency_conflict",
      category: "conflict",
      userMessage: /duplicad|unique/i.test(message)
        ? "La factura coincide con otra factura ya registrada."
        : "La factura cambió durante la ingesta. Revise el resultado antes de reintentar.",
      requestId,
      extra: { index },
    });
  }
  if (status === 422) {
    return buildIngestError({
      status,
      code: "invalid_invoice",
      category: "validation",
      userMessage: "La factura no cumple el formato requerido para la ingesta.",
      requestId,
      extra: { index },
    });
  }
  return buildIngestError({
    status: status >= 500 ? status : 500,
    code: "upstream_unavailable",
    category: "transport",
    userMessage: "No se pudo guardar la factura recibida.",
    requestId,
    retryable: true,
    extra: { index },
  });
};

const normalizeOnePayload = (raw: JsonObject, trustedImportSignal: boolean) => {
  const normalizedExtraction = normalizeFacturaExtractionPayload(raw);
  const ingestAuthority = resolveFacturaIngestAuthority({
    frr: normalizedExtraction.frr,
    source: normalizedExtraction.source,
    remoteFrrId: normalizedExtraction.remoteFrrId,
    trustedImportSignal,
    ctb: normalizedExtraction.ctb,
    punteos: normalizedExtraction.punteos,
  });

  return {
    frr: ingestAuthority.frr,
    ctb: ingestAuthority.ctb,
    punteos: ingestAuthority.punteos,
    requestedPunteos: ingestAuthority.isERPReference
      ? []
      : normalizedExtraction.punteos,
    extraction: normalizedExtraction.extraction,
    pdfBase64: normalizedExtraction.pdfBase64,
    fileName: normalizedExtraction.fileName,
    metadata: normalizedExtraction.documentMetadata,
    auditMetadata: normalizedExtraction.auditMetadata,
    warnings: normalizedExtraction.warnings,
    matchEvidence: normalizedExtraction.matchEvidence,
    source: normalizedExtraction.source,
    isERPReference: ingestAuthority.isERPReference,
    remoteFrrId: ingestAuthority.remoteFrrId,
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return ingestErrorResponse({
      status: 405,
      code: "invalid_operation",
      category: "validation",
      userMessage: "Método no permitido.",
      requestId: null,
    });
  }

  let activeRequestId: string | null = null;
  try {
    const tokenResult = await requireAgentToken(req);
    if (!tokenResult.ok) {
      const status = tokenResult.response.status;
      return ingestErrorResponse({
        status,
        code: status === 401 ? "unauthorized" : "upstream_unavailable",
        category: status === 401 ? "validation" : "transport",
        userMessage: status === 401
          ? "La credencial de ingesta no es válida."
          : "No se pudo comprobar la credencial de ingesta.",
        requestId: null,
        retryable: status >= 500,
      });
    }
    const trustedImportSignal = await requestHasServiceRoleCredential(req);

    const body = await req.json();
    const envelope = asObject(body);
    activeRequestId = isValidRequestId(envelope.request_id)
      ? envelope.request_id.trim()
      : null;
    const contractVersion = integerValue(envelope.contract_version, null);
    if (contractVersion !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return ingestErrorResponse({
        status: 422,
        code: "invalid_contract",
        category: "validation",
        userMessage: "contract_version=2 es requerido.",
        requestId: isValidRequestId(envelope.request_id)
          ? envelope.request_id.trim()
          : null,
      });
    }
    const inputs: JsonObject[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.facturas)
        ? body.facturas
        : [body];

    const supabase = createServiceClient();
    const results: JsonObject[] = [];
    const errors: IngestErrorEnvelope[] = [];

    for (const [index, input] of inputs.entries()) {
      let itemRequestId: string | null = null;
      try {
        if (
          input.contract_version !== undefined &&
          integerValue(input.contract_version, null) !==
            FACTURAS_RECIBIDAS_CONTRACT_VERSION
        ) {
          throw new Error("contract_version=2 es requerido en cada factura");
        }
        const requestIdValue = input.request_id ??
          (inputs.length === 1 ? envelope.request_id : null);
        if (!isValidRequestId(requestIdValue)) {
          throw new Error("request_id UUID explicito es requerido");
        }
        const requestId = requestIdValue.trim();
        itemRequestId = requestId;
        const normalized = normalizeOnePayload(input, trustedImportSignal);
        const proveedorTipo = getFacturaProveedorTipoFromMatchEvidence(
          normalized.matchEvidence,
          normalized.frr.FRR_idproveedor,
        );
        const accountingRules = await loadAndResolveFacturaERPAccountingRules(
          supabase,
          normalized.frr,
          proveedorTipo,
        );
        normalized.frr = accountingRules.factura;
        normalized.matchEvidence = syncFacturaERPAccountingMatchEvidence(
          normalized.matchEvidence,
          accountingRules,
        );
        let punteoVerificationIssues: Awaited<
          ReturnType<typeof verifyFacturaERPExactMAPunteos>
        >["issues"] = [];
        if (!normalized.isERPReference) {
          const punteoVerification = await verifyFacturaERPExactMAPunteos(
            normalized.frr,
            normalized.requestedPunteos,
            fetchERPReadConsulta,
          );
          normalized.punteos = punteoVerification.punteos;
          punteoVerificationIssues = punteoVerification.issues;
          normalized.matchEvidence = {
            ...normalized.matchEvidence,
            punteos_edge_verification: punteoVerification.evidence,
          };
        }
        const documentedReferenceIssues = normalized.isERPReference
          ? []
          : getFacturaERPDocumentedReferenceIssues({
            factura: normalized.frr,
            extraction: normalized.extraction,
            matchEvidence: normalized.matchEvidence,
            punteos: normalized.punteos,
          });
        const pdfResult = await ensureArchivoPdf(supabase, normalized.pdfBase64, normalized.fileName);

        const duplicateCandidates = [];
        if (pdfResult.archivoPdfId) {
          const { data: pdfDup, error: pdfDupError } = await supabase
            .from("facturasrecibidas")
            .select("id")
            .eq("archivo_pdf_id", pdfResult.archivoPdfId)
            .neq("estado", "duplicada")
            .neq("estado", "descartada")
            .limit(1);
          if (pdfDupError) throw pdfDupError;
          if (pdfDup?.[0]?.id) duplicateCandidates.push(pdfDup[0].id);
        }

        const empresaId = integerValue(normalized.frr.FRR_Idempresa, null);
        const ejercicio = integerValue(normalized.frr.FRR_ejercicio, null);
        const proveedorId = integerValue(normalized.frr.FRR_idproveedor, null);
        const numeroFactura = text(normalized.frr.FRR_numerofactura, null);
        const resolvedProveedorTipo = resolveFacturaProveedorTipo(
          normalized.frr,
          proveedorTipo,
        );
        if (
          empresaId &&
          ejercicio &&
          proveedorId &&
          numeroFactura &&
          resolvedProveedorTipo
        ) {
          let supplierQuery = supabase
            .from("facturasrecibidas")
            .select("id")
            .eq("FRR_Idempresa", empresaId)
            .eq("FRR_ejercicio", ejercicio)
            .eq("FRR_idproveedor", proveedorId)
            .eq("FRR_numerofactura", numeroFactura)
            .neq("estado", "duplicada")
            .neq("estado", "descartada");
          supplierQuery = resolvedProveedorTipo === "agricultor"
            ? supplierQuery.eq("FRR_tipofactura", "GE")
            : supplierQuery.neq("FRR_tipofactura", "GE");
          const { data: supplierDup, error: supplierDupError } =
            await supplierQuery.limit(1);
          if (supplierDupError) throw supplierDupError;
          if (supplierDup?.[0]?.id) duplicateCandidates.push(supplierDup[0].id);
        }

        const baseValidationErrors = await getValidationErrorsForFactura(normalized.frr);
        const validationErrors = mergeValidationIssues(
          [
            ...accountingRules.issues,
            ...punteoVerificationIssues,
            ...documentedReferenceIssues,
            ...baseValidationErrors,
          ],
          normalized.warnings,
        );
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
            source_kind: normalized.isERPReference ? "erp_reference" : "n8n_draft",
            fecha_ctb_source: "invoice_date",
            remote_frr_id: normalized.remoteFrrId,
            is_readonly_reference: normalized.isERPReference,
            match_status: normalized.isERPReference ? "reference" : "matched",
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
          p_change_source: normalized.isERPReference ? "erp_import" : "ingest",
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
        errors.push(classifyIngestError(message, itemRequestId, index));
      }
    }

    if (errors.length > 0) {
      const primaryError = errors[0];
      const partial = results.length > 0;
      const userMessage = partial
        ? `Se registraron ${results.length} facturas, pero ${errors.length} requieren revisión.`
        : "No se pudo registrar ninguna factura del lote.";
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          success: false,
          facturas_created: results.length,
          results,
          errors,
          code: primaryError.code,
          category: primaryError.category,
          user_message: userMessage,
          error: userMessage,
          technical_details: {},
          retryable: errors.some((item) => item.retryable),
          reconciliation_required: false,
          request_id: inputs.length === 1
            ? primaryError.request_id ??
              (results[0]?.request_id as string | undefined) ??
              null
            : isValidRequestId(envelope.request_id)
              ? envelope.request_id.trim()
              : null,
          target_id: null,
          dataset_epoch: null,
        },
        partial ? 207 : primaryError.status,
      );
    }

    return jsonResponse(
      {
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        request_id: inputs.length === 1
          ? (results[0]?.request_id as string | undefined) ?? null
          : isValidRequestId(envelope.request_id)
            ? envelope.request_id.trim()
            : null,
        success: true,
        facturas_created: results.length,
        results,
      },
      200,
    );
  } catch (error) {
    console.error("factura-recibida-ingest error", error);
    return ingestErrorResponse({
      status: 500,
      code: "upstream_unavailable",
      category: "transport",
      userMessage: "No se pudo completar la ingesta de facturas.",
      requestId: activeRequestId,
      retryable: true,
    });
  }
});
