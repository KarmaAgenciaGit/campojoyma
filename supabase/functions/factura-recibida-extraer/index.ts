import {
  corsHeaders,
  getValidationErrorsForFactura,
  jsonResponse,
  normalizeFrcPayload,
  normalizeFrrPayload,
  pick,
  requireRouteUser,
  signJwtHs256,
  text,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";

const DEFAULT_WEBHOOK_URL =
  "https://n8nbecarios.srv894901.hstgr.cloud/webhook/campojoyma-factura-extraer";

type ValidationIssue = {
  field: string;
  message: string;
  severity: "error" | "warning";
};

type NormalizedExtraction = {
  frr: JsonObject;
  ctb: JsonObject[];
  extraction: JsonObject;
  metadata: JsonObject;
  warnings: string[];
};

const asObject = (value: unknown): JsonObject => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
};

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
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/^archivo_pdf_id:/, ""));
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
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
    throw new Error(text(pick(rawObject, ["error", "message"]), "n8n no pudo extraer la factura")!);
  }

  const root = asObject(rawObject.ingest_payload ?? rawObject.payload ?? rawObject.output ?? rawObject);
  const output = asObject(root.output ?? root);
  const extraction = asObject(output.extraction ?? output.factura ?? output.invoice ?? output);
  const metadata = asObject(output.metadata ?? root.metadata ?? rawObject.metadata);
  const ctbSource = output.ctb ?? extraction.ctb ?? extraction.lineas_ctb ?? extraction.lineas;
  const warnings = warningTexts(metadata.warnings, extraction.warnings, output.warnings);

  return {
    frr: normalizeFrrPayload(extraction),
    ctb: asArray(ctbSource).map((linea, index) => normalizeFrcPayload(asObject(linea), index + 1)),
    extraction,
    metadata,
    warnings,
  };
};

