import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  applyGastosToFrr,
  cleanBase64,
  integerValue,
  normalizeConfidence,
  normalizeFrcPayload,
  normalizeFrrPayload,
  normalizePunteoPayload,
  pick,
  sanitizeAuditValue,
  text,
  timestampValue,
  type JsonObject,
} from "./facturas-recibidas-erp.ts";

export type NormalizedFacturaExtraction = {
  frr: JsonObject;
  ctb: JsonObject[];
  punteos: JsonObject[];
  extraction: JsonObject;
  metadata: JsonObject;
  auditMetadata: JsonObject;
  matchEvidence: JsonObject;
  warnings: string[];
  source: string | null;
  remoteFrrId: number | null;
  pdfBase64: string | null;
  fileName: string;
  documentMetadata: JsonObject;
};

export const extractionObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};

export const extractionObjectArray = (value: unknown): JsonObject[] =>
  Array.isArray(value)
    ? value.filter(
      (item): item is JsonObject =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item),
    )
    : [];

const warningTexts = (...sources: unknown[]): string[] => {
  const warnings: string[] = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (typeof entry === "string" && entry.trim()) warnings.push(entry.trim());
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const message = text(
          pick(entry as JsonObject, ["message", "mensaje", "warning"]),
          null,
        );
        if (message) warnings.push(message);
      }
    }
  }
  return Array.from(new Set(warnings)).slice(0, 25);
};

/**
 * Verifies the response produced by the extraction workflow. The workflow is
 * an untrusted boundary: a successful HTTP response is not enough unless it
 * echoes the exact request and contract that Edge sent.
 */
export const assertFacturaExtractionResponseContract = (
  raw: unknown,
  expectedRequestId: string,
): JsonObject => {
  const response = extractionObject(raw);
  if (
    integerValue(response.contract_version, null) !==
      FACTURAS_RECIBIDAS_CONTRACT_VERSION
  ) {
    throw new Error(
      `EXTRACTION_CONTRACT_MISMATCH: contract_version=${FACTURAS_RECIBIDAS_CONTRACT_VERSION} explicito requerido`,
    );
  }
  if (text(response.request_id, null) !== expectedRequestId) {
    throw new Error(
      "EXTRACTION_REQUEST_MISMATCH: request_id no coincide con la solicitud",
    );
  }
  return response;
};

export type FacturaExtractionUpstreamFailure = {
  status: number;
  code: string;
  category: "validation" | "transport";
  userMessage: string;
  retryable: boolean;
};

/**
 * Mantiene separados un rechazo documental valido de n8n y una caida real del
 * servicio. El 422 solo se acepta si conserva contrato y request_id exactos;
 * un envelope alterado falla cerrado como transporte.
 */
export const classifyFacturaExtractionUpstreamFailure = (
  status: number,
  raw: unknown,
  expectedRequestId: string,
): FacturaExtractionUpstreamFailure => {
  if (status === 422) {
    const response = assertFacturaExtractionResponseContract(
      raw,
      expectedRequestId,
    );
    if (response.ok !== false) {
      throw new Error(
        "EXTRACTION_CONTRACT_MISMATCH: un rechazo 422 debe declarar ok=false",
      );
    }
    return {
      status: 422,
      code: "invalid_invoice",
      category: "validation",
      userMessage: "El PDF no contiene una factura procesable.",
      retryable: false,
    };
  }

  const timeout = status === 504;
  return {
    status: timeout ? 504 : 502,
    code: timeout ? "upstream_timeout" : "upstream_unavailable",
    category: "transport",
    userMessage: timeout
      ? "El servicio de analisis ha tardado demasiado."
      : "El servicio de analisis no pudo extraer la factura.",
    retryable: status >= 429,
  };
};

/**
 * One normalizer for both the interactive extraction response and authenticated
 * n8n ingest. It deliberately accepts the historical envelope aliases while
 * producing one canonical FRR/CTB/punteos projection.
 */
