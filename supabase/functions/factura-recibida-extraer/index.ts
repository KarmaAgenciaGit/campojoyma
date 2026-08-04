import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  cleanBase64,
  corsHeaders,
  ensureArchivoPdf,
  fetchERPReadConsulta,
  filterFacturaERPWarningsAfterDuplicateVerification,
  getFacturaERPDocumentedReferenceIssues,
  getFacturaERPDocumentedReferenceCount,
  getFacturaProveedorTipoFromMatchEvidence,
  getValidationErrorsForFactura,
  loadAndResolveFacturaERPAccountingRules,
  mergeValidationIssues,
  integerValue,
  jsonResponse,
  loadArchivoPdfBase64,
  pick,
  prepareFacturaExtractionPersistence,
  requestIdValue,
  requireRouteUser,
  resolveFacturaERPExistingPunteoLinks,
  resolveFacturaProveedorTipo,
  rpcErrorStatus,
  sanitizeUntrustedFacturaAccountingFields,
  sanitizeUntrustedPunteoSelections,
  signJwtHs256,
  syncFacturaERPAccountingMatchEvidence,
  text,
  verifyFacturaERPExactDuplicate,
  verifyFacturaERPExactMAPunteos,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";
import {
  assertFacturaExtractionResponseContract,
  classifyFacturaExtractionUpstreamFailure,
  normalizeFacturaExtractionPayload,
} from "../_shared/factura-recibida-extraction.ts";

const DEFAULT_WEBHOOK_URL =
  "https://n8nbecarios.srv894901.hstgr.cloud/webhook/campojoyma-factura-extraer";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/\./g, "").replace(",", ".").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parsePositiveInt = (value: unknown): number | null => {
  const parsed = integerValue(
    typeof value === "string" ? value.replace(/^archivo_pdf_id:/, "") : value,
    null,
  );
  return parsed && parsed > 0 ? parsed : null;
};

const buildWebhookHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const jwtSecret = Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET");
  if (jwtSecret) {
    const expiresInSeconds = parsePositiveInt(Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS")) ?? 300;
    headers.Authorization = `Bearer ${await signJwtHs256(jwtSecret, expiresInSeconds)}`;
  }
  return headers;
};

const readResponseJson = async (response: Response): Promise<unknown> => {
  const rawText = await response.text();
  if (!rawText.trim()) return {};
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`El servicio de analisis devolvio una respuesta no valida (${response.status})`);
  }
};