const appendWarningIssues = (issues: unknown[], warnings: string[]): ValidationIssue[] => {
  const normalized = asArray(issues).map((issue) => {
    const object = asObject(issue);
    return {
      field: text(object.field, "extraction")!,
      message: text(object.message, "Aviso de extraccion")!,
      severity: object.severity === "warning" ? "warning" : "error",
    } satisfies ValidationIssue;
  });

  const existing = new Set(normalized.map((issue) => issue.message));
  for (const warning of warnings) {
    if (!existing.has(warning)) {
      normalized.push({ field: "extraction", message: warning, severity: "warning" });
    }
  }
  return normalized;
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
    throw new Error(`n8n devolvio una respuesta no JSON (${response.status})`);
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Metodo no permitido" }, 405);
  }

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = asObject(await req.json().catch(() => ({})));
    const serviceClient = auth.serviceClient;

    const facturaId = text(body.factura_id, null);
    const source = text(body.source, "xfuego-front")!;
    let archivoPdfId = parsePositiveInt(body.archivo_pdf_id ?? body.pdf_path);
    let existingFactura: JsonObject | null = null;

    if (!archivoPdfId && facturaId) {
      const { data, error } = await serviceClient
        .from("facturasrecibidas")
        .select("id, archivo_pdf_id, source_pdf_name, email_from, email_subject, email_received_at")
        .eq("id", facturaId)
        .maybeSingle();

      if (error) throw error;
      existingFactura = asObject(data);
      archivoPdfId = parsePositiveInt(existingFactura.archivo_pdf_id);
    }

    if (!archivoPdfId) {
      return jsonResponse({ error: "Falta archivo_pdf_id o factura_id con PDF asociado" }, 400);
    }

    const { data: archivoPdf, error: archivoError } = await serviceClient
      .from("archivos_pdf")
      .select("id, b64_contenido, nombre_archivo, mime_type, tamanio_bytes")
      .eq("id", archivoPdfId)
      .maybeSingle();

    if (archivoError) throw archivoError;
    const archivo = asObject(archivoPdf);
    const pdfBase64 = text(archivo.b64_contenido, null);
    if (!pdfBase64) {
      return jsonResponse({ error: "El PDF no tiene contenido base64 disponible" }, 422);
    }

    const pdfNombre = text(body.pdf_nombre, text(archivo.nombre_archivo, text(existingFactura?.source_pdf_name, "factura-recibida.pdf")))!;
    const pdfMimeType = text(body.pdf_mime_type, text(archivo.mime_type, "application/pdf"))!;
    const pdfSize = numberOrNull(body.pdf_size) ?? numberOrNull(archivo.tamanio_bytes);

    const webhookUrl = Deno.env.get("N8N_CAMPOJOYMA_EXTRACT_WEBHOOK_URL") || DEFAULT_WEBHOOK_URL;
    const n8nPayload = {
      factura_id: facturaId,
      archivo_pdf_id: archivoPdfId,
      source,
      pdf_base64: pdfBase64,
      pdf_nombre: pdfNombre,
      pdf_mime_type: pdfMimeType,
      pdf_size: pdfSize,
      email: asObject(body.email),
      requested_at: new Date().toISOString(),
    };

    const webhookResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: await buildWebhookHeaders(),
      body: JSON.stringify(n8nPayload),
    });

    const webhookJson = await readResponseJson(webhookResponse);
    if (!webhookResponse.ok) {
      return jsonResponse(
        {
          error: "n8n no pudo extraer la factura",
          status: webhookResponse.status,
          details: webhookJson,
        },
        502,
      );
    }

    const normalized = normalizeN8nResponse(webhookJson);
    if (typeof normalized.frr.FRR_Concepto === "string" && normalized.frr.FRR_Concepto.length > 50) {
      normalized.frr.FRR_Concepto = normalized.frr.FRR_Concepto.slice(0, 50);
    }
    const validationBase = await getValidationErrorsForFactura(serviceClient, normalized.frr);
    const validationErrors = appendWarningIssues(validationBase, normalized.warnings);
    const hasBlockingErrors = validationErrors.some((issue) => issue.severity !== "warning");

    const duplicateCandidates: string[] = [];
    const { data: pdfDuplicates, error: pdfDupError } = await serviceClient
      .from("facturasrecibidas")
      .select("id")
      .eq("archivo_pdf_id", archivoPdfId)
      .limit(1);
    if (pdfDupError) throw pdfDupError;
    for (const candidate of asArray(pdfDuplicates)) {
      const id = text(asObject(candidate).id, null);
      if (id && id !== facturaId) duplicateCandidates.push(id);
    }

    const proveedorId = normalized.frr.FRR_idproveedor;
    const numeroFactura = text(normalized.frr.FRR_numerofactura, null);
    if (proveedorId !== null && proveedorId !== undefined && numeroFactura) {
      const { data: supplierDuplicates, error: supplierDupError } = await serviceClient
        .from("facturasrecibidas")
        .select("id")
        .eq("FRR_idproveedor", proveedorId)
        .eq("FRR_numerofactura", numeroFactura)
        .limit(1);
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
    const rawConfidence = numberOrNull(pick(normalized.metadata, ["confidence", "confianza"]) ?? normalized.extraction.confidence);
    const confidence =
      rawConfidence === null ? null : rawConfidence > 1 ? (rawConfidence <= 100 ? rawConfidence / 100 : null) : rawConfidence;

    const facturaPayload: JsonObject = {
      ...normalized.frr,
      archivo_pdf_id: archivoPdfId,
      duplicada_de: duplicatedOf,
      estado,
      proveedor_nombre: providerName,
      proveedor_nif: providerNif,
      source_pdf_name: pdfNombre,
      confidence,
      extraction: {
        ...normalized.extraction,
        metadata: normalized.metadata,
      },
      validation_errors: validationErrors,
      updated_by: auth.user.id,
    };

    let savedFactura: JsonObject;
    if (facturaId) {
      const { data, error } = await serviceClient
        .from("facturasrecibidas")
        .update(facturaPayload)
        .eq("id", facturaId)
        .select("id, estado, archivo_pdf_id, duplicada_de, validation_errors")
        .single();
      if (error) throw error;
      savedFactura = asObject(data);
    } else {
      const { data, error } = await serviceClient
        .from("facturasrecibidas")
        .insert({
          ...facturaPayload,
          created_by: auth.user.id,
        })
        .select("id, estado, archivo_pdf_id, duplicada_de, validation_errors")
        .single();
      if (error) throw error;
      savedFactura = asObject(data);
    }

    const savedId = text(savedFactura.id, null);
    if (!savedId) {
      throw new Error("No se pudo recuperar la factura creada");
    }

    await serviceClient.from("facturasrecibidas_ctb").delete().eq("factura_id", savedId);
    if (normalized.ctb.length > 0) {
      const ctbRows = normalized.ctb.map((linea, index) => ({
        ...linea,
        factura_id: savedId,
        posicion: index + 1,
        FRC_idfacturarecibida: null,
        FRC_Importe: linea.FRC_Importe ?? 0,
      }));
      const { error: ctbError } = await serviceClient.from("facturasrecibidas_ctb").insert(ctbRows);
      if (ctbError) throw ctbError;
    }

    return jsonResponse({
      ok: true,
      factura_id: savedId,
      estado,
      archivo_pdf_id: archivoPdfId,
      duplicada_de: duplicatedOf,
      validation_errors: validationErrors,
    });
  } catch (error) {
    console.error("factura-recibida-extraer error", error);
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "No se pudo extraer la factura recibida",
      },
      500,
    );
  }
});