export const normalizeFacturaExtractionPayload = (
  raw: unknown,
): NormalizedFacturaExtraction => {
  const rawObject = extractionObject(raw);
  if (rawObject.ok === false) {
    throw new Error(
      text(
        pick(rawObject, ["error", "message"]),
        "El servicio de analisis no pudo extraer la factura",
      )!,
    );
  }

  const root = extractionObject(
    rawObject.ingest_payload ??
      rawObject.payload ??
      rawObject.output ??
      rawObject,
  );
  const output = extractionObject(root.output ?? root);
  const extraction = extractionObject(
    output.extraction ??
      output.cabecera ??
      output.factura ??
      output.invoice ??
      output,
  );
  const metadata = extractionObject(
    output.metadata ?? root.metadata ?? rawObject.metadata,
  );
  const email = extractionObject(output.email ?? root.email ?? rawObject.email);

  const ctbSource =
    output.ctb ??
    extraction.ctb ??
    extraction.lineas_ctb ??
    root.ctb ??
    rawObject.ctb;
  const punteosSource =
    output.punteos ??
    extraction.punteos ??
    root.punteos ??
    rawObject.punteos;
  const gastos = output.gastos ?? extraction.gastos ?? root.gastos ?? rawObject.gastos;
  const warnings = warningTexts(
    metadata.warnings,
    extraction.warnings,
    output.warnings,
    root.warnings,
    rawObject.warnings,
  );
  const source = text(
    pick(output, ["source", "workflow", "origin"]),
    text(
      pick(metadata, ["source", "workflow", "origin"]),
      text(pick(extraction, ["source", "workflow", "origin"]), null),
    ),
  );
  const fileName = text(
    pick(output, [
      "file_name",
      "filename",
      "source_pdf_name",
      "nombre_archivo",
      "pdf_nombre",
    ]),
    text(
      pick(root, [
        "file_name",
        "filename",
        "source_pdf_name",
        "nombre_archivo",
        "pdf_nombre",
      ]),
      "factura-recibida.pdf",
    ),
  )!;
  const pdfBase64 = cleanBase64(
    pick(output, [
      "file_base64",
      "pdf_base64",
      "b64_pdf",
      "B64_PDF",
      "pdf",
      "data",
    ]) ??
      pick(root, [
        "file_base64",
        "pdf_base64",
        "b64_pdf",
        "B64_PDF",
        "pdf",
        "data",
      ]),
  );
  const matchEvidence = extractionObject(
    sanitizeAuditValue(
      metadata.match_evidence ??
        extraction.match_evidence ??
        extraction.matching,
    ),
  );
  const proveedorNombre = text(
    pick(extraction, [
      "proveedor_nombre",
      "nombre_proveedor",
      "acreedor_nombre",
      "FRR_proveedor_nombre",
    ]),
    null,
  );
  const proveedorNif = text(
    pick(extraction, [
      "proveedor_nif",
      "nif_proveedor",
      "acreedor_nif",
      "cif",
    ]),
    null,
  );

  return {
    frr: applyGastosToFrr(normalizeFrrPayload(extraction), gastos),
    ctb: extractionObjectArray(ctbSource).map((linea, index) =>
      normalizeFrcPayload(linea, index + 1)
    ),
    punteos: extractionObjectArray(punteosSource).map((punteo, index) =>
      normalizePunteoPayload(punteo, index + 1)
    ),
    extraction,
    metadata,
    auditMetadata: {
      confidence: normalizeConfidence(
        pick(metadata, ["confidence", "confianza"]) ??
          pick(extraction, ["confidence", "confianza"]),
      ),
      warnings,
      raw_text_summary: text(
        metadata.raw_text_summary ?? extraction.raw_text_summary,
        null,
      ),
    },
    matchEvidence,
    warnings,
    source,
    remoteFrrId: integerValue(
      pick(extraction, ["remote_id", "remote_frr_id", "FRR_id"]),
      null,
    ),
    pdfBase64,
    fileName,
    documentMetadata: {
      proveedor_nombre: proveedorNombre,
      proveedor_nif: proveedorNif,
      source_pdf_name: text(
        pick(output, ["source_pdf_name", "file_name", "filename"]),
        fileName,
      ),
      source_page_number: integerValue(
        pick(output, ["source_page_number", "page_number"]),
        null,
      ),
      source_page_count: integerValue(
        pick(output, ["source_page_count", "page_count"]),
        null,
      ),
      email_from: text(pick(email, ["from", "from_email", "sender"]), null),
      email_subject: text(pick(email, ["subject", "asunto"]), null),
      email_received_at: timestampValue(
        pick(email, ["date", "received_at", "fecha"]),
        null,
      ),
      confidence: normalizeConfidence(
        pick(metadata, ["confidence", "confianza"]) ??
          pick(extraction, ["confidence", "confianza"]),
      ),
    },
  };
};
