import {
  FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
  integerValue,
  parseJsonResponse,
  sha256Text,
  text,
  type JsonObject,
} from "./facturas-recibidas-erp.ts";

export type NetagroWriteOperation = "validate" | "commit";
export type NetagroAccountingOperation = "validate" | "commit";

export type NetagroRuntime = {
  service: string | null;
  version: string | null;
  write_contract_version: number;
  target_id: string | null;
  dataset_epoch: string | null;
  snapshot_at: string | null;
  write_mode: "disabled" | "blocked" | "management";
  accounting_mode: "unavailable" | "official" | "sql_test";
  accounting_write_mode: "disabled" | "blocked" | "sql_test";
  accounting_ready_for_commit: boolean;
  ready_for_commit: boolean;
  missing_configuration: string[];
  idempotency_store: JsonObject;
  capabilities: {
    validate: boolean;
    management_commit: boolean;
    accounting_commit: boolean;
  };
};

export type StructuredERPError = {
  code: string;
  category: "validation" | "environment" | "conflict" | "transport" | "accounting";
  user_message: string;
  technical_details: JsonObject;
  retryable: boolean;
  reconciliation_required: boolean;
  request_id: string | null;
  target_id: string | null;
  dataset_epoch: string | null;
};

type NetagroApiConfig = {
  baseUrl: URL;
  sharedSecret: string;
};

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
    : [];

const booleanValue = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

export const timestampsReferToSameInstant = (
  left: unknown,
  right: unknown,
): boolean => {
  const leftText = text(left, null);
  const rightText = text(right, null);
  if (!leftText || !rightText) return false;
  const leftMillis = Date.parse(leftText);
  const rightMillis = Date.parse(rightText);
  return Number.isFinite(leftMillis) &&
    Number.isFinite(rightMillis) &&
    leftMillis === rightMillis;
};

export const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalizeJson(value));

export const buildFacturaWriteIdentity = async ({
  cabecera,
  ctb,
  punteos,
}: {
  cabecera: JsonObject;
  ctb: JsonObject[];
  punteos: JsonObject[];
}) => {
  // Mirrors FastAPI's canonical audit hash. The server remains authoritative:
  // Edge only uses this prediction to detect local drift before opening commit.
  const payloadHash = await sha256Text(canonicalJson({
    operation: "POST /facturasrecibidas",
    contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
    payload: {
      cabecera,
      ctb,
      punteos,
      accounting_mode: "none",
    },
  }));
  const businessFingerprint = await sha256Text(canonicalJson({
    empresa_id: cabecera.FRR_Idempresa ?? null,
    ejercicio: cabecera.FRR_ejercicio ?? null,
    circuito: cabecera.FRR_tipofactura === "GE" ? "genero" : "acreedores",
    proveedor_id: cabecera.FRR_idproveedor ?? null,
    numero_factura: cabecera.FRR_numerofactura ?? null,
    fecha_factura: cabecera.FRR_fechafactura ?? null,
    total: cabecera.FRR_totalfac ?? null,
  }));
  return { payloadHash, businessFingerprint };
};

export const buildERPContractV3 = ({
  operation,
  requestId,
  targetId,
  datasetEpoch,
  cabecera,
  ctb,
  punteos,
}: {
  operation: NetagroWriteOperation;
  requestId: string;
  targetId: string;
  datasetEpoch: string;
  cabecera: JsonObject;
  ctb: JsonObject[];
  punteos: JsonObject[];
}): JsonObject => ({
  contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
  operation,
  request_id: requestId,
  target_id: targetId,
  dataset_epoch: datasetEpoch,
  accounting_mode: "none",
  cabecera,
  ctb,
  punteos,
});

export const getNetagroApiConfig = (): NetagroApiConfig => {
  const rawBaseUrl = Deno.env.get("CAMPOJOYMA_API_V2_BASE_URL")?.trim();
  const sharedSecret = Deno.env.get("CAMPOJOYMA_API_V2_SHARED_SECRET")?.trim();
  if (!rawBaseUrl || !sharedSecret) {
    throw new Error(
      "ERP_API_CONFIGURATION_MISSING: falta configuracion interna del API Netagro",
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawBaseUrl.endsWith("/") ? rawBaseUrl : `${rawBaseUrl}/`);
  } catch {
    throw new Error("ERP_API_CONFIGURATION_INVALID: URL del API Netagro no valida");
  }
  if (baseUrl.protocol !== "https:") {
    throw new Error("ERP_API_CONFIGURATION_INVALID: el API Netagro debe usar HTTPS");
  }
  if (baseUrl.username || baseUrl.password) {
    throw new Error(
      "ERP_API_CONFIGURATION_INVALID: la URL del API no puede contener credenciales",
    );
  }
  return { baseUrl, sharedSecret };
};

