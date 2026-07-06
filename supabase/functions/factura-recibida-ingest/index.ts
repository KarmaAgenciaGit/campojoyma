import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  cleanBase64,
  corsHeaders,
  createServiceClient,
  dateValue,
  ensureArchivoPdf,
  getValidationErrorsForFactura,
  integerValue,
  jsonResponse,
  normalizeFrcPayload,
  normalizeFrrPayload,
  numberValue,
  pick,
  requireAgentToken,
  text,
  timestampValue,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const asArray = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.filter((item): item is JsonObject => item && typeof item === "object" && !Array.isArray(item)) : [];

const normalizeOnePayload = (raw: JsonObject) => {
  const extraction = asObject(raw.extraction ?? raw.factura ?? raw.invoice ?? raw);
  const fileName = text(pick(raw, ["file_name", "filename", "source_pdf_name", "nombre_archivo", "pdf_nombre"]), "factura-recibida.pdf");
  const pdfBase64 = cleanBase64(pick(raw, ["file_base64", "pdf_base64", "b64_pdf", "B64_PDF", "pdf", "data"]));
  const email = asObject(raw.email);
  const rawMetadata = asObject(raw.metadata);
  const source = text(
    pick(raw, ["source", "workflow", "origin"]),
    text(pick(rawMetadata, ["source", "workflow", "origin"]), null),
  );
  const strictExplicitCtb =
    raw.skip_default_ctb === true ||
    raw.strict_ctb === true ||
    rawMetadata.skip_default_ctb === true ||
    rawMetadata.strict_ctb === true ||
    source === "campojoyma-factura-extraer" ||
    source === "campojoyma-front" ||
    source === "campojoyma-email" ||
    source === "xfuego-front";
  const frr = normalizeFrrPayload(extraction);

  const proveedorNombre = text(pick(extraction, ["proveedor_nombre", "nombre_proveedor", "acreedor_nombre", "FRR_proveedor_nombre"]), null);
  const proveedorNif = text(pick(extraction, ["proveedor_nif", "nif_proveedor", "acreedor_nif", "cif"]), null);
  const lineasRaw =
    asArray(extraction.ctb).length > 0
      ? asArray(extraction.ctb)
      : asArray(extraction.lineas_ctb).length > 0
        ? asArray(extraction.lineas_ctb)
        : asArray(extraction.lineas).length > 0
          ? asArray(extraction.lineas)
          : [];

  const ctb = lineasRaw.length > 0
    ? lineasRaw.map((linea, index) => normalizeFrcPayload(linea, index + 1))
    : strictExplicitCtb
      ? []
      : [
        normalizeFrcPayload(
          {
            FRC_Importe: numberValue(frr.FRR_base1, 0),
            FRC_Cuenta: frr.FRR_idcuenta,
          },
          1,
        ),
      ];

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
    confidence: numberValue(pick(extraction, ["confidence", "confianza"]), null),
  };

  return { frr, ctb, extraction, pdfBase64, fileName, metadata };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const tokenResult = requireAgentToken(req);
  if (!tokenResult.ok) return tokenResult.response;

  try {
    const body = await req.json();
    const inputs: JsonObject[] = Array.isArray(body)
      ? body
      : Array.isArray(body?.facturas)
        ? body.facturas
        : [body];

    const supabase = createServiceClient();
    const results: unknown[] = [];
    const errors: unknown[] = [];

    for (const input of inputs) {
      try {
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

        const validationErrors = await getValidationErrorsForFactura(supabase, normalized.frr);
        const duplicateOf = duplicateCandidates[0] ?? null;
        const nextEstado = duplicateOf
          ? "duplicada"
          : validationErrors.some((error) => error.severity === "error")
            ? "pendiente_revision"
            : "validada";

        const { data: factura, error: insertError } = await supabase
          .from("facturasrecibidas")
          .insert({
            ...normalized.metadata,
            ...normalized.frr,
            archivo_pdf_id: pdfResult.archivoPdfId,
            duplicada_de: duplicateOf,
            estado: nextEstado,
            extraction: normalized.extraction,
            validation_errors: validationErrors,
          })
          .select("id, estado, archivo_pdf_id")
          .single();

        if (insertError || !factura) throw insertError ?? new Error("No se pudo insertar factura recibida.");

        if (normalized.ctb.length > 0) {
          const { error: linesError } = await supabase.from("facturasrecibidas_ctb").insert(
            normalized.ctb.map((linea) => ({
              ...linea,
              factura_id: factura.id,
            })),
          );
          if (linesError) throw linesError;
        }

        results.push({
          factura_id: factura.id,
          estado: factura.estado,
          archivo_pdf_id: factura.archivo_pdf_id,
          pdf_reutilizado: pdfResult.reused,
          duplicada_de: duplicateOf,
          validation_errors: validationErrors,
        });
      } catch (error) {
        errors.push({ error: error instanceof Error ? error.message : String(error), payload: input });
      }
    }

    return jsonResponse(
      {
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