const extractionError = ({
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
  category: "validation" | "environment" | "conflict" | "transport" | "accounting";
  userMessage: string;
  requestId: string | null;
  retryable?: boolean;
  extra?: JsonObject;
}) =>
  jsonResponse({
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
    ...extra,
  }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return extractionError({
      status: 405,
      code: "invalid_operation",
      category: "validation",
      userMessage: "Método no permitido.",
      requestId: null,
    });
  }

  let activeRequestId: string | null = null;
  try {
    const auth = await requireRouteUser(req);
    if (!auth.ok) {
      const status = auth.response.status;
      return extractionError({
        status,
        code: status === 403
          ? "forbidden"
          : status === 401
            ? "unauthorized"
            : "upstream_unavailable",
        category: status >= 500 ? "transport" : "validation",
        userMessage: status === 403
          ? "No tiene permiso para trabajar con facturas recibidas."
          : status === 401
            ? "Debe iniciar sesión para trabajar con facturas recibidas."
            : "No se pudo comprobar el acceso a facturas recibidas.",
        requestId: null,
        retryable: status >= 500,
      });
    }

    const body = asObject(await req.json().catch(() => ({})));
    const contractVersion = integerValue(body.contract_version, FACTURAS_RECIBIDAS_CONTRACT_VERSION);
    if (contractVersion !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return extractionError({
        status: 422,
        code: "invalid_contract",
        category: "validation",
        userMessage: "contract_version=2 es requerido.",
        requestId: null,
      });
    }

    const requestId = requestIdValue(body.request_id);
    activeRequestId = requestId;
    const serviceClient = auth.serviceClient;
    const facturaId = text(body.factura_id, null);
    const source = text(body.source, "front_draft")!;
    const expectedVersion = integerValue(
      body.expected_version ?? body.row_version ?? body.version,
      null,
    );
    let existingFactura: JsonObject | null = null;

    if (facturaId) {
      const { data, error } = await serviceClient
        .from("facturasrecibidas")
        .select("*")
        .eq("id", facturaId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return extractionError({
          status: 404,
          code: "not_found",
          category: "validation",
          userMessage: "Factura no encontrada.",
          requestId,
        });
      }
      existingFactura = asObject(data);
      if (!expectedVersion || expectedVersion < 1) {
        return extractionError({
          status: 422,
          code: "invalid_invoice",
          category: "validation",
          userMessage: "expected_version es requerido para volver a extraer.",
          requestId,
        });
      }
      if (integerValue(existingFactura.row_version, null) !== expectedVersion) {
        return extractionError({
          status: 409,
          code: "version_conflict",
          category: "conflict",
          userMessage:
            "La factura ha cambiado. Recárguela antes de volver a extraer.",
          requestId,
          extra: {
            expected_version: expectedVersion,
            current_version: existingFactura.row_version,
          },
        });
      }
      if (
        existingFactura.FRR_id ||
        existingFactura.remote_frr_id ||
        existingFactura.is_readonly_reference === true ||
        ["sending", "unknown", "reconciling", "sent"].includes(String(existingFactura.sync_status ?? ""))
      ) {
        return extractionError({
          status: 409,
          code: "invoice_locked",
          category: "conflict",
          userMessage: "La factura ya no se puede volver a extraer.",
          requestId,
        });
      }
    }

    let archivoPdfId = parsePositiveInt(body.archivo_pdf_id ?? body.pdf_path ?? existingFactura?.archivo_pdf_id);
    const incomingBase64 = cleanBase64(
      body.pdf_base64 ?? body.file_base64 ?? body.b64_pdf ?? body.data,
    );
    const incomingName = text(
      body.pdf_nombre ?? body.file_name ?? body.filename,
      text(existingFactura?.source_pdf_name, "factura-recibida.pdf"),
    );

    if (incomingBase64) {
      const pdf = await ensureArchivoPdf(serviceClient, incomingBase64, incomingName, auth.user.id);
      archivoPdfId = pdf.archivoPdfId;
    }
    if (!archivoPdfId) {
      return extractionError({
        status: 422,
        code: "invalid_invoice",
        category: "validation",
        userMessage: "Falta un PDF asociado a la factura.",
        requestId,
      });
    }

    const { data: archivoPdf, error: archivoError } = await serviceClient
      .from("archivos_pdf")
      .select("id, b64_contenido, storage_bucket, storage_path, nombre_archivo, mime_type, tamanio_bytes")
      .eq("id", archivoPdfId)
      .maybeSingle();
    if (archivoError) throw archivoError;
    if (!archivoPdf) {
      return extractionError({
        status: 404,
        code: "not_found",
        category: "validation",
        userMessage: "PDF no encontrado.",
        requestId,
      });
    }

    const archivo = asObject(archivoPdf);
    const pdfBase64 = incomingBase64 ?? await loadArchivoPdfBase64(serviceClient, archivo);
    if (!pdfBase64) {
      return extractionError({
        status: 422,
        code: "invalid_invoice",
        category: "validation",
        userMessage: "El PDF no tiene contenido disponible.",
        requestId,
      });
    }

    const pdfNombre = text(body.pdf_nombre, text(archivo.nombre_archivo, incomingName))!;
    const pdfMimeType = text(body.pdf_mime_type, text(archivo.mime_type, "application/pdf"))!;
    const pdfSize = numberOrNull(body.pdf_size) ?? numberOrNull(archivo.tamanio_bytes);
    const webhookUrl = Deno.env.get("N8N_CAMPOJOYMA_EXTRACT_WEBHOOK_URL") || DEFAULT_WEBHOOK_URL;

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: await buildWebhookHeaders(),
      body: JSON.stringify({
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        request_id: requestId,
        factura_id: facturaId,
        archivo_pdf_id: archivoPdfId,
        source,
        pdf_base64: pdfBase64,
        pdf_nombre: pdfNombre,
        pdf_mime_type: pdfMimeType,
        pdf_size: pdfSize,
        email: asObject(body.email),
        requested_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const webhookJson = await readResponseJson(webhookResponse);
    if (!webhookResponse.ok) {
      const failure = classifyFacturaExtractionUpstreamFailure(
        webhookResponse.status,
        webhookJson,
        requestId,
      );
      return extractionError({
        status: failure.status,
        code: failure.code,
        category: failure.category,
        userMessage: failure.userMessage,
        requestId,
        retryable: failure.retryable,
      });
    }

    assertFacturaExtractionResponseContract(webhookJson, requestId);
    const normalized = normalizeFacturaExtractionPayload(webhookJson);
    const sanitizedExtractedFrr = sanitizeUntrustedFacturaAccountingFields(normalized.frr);
    const extractionPersistence = prepareFacturaExtractionPersistence({
      existingFactura,
      extractedFrr: sanitizedExtractedFrr,
      ctb: normalized.ctb,
      punteos: sanitizeUntrustedPunteoSelections(normalized.punteos),
    });
    const normalizedMatchEvidence = asObject(
      normalized.metadata.match_evidence ??
        normalized.extraction.match_evidence ??
        normalized.extraction.matching,
    );
    const proveedorTipo = getFacturaProveedorTipoFromMatchEvidence(
      normalizedMatchEvidence,
      extractionPersistence.factura.FRR_idproveedor,
    );
    const accountingRules = await loadAndResolveFacturaERPAccountingRules(
      serviceClient,
      extractionPersistence.factura,
      proveedorTipo,
    );
    const accountingEvidence = asObject(accountingRules.evidence);
    let resolvedMatchEvidence = syncFacturaERPAccountingMatchEvidence(
      normalizedMatchEvidence,
      accountingRules,
    );
    const resolvedFrr = accountingRules.factura;
    const duplicateVerification = await verifyFacturaERPExactDuplicate(
      resolvedFrr,
      fetchERPReadConsulta,
    );
    const verifiedExactDuplicate = duplicateVerification.duplicate;
    resolvedMatchEvidence = {
      ...resolvedMatchEvidence,
      erp_duplicate_verification: duplicateVerification.evidence,
    };
    let punteoVerificationIssues: Awaited<
      ReturnType<typeof verifyFacturaERPExactMAPunteos>
    >["issues"] = [];
    if (verifiedExactDuplicate) {
      const existingPunteoLinks = await resolveFacturaERPExistingPunteoLinks(
        duplicateVerification,
        fetchERPReadConsulta,
        {
          requireNonEmpty: getFacturaERPDocumentedReferenceCount(
            normalized.extraction,
            resolvedMatchEvidence,
          ) > 0,
        },
      );
      extractionPersistence.punteos = existingPunteoLinks.punteos;
      punteoVerificationIssues = existingPunteoLinks.issues;
      resolvedMatchEvidence = {
        ...resolvedMatchEvidence,
        punteos_edge_verification: existingPunteoLinks.evidence,
      };
    } else if (extractionPersistence.punteos !== null) {
        const punteoVerification = await verifyFacturaERPExactMAPunteos(
          resolvedFrr,
          normalized.punteos,
          fetchERPReadConsulta,
        );
        extractionPersistence.punteos = punteoVerification.punteos;
        punteoVerificationIssues = punteoVerification.issues;
        resolvedMatchEvidence = {
          ...resolvedMatchEvidence,
          punteos_edge_verification: punteoVerification.evidence,
        };
    }
    const documentedReferenceIssues = getFacturaERPDocumentedReferenceIssues({
      factura: resolvedFrr,
      extraction: normalized.extraction,
      matchEvidence: resolvedMatchEvidence,
      punteos: extractionPersistence.punteos ?? [],
      existingInvoiceVerified: verifiedExactDuplicate,
    });
    const persistedFrr = {
      ...extractionPersistence.persistedFrr,
      ...accountingRules.applied,
    };
    const validationBase = await getValidationErrorsForFactura(resolvedFrr);
    const validationErrors = mergeValidationIssues(
      [
        ...accountingRules.issues,
        ...duplicateVerification.issues,
        ...punteoVerificationIssues,
        ...documentedReferenceIssues,
        ...validationBase,
      ],
      filterFacturaERPWarningsAfterDuplicateVerification(
        normalized.warnings,
        verifiedExactDuplicate,
      ),
    );
    const hasBlockingErrors = validationErrors.some((issue) => issue.severity !== "warning");

    const duplicateCandidates: string[] = [];
    const { data: pdfDuplicates, error: pdfDupError } = await serviceClient
      .from("facturasrecibidas")
      .select("id")
      .eq("archivo_pdf_id", archivoPdfId)
      .neq("estado", "duplicada")
      .neq("estado", "descartada")
      .limit(2);
    if (pdfDupError) throw pdfDupError;
    for (const candidate of asArray(pdfDuplicates)) {
      const id = text(asObject(candidate).id, null);
      if (id && id !== facturaId) duplicateCandidates.push(id);
    }

    const empresaId = integerValue(resolvedFrr.FRR_Idempresa, null);
    const ejercicio = integerValue(resolvedFrr.FRR_ejercicio, null);
    const proveedorId = integerValue(resolvedFrr.FRR_idproveedor, null);
    const numeroFactura = text(resolvedFrr.FRR_numerofactura, null);
    const resolvedProveedorTipo = resolveFacturaProveedorTipo(
      resolvedFrr,
      proveedorTipo,
    );
    if (
      empresaId &&
      ejercicio &&
      proveedorId &&
      numeroFactura &&
      resolvedProveedorTipo
    ) {
      let supplierQuery = serviceClient
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
      const { data: supplierDuplicates, error: supplierDupError } =
        await supplierQuery.limit(2);
      if (supplierDupError) throw supplierDupError;
      for (const candidate of asArray(supplierDuplicates)) {
        const id = text(asObject(candidate).id, null);
        if (id && id !== facturaId) duplicateCandidates.push(id);
      }
    }

    const duplicatedOf = duplicateCandidates[0] ?? null;
    const estado = duplicatedOf ? "duplicada" : hasBlockingErrors ? "pendiente_revision" : "validada";
    const providerName = text(
      pick(normalized.extraction, ["proveedor_nombre", "supplier_name"]),
      text(pick(normalized.metadata, ["proveedor_nombre", "supplier_name"]), null),
    );
    const providerNif = text(
      pick(normalized.extraction, ["proveedor_nif", "supplier_nif", "nif"]),
      text(pick(normalized.metadata, ["proveedor_nif", "supplier_nif", "nif"]), null),
    );
    const rawConfidence = numberOrNull(
      pick(normalized.metadata, ["confidence", "confianza"]) ?? normalized.extraction.confidence,
    );
    const confidence = rawConfidence === null
      ? null
      : rawConfidence > 1
        ? (rawConfidence <= 100 ? rawConfidence / 100 : null)
        : rawConfidence;

    const facturaPayload: JsonObject = {
      ...persistedFrr,
      archivo_pdf_id: archivoPdfId,
      duplicada_de: duplicatedOf,
      estado,
      proveedor_nombre: providerName,
      proveedor_nif: providerNif,
      source_pdf_name: pdfNombre,
      confidence,
      source_kind: "front_draft",
      fecha_ctb_source:
        existingFactura?.fecha_ctb_source === "manual" ? "manual" : "invoice_date",
      remote_frr_id: null,
      is_readonly_reference: false,
      match_status: normalized.warnings.length > 0 || hasBlockingErrors ? "ambiguous" : "matched",
      match_evidence: resolvedMatchEvidence,
      extraction: {
        ...normalized.extraction,
        metadata: {
          ...normalized.metadata,
          erp_accounting: accountingEvidence,
        },
      },
      validation_errors: validationErrors,
    };

    const rpcName = facturaId ? "save_factura_recibida_v2" : "create_factura_recibida_v2";
    const rpcArguments = facturaId
      ? {
        p_factura_id: facturaId,
        p_expected_version: expectedVersion,
        p_factura: facturaPayload,
        p_ctb: extractionPersistence.ctb,
        p_punteos: extractionPersistence.punteos,
        p_actor: auth.user.id,
        p_request_id: requestId,
        p_change_source: "extract",
        p_reason: "Extraccion OCR/n8n",
      }
      : {
        p_factura: facturaPayload,
        p_ctb: extractionPersistence.ctb,
        p_punteos: extractionPersistence.punteos,
        p_actor: auth.user.id,
        p_request_id: requestId,
        p_change_source: "extract",
        p_reason: "Extraccion OCR/n8n",
      };

    const { data: saved, error: saveError } = await serviceClient.rpc(rpcName, rpcArguments);
    if (saveError) {
      console.error("factura-recibida-extraer persistence error", saveError);
      const status = rpcErrorStatus(saveError.message);
      const userMessage = status === 409
        ? "La factura ha cambiado mientras se procesaba. Recárguela antes de continuar."
        : "La extracción terminó, pero no se pudo guardar la factura.";
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          code: status === 409 ? "idempotency_conflict" : "upstream_unavailable",
          category: status === 409 ? "conflict" : "transport",
          user_message: userMessage,
          error: userMessage,
          technical_details: {},
          retryable: status >= 500,
          reconciliation_required: false,
          target_id: null,
          dataset_epoch: null,
        },
        status,
      );
    }

    const result = asObject(saved);
    const savedFactura = asObject(result.factura);
    return jsonResponse({
      contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
      request_id: requestId,
      ok: true,
      factura_id: savedFactura.id,
      version: result.version,
      estado: savedFactura.estado ?? estado,
      archivo_pdf_id: archivoPdfId,
      duplicada_de: duplicatedOf,
      validation_errors: validationErrors,
      factura: savedFactura,
      ctb: result.ctb ?? extractionPersistence.ctb,
      punteos: result.punteos ?? extractionPersistence.punteos,
    });
  } catch (error) {
    console.error("factura-recibida-extraer error", error);
    const message = error instanceof Error ? error.message : "No se pudo extraer la factura recibida";
    const timeout = error instanceof DOMException && error.name === "TimeoutError";
    const status = timeout ? 504 : rpcErrorStatus(message);
    const userMessage = timeout
      ? "La extracción ha tardado demasiado. Puede volver a intentarlo."
      : "No se pudo completar la extracción de la factura.";
    return jsonResponse({
      contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
      request_id: activeRequestId,
      code: "upstream_unavailable",
      category: "transport",
      user_message: userMessage,
      error: userMessage,
      technical_details: {},
      retryable: timeout || status >= 500,
      reconciliation_required: false,
      target_id: null,
      dataset_epoch: null,
    }, status);
  }
});