const apiUrl = (baseUrl: URL, path: string): URL =>
  new URL(path.replace(/^\/+/, ""), baseUrl);

const callNetagro = async (
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: JsonObject;
    timeoutMs?: number;
  } = {},
) => {
  const config = getNetagroApiConfig();
  const response = await fetch(apiUrl(config.baseUrl, path), {
    method: options.method ?? "GET",
    headers: {
      "X-Netagro-Api-Key": config.sharedSecret,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  const parsed = await parseJsonResponse(response);
  return { response, payload: parsed.payload };
};

export const parseStructuredERPError = (
  payload: unknown,
  fallback: Partial<StructuredERPError> = {},
): StructuredERPError => {
  const root = asObject(payload);
  const detail = asObject(root.detail);
  const error = Object.keys(detail).length > 0 ? detail : root;
  const category = text(error.category, null);
  return {
    code: text(error.code, fallback.code ?? "upstream_unavailable")!,
    category: (
      ["validation", "environment", "conflict", "transport", "accounting"].includes(
          category ?? "",
        )
        ? category
        : fallback.category ?? "transport"
    ) as StructuredERPError["category"],
    user_message: text(
      error.user_message,
      fallback.user_message ?? "No se pudo completar la operacion con Netagro.",
    )!,
    technical_details: asObject(
      error.technical_details ?? fallback.technical_details,
    ),
    retryable: booleanValue(error.retryable, fallback.retryable ?? false),
    reconciliation_required: booleanValue(
      error.reconciliation_required,
      fallback.reconciliation_required ?? false,
    ),
    request_id: text(error.request_id, fallback.request_id ?? null),
    target_id: text(error.target_id, fallback.target_id ?? null),
    dataset_epoch: text(error.dataset_epoch, fallback.dataset_epoch ?? null),
  };
};

export const fetchNetagroRuntime = async (): Promise<NetagroRuntime> => {
  const { response, payload } = await callNetagro("meta/runtime");
  if (!response.ok) {
    const error = parseStructuredERPError(payload, {
      code: "upstream_unavailable",
      category: "transport",
      user_message: "No se pudo consultar el entorno Netagro.",
      retryable: response.status >= 500,
    });
    throw new Error(`${error.code}: ${error.user_message}`);
  }
  const runtime = asObject(payload);
  const capabilities = asObject(runtime.capabilities);
  const writeContractVersion = integerValue(runtime.write_contract_version, null);
  if (writeContractVersion !== FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION) {
    throw new Error(
      `ERP_CONTRACT_MISMATCH: Netagro no anuncia contract_version=${FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION}`,
    );
  }
  return {
    service: text(runtime.service, null),
    version: text(runtime.version, null),
    write_contract_version: writeContractVersion,
    target_id: text(runtime.target_id, null),
    dataset_epoch: text(runtime.dataset_epoch, null),
    snapshot_at: text(runtime.snapshot_at, null),
    write_mode: (
      ["disabled", "blocked", "management"].includes(
          text(runtime.write_mode, "") ?? "",
        )
        ? runtime.write_mode
        : "blocked"
    ) as NetagroRuntime["write_mode"],
    accounting_mode: (
      ["official", "sql_test"].includes(text(runtime.accounting_mode, "") ?? "")
        ? runtime.accounting_mode
        : "unavailable"
    ) as NetagroRuntime["accounting_mode"],
    accounting_write_mode: (
      ["disabled", "blocked", "sql_test"].includes(
          text(runtime.accounting_write_mode, "") ?? "",
        )
        ? runtime.accounting_write_mode
        : "blocked"
    ) as NetagroRuntime["accounting_write_mode"],
    accounting_ready_for_commit: booleanValue(
      runtime.accounting_ready_for_commit,
      false,
    ),
    ready_for_commit: booleanValue(runtime.ready_for_commit, false),
    missing_configuration: asStringArray(runtime.missing_configuration),
    idempotency_store: asObject(runtime.idempotency_store),
    capabilities: {
      validate: booleanValue(capabilities.validate, false),
      management_commit: booleanValue(capabilities.management_commit, false),
      accounting_commit: booleanValue(capabilities.accounting_commit, false),
    },
  };
};

export const callNetagroWriteV3 = async (
  payload: JsonObject,
): Promise<{ response: Response; payload: unknown }> =>
  callNetagro("facturasrecibidas", {
    method: "POST",
    body: payload,
    timeoutMs: 30_000,
  });

export const buildAccountingContractV3 = ({
  operation,
  requestId,
  targetId,
  datasetEpoch,
}: {
  operation: NetagroAccountingOperation;
  requestId: string;
  targetId: string;
  datasetEpoch: string;
}): JsonObject => ({
  contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
  operation,
  request_id: requestId,
  target_id: targetId,
  dataset_epoch: datasetEpoch,
});

export const callNetagroAccountingV3 = async (
  facturaId: number,
  payload: JsonObject,
): Promise<{ response: Response; payload: unknown }> => {
  if (!Number.isSafeInteger(facturaId) || facturaId <= 0) {
    throw new Error("ERP_ACCOUNTING_ID_INVALID: factura ERP no valida");
  }
  return callNetagro(`facturasrecibidas/${facturaId}/contabilizar`, {
    method: "POST",
    body: payload,
    timeoutMs: 30_000,
  });
};

export const callNetagroRead = async (
  consulta: string,
): Promise<{ response: Response; payload: unknown }> =>
  callNetagro(consulta, { method: "GET", timeoutMs: 30_000 });

export const scopeNetagroReadToTarget = (
  consulta: string,
  targetId: string,
  datasetEpoch: string,
): string => {
  const parsed = new URL(consulta, "https://netagro-read.invalid/");
  if (
    parsed.origin !== "https://netagro-read.invalid" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error("ERP_READ_SCOPE_INVALID: consulta Netagro no valida");
  }
  parsed.searchParams.set("target_id", targetId);
  parsed.searchParams.set("dataset_epoch", datasetEpoch);
  const path = parsed.pathname.replace(/^\/+/, "");
  const query = parsed.searchParams.toString();
  return query ? `${path}?${query}` : path;
};

export const validateNetagroWriteResponseV3 = (
  payload: unknown,
  expected: {
    operation: NetagroWriteOperation;
    requestId: string;
    targetId: string;
    datasetEpoch: string;
    payloadHash: string;
  },
) => {
  const response = asObject(payload);
  const errors: string[] = [];
  if (
    integerValue(response.contract_version, null) !==
      FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION
  ) {
    errors.push("contract_version=3 no confirmado");
  }
  if (text(response.operation, null) !== expected.operation) {
    errors.push("operation no coincide");
  }
  if (text(response.request_id, null) !== expected.requestId) {
    errors.push("request_id no coincide");
  }
  if (text(response.target_id, null) !== expected.targetId) {
    errors.push("target_id no coincide");
  }
  if (text(response.dataset_epoch, null) !== expected.datasetEpoch) {
    errors.push("dataset_epoch no coincide");
  }
  if (text(response.payload_hash, null) !== expected.payloadHash) {
    errors.push("payload_hash no coincide");
  }
  return { ok: errors.length === 0, errors, response };
};

export const validateNetagroAccountingResponseV3 = (
  payload: unknown,
  expected: {
    operation: NetagroAccountingOperation;
    requestId: string;
    targetId: string;
    datasetEpoch: string;
    facturaId: number;
    payloadHash?: string | null;
    invoiceFingerprint?: string | null;
    requireCreated?: boolean;
  },
) => {
  const response = asObject(payload);
  const accounting = asObject(response.accounting);
  const errors: string[] = [];
  if (
    integerValue(response.contract_version, null) !==
      FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION
  ) {
    errors.push("contract_version=3 no confirmado");
  }
  if (text(response.operation, null) !== expected.operation) {
    errors.push("operation no coincide");
  }
  if (text(response.request_id, null) !== expected.requestId) {
    errors.push("request_id no coincide");
  }
  if (text(response.target_id, null) !== expected.targetId) {
    errors.push("target_id no coincide");
  }
  if (text(response.dataset_epoch, null) !== expected.datasetEpoch) {
    errors.push("dataset_epoch no coincide");
  }
  if (integerValue(response.factura_id, null) !== expected.facturaId) {
    errors.push("factura_id no coincide");
  }
  if (response.ok !== true) errors.push("ok=true no confirmado");
  if (expected.payloadHash && text(response.payload_hash, null) !== expected.payloadHash) {
    errors.push("payload_hash no coincide");
  }
  if (
    expected.invoiceFingerprint &&
    text(response.invoice_fingerprint, null) !== expected.invoiceFingerprint
  ) {
    errors.push("invoice_fingerprint no coincide");
  }
  if (expected.requireCreated) {
    if (response.eligible !== true) errors.push("perfil contable no elegible");
    if (response.readback_confirmed !== true) {
      errors.push("readback contable no confirmado");
    }
    if (
      accounting.created !== true ||
      text(accounting.status, null) !== "created" ||
      accounting.balanced !== true ||
      (integerValue(accounting.technical_id, null) ?? 0) <= 0 ||
      !text(accounting.visible_number, null) ||
      !Array.isArray(response.entries) ||
      response.entries.length === 0
    ) {
      errors.push("asiento creado y cuadrado no confirmado");
    }
  }
  return { ok: errors.length === 0, errors, response, accounting };
};
