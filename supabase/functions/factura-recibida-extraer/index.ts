import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  applyGastosToFrr,
  cleanBase64,
  corsHeaders,
  ensureArchivoPdf,
  fetchERPReadConsulta,
  getFacturaERPDocumentedReferenceIssues,
  getFacturaProveedorTipoFromMatchEvidence,
  getValidationErrorsForFactura,
  loadAndResolveFacturaERPAccountingRules,
  mergeValidationIssues,
  integerValue,
  jsonResponse,
  loadArchivoPdfBase64,
  normalizeFrcPayload,
  normalizePunteoPayload,
  normalizeFrrPayload,
  pick,
  prepareFacturaExtractionPersistence,
  requestIdValue,
  requireRouteUser,
  resolveFacturaProveedorTipo,
  rpcErrorStatus,
  sanitizeUntrustedFacturaAccountingFields,
  sanitizeUntrustedPunteoSelections,
  signJwtHs256,
  syncFacturaERPAccountingMatchEvidence,
  text,
  verifyFacturaERPExactMAPunteos,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";

const DEFAULT_WEBHOOK_URL =
  "https://n8nbecarios.srv894901.hstgr.cloud/webhook/campojoyma-factura-extraer";

type NormalizedExtraction = {
  frr: JsonObject;
  ctb: JsonObject[];
  punteos: JsonObject[];
  extraction: JsonObject;
  metadata: JsonObject;
  warnings: string[];
};

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

const warningTexts = (...sources: unknown[]): string[] => {
  const warnings: string[] = [];
  for (const source of sources) {
    for (const entry of asArray(source)) {
      if (typeof entry === "string" && entry.trim()) warnings.push(entry.trim());
      if (entry && typeof entry === "object") {
        const message = text(pick(entry as JsonObject, ["message", "mensaje", "warning"]), null);
        if (message) warnings.push(message);
      }
    }
  }
  return Array.from(new Set(warnings));
};

const normalizeN8nResponse = (raw: unknown): NormalizedExtraction => {
  const rawObject = asObject(raw);
  if (rawObject.ok === false) {
    throw new Error(
      text(
        pick(rawObject, ["error", "message"]),
        "El servicio de analisis no pudo extraer la factura",
      )!,
    );
  }

  const root = asObject(rawObject.ingest_payload ?? rawObject.payload ?? rawObject.output ?? rawObject);
  const output = asObject(root.output ?? root);
  const extraction = asObject(output.extraction ?? output.factura ?? output.invoice ?? output);
  const metadata = asObject(output.metadata ?? root.metadata ?? rawObject.metadata);
  const ctbSource = output.ctb ?? extraction.ctb ?? extraction.lineas_ctb;
  const punteosSource = output.punteos ?? extraction.punteos;

  return {
    frr: applyGastosToFrr(normalizeFrrPayload(extraction), output.gastos ?? extraction.gastos),
    ctb: asArray(ctbSource).map((linea, index) => normalizeFrcPayload(asObject(linea), index + 1)),
    punteos: asArray(punteosSource).map((punteo, index) =>
      normalizePunteoPayload(asObject(punteo), index + 1)
    ),
    extraction,
    metadata,
    warnings: warningTexts(metadata.warnings, extraction.warnings, output.warnings),
  };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Metodo no permitido" }, 405);

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = asObject(await req.json().catch(() => ({})));
    const contractVersion = integerValue(body.contract_version, FACTURAS_RECIBIDAS_CONTRACT_VERSION);
    if (contractVersion !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return jsonResponse({ error: "contract_version=2 es requerido" }, 422);
    }

    const requestId = requestIdValue(body.request_id);
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
      if (!data) return jsonResponse({ error: "Factura no encontrada" }, 404);
      existingFactura = asObject(data);
      if (!expectedVersion || expectedVersion < 1) {
        return jsonResponse({ error: "expected_version es requerido para reextraer" }, 422);
      }
      if (integerValue(existingFactura.row_version, null) !== expectedVersion) {
        return jsonResponse(
          {
            error: `VERSION_CONFLICT: esperada ${expectedVersion}, actual ${existingFactura.row_version}`,
          },
          409,
        );
      }
      if (
        existingFactura.FRR_id ||
        existingFactura.remote_frr_id ||
        existingFactura.is_readonly_reference === true ||
        ["sending", "unknown", "reconciling", "sent"].includes(String(existingFactura.sync_status ?? ""))
      ) {
        return jsonResponse({ error: "FACTURA_LOCKED: la factura no se puede reextraer" }, 409);
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
      return jsonResponse(
        { error: "Falta pdf_base64, archivo_pdf_id o una factura con PDF asociado" },
        422,
      );
    }

    const { data: archivoPdf, error: archivoError } = await serviceClient
      .from("archivos_pdf")
      .select("id, b64_contenido, storage_bucket, storage_path, nombre_archivo, mime_type, tamanio_bytes")
      .eq("id", archivoPdfId)
      .maybeSingle();
    if (archivoError) throw archivoError;
    if (!archivoPdf) return jsonResponse({ error: "PDF no encontrado" }, 404);

    const archivo = asObject(archivoPdf);
    const pdfBase64 = incomingBase64 ?? await loadArchivoPdfBase64(serviceClient, archivo);
    if (!pdfBase64) return jsonResponse({ error: "El PDF no tiene contenido disponible" }, 422);

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
    });

    const webhookJson = await readResponseJson(webhookResponse);
    if (!webhookResponse.ok) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          error: "El servicio de analisis no pudo extraer la factura",
          status: webhookResponse.status,
          details: webhookJson,
        },
        502,
      );
    }

    const normalized = normalizeN8nResponse(webhookJson);
    const sanitizedExtractedFrr = sanitizeUntrustedFacturaAccountingFields(normalized.frr);
    const extractionPersistence = prepareFacturaExtractionPersistence({
      existingFactura,
      extractedFrr: sanitizedExtractedFrr,
      ctb: [],
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
    let punteoVerificationIssues: Awaited<
      ReturnType<typeof verifyFacturaERPExactMAPunteos>
    >["issues"] = [];
    if (extractionPersistence.punteos !== null) {
      const punteoVerification = await verifyFacturaERPExactMAPunteos(
        accountingRules.factura,
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
    const resolvedFrr = accountingRules.factura;
    const documentedReferenceIssues = getFacturaERPDocumentedReferenceIssues({
      factura: resolvedFrr,
      extraction: normalized.extraction,
      matchEvidence: resolvedMatchEvidence,
      punteos: extractionPersistence.punteos ?? [],
    });
    const persistedFrr = {
      ...extractionPersistence.persistedFrr,
      ...accountingRules.applied,
    };
    const validationBase = await getValidationErrorsForFactura(resolvedFrr);
    const validationErrors = mergeValidationIssues(
      [
        ...accountingRules.issues,
        ...punteoVerificationIssues,
        ...documentedReferenceIssues,
        ...validationBase,
      ],
      normalized.warnings,
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
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          error: saveError.message,
        },
        rpcErrorStatus(saveError.message),
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
    return jsonResponse({ error: message }, rpcErrorStatus(message));
  }
});
