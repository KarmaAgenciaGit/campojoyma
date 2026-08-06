import { createClient } from "jsr:@supabase/supabase-js@2";

type EdgeRecord = Record<string, unknown>;
type EdgeDatabase = {
  public: {
    Tables: Record<string, {
      Row: EdgeRecord;
      Insert: EdgeRecord;
      Update: EdgeRecord;
      Relationships: [];
    }>;
    Views: Record<string, {
      Row: EdgeRecord;
      Relationships: [];
    }>;
    Functions: Record<string, {
      Args: EdgeRecord;
      Returns: unknown;
    }>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, EdgeRecord>;
  };
};

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Record<string, unknown>;

export const FACTURAS_RECIBIDAS_CONTRACT_VERSION = 2;
export const FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION = 3;
export const FACTURAS_RECIBIDAS_PDF_BUCKET = "facturas-recibidas-pdf";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-agent-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient<EdgeDatabase>(supabaseUrl, serviceRoleKey);
};

export const createAuthClient = (authHeader: string) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createClient<EdgeDatabase>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
};

export type AgentTokenHashVerifier = (tokenHash: string) => Promise<boolean>;

export type AgentTokenAuthDependencies = {
  getConfiguredToken?: () => string | null;
  verifyTokenHash?: AgentTokenHashVerifier;
};

const getConfiguredAgentToken = () =>
  Deno.env.get("N8N_FACTURAS_RECIBIDAS_INGEST_TOKEN")?.trim() ||
  Deno.env.get("N8N_AGENT_TOKEN")?.trim() ||
  null;

export const sha256Text = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const constantTimeTokenEquals = async (received: string, expected: string) => {
  const [receivedHash, expectedHash] = await Promise.all([
    sha256Text(received),
    sha256Text(expected),
  ]);
  let difference = 0;
  for (let index = 0; index < receivedHash.length; index += 1) {
    difference |= receivedHash.charCodeAt(index) ^ expectedHash.charCodeAt(index);
  }
  return difference === 0;
};

export const requestHasServiceRoleCredential = async (
  req: Request,
  getServiceRoleKey: () => string | null = () =>
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || null,
) => {
  const expected = getServiceRoleKey();
  if (!expected) return false;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const apiKey = req.headers.get("apikey")?.trim();
  for (const credential of [bearer, apiKey]) {
    if (credential && await constantTimeTokenEquals(credential, expected)) return true;
  }
  return false;
};

const verifyAgentTokenHashWithServiceRole: AgentTokenHashVerifier = async (tokenHash) => {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("verify_factura_ingest_token_hash", {
    p_token_hash: tokenHash,
  });
  if (error) throw error;
  return data === true;
};

export const requireAgentToken = async (
  req: Request,
  dependencies: AgentTokenAuthDependencies = {},
) => {
  const headerToken = req.headers.get("x-agent-token")?.trim();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const received = headerToken || bearer;
  if (!received) {
    return { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, 401) };
  }

  const expected = (dependencies.getConfiguredToken ?? getConfiguredAgentToken)();
  if (expected) {
    const matches = await constantTimeTokenEquals(received, expected);
    return matches
      ? { ok: true as const }
      : { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, 401) };
  }

  try {
    const receivedHash = await sha256Text(received);
    const verifyTokenHash = dependencies.verifyTokenHash ?? verifyAgentTokenHashWithServiceRole;
    const matches = await verifyTokenHash(receivedHash);
    return matches
      ? { ok: true as const }
      : { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, 401) };
  } catch (error) {
    console.error(
      "No se pudo verificar el hash del token de ingesta.",
      error instanceof Error ? error.message : "Error desconocido",
    );
    return {
      ok: false as const,
      response: jsonResponse({ error: "No se pudo verificar el token de ingesta." }, 500),
    };
  }
};

export const isRouteSetAuthorized = (
  role: unknown,
  allowedRoutes: unknown,
  requiredRoutes: string | readonly string[],
) => {
  if (role === "admin") return true;
  const allowed = Array.isArray(allowedRoutes)
    ? allowedRoutes.filter((route): route is string => typeof route === "string")
    : [];
  const required = typeof requiredRoutes === "string" ? [requiredRoutes] : requiredRoutes;
  return required.some((route) => allowed.includes(route));
};

const ERP_ACREEDORES_CONSUMER_ROUTES = [
  "/facturas-recibidas",
  "/pedidos",
  "/cambios",
  "/previsiones",
] as const;

export const getERPReadAuthorizedRoutes = (consulta: string): readonly string[] => {
  try {
    const path = new URL(consulta, "https://erp-read.invalid/").pathname.replace(/^\/+/, "");
    if (path === "acreedores" || /^acreedores\/\d+(?:\/gastos)?$/.test(path)) {
      return ERP_ACREEDORES_CONSUMER_ROUTES;
    }
    if (path === "albaranes/entrada") {
      return ["/albaranes", "/facturas-recibidas"];
    }
    if (/^albaranes\/entrada\/[1-9]\d*\/lineas$/.test(path)) {
      return ["/facturas-recibidas", "/albaranes"];
    }
  } catch {
    // La ruta exclusiva de facturas es el fallback cerrado para consultas no parseables.
  }
  return ["/facturas-recibidas"];
};

export const requireRouteUser = async (
  req: Request,
  route: string | readonly string[] = "/facturas-recibidas",
) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return { ok: false as const, response: jsonResponse({ error: "Unauthorized" }, 401) };
  }

  const authClient = createAuthClient(authHeader);
  const serviceClient = createServiceClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return { ok: false as const, response: jsonResponse({ error: "No autorizado" }, 401) };
  }

  const { data: roleRow, error: roleError } = await serviceClient
    .from("user_roles")
    .select("role, allowed_routes")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleError) {
    return { ok: false as const, response: jsonResponse({ error: roleError.message }, 500) };
  }

  if (!isRouteSetAuthorized(roleRow?.role, roleRow?.allowed_routes, route)) {
    return { ok: false as const, response: jsonResponse({ error: "Ruta no permitida" }, 403) };
  }

  return { ok: true as const, user, serviceClient };
};

export const text = (value: unknown, fallback: string | null = null) => {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  return str.length > 0 ? str : fallback;
};

export const numberValue = (value: unknown, fallback: number | null = null) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const normalized =
      trimmed.includes(",") && trimmed.includes(".")
        ? trimmed.replace(/\./g, "").replace(",", ".")
        : trimmed.replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

export const normalizeConfidence = (value: unknown) => {
  const parsed = numberValue(value, null);
  if (parsed === null || parsed < 0) return null;
  if (parsed <= 1) return parsed;
  return parsed <= 100 ? parsed / 100 : null;
};

const blockedAuditKeys = new Set([
  "authorization",
  "body",
  "data",
  "items",
  "password",
  "payload",
  "raw",
  "response",
  "secret",
  "token",
]);

export const sanitizeAuditValue = (value: unknown, depth = 0): JsonValue | null => {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 1000);
  if (depth >= 5) return null;
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return null;

  const sanitized: Record<string, JsonValue> = {};
  for (const [key, nested] of Object.entries(value as JsonObject).slice(0, 50)) {
    const normalizedKey = key.toLowerCase();
    if (
      blockedAuditKeys.has(normalizedKey) ||
      normalizedKey.includes("base64") ||
      normalizedKey.includes("password") ||
      normalizedKey.includes("secret") ||
      normalizedKey.includes("token")
    ) {
      continue;
    }
    sanitized[key] = sanitizeAuditValue(nested, depth + 1);
  }
  return sanitized;
};

export const integerValue = (value: unknown, fallback: number | null = null) => {
  const parsed = numberValue(value, fallback);
  return parsed === null ? null : Math.trunc(parsed);
};

export const booleanValue = (value: unknown, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "s", "si", "sí", "yes"].includes(normalized)) return true;
    if (["false", "0", "n", "no"].includes(normalized)) return false;
  }
  return fallback;
};

export const snValue = (value: unknown, fallback: "S" | "N" | null = null) => {
  if (value === null || value === undefined || value === "") return fallback;
  return booleanValue(value, String(value).trim().toUpperCase() === "S") ? "S" : "N";
};

export const isValidRequestId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );

export const requestIdValue = (value: unknown) => {
  const parsed = text(value, null);
  if (!parsed) return crypto.randomUUID();
  if (!isValidRequestId(parsed)) {
    throw new Error("request_id debe ser un UUID valido.");
  }
  return parsed;
};

export const getFacturaSyncEntryDecision = (
  factura: JsonObject,
  incomingRequestId: string,
) => {
  const syncStatus = text(factura.sync_status, "draft")?.toLowerCase() ?? "draft";
  const lastRequestId = text(factura.last_request_id, null);

  if (syncStatus === "sent") {
    return lastRequestId === incomingRequestId
      ? {
        mode: "replay" as const,
        syncRequestId: incomingRequestId,
        writerAllowed: false,
      }
      : {
        mode: "blocked_sent" as const,
        syncRequestId: lastRequestId,
        writerAllowed: false,
      };
  }
  if (syncStatus === "unknown" || syncStatus === "reconciling") {
    return isValidRequestId(lastRequestId)
      ? {
        mode: "reconcile" as const,
        syncRequestId: lastRequestId.trim(),
        writerAllowed: false,
      }
      : {
        mode: "blocked_reconciliation" as const,
        syncRequestId: null,
        writerAllowed: false,
      };
  }
  if (syncStatus === "sending") {
    return {
      mode: "blocked_in_flight" as const,
      syncRequestId: lastRequestId,
      writerAllowed: false,
    };
  }
  return {
    mode: "send" as const,
    syncRequestId: incomingRequestId,
    writerAllowed: true,
  };
};

export const isEligibleERPCommitAttempt = (
  attempt: JsonObject,
  requestId: string,
) =>
  text(attempt.request_id, null) === requestId &&
  text(attempt.phase, null) === "commit" &&
  ["unknown", "succeeded"].includes(text(attempt.status, "") ?? "");

export const ERPAttemptMatchesIdentity = (
  attempt: JsonObject | null | undefined,
  expected: {
    targetId: string;
    datasetEpoch: string;
    circuit: "genero" | "acreedores";
    payloadHash: string;
    businessFingerprint: string;
  },
) =>
  Boolean(attempt) &&
  text(attempt?.erp_target_id, null) === expected.targetId &&
  text(attempt?.erp_dataset_epoch, null) === expected.datasetEpoch &&
  text(attempt?.circuit, null) === expected.circuit &&
  text(attempt?.payload_hash, null) === expected.payloadHash &&
  text(attempt?.business_fingerprint, null) === expected.businessFingerprint;

export const rpcErrorStatus = (message: string) => {
  if (message.includes("VERSION_CONFLICT")) return 409;
  if (
    message.includes("FACTURA_LOCKED") ||
    message.includes("IDEMPOTENCY_CONFLICT") ||
    message.includes("SYNC_RECONCILIATION_REQUIRED") ||
    message.includes("REMOTE_ID_CONFLICT")
  ) return 409;
  if (message.includes("NOT_FOUND")) return 404;
  if (
    message.includes("INVALID_PAYLOAD") ||
    message.includes("INVALID_WRITE_RESPONSE") ||
    message.includes("INVALID_READBACK")
  ) return 422;
  return 500;
};

export const dateValue = (value: unknown, fallback: string | null = null) => {
  const raw = text(value, null);
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString().slice(0, 10);
};

export const timestampValue = (value: unknown, fallback: string | null = null) => {
  const raw = text(value, null);
  if (!raw) return fallback;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
};

export const pick = (source: JsonObject, keys: string[], fallback: unknown = null) => {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
};

const hasOwn = (source: JsonObject, key: string) => Object.prototype.hasOwnProperty.call(source, key);

const hasUsableValue = (value: unknown) =>
  value !== undefined && value !== null && (typeof value !== "string" || value.trim() !== "");

const pickDefined = (source: JsonObject, keys: string[]) => {
  for (const key of keys) {
    if (hasOwn(source, key) && hasUsableValue(source[key])) return source[key];
  }
  return undefined;
};

const assignIfPresent = (
  target: JsonObject,
  key: string,
  source: JsonObject,
  parser: (value: unknown, fallback?: any) => unknown,
) => {
  if (hasOwn(source, key)) target[key] = parser(source[key], null);
};

export const cleanBase64 = (value: unknown) => {
  const raw = text(value, null);
  if (!raw) return null;
  return raw.replace(/^data:.*;base64,/i, "").replace(/\s/g, "");
};

export const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const sha256Bytes = async (bytes: Uint8Array) => {
  const hashBuffer = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const sha256Base64 = async (base64: string) => sha256Bytes(base64ToBytes(base64));

export const ensureArchivoPdf = async (
  supabase: ReturnType<typeof createServiceClient>,
  base64: string | null,
  fileName: string | null,
  createdBy: string | null = null,
) => {
  if (!base64) return { archivoPdfId: null as number | null, reused: false, hash: null as string | null };

  const bytes = base64ToBytes(base64);
  const hash = await sha256Bytes(bytes);
  const storagePath = `${hash.slice(0, 2)}/${hash}.pdf`;
  const { data: existingPdf, error: searchError } = await supabase
    .from("archivos_pdf")
    .select("id, storage_bucket, storage_path")
    .eq("hash_sha256", hash)
    .maybeSingle();

  if (searchError) throw searchError;
  if (existingPdf?.id) {
    if (!existingPdf.storage_bucket || !existingPdf.storage_path) {
      const { error: storageError } = await supabase.storage
        .from(FACTURAS_RECIBIDAS_PDF_BUCKET)
        .upload(storagePath, bytes, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (storageError && !/already exists|duplicate/i.test(storageError.message)) throw storageError;

      const { error: metadataError } = await supabase
        .from("archivos_pdf")
        .update({
          b64_contenido: null,
          storage_bucket: FACTURAS_RECIBIDAS_PDF_BUCKET,
          storage_path: storagePath,
          storage_uploaded_at: new Date().toISOString(),
          tamanio_bytes: bytes.byteLength,
        })
        .eq("id", existingPdf.id);
      if (metadataError) throw metadataError;
    }
    return { archivoPdfId: Number(existingPdf.id), reused: true, hash };
  }

  const { error: storageError } = await supabase.storage
    .from(FACTURAS_RECIBIDAS_PDF_BUCKET)
    .upload(storagePath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
  if (storageError && !/already exists|duplicate/i.test(storageError.message)) throw storageError;

  const { data: inserted, error: insertError } = await supabase
    .from("archivos_pdf")
    .insert({
      hash_sha256: hash,
      b64_contenido: null,
      storage_bucket: FACTURAS_RECIBIDAS_PDF_BUCKET,
      storage_path: storagePath,
      storage_uploaded_at: new Date().toISOString(),
      nombre_archivo: fileName,
      tamanio_bytes: bytes.byteLength,
      mime_type: "application/pdf",
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (insertError && insertError.code === "23505") {
    const { data: raced, error: racedError } = await supabase
      .from("archivos_pdf")
      .select("id")
      .eq("hash_sha256", hash)
      .single();
    if (racedError || !raced) throw racedError ?? insertError;
    return { archivoPdfId: Number(raced.id), reused: true, hash };
  }
  if (insertError || !inserted) throw insertError ?? new Error("No se pudo guardar el PDF.");
  return { archivoPdfId: Number(inserted.id), reused: false, hash };
};

export const loadArchivoPdfBase64 = async (
  supabase: ReturnType<typeof createServiceClient>,
  archivo: JsonObject,
) => {
  const fallback = cleanBase64(archivo.b64_contenido);
  if (fallback) return fallback;

  const bucket = text(archivo.storage_bucket, null);
  const path = text(archivo.storage_path, null);
  if (!bucket || !path) return null;

  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw error ?? new Error("No se pudo descargar el PDF privado.");
  return bytesToBase64(new Uint8Array(await data.arrayBuffer()));
};

const frrNumericKeys = [
  "FRR_base1",
  "FRR_base2",
  "FRR_base3",
  "FRR_base4",
  "FRR_base5",
  "FRR_iva1",
  "FRR_iva2",
  "FRR_iva3",
  "FRR_iva4",
  "FRR_iva5",
  "FRR_cuota1",
  "FRR_cuota2",
  "FRR_cuota3",
  "FRR_cuota4",
  "FRR_cuota5",
  "FRR_baseret",
  "FRR_ret",
  "FRR_cuotaret",
  "FRR_igasto1",
  "FRR_igasto2",
  "FRR_igasto3",
  "FRR_igasto4",
  "FRR_totalfac",
  "ImporteVto",
  "FRR_ImporteVto1",
  "FRR_ImporteVto2",
  "FRR_ImporteVto3",
  "FRR_ImpSuplido",
  "FRR_CuotaNoDeducible",
] as const;

const frrIntegerKeys = [
  "FRR_id",
  "FRR_numero",
  "FRR_ejercicio",
  "FRR_idcentro",
  "FRR_idproveedor",
  "FRR_idregimen",
  "FRR_idpuntoventa",
  "FRR_IdAsientoNet",
  "FRR_IdBanco",
  "FRR_IdFormaPago",
  "FRR_Idempresa",
  "FRR_idpago",
  "FRR_IdUsuarioLog",
  "FRR_IdTipoDoc",
  "FRR_IdAgricultorDto",
  "FRR_BancoPrevPago",
  "FRR_IdSeccion",
  "FRR_IdActividad",
  "FRR_IdfacturaRec",
] as const;

const frrDateKeys = [
  "FRR_fechafactura",
  "FRR_fechactb",
  "FechaVto",
  "FRR_FechaLog",
  "FRR_FechaVto1",
  "FRR_FechaVto2",
  "FRR_FechaVto3",
  "FRR_FechaPrevPago",
] as const;

const frrTextKeys = [
  "FRR_numerofactura",
  "FRR_ctagasto1",
  "FRR_ctagasto2",
  "FRR_ctagasto3",
  "FRR_ctagasto4",
  "FRR_tipofactura",
  "FRR_idcuenta",
  "FRR_ClaveIRPF",
  "FRR_CtaCartera",
  "FRR_Modificable",
  "FRR_HoraLog",
  "FRR_Concepto",
  "FRR_GeneraCartera",
  "FRR_CtaSuplido",
  "FRR_CancelarporCtb",
  "FRR_Observaciones",
  "FRR_ObservacionesAEAT",
  "FRR_Contabilizar",
] as const;

// Estos tres campos replican varchar(50) del ERP. El documento completo se
// conserva por separado en extraction; solo se ajusta la proyeccion operativa.
const frrDescriptiveTextLimits = {
  FRR_Concepto: 50,
  FRR_Observaciones: 50,
  FRR_ObservacionesAEAT: 50,
} as const;

const frcNumericKeys = ["FRC_Importe"] as const;
const frcIntegerKeys = [
  "FRC_IdActividad",
  "FRC_Idseccion",
  "FRC_Iddepartamento",
  "FRC_Idsubdepartamento",
  "FRC_IdUsuarioLog",
] as const;
const frcDateKeys = ["FRC_FechaLog"] as const;
const frcTextKeys = ["FRC_Cuenta", "FRC_HoraLog"] as const;

export const normalizeFrrPayload = (input: JsonObject, options: { partial?: boolean } = {}) => {
  const partial = options.partial === true;
  const out: JsonObject = {};

  for (const key of frrNumericKeys) assignIfPresent(out, key, input, numberValue);
  for (const key of frrIntegerKeys) assignIfPresent(out, key, input, integerValue);
  for (const key of frrDateKeys) assignIfPresent(out, key, input, dateValue);
  for (const key of frrTextKeys) assignIfPresent(out, key, input, text);
  for (const key of ["FRR_Modificable", "FRR_GeneraCartera", "FRR_CancelarporCtb", "FRR_Contabilizar"]) {
    if (hasOwn(input, key)) out[key] = snValue(input[key], null);
  }

  const aliasParsers: Array<[string, string[], (value: unknown, fallback?: any) => unknown]> = [
    ["FRR_numerofactura", ["FRR_numerofactura", "numero_factura", "numero_factura_proveedor", "invoice_number"], text],
    ["FRR_fechafactura", ["FRR_fechafactura", "fecha_factura", "fecha"], dateValue],
    ["FRR_fechactb", ["FRR_fechactb", "fecha_contable", "fecha_registro_contable"], dateValue],
    ["FRR_idproveedor", ["FRR_idproveedor", "proveedor_id", "acreedor_id", "id_proveedor"], integerValue],
    ["FRR_idregimen", ["FRR_idregimen", "regimen_id", "tipo_iva_id"], integerValue],
    ["FRR_idcuenta", ["FRR_idcuenta", "cuenta_proveedor", "cuenta_contable"], text],
    ["FRR_Idempresa", ["FRR_Idempresa", "empresa_id"], integerValue],
    ["FRR_totalfac", ["FRR_totalfac", "total", "total_factura", "importe_total"], numberValue],
    ["FRR_base1", ["FRR_base1", "base_imponible", "base"], numberValue],
    ["FRR_iva1", ["FRR_iva1", "iva_porcentaje", "tipo_iva"], numberValue],
    ["FRR_cuota1", ["FRR_cuota1", "iva_importe", "cuota_iva"], numberValue],
    ["FRR_baseret", ["FRR_baseret", "retencion_base"], numberValue],
    ["FRR_ret", ["FRR_ret", "retencion_porcentaje"], numberValue],
    ["FRR_cuotaret", ["FRR_cuotaret", "retencion_importe"], numberValue],
    ["FRR_Concepto", ["FRR_Concepto", "concepto", "descripcion"], text],
    ["FRR_Observaciones", ["FRR_Observaciones", "observaciones_visibles", "observaciones"], text],
    ["FRR_ObservacionesAEAT", ["FRR_ObservacionesAEAT", "observaciones_aeat"], text],
    ["FRR_tipofactura", ["FRR_tipofactura", "tipo_factura"], text],
  ];

  for (const [targetKey, aliases, parser] of aliasParsers) {
    const value = pickDefined(input, aliases);
    if (value !== undefined) out[targetKey] = parser(value, null);
  }

  for (const [key, maxLength] of Object.entries(frrDescriptiveTextLimits)) {
    const value = out[key];
    if (typeof value === "string" && value.length > maxLength) {
      out[key] = value.slice(0, maxLength);
    }
  }

  if (!partial) {
    if (out.FRR_Idempresa === undefined && hasUsableValue(input.FRR_Idempresa)) {
      out.FRR_Idempresa = integerValue(input.FRR_Idempresa, null);
    }
    // Centro y punto de venta valen 1 en las 285 cabeceras historicas medidas.
    // Dejarlos nulos producia una cabecera incompleta frente al resto del ERP.
    if (out.FRR_idcentro === undefined) out.FRR_idcentro = 1;
    if (out.FRR_idpuntoventa === undefined) out.FRR_idpuntoventa = 1;
    // FRR_Modificable no se fuerza: el historico del ERP lo devuelve vacio en las
    // 285 cabeceras medidas, nunca "S". Solo se envia si el llamante lo aporta.
    out.FRR_GeneraCartera = snValue(input.FRR_GeneraCartera, "N");
    out.FRR_CancelarporCtb = snValue(input.FRR_CancelarporCtb, "N");
    out.FRR_Contabilizar = snValue(input.FRR_Contabilizar, "N");
    out.FRR_FechaLog = dateValue(input.FRR_FechaLog, new Date().toISOString().slice(0, 10));
    out.FRR_HoraLog = text(input.FRR_HoraLog, new Date().toISOString().slice(11, 19));
  }

  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
};

const EDGE_AUTHORITATIVE_ACCOUNTING_FIELDS = [
  "FRR_id",
  "FRR_numero",
  "FRR_IdAsientoNet",
  "FRR_IdfacturaRec",
  "remote_frr_id",
  "is_readonly_reference",
  "source_kind",
  "sync_status",
  "estado",
  "accounting_status",
  "accounting_visible_number",
  "accounting_date",
  "FRR_ejercicio",
  "FRR_tipofactura",
  "FRR_idregimen",
  "FRR_fechactb",
  "FechaVto",
  "ImporteVto",
  "FRR_FechaVto1",
  "FRR_FechaVto2",
  "FRR_FechaVto3",
  "FRR_ImporteVto1",
  "FRR_ImporteVto2",
  "FRR_ImporteVto3",
  "FRR_igasto1",
  "FRR_igasto2",
  "FRR_igasto3",
  "FRR_igasto4",
  "FRR_ctagasto1",
  "FRR_ctagasto2",
  "FRR_ctagasto3",
  "FRR_ctagasto4",
  "FRR_Concepto",
  "FRR_ObservacionesAEAT",
  "FRR_CuotaNoDeducible",
  "FRR_Contabilizar",
] as const;

export const sanitizeUntrustedFacturaAccountingFields = (frr: JsonObject): JsonObject => {
  const sanitized = { ...frr };
  for (const field of EDGE_AUTHORITATIVE_ACCOUNTING_FIELDS) delete sanitized[field];
  return sanitized;
};

export const sanitizeUntrustedPunteoSelections = (punteos: JsonObject[]): JsonObject[] =>
  punteos.map((punteo) => ({ ...punteo, S: false }));

export const resolveFacturaIngestAuthority = ({
  frr,
  source,
  remoteFrrId,
  trustedImportSignal,
  ctb = [],
  punteos = [],
}: {
  frr: JsonObject;
  source: string | null;
  remoteFrrId: unknown;
  trustedImportSignal: boolean;
  ctb?: JsonObject[];
  punteos?: JsonObject[];
}) => {
  const normalizedRemoteFrrId = integerValue(remoteFrrId, null);
  const isERPReference = trustedImportSignal &&
    source === "apiCampojoyma-read-sample" &&
    normalizedRemoteFrrId !== null &&
    normalizedRemoteFrrId > 0;
  return {
    frr: isERPReference ? { ...frr } : sanitizeUntrustedFacturaAccountingFields(frr),
    // CTB extracted from a draft is user-reviewable business data. Only the
    // ERP-generated identifiers are untrusted, not the account distribution.
    ctb: ctb.map((linea, index) =>
      isERPReference
        ? { ...linea }
        : normalizeFrcPayload(linea, index + 1)
    ),
    punteos: isERPReference
      ? punteos.map((punteo) => ({ ...punteo }))
      : sanitizeUntrustedPunteoSelections(punteos),
    isERPReference,
    remoteFrrId: isERPReference ? normalizedRemoteFrrId : null,
  };
};

export const normalizeFrcPayload = (
  input: JsonObject,
  position: number,
  options: { preserveRemoteIds?: boolean } = {},
) => {
  const out: JsonObject = { posicion: position };
  for (const key of frcNumericKeys) out[key] = numberValue(input[key], null);
  for (const key of frcIntegerKeys) out[key] = integerValue(input[key], null);
  for (const key of frcDateKeys) out[key] = dateValue(input[key], null);
  for (const key of frcTextKeys) out[key] = text(input[key], null);

  out.FRC_Importe = numberValue(pick(input, ["FRC_Importe", "importe", "amount"]), (out.FRC_Importe as number | null) ?? 0);
  out.FRC_Cuenta = text(pick(input, ["FRC_Cuenta", "cuenta", "cuenta_contable"]), out.FRC_Cuenta as string | null);
  out.FRC_FechaLog = dateValue(input.FRC_FechaLog, new Date().toISOString().slice(0, 10));
  out.FRC_HoraLog = text(input.FRC_HoraLog, new Date().toISOString().slice(11, 19));
  out.FRC_id = options.preserveRemoteIds
    ? integerValue(pick(input, ["FRC_id", "frc_id", "id"]), null)
    : null;
  out.FRC_idfacturarecibida = options.preserveRemoteIds
    ? integerValue(pick(input, ["FRC_idfacturarecibida", "FRR_id", "factura_erp_id"]), null)
    : null;
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
};

export const normalizePunteoPayload = (input: JsonObject, position: number) => {
  const sourceLinesValue = pick(input, ["source_lines", "lines", "lineas"], []);
  const sourceLines = Array.isArray(sourceLinesValue) ? sourceLinesValue : [];
  const rawWithoutSourceLines = Object.fromEntries(
    Object.entries(input).filter(([key]) => !["source_lines", "lines", "lineas"].includes(key)),
  );
  const rawSourceTable = text(pick(input, ["source_table", "tabla_origen", "tabla"]), null);
  return {
    posicion: integerValue(pick(input, ["posicion", "position"]), position) ?? position,
    remote_id: text(
      pick(input, ["remote_id", "id_interno_estable", "id", "ID", "ALB_id", "GTO_id", "AMA_id"]),
      null,
    ),
    source_table: rawSourceTable?.toLowerCase() ?? null,
    source_id: integerValue(pick(input, ["source_id", "id_origen", "AMA_id"]), null),
    importe_factura: numberValue(
      pick(input, ["importe_factura", "importe_a_facturar"]),
      null,
    ),
    "Origen": text(pick(input, ["Origen", "origen"]), rawSourceTable === "albmaterial" ? "MA" : null),
    "Serie": text(pick(input, ["Serie", "serie"]), null),
    "Albaran": integerValue(pick(input, ["Albaran", "albaran", "numero_albaran"]), null),
    "Ref": text(pick(input, ["Ref", "ref", "referencia"]), null),
    "Fecha": dateValue(pick(input, ["Fecha", "fecha"]), null),
    "Importe P": numberValue(pick(input, ["Importe P", "importe_p", "importe_punteado"]), 0),
    "Importe": numberValue(pick(input, ["Importe", "importe"]), 0),
    "S": booleanValue(pick(input, ["S", "seleccionado"], false), false),
    "Ver": booleanValue(pick(input, ["Ver", "ver"], false), false),
    empresa_id: integerValue(pick(input, ["empresa_id", "FRR_Idempresa"]), null),
    proveedor_id: integerValue(pick(input, ["proveedor_id", "FRR_idproveedor"]), null),
    cuenta_gasto: text(pick(input, ["cuenta_gasto", "FRR_ctagasto"]), null),
    line_count: integerValue(pick(input, ["line_count", "numero_lineas"]), sourceLines.length) ?? sourceLines.length,
    source_lines: [],
    raw: rawWithoutSourceLines,
  };
};

const REEXTRACTION_PRESERVED_FRR_FIELDS = [
  "FRR_Idempresa",
  "FRR_idproveedor",
  "FRR_idcuenta",
  "FRR_ejercicio",
  "FRR_tipofactura",
  "FRR_idregimen",
  "FRR_fechactb",
  "FRR_Contabilizar",
  "FechaVto",
  "ImporteVto",
  "FRR_FechaVto1",
  "FRR_FechaVto2",
  "FRR_FechaVto3",
  "FRR_ImporteVto1",
  "FRR_ImporteVto2",
  "FRR_ImporteVto3",
  "FRR_igasto1",
  "FRR_igasto2",
  "FRR_igasto3",
  "FRR_igasto4",
  "FRR_ctagasto1",
  "FRR_ctagasto2",
  "FRR_ctagasto3",
  "FRR_ctagasto4",
] as const;

export type FacturaExtractionPersistence = {
  factura: JsonObject;
  persistedFrr: JsonObject;
  ctb: JsonObject[] | null;
  punteos: JsonObject[] | null;
};

export const prepareFacturaExtractionPersistence = ({
  existingFactura,
  extractedFrr,
  ctb,
  punteos,
}: {
  existingFactura: JsonObject | null;
  extractedFrr: JsonObject;
  ctb: JsonObject[];
  punteos: JsonObject[];
}): FacturaExtractionPersistence => {
  if (!existingFactura) {
    return {
      factura: { ...extractedFrr },
      persistedFrr: { ...extractedFrr },
      ctb,
      punteos,
    };
  }

  const preservedFrr: JsonObject = {};
  for (const field of REEXTRACTION_PRESERVED_FRR_FIELDS) {
    if (hasUsableValue(existingFactura[field])) {
      preservedFrr[field] = existingFactura[field];
    }
  }

  return {
    factura: { ...existingFactura, ...extractedFrr, ...preservedFrr },
    persistedFrr: { ...extractedFrr, ...preservedFrr },
    ctb: null,
    punteos: null,
  };
};

/**
 * Cierre operativo temporal para TEST: el alta de factura se conserva, pero
 * nunca solicita una contabilización que el servicio oficial no puede atender.
 */
export const forceFacturaERPAccountingDisabled = (factura: JsonObject): JsonObject => ({
  ...factura,
  FRR_Contabilizar: "N",
});

export const applyGastosToFrr = (frr: JsonObject, gastos: unknown) => {
  if (!Array.isArray(gastos)) return frr;

  gastos
    .filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .slice(0, 4)
    .forEach((gasto, index) => {
      const slot = index + 1;
      const importe = numberValue(pick(gasto, [`FRR_igasto${slot}`, "importe_gasto", "importe", "amount"]), null);
      const cuenta = text(pick(gasto, [`FRR_ctagasto${slot}`, "cuenta_gasto", "cuenta", "account"]), null);
      if (importe !== null) frr[`FRR_igasto${slot}`] = importe;
      if (cuenta !== null) frr[`FRR_ctagasto${slot}`] = cuenta;
    });

  return frr;
};

// Campos tecnicos que genera el servidor ERP; la API v0.2 rechaza recibirlos con valor.
const ERP_SERVER_GENERATED_FRR_KEYS = new Set([
  "FRR_id",
  "FRR_numero",
  "FRR_IdUsuarioLog",
  "FRR_FechaLog",
  "FRR_HoraLog",
  "FRR_IdAsientoNet",
  "FRR_IdfacturaRec",
]);
const ERP_SERVER_GENERATED_FRC_KEYS = new Set([
  "FRC_id",
  "FRC_idfacturarecibida",
  "FRC_IdUsuarioLog",
  "FRC_FechaLog",
  "FRC_HoraLog",
]);

export const toERPFacturaPayload = (factura: JsonObject) =>
  Object.fromEntries(
    Object.entries(normalizeFrrPayload(factura)).filter(
      ([key]) =>
        (key.startsWith("FRR_") || key === "FechaVto" || key === "ImporteVto") &&
        !ERP_SERVER_GENERATED_FRR_KEYS.has(key),
    ),
  );

export const toERPCtbPayload = (linea: JsonObject, position: number) =>
  Object.fromEntries(
    Object.entries(normalizeFrcPayload(linea, position)).filter(
      ([key]) => key.startsWith("FRC_") && !ERP_SERVER_GENERATED_FRC_KEYS.has(key),
    ),
  );

export const isPunteoExplicitlySelected = (punteo: JsonObject) =>
  punteo.S === true || punteo.S === "S";

const ERP_WRITABLE_PUNTEO_SOURCES = new Set([
  "albsalida_gastos",
  "albentrada_hisgastos",
  "albaranescompra_gastos",
  "facturas_gastos",
  "albarancoste",
  "albmaterial",
]);

export const getSelectedPunteoPreflightIssues = (punteos: readonly JsonObject[]) => {
  const issues: FacturaValidationIssue[] = [];
  const seenIdentities = new Map<string, number>();

  punteos.forEach((punteo, index) => {
    if (!isPunteoExplicitlySelected(punteo)) return;
    const position = index + 1;
    const sourceTable = text(punteo.source_table, null)?.toLowerCase() ?? null;
    const sourceId = integerValue(punteo.source_id, null);

    if (!sourceTable) {
      issues.push({
        field: `punteos.${index}.source_table`,
        message: `El punteo seleccionado en posicion ${position} no tiene source_table.`,
        severity: "error",
      });
    } else if (!ERP_WRITABLE_PUNTEO_SOURCES.has(sourceTable)) {
      issues.push({
        field: `punteos.${index}.source_table`,
        message:
          `El origen ${sourceTable} del punteo seleccionado en posicion ${position} es solo de lectura y no se puede enviar al ERP.`,
        severity: "error",
      });
    }
    if (sourceId === null || sourceId <= 0) {
      issues.push({
        field: `punteos.${index}.source_id`,
        message: `El punteo seleccionado en posicion ${position} no tiene source_id positivo.`,
        severity: "error",
      });
    }
    if (
      !sourceTable ||
      !ERP_WRITABLE_PUNTEO_SOURCES.has(sourceTable) ||
      sourceId === null ||
      sourceId <= 0
    ) return;

    const identity = `${sourceTable}:${sourceId}`;
    const firstPosition = seenIdentities.get(identity);
    if (firstPosition !== undefined) {
      issues.push({
        field: `punteos.${index}.source_id`,
        message:
          `El punteo seleccionado ${sourceTable}/${sourceId} esta duplicado en las posiciones ${firstPosition} y ${position}.`,
        severity: "error",
      });
      return;
    }
    seenIdentities.set(identity, position);
  });

  return issues;
};

export const toERPPunteoPayload = (punteo: JsonObject) => {
  const sourceTable = text(punteo.source_table, null)?.toLowerCase() ?? null;
  const sourceId = integerValue(punteo.source_id, null);
  const importeFactura = numberValue(punteo.importe_factura, null);
  return {
    source_table: sourceTable,
    source_id: sourceId,
    ...(importeFactura === null ? {} : { importe_factura: importeFactura }),
  };
};

export const toERPSelectedPunteosPayload = (punteos: readonly JsonObject[]) =>
  punteos
    .filter(isPunteoExplicitlySelected)
    .map(toERPPunteoPayload);

export const buildERPContractV2 = ({
  requestId,
  dryRun,
  cabecera,
  ctb,
  punteos,
}: {
  requestId: string;
  dryRun: boolean;
  cabecera: JsonObject;
  ctb: JsonObject[];
  punteos: JsonObject[];
}) => ({
  contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  request_id: requestId,
  dry_run: dryRun,
  cabecera,
  ctb,
  punteos,
});

export const parseJsonResponse = async (response: Response) => {
  const raw = await response.text();
  if (!raw.trim()) return { raw, payload: {} as unknown };
  try {
    return { raw, payload: JSON.parse(raw) as unknown };
  } catch {
    return { raw, payload: raw as unknown };
  }
};

export const upstreamResult = (response: Response, payload: unknown) => {
  const object = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as JsonObject
    : {};
  const explicitSuccess = object.ok === true || object.success === true;
  const declaredError =
    (typeof object.error === "string" && object.error.trim().length > 0) ||
    (typeof object.detail === "string" && object.detail.trim().length > 0);
  const ok = response.ok &&
    object.ok !== false &&
    object.success !== false &&
    (explicitSuccess || !declaredError);
  const message = text(
    pick(object, ["message", "error", "detail"]),
    typeof payload === "string" ? payload : `HTTP ${response.status}`,
  );
  return { ok, object, message };
};

export const extractRemoteFacturaId = (payload: unknown) => {
  const object = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as JsonObject
    : {};
  const factura = object.factura && typeof object.factura === "object" && !Array.isArray(object.factura)
    ? object.factura as JsonObject
    : {};
  const data = object.data && typeof object.data === "object" && !Array.isArray(object.data)
    ? object.data as JsonObject
    : {};
  const result = object.result && typeof object.result === "object" && !Array.isArray(object.result)
    ? object.result as JsonObject
    : {};
  const parsed = integerValue(
    pick(object, ["FRR_id", "frr_id", "factura_id"], pick(factura, ["FRR_id"], pick(data, ["FRR_id"], result.FRR_id))),
    null,
  );
  return parsed && parsed > 0 ? parsed : null;
};

export const validateERPWriteResponseV2 = (
  payload: unknown,
  {
    requestId,
    expectedDryRun,
  }: {
    requestId: string;
    expectedDryRun: boolean;
  },
) => {
  const object = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as JsonObject
    : {};
  const errors: string[] = [];

  if (object.contract_version !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
    errors.push("La respuesta ERP no confirma contract_version=2.");
  }
  if (object.request_id !== requestId) {
    errors.push("La respuesta ERP no corresponde al request_id enviado.");
  }
  if (object.ok !== true) {
    errors.push("La respuesta ERP no confirma ok=true.");
  }
  if (object.dry_run !== expectedDryRun) {
    errors.push(`La respuesta ERP no confirma dry_run=${expectedDryRun}.`);
  }

  let remoteFacturaId: number | null = null;
  if (errors.length === 0 && !expectedDryRun) {
    remoteFacturaId = extractRemoteFacturaId(object);
    if (!remoteFacturaId) errors.push("La respuesta confirmada no contiene FRR_id positivo.");
  }

  return {
    ok: errors.length === 0,
    object,
    errors,
    remoteFacturaId,
  };
};

export const validateERPWriteRequestV2 = (
  payload: unknown,
  {
    requestId,
    expectedDryRun,
  }: {
    requestId: string;
    expectedDryRun: boolean;
  },
) => {
  const object = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as JsonObject
    : {};
  const errors: string[] = [];
  if (object.contract_version !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
    errors.push("El request original no confirma contract_version=2.");
  }
  if (object.request_id !== requestId) {
    errors.push("El request original no coincide con el request_id activo.");
  }
  if (object.dry_run !== expectedDryRun) {
    errors.push(`El request original no confirma dry_run=${expectedDryRun}.`);
  }
  const cabecera = object.cabecera && typeof object.cabecera === "object" &&
      !Array.isArray(object.cabecera)
    ? object.cabecera as JsonObject
    : null;
  const ctb = Array.isArray(object.ctb) && object.ctb.every((item) =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    ? object.ctb as JsonObject[]
    : null;
  const punteos = Array.isArray(object.punteos) && object.punteos.every((item) =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    ? object.punteos as JsonObject[]
    : null;
  if (!cabecera) errors.push("El request original no contiene cabecera valida.");
  if (!ctb) errors.push("El request original no contiene CTB valido.");
  if (!punteos) errors.push("El request original no contiene punteos validos.");
  return {
    ok: errors.length === 0,
    errors,
    cabecera: cabecera ?? {},
    ctb: ctb ?? [],
    punteos: punteos ?? [],
  };
};

const jsonSemanticEquals = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonSemanticEquals(item, right[index]));
  }
  if (
    left && right &&
    typeof left === "object" && typeof right === "object"
  ) {
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftObject).sort();
    const rightKeys = Object.keys(rightObject).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) =>
        key === rightKeys[index] && jsonSemanticEquals(leftObject[key], rightObject[key])
      );
  }
  return false;
};

export const ERPWriterRelationsMatchSnapshot = ({
  currentCtb,
  currentPunteos,
  snapshotCtb,
  snapshotPunteos,
}: {
  currentCtb: JsonObject[];
  currentPunteos: JsonObject[];
  snapshotCtb: JsonObject[];
  snapshotPunteos: JsonObject[];
}) =>
  jsonSemanticEquals(currentCtb, snapshotCtb) &&
  jsonSemanticEquals(currentPunteos, snapshotPunteos);

export const hasBlockingERPValidationErrors = (payload: unknown) => {
  const object = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as JsonObject
    : {};
  const validations = object.validations && typeof object.validations === "object" &&
      !Array.isArray(object.validations)
    ? object.validations as JsonObject
    : {};
  const candidateGroups = [
    object.validation_errors,
    Array.isArray(object.validations) ? object.validations : null,
    object.errors,
    validations.errors,
    validations.validation_errors,
  ];
  return candidateGroups.some((candidates) =>
    Array.isArray(candidates) && candidates.some((item) => {
      const issue = item && typeof item === "object" && !Array.isArray(item)
        ? item as JsonObject
        : {};
      return issue.severity !== "warning" && issue.valid !== true;
    })
  );
};

const erpReadbackValueMatches = (expected: unknown, actual: unknown, tolerance = 0) => {
  if (typeof expected === "number") {
    const actualNumber = numberValue(actual, null);
    return actualNumber !== null && Math.abs(expected - actualNumber) <= tolerance;
  }
  return Object.is(expected, actual);
};

const ERP_MONETARY_HEADER_FIELDS = new Set([
  "FRR_base1",
  "FRR_base2",
  "FRR_base3",
  "FRR_base4",
  "FRR_base5",
  "FRR_cuota1",
  "FRR_cuota2",
  "FRR_cuota3",
  "FRR_cuota4",
  "FRR_cuota5",
  "FRR_baseret",
  "FRR_cuotaret",
  "FRR_igasto1",
  "FRR_igasto2",
  "FRR_igasto3",
  "FRR_igasto4",
  "FRR_totalfac",
  "ImporteVto",
  "FRR_ImporteVto1",
  "FRR_ImporteVto2",
  "FRR_ImporteVto3",
  "FRR_ImpSuplido",
  "FRR_CuotaNoDeducible",
]);

export const validateERPReadbackAgainstWrite = ({
  remoteFacturaId,
  cabecera,
  ctb,
  punteos,
  readback,
}: {
  remoteFacturaId: number;
  cabecera: JsonObject;
  ctb: JsonObject[];
  punteos: JsonObject[];
  readback: JsonObject;
}) => {
  const errors: FacturaValidationIssue[] = [];
  const headerRaw = readback.factura && typeof readback.factura === "object" &&
      !Array.isArray(readback.factura)
    ? readback.factura as JsonObject
    : {};
  const actualRemoteId = extractRemoteFacturaId(headerRaw);
  if (actualRemoteId !== remoteFacturaId) {
    errors.push({
      field: "factura.FRR_id",
      message: "El FRR_id leido no coincide con el confirmado por el writer.",
      severity: "error",
    });
  }

  const actualHeader = toERPFacturaPayload(headerRaw);
  for (const [key, expected] of Object.entries(cabecera)) {
    // FastAPI omite los null al escribir para que MariaDB aplique sus defaults
    // existentes. El readback puede devolver esos defaults (0, cadena o fecha
    // vacia), por lo que un campo no informado no debe exigir igualdad literal.
    if (expected === null || expected === undefined) continue;
    const tolerance = ERP_MONETARY_HEADER_FIELDS.has(key) ? 0.01 : 0;
    if (erpReadbackValueMatches(expected, actualHeader[key], tolerance)) continue;
    errors.push({
      field: `factura.${key}`,
      message: `La cabecera leida no coincide en ${key}.`,
      severity: "error",
    });
  }

  const actualCtb = Array.isArray(readback.ctb)
    ? readback.ctb.filter((linea): linea is JsonObject =>
      Boolean(linea) && typeof linea === "object" && !Array.isArray(linea)
    )
    : [];
  if (actualCtb.length !== ctb.length) {
    errors.push({
      field: "ctb",
      message: `El numero de lineas CTB leidas (${actualCtb.length}) no coincide con el enviado (${ctb.length}).`,
      severity: "error",
    });
  }
  const ctbKeys = [
    "FRC_Cuenta",
    "FRC_Importe",
    "FRC_IdActividad",
    "FRC_Idseccion",
    "FRC_Iddepartamento",
    "FRC_Idsubdepartamento",
  ] as const;
  const ctbZeroDefaultKeys = new Set<string>([
    "FRC_Iddepartamento",
    "FRC_Idsubdepartamento",
  ]);
  for (let index = 0; index < Math.min(ctb.length, actualCtb.length); index += 1) {
    const expectedLine = toERPCtbPayload(ctb[index], index + 1);
    const actualLine = toERPCtbPayload(actualCtb[index], index + 1);
    for (const key of ctbKeys) {
      const expected = expectedLine[key];
      const actual = actualLine[key];
      if (
        ctbZeroDefaultKeys.has(key) &&
        (expected === null || expected === undefined) &&
        (actual === null || actual === undefined || actual === 0)
      ) continue;
      const tolerance = key === "FRC_Importe" ? 0.01 : 0;
      if (erpReadbackValueMatches(expected, actual, tolerance)) continue;
      errors.push({
        field: `ctb.${index}.${key}`,
        message: `La linea CTB ${index + 1} no coincide en ${key}.`,
        severity: "error",
      });
    }
  }

  const actualPunteos = Array.isArray(readback.punteos)
    ? readback.punteos.filter((punteo): punteo is JsonObject =>
      Boolean(punteo) && typeof punteo === "object" && !Array.isArray(punteo)
    )
    : [];
  if (actualPunteos.length !== punteos.length) {
    errors.push({
      field: "punteos",
      message:
        `El numero de punteos leidos (${actualPunteos.length}) no coincide con el enviado (${punteos.length}).`,
      severity: "error",
    });
  }

  const actualPunteosByIdentity = new Map<string, JsonObject>();
  actualPunteos.forEach((punteo, index) => {
    const sourceTable = text(punteo.source_table, null)?.toLowerCase() ?? null;
    const sourceId = integerValue(punteo.source_id, null);
    if (!sourceTable || sourceId === null || sourceId <= 0) {
      errors.push({
        field: `punteos.${index}`,
        message: `El punteo leido en posicion ${index + 1} no tiene identidad ERP valida.`,
        severity: "error",
      });
      return;
    }
    const identity = `${sourceTable}:${sourceId}`;
    if (actualPunteosByIdentity.has(identity)) {
      errors.push({
        field: `punteos.${index}`,
        message: `El punteo leido ${sourceTable}/${sourceId} esta duplicado.`,
        severity: "error",
      });
      return;
    }
    actualPunteosByIdentity.set(identity, punteo);
  });

  punteos.forEach((punteo, index) => {
    const sourceTable = text(punteo.source_table, null)?.toLowerCase() ?? null;
    const sourceId = integerValue(punteo.source_id, null);
    const identity = sourceTable && sourceId !== null && sourceId > 0
      ? `${sourceTable}:${sourceId}`
      : null;
    const actual = identity ? actualPunteosByIdentity.get(identity) : undefined;
    if (!actual) {
      errors.push({
        field: `punteos.${index}`,
        message: `El punteo enviado ${sourceTable ?? "?"}/${sourceId ?? "?"} no aparece en el readback.`,
        severity: "error",
      });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(punteo, "importe_factura")) {
      const expectedAmount = numberValue(punteo.importe_factura, null);
      const actualAmount = numberValue(actual.importe_factura, null);
      if (
        expectedAmount === null ||
        actualAmount === null ||
        Math.abs(expectedAmount - actualAmount) > 0.01
      ) {
        errors.push({
          field: `punteos.${index}.importe_factura`,
          message: `El importe_factura del punteo ${sourceTable}/${sourceId} no coincide.`,
          severity: "error",
        });
      }
    }
  });

  return { ok: errors.length === 0, errors };
};

export const unwrapERPObject = (payload: unknown): JsonObject => {
  if (Array.isArray(payload)) {
    const first = payload[0];
    return first && typeof first === "object" && !Array.isArray(first) ? first as JsonObject : {};
  }
  if (!payload || typeof payload !== "object") return {};
  const object = payload as JsonObject;
  for (const key of ["factura", "data", "result", "item"]) {
    const candidate = object[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate as JsonObject;
  }
  return object;
};

export const unwrapERPArray = (payload: unknown): JsonObject[] => {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is JsonObject =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
  }
  if (!payload || typeof payload !== "object") return [];
  const object = payload as JsonObject;
  for (const key of ["items", "data", "results", "ctb", "punteos", "lines", "entries", "apuntes"]) {
    const candidate = object[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is JsonObject =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      );
    }
  }
  return [];
};

export const parseERPArrayEnvelope = (
  payload: unknown,
  supportedKeys: readonly string[],
): { ok: boolean; items: JsonObject[]; error: string | null } => {
  const parseArray = (candidate: unknown) => {
    if (!Array.isArray(candidate)) return null;
    if (candidate.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
      return { ok: false, items: [] as JsonObject[], error: "El array ERP contiene elementos no validos." };
    }
    return { ok: true, items: candidate as JsonObject[], error: null };
  };

  const direct = parseArray(payload);
  if (direct) return direct;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, items: [], error: "La respuesta ERP no contiene un array reconocido." };
  }

  const object = payload as JsonObject;
  for (const key of supportedKeys) {
    if (!hasOwn(object, key)) continue;
    const parsed = parseArray(object[key]);
    if (parsed) return parsed;
  }
  for (const wrapperKey of ["data", "result"]) {
    const wrapper = object[wrapperKey];
    if (!wrapper || typeof wrapper !== "object" || Array.isArray(wrapper)) continue;
    const wrapperObject = wrapper as JsonObject;
    for (const key of supportedKeys) {
      if (!hasOwn(wrapperObject, key)) continue;
      const parsed = parseArray(wrapperObject[key]);
      if (parsed) return parsed;
    }
  }
  return { ok: false, items: [], error: "La respuesta ERP no contiene un array reconocido." };
};

export type FacturaProveedorTipo = "acreedor" | "agricultor";

const positiveIdentityInteger = (value: unknown): number | null => {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : null;
  return parsed !== null && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : null;
};

export const resolveFacturaProveedorTipo = (
  factura: JsonObject,
  hintedType: unknown = null,
): FacturaProveedorTipo | null => {
  const tipoFactura = text(factura.FRR_tipofactura, null)?.toUpperCase() ?? null;
  if (tipoFactura === "GE") return "agricultor";
  if (tipoFactura) return "acreedor";
  const normalizedHint = text(hintedType, null)?.toLowerCase() ?? null;
  return normalizedHint === "acreedor" || normalizedHint === "agricultor"
    ? normalizedHint
    : null;
};

export const getFacturaProveedorTipoFromMatchEvidence = (
  matchEvidence: unknown,
  expectedProviderId: unknown,
): FacturaProveedorTipo | null => {
  if (!matchEvidence || typeof matchEvidence !== "object" || Array.isArray(matchEvidence)) {
    return null;
  }
  const proveedor = (matchEvidence as JsonObject).proveedor;
  if (!proveedor || typeof proveedor !== "object" || Array.isArray(proveedor)) {
    return null;
  }
  const proveedorEvidence = proveedor as JsonObject;
  // `entity_type` solo es una identidad utilizable cuando el match quedó
  // confirmado. No se acepta el tipo meramente sugerido ni shapes legacy
  // ambiguos: una cabecera FRR_tipofactura explícita seguirá teniendo prioridad.
  if (proveedorEvidence.matched !== true) return null;
  const expectedId = positiveIdentityInteger(expectedProviderId);
  const evidenceProviderId = positiveIdentityInteger(
    proveedorEvidence.provider_id,
  );
  if (
    !expectedId ||
    !evidenceProviderId ||
    evidenceProviderId !== expectedId
  ) {
    return null;
  }
  // Rechaza evidencia internamente contradictoria. `provider_id` es la clave
  // canónica del enriquecedor; si además llega otra identidad explícita, no
  // puede señalar a un maestro distinto.
  for (const alias of ["entity_id", "id"]) {
    if (!hasOwn(proveedorEvidence, alias)) continue;
    const aliasId = positiveIdentityInteger(proveedorEvidence[alias]);
    if (!aliasId || aliasId !== expectedId) return null;
  }

  const ownedTypeAliases = ["entity_type", "proveedor_tipo"]
    .filter((alias) => hasOwn(proveedorEvidence, alias))
    .map((alias) => text(proveedorEvidence[alias], null)?.toLowerCase() ?? null);
  if (
    ownedTypeAliases.length === 0 ||
    ownedTypeAliases.some((value) =>
      value !== "acreedor" && value !== "agricultor"
    )
  ) {
    return null;
  }
  const uniqueTypes = [...new Set(ownedTypeAliases)];
  return uniqueTypes.length === 1
    ? uniqueTypes[0] as FacturaProveedorTipo
    : null;
};

export const isFacturaERPReadOnlyReference = (factura: JsonObject) =>
  booleanValue(factura.is_readonly_reference, false) === true ||
  text(factura.source_kind, null) === "erp_reference";

export const parseERPProviderDetailResponse = (
  payload: unknown,
  providerType: FacturaProveedorTipo = "acreedor",
): { ok: boolean; provider: JsonObject; error: string | null } => {
  const providerLabel = providerType === "agricultor" ? "agricultor" : "acreedor";
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, provider: {}, error: `El detalle de ${providerLabel} ERP no es un objeto.` };
  }
  const envelope = payload as JsonObject;
  let provider = envelope;
  for (const key of [providerLabel, "provider", "data", "result", "item"]) {
    if (!hasOwn(envelope, key)) continue;
    const candidate = envelope[key];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, provider: {}, error: `El envelope de ${providerLabel} ERP es invalido.` };
    }
    provider = candidate as JsonObject;
    break;
  }
  const providerId = positiveIdentityInteger(
    pick(
      provider,
      providerType === "agricultor"
        ? ["id", "codigo", "agricultor_id", "AGR_Idagricultor", "AGR_Codigo"]
        : ["id", "codigo", "acreedor_id", "ACR_Codigo"],
    ),
  );
  if (!providerId) {
    return {
      ok: false,
      provider: {},
      error: `El detalle ERP no contiene un id de ${providerLabel} positivo.`,
    };
  }
  return { ok: true, provider, error: null };
};

export const buildERPDuplicateConsulta = (factura: JsonObject): string | null => {
  const empresaId = integerValue(factura.FRR_Idempresa, null);
  const ejercicio = integerValue(factura.FRR_ejercicio, null);
  const proveedorId = integerValue(factura.FRR_idproveedor, null);
  const numeroFactura = text(factura.FRR_numerofactura, null);
  const tipoFactura = text(factura.FRR_tipofactura, null)?.toUpperCase() ?? null;
  if (!empresaId || empresaId < 1 || !ejercicio || ejercicio < 1 || !proveedorId || proveedorId < 1 || !numeroFactura || !tipoFactura) {
    return null;
  }

  const params = new URLSearchParams({
    empresa_id: String(empresaId),
    ejercicio: String(ejercicio),
    proveedor_id: String(proveedorId),
    numero_factura: numeroFactura,
    tipo_factura: tipoFactura,
    limit: "10",
  });
  return `facturasrecibidas/buscar?${params.toString()}`;
};

export const getERPProviderPreflightIssues = (
  factura: JsonObject,
  providerPayload: unknown,
  providerType: FacturaProveedorTipo = "acreedor",
): FacturaValidationIssue[] => {
  const providerLabel = providerType === "agricultor" ? "agricultor" : "acreedor";
  const provider = unwrapERPObject(providerPayload);
  const expectedProviderId = positiveIdentityInteger(factura.FRR_idproveedor);
  const actualProviderId = positiveIdentityInteger(
    pick(
      provider,
      providerType === "agricultor"
        ? ["id", "codigo", "agricultor_id", "AGR_Idagricultor", "AGR_Codigo"]
        : ["id", "codigo", "acreedor_id", "ACR_Codigo"],
    ),
  );
  const expectedAccount = text(factura.FRR_idcuenta, null);
  const actualAccount = text(
    pick(
      provider,
      providerType === "agricultor"
        ? ["cuenta_id", "AGR_Cuenta", "AGR_IdCuenta", "cuenta", "cuenta_contable"]
        : ["cuenta_id", "ACR_IdCuenta", "ACR_Cuenta", "cuenta", "cuenta_contable"],
    ),
    null,
  );
  const issues: FacturaValidationIssue[] = [];

  const falseOperationalFlag = (value: unknown) => {
    if (value === false || value === 0) return true;
    if (typeof value !== "string") return false;
    return ["n", "no", "false", "0"].includes(value.trim().toLowerCase());
  };
  const firstOwnedFlag = (keys: string[]) => {
    const key = keys.find((candidate) => hasOwn(provider, candidate));
    return key ? { present: true, value: provider[key] } : { present: false, value: undefined };
  };
  const activo = firstOwnedFlag(
    providerType === "agricultor"
      ? ["activo", "AGR_Activo"]
      : ["activo", "ACR_Activo"],
  );
  const bloqueado = firstOwnedFlag(
    providerType === "agricultor"
      ? ["bloqueado", "AGR_Bloqueado", "AGR_bloqueado"]
      : ["bloqueado", "ACR_Bloqueado"],
  );
  const inactivoRgpd = firstOwnedFlag(
    providerType === "agricultor"
      ? []
      : ["inactivo_rgpd", "ACR_InactivoRGPD"],
  );

  if (activo.present && !booleanValue(activo.value, false)) {
    issues.push({
      field: "FRR_idproveedor",
      message: `El ${providerLabel} seleccionado no esta activo en el ERP.`,
      severity: "error",
    });
  }
  if (bloqueado.present && !falseOperationalFlag(bloqueado.value)) {
    issues.push({
      field: "FRR_idproveedor",
      message: `El ${providerLabel} seleccionado esta bloqueado en el ERP.`,
      severity: "error",
    });
  }
  if (inactivoRgpd.present && !falseOperationalFlag(inactivoRgpd.value)) {
    issues.push({
      field: "FRR_idproveedor",
      message: `El ${providerLabel} seleccionado esta inactivo por RGPD en el ERP.`,
      severity: "error",
    });
  }

  if (!expectedProviderId || !actualProviderId || actualProviderId !== expectedProviderId) {
    issues.push({
      field: "FRR_idproveedor",
      message: `El ${providerLabel} seleccionado no coincide con el detalle devuelto por el ERP.`,
      severity: "error",
    });
  }
  if (!actualAccount) {
    issues.push({
      field: "FRR_idcuenta",
      message: `El ERP no devuelve una cuenta contable para el ${providerLabel} seleccionado.`,
      severity: "error",
    });
  } else if (!expectedAccount || actualAccount !== expectedAccount) {
    issues.push({
      field: "FRR_idcuenta",
      message: `La cuenta contable no coincide con el maestro ERP (${actualAccount}).`,
      severity: "error",
    });
  }

  return issues;
};

export const normalizeERPDuplicateCandidates = (payload: unknown): JsonObject[] =>
  (() => {
    const direct = unwrapERPArray(payload);
    if (direct.length > 0 || !payload || typeof payload !== "object" || Array.isArray(payload)) return direct;
    const object = payload as JsonObject;
    return unwrapERPArray(object.data ?? object.result);
  })().slice(0, 10).map((candidate) => ({
    FRR_id: integerValue(candidate.FRR_id ?? candidate.id, null),
    FRR_numero: integerValue(candidate.FRR_numero ?? candidate.numero, null),
    FRR_Idempresa: integerValue(candidate.FRR_Idempresa ?? candidate.empresa_id, null),
    FRR_ejercicio: integerValue(candidate.FRR_ejercicio ?? candidate.ejercicio, null),
    FRR_idproveedor: integerValue(candidate.FRR_idproveedor ?? candidate.proveedor_id, null),
    FRR_numerofactura: text(candidate.FRR_numerofactura ?? candidate.numero_factura, null),
    FRR_tipofactura: text(
      candidate.FRR_tipofactura ?? candidate.tipo_factura,
      null,
    )?.toUpperCase() ?? null,
  }));

export const validateERPDuplicateSearchResponse = (
  payload: unknown,
  factura: JsonObject,
): {
  ok: boolean;
  total: number | null;
  candidates: JsonObject[];
  error: string | null;
} => {
  let items: unknown[];
  let total: unknown;
  if (Array.isArray(payload)) {
    return {
      ok: false,
      total: null,
      candidates: [],
      error: "Respuesta /buscar sin envelope items+total documentado.",
    };
  } else if (payload && typeof payload === "object") {
    const root = payload as JsonObject;
    const envelope = hasOwn(root, "items")
      ? root
      : root.data && typeof root.data === "object" && !Array.isArray(root.data)
        ? root.data as JsonObject
        : root.result && typeof root.result === "object" && !Array.isArray(root.result)
          ? root.result as JsonObject
          : null;
    if (!envelope || !Array.isArray(envelope.items) || !hasOwn(envelope, "total")) {
      return { ok: false, total: null, candidates: [], error: "Respuesta /buscar sin items y total explicitos." };
    }
    items = envelope.items;
    total = envelope.total;
  } else {
    return { ok: false, total: null, candidates: [], error: "Respuesta /buscar no reconocida." };
  }

  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    return { ok: false, total: null, candidates: [], error: "El total de /buscar no es un entero no negativo." };
  }
  if (total < items.length || (total === 0) !== (items.length === 0)) {
    return { ok: false, total: null, candidates: [], error: "Items y total de /buscar son incoherentes." };
  }

  const expected = {
    FRR_Idempresa: integerValue(factura.FRR_Idempresa, null),
    FRR_ejercicio: integerValue(factura.FRR_ejercicio, null),
    FRR_idproveedor: integerValue(factura.FRR_idproveedor, null),
    FRR_numerofactura: text(factura.FRR_numerofactura, null),
    FRR_tipofactura: text(factura.FRR_tipofactura, null)?.toUpperCase() ?? null,
  };
  if (
    !expected.FRR_Idempresa ||
    !expected.FRR_ejercicio ||
    !expected.FRR_idproveedor ||
    !expected.FRR_numerofactura ||
    !expected.FRR_tipofactura
  ) {
    return { ok: false, total: null, candidates: [], error: "La clave esperada de duplicado esta incompleta." };
  }

  const candidates: JsonObject[] = [];
  for (const rawCandidate of items) {
    if (!rawCandidate || typeof rawCandidate !== "object" || Array.isArray(rawCandidate)) {
      return { ok: false, total: null, candidates: [], error: "La respuesta /buscar contiene un candidato malformado." };
    }
    const candidate = rawCandidate as JsonObject;
    const normalized = {
      FRR_id: integerValue(candidate.FRR_id ?? candidate.id, null),
      FRR_numero: integerValue(candidate.FRR_numero ?? candidate.numero, null),
      FRR_Idempresa: integerValue(candidate.FRR_Idempresa ?? candidate.empresa_id, null),
      FRR_ejercicio: integerValue(candidate.FRR_ejercicio ?? candidate.ejercicio, null),
      FRR_idproveedor: integerValue(candidate.FRR_idproveedor ?? candidate.proveedor_id, null),
      FRR_numerofactura: text(candidate.FRR_numerofactura ?? candidate.numero_factura, null),
      FRR_tipofactura: text(
        candidate.FRR_tipofactura ?? candidate.tipo_factura,
        null,
      )?.toUpperCase() ?? null,
    };
    if (
      !normalized.FRR_id ||
      normalized.FRR_id <= 0 ||
      normalized.FRR_Idempresa !== expected.FRR_Idempresa ||
      normalized.FRR_ejercicio !== expected.FRR_ejercicio ||
      normalized.FRR_idproveedor !== expected.FRR_idproveedor ||
      normalized.FRR_numerofactura !== expected.FRR_numerofactura ||
      (normalized.FRR_tipofactura === "GE") !==
        (expected.FRR_tipofactura === "GE")
    ) {
      return {
        ok: false,
        total: null,
        candidates: [],
        error: "Un candidato de /buscar no coincide exactamente con la clave consultada.",
      };
    }
    candidates.push(normalized);
  }

  return { ok: true, total, candidates, error: null };
};

export const normalizeAccountingReadback = (payload: unknown): JsonObject => {
  const envelope = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as JsonObject
    : {};
  const accounting = envelope.accounting && typeof envelope.accounting === "object" &&
      !Array.isArray(envelope.accounting)
    ? envelope.accounting as JsonObject
    : unwrapERPObject(payload);
  const lines = unwrapERPArray(
    envelope.entries ??
      accounting.lines ??
      accounting.apuntes ??
      [],
  );
  return { ...accounting, lines };
};

export const validateAccountingReadback = (accounting: JsonObject) => {
  const technicalId = integerValue(
    accounting.technical_id ?? accounting.FRR_IdAsientoNet ?? accounting.id,
    null,
  );
  const visibleNumber = text(
    accounting.visible_number ?? accounting.numero ?? accounting.asiento,
    null,
  );
  const lines = Array.isArray(accounting.lines)
    ? accounting.lines.filter((line): line is JsonObject =>
      Boolean(line) && typeof line === "object" && !Array.isArray(line)
    )
    : [];
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    const side = text(line.side ?? line.lado, "")?.toLowerCase();
    const amount = numberValue(line.amount ?? line.importe, 0) ?? 0;
    debit += numberValue(line.debe ?? line.debit, side === "debe" ? amount : 0) ?? 0;
    credit += numberValue(line.haber ?? line.credit, side === "haber" ? amount : 0) ?? 0;
  }
  const status = text(accounting.status, "")?.toLowerCase();
  const created = status === "created" && accounting.created === true;
  return {
    ok:
      created &&
      Boolean(technicalId && technicalId > 0) &&
      Boolean(visibleNumber) &&
      lines.length > 0 &&
      debit > 0 &&
      Math.abs(debit - credit) <= 0.01,
    technical_id: technicalId,
    visible_number: visibleNumber,
    lines,
    total_debit: Number(debit.toFixed(2)),
    total_credit: Number(credit.toFixed(2)),
  };
};

const erpReadRouteRules: Array<{ path: RegExp; keys: ReadonlySet<string> }> = [
  {
    path: /^acreedores$/,
    keys: new Set(["schema", "limit", "offset", "q", "nombre", "nif", "codigo", "activo"]),
  },
  { path: /^acreedores\/\d+$/, keys: new Set(["schema"]) },
  { path: /^acreedores\/\d+\/gastos$/, keys: new Set(["schema"]) },
  {
    path: /^cuentas-contables$/,
    keys: new Set(["empresa_id", "limit", "offset", "q", "cuenta", "nif"]),
  },
  // La ruta `cuentas/...` no existe en FastAPI; mantenerla en la allowlist solo
  // producia 404 rio arriba presentados como 500. La lectura de cuentas es
  // `cuentas-contables`. Los proveedores GE son agricultores y no existen en el
  // maestro de acreedores: sus rutas de lectura deben estar permitidas.
  {
    path: /^agricultores$/,
    keys: new Set(["schema", "limit", "offset", "q", "nombre", "nif", "codigo", "tipo", "activo"]),
  },
  { path: /^agricultores\/\d+$/, keys: new Set(["schema"]) },
  { path: /^agricultores\/\d+\/gastos$/, keys: new Set(["schema"]) },
  { path: /^empresas$/, keys: new Set(["schema", "limit", "offset"]) },
  {
    path: /^facturasrecibidas$/,
    keys: new Set([
      "schema",
      "limit",
      "offset",
      "fecha_desde",
      "fecha_hasta",
      "proveedor_id",
      "proveedor_nif",
      "numero_factura",
      "ejercicio",
      "tipo_factura",
    ]),
  },
  {
    path: /^facturasrecibidas\/buscar$/,
    keys: new Set(["empresa_id", "ejercicio", "proveedor_id", "numero_factura", "fecha_factura", "tipo_factura", "schema", "limit", "offset"]),
  },
  {
    path: /^facturasrecibidas\/regimen-sugerido$/,
    keys: new Set([
      "schema",
      "empresa_id",
      "proveedor_id",
      "proveedor_tipo",
      "iva1",
      "iva2",
      "iva3",
      "iva4",
      "iva5",
      "base1",
      "base2",
      "base3",
      "base4",
      "base5",
      "cuota1",
      "cuota2",
      "cuota3",
      "cuota4",
      "cuota5",
    ]),
  },
  {
    path: /^facturasrecibidas\/cuentas-gasto-historicas$/,
    keys: new Set([
      "schema",
      "empresa_id",
      "proveedor_id",
      "proveedor_tipo",
      "fecha_desde",
      "fecha_hasta",
      "limit",
    ]),
  },
  {
    path: /^facturasrecibidas\/cuentas-iva-historicas$/,
    keys: new Set([
      "schema",
      "empresa_id",
      "ejercicio",
      "regimen_id",
      "tipo_factura",
      "porcentaje",
      "proveedor_id",
    ]),
  },
  { path: /^facturasrecibidas\/\d+$/, keys: new Set(["schema"]) },
  { path: /^facturasrecibidas\/\d+\/ctb$/, keys: new Set(["schema"]) },
  {
    path: /^facturasrecibidas\/\d+\/punteos$/,
    keys: new Set(["schema", "limit", "offset", "include_lines"]),
  },
  { path: /^facturasrecibidas\/\d+\/asiento$/, keys: new Set(["schema"]) },
  { path: /^facturasrecibidas\/tipos$/, keys: new Set(["schema"]) },
  { path: /^facturasrecibidas_ctb$/, keys: new Set(["schema", "limit", "offset"]) },
  { path: /^(?:tipos-iva|tipos_iva|regimenes|regimenes-iva|regimenes_iva)$/, keys: new Set(["schema"]) },
  {
    path: /^regimenes\/[1-9]\d*\/perfiles-iva$/,
    keys: new Set(["schema", "proveedor_id", "tipo_factura"]),
  },
  {
    path: /^albaranes-gastos\/punteables$/,
    keys: new Set([
      "schema",
      "limit",
      "offset",
      "source_table",
      "proveedor_id",
      "empresa_id",
      "referencia",
      "fecha_desde",
      "fecha_hasta",
      "solo_pendientes",
      "include_lines",
    ]),
  },
  {
    path: /^albaranes\/entrada$/,
    keys: new Set([
      "schema",
      "limit",
      "offset",
      "fecha_desde",
      "fecha_hasta",
      "agricultor_id",
      "serie",
      "numero",
    ]),
  },
  {
    path: /^albaranes\/entrada\/[1-9]\d*\/lineas$/,
    keys: new Set(["schema"]),
  },
  {
    path: /^albaranes\/material\/[1-9]\d*\/lineas$/,
    keys: new Set(["schema"]),
  },
];

export const isAllowedERPConsulta = (consulta: string) => {
  if (
    !consulta ||
    consulta.length > 2048 ||
    consulta.startsWith("/") ||
    /^https?:\/\//i.test(consulta) ||
    consulta.includes("..")
  ) {
    return false;
  }

  try {
    const rawPath = consulta.split(/[?#]/, 1)[0];
    const decodedPath = decodeURIComponent(rawPath);
    if (decodedPath.split(/[\\/\\\\]/).some((segment) => segment === "." || segment === "..")) {
      return false;
    }
  } catch {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(consulta, "https://erp.invalid/");
  } catch {
    return false;
  }
  if (parsed.origin !== "https://erp.invalid" || parsed.hash || parsed.username || parsed.password) return false;

  const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
  const rule = erpReadRouteRules.find((candidate) => candidate.path.test(path));
  if (!rule) return false;
  return [...parsed.searchParams.keys()].every((key) => rule.keys.has(key));
};

const CAMPOJOYMA_LEGACY_ERP_EMPRESA_ID = 1;

/**
 * Compatibilidad transitoria para clientes de Campojoyma anteriores al contrato
 * que hizo obligatorio `empresa_id` en el catalogo contable.
 *
 * El fallback esta deliberadamente limitado a `cuentas-contables` y nunca
 * reemplaza un valor enviado por el cliente, aunque sea invalido. FastAPI sigue
 * siendo la autoridad para validar la empresa y derivar su esquema contable.
 */
export const applyCampojoymaLegacyERPReadScope = (consulta: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(consulta, "https://erp.invalid/");
  } catch {
    return consulta;
  }
  if (
    parsed.origin !== "https://erp.invalid" ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    return consulta;
  }

  const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
  if (
    path !== "cuentas-contables" ||
    parsed.searchParams.has("empresa_id")
  ) {
    return consulta;
  }

  parsed.searchParams.set(
    "empresa_id",
    String(CAMPOJOYMA_LEGACY_ERP_EMPRESA_ID),
  );
  const query = parsed.searchParams.toString();
  return query ? `${path}?${query}` : path;
};

export type FacturaValidationIssue = {
  code?: string;
  field: string;
  message: string;
  severity: "error" | "warning";
  details?: JsonObject;
};

export type FacturaERPAccountingRuleRow = {
  empresa_id?: unknown;
  proveedor_id?: unknown;
  ejercicio_erp?: unknown;
  tipo_factura?: unknown;
  regimen_id?: unknown;
  fecha_ctb_policy?: unknown;
  cuenta_gasto_default?: unknown;
  concepto_template?: unknown;
  contabilizar_default?: unknown;
  activo?: unknown;
};

export type FacturaERPAccountingRuleResolution = {
  factura: JsonObject;
  applied: JsonObject;
  issues: FacturaValidationIssue[];
  evidence?: JsonObject;
};

export type FacturaERPAccountingRuleDependencies = {
  readERP?: (consulta: string) => Promise<unknown>;
};

export type FacturaERPIVAProfileResolution = {
  factura: JsonObject;
  applied: JsonObject;
  issues: FacturaValidationIssue[];
  evidence: JsonObject;
};

export type FacturaERPProviderTypeConfirmation = {
  providerType: FacturaProveedorTipo | null;
  providerName: string | null;
  issues: FacturaValidationIssue[];
  evidence: JsonObject;
};

export type FacturaERPExactMAPunteoVerification = {
  punteos: JsonObject[];
  issues: FacturaValidationIssue[];
  evidence: JsonObject;
};

export type FacturaERPExactDuplicateVerification = {
  duplicate: boolean;
  candidates: JsonObject[];
  issues: FacturaValidationIssue[];
  evidence: JsonObject;
};

export type FacturaERPExistingPunteoLinksResolution = {
  punteos: JsonObject[] | null;
  issues: FacturaValidationIssue[];
  evidence: JsonObject;
};

export type FacturaERPDocumentedReferenceValidationInput = {
  factura: JsonObject;
  extraction: JsonObject;
  matchEvidence?: JsonObject;
  punteos: JsonObject[];
  existingInvoiceVerified?: boolean;
};

const normalizedDocumentedReference = (value: unknown): string | null => {
  const parsed = text(value, null)
    ?.toLocaleLowerCase("es-ES")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "") ?? null;
  return parsed || null;
};

const jsonObjectOrEmpty = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};

const jsonObjectArray = (value: unknown): JsonObject[] =>
  Array.isArray(value)
    ? value.filter((item): item is JsonObject =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    : [];

const facturaERPDuplicateBusinessKey = (factura: JsonObject): JsonObject | null => {
  const empresaId = positiveIdentityInteger(factura.FRR_Idempresa);
  const ejercicio = positiveIdentityInteger(factura.FRR_ejercicio);
  const proveedorId = positiveIdentityInteger(factura.FRR_idproveedor);
  const numeroFactura = text(factura.FRR_numerofactura, null);
  const tipoFactura = text(factura.FRR_tipofactura, null)?.toUpperCase() ?? null;
  if (!empresaId || !ejercicio || !proveedorId || !numeroFactura || !tipoFactura) {
    return null;
  }
  return {
    empresa_id: empresaId,
    ejercicio,
    circuito: tipoFactura === "GE" ? "GE" : "MA",
    proveedor_id: proveedorId,
    numero_factura: numeroFactura,
  };
};

const sameFacturaERPDuplicateBusinessKey = (
  left: JsonObject,
  right: JsonObject,
): boolean =>
  left.empresa_id === right.empresa_id &&
  left.ejercicio === right.ejercicio &&
  left.circuito === right.circuito &&
  left.proveedor_id === right.proveedor_id &&
  left.numero_factura === right.numero_factura;

const facturaERPExactDuplicateIssue = (
  candidates: JsonObject[],
  total: number,
): FacturaValidationIssue => {
  const onlyCandidate = total === 1 && candidates.length === 1 ? candidates[0] : null;
  const remoteId = onlyCandidate ? positiveIdentityInteger(onlyCandidate.FRR_id) : null;
  const visibleNumber = onlyCandidate ? positiveIdentityInteger(onlyCandidate.FRR_numero) : null;
  const candidateDetail = remoteId
    ? ` como entrada ${remoteId}${visibleNumber ? ` (número ERP ${visibleNumber})` : ""}`
    : " para la misma empresa, ejercicio, circuito, proveedor y número";
  return {
    code: "duplicate_invoice",
    field: "erp_duplicate",
    message: `La factura ya existe en ERP${candidateDetail}; este borrador no puede enviarse de nuevo.`,
    severity: "error",
    details: {
      total,
      candidates,
    },
  };
};

const reusableFacturaERPExactDuplicate = (
  previousEvidence: unknown,
  businessKey: JsonObject,
): { candidates: JsonObject[]; total: number; evidence: JsonObject } | null => {
  const evidence = jsonObjectOrEmpty(previousEvidence);
  const previousKey = jsonObjectOrEmpty(evidence.business_key);
  const candidates = jsonObjectArray(evidence.candidates);
  const total = integerValue(evidence.total, null);
  if (
    evidence.source !== "erp_exact_duplicate" ||
    evidence.status !== "duplicate" ||
    evidence.verified !== true ||
    !total ||
    total < 1 ||
    candidates.length === 0 ||
    candidates.some((candidate) => !positiveIdentityInteger(candidate.FRR_id)) ||
    !sameFacturaERPDuplicateBusinessKey(previousKey, businessKey)
  ) {
    return null;
  }
  return { candidates, total, evidence };
};

/**
 * Edge vuelve a comprobar la clave de duplicado directamente contra Netagro.
 * Una señal de n8n nunca se acepta como autoridad. Si una revalidación de una
 * clave ya confirmada falla temporalmente, se conserva el bloqueo previo y se
 * registra que la comprobación fresca no estuvo disponible.
 */
export const verifyFacturaERPExactDuplicate = async (
  factura: JsonObject,
  readERP: (consulta: string) => Promise<unknown>,
  previousEvidence: unknown = null,
): Promise<FacturaERPExactDuplicateVerification> => {
  const consulta = buildERPDuplicateConsulta(factura);
  const businessKey = facturaERPDuplicateBusinessKey(factura);
  if (!consulta || !businessKey) {
    return {
      duplicate: false,
      candidates: [],
      issues: [],
      evidence: {
        source: "erp_exact_duplicate",
        status: "not_checkable",
        verified: false,
        checked: false,
      },
    };
  }

  const rejectUnverifiable = (
    status: "invalid_response" | "unavailable",
    reason: string,
  ): FacturaERPExactDuplicateVerification => {
    const reusable = reusableFacturaERPExactDuplicate(previousEvidence, businessKey);
    const availabilityIssue: FacturaValidationIssue = {
      code: "upstream_unavailable",
      field: reusable ? "metadata.warnings" : "erp_duplicate",
      message: reusable
        ? "No se pudo revalidar ahora el duplicado ya confirmado en ERP; se conserva el bloqueo anterior."
        : "No se pudo comprobar de forma fiable si la factura ya existe en el ERP.",
      severity: reusable ? "warning" : "error",
      details: { reason },
    };
    if (reusable) {
      return {
        duplicate: true,
        candidates: reusable.candidates,
        issues: [
          facturaERPExactDuplicateIssue(reusable.candidates, reusable.total),
          availabilityIssue,
        ],
        evidence: {
          ...reusable.evidence,
          checked: false,
          fresh: false,
          last_revalidation_status: status,
          last_revalidation_reason: reason,
        },
      };
    }
    return {
      duplicate: false,
      candidates: [],
      issues: [availabilityIssue],
      evidence: {
        source: "erp_exact_duplicate",
        status,
        verified: false,
        checked: false,
        fresh: false,
        reason,
        business_key: businessKey,
        total: null,
        candidates: [],
      },
    };
  };

  let payload: unknown;
  try {
    payload = await readERP(consulta);
  } catch {
    return rejectUnverifiable("unavailable", "upstream_unavailable");
  }
  const validation = validateERPDuplicateSearchResponse(payload, factura);
  if (!validation.ok || validation.total === null) {
    return rejectUnverifiable(
      "invalid_response",
      validation.error ?? "invalid_response",
    );
  }

  const duplicate = validation.total > 0;
  const evidence: JsonObject = {
    source: "erp_exact_duplicate",
    status: duplicate ? "duplicate" : "clear",
    verified: true,
    checked: true,
    fresh: true,
    business_key: businessKey,
    total: validation.total,
    candidates: validation.candidates,
  };
  return {
    duplicate,
    candidates: validation.candidates,
    issues: duplicate
      ? [facturaERPExactDuplicateIssue(validation.candidates, validation.total)]
      : [],
    evidence,
  };
};

/**
 * Recupera del ERP los vinculos que ya pertenecen a una factura duplicada
 * exacta y unica. `null` significa deliberadamente "no sustituir lo que ya
 * existe en Supabase"; nunca se convierte un fallo o una pagina incompleta en
 * un array vacio que el RPC interpretaria como una orden de borrado.
 */
export const resolveFacturaERPExistingPunteoLinks = async (
  duplicateVerification: FacturaERPExactDuplicateVerification,
  readERP: (consulta: string) => Promise<unknown>,
  options: { requireNonEmpty?: boolean } = {},
): Promise<FacturaERPExistingPunteoLinksResolution> => {
  const declaredDuplicateTotal = integerValue(
    duplicateVerification.evidence.total,
    null,
  );
  const onlyCandidate =
    duplicateVerification.duplicate &&
      declaredDuplicateTotal === 1 &&
      duplicateVerification.candidates.length === 1
      ? duplicateVerification.candidates[0]
      : null;
  const remoteFacturaId = onlyCandidate
    ? positiveIdentityInteger(onlyCandidate.FRR_id)
    : null;

  if (!remoteFacturaId) {
    return {
      punteos: null,
      issues: [],
      evidence: {
        source: "erp_existing_invoice_punteos",
        status: duplicateVerification.duplicate
          ? "not_checkable_ambiguous_duplicate"
          : "not_applicable",
        checked: false,
        authoritative: false,
        preserve_existing: true,
      },
    };
  }

  const unavailable = (reason: string): FacturaERPExistingPunteoLinksResolution => ({
    punteos: null,
    issues: [{
      code: "erp_linked_punteos_unavailable",
      field: "punteos",
      message:
        "No se pudieron actualizar los vinculos historicos de la factura existente en ERP; no se han modificado los vinculos guardados.",
      severity: "warning",
      details: { reason, existing_invoice_id: remoteFacturaId },
    }],
    evidence: {
      source: "erp_existing_invoice_punteos",
      status: "unavailable",
      checked: false,
      authoritative: false,
      preserve_existing: true,
      existing_invoice_id: remoteFacturaId,
      reason,
    },
  });

  let payload: unknown;
  try {
    payload = await readERP(
      `facturasrecibidas/${remoteFacturaId}/punteos?limit=100&offset=0&include_lines=false`,
    );
  } catch {
    return unavailable("upstream_unavailable");
  }

  const parsed = parseERPArrayEnvelope(payload, ["items", "punteos"]);
  if (!parsed.ok) return unavailable(parsed.error ?? "invalid_response");

  const payloadObject = jsonObjectOrEmpty(payload);
  const nestedEnvelope = jsonObjectOrEmpty(payloadObject.data ?? payloadObject.result);
  const envelope = hasOwn(payloadObject, "items") || hasOwn(payloadObject, "punteos")
    ? payloadObject
    : nestedEnvelope;
  const total = typeof envelope.total === "number" &&
      Number.isSafeInteger(envelope.total) && envelope.total >= 0
    ? envelope.total
    : null;
  if (total === null) return unavailable("missing_or_invalid_total");
  if (
    hasOwn(envelope, "limit") &&
    (typeof envelope.limit !== "number" ||
      !Number.isSafeInteger(envelope.limit) || envelope.limit !== 100)
  ) {
    return unavailable("unexpected_page_limit");
  }
  if (
    hasOwn(envelope, "offset") &&
    (typeof envelope.offset !== "number" ||
      !Number.isSafeInteger(envelope.offset) || envelope.offset !== 0)
  ) {
    return unavailable("unexpected_page_offset");
  }
  if (total !== parsed.items.length) return unavailable("partial_response");
  if (options.requireNonEmpty === true && total === 0) {
    return unavailable("documented_links_missing");
  }

  const normalizedPunteos = parsed.items.map((punteo, index) => ({
    ...normalizePunteoPayload(punteo, index + 1),
    posicion: index + 1,
    S: false,
  }));
  const identities = new Set<string>();
  for (const [index, punteo] of normalizedPunteos.entries()) {
    const sourceTable = text(punteo.source_table, null)?.toLowerCase() ?? null;
    const sourceId = positiveIdentityInteger(punteo.source_id);
    const remoteFacturaKey = ["factura_recibida_id", "FRR_id", "frr_id"]
      .find((key) => hasOwn(parsed.items[index], key));
    const rawRemoteFacturaId = remoteFacturaKey
      ? parsed.items[index][remoteFacturaKey]
      : undefined;
    const linkedRemoteFacturaId = rawRemoteFacturaId === undefined
      ? null
      : positiveIdentityInteger(rawRemoteFacturaId);
    if (
      !sourceTable ||
      !sourceId ||
      (rawRemoteFacturaId !== undefined && linkedRemoteFacturaId !== remoteFacturaId)
    ) {
      return unavailable("invalid_link_identity");
    }
    const identity = `${sourceTable}:${sourceId}`;
    if (identities.has(identity)) return unavailable("duplicate_link_identity");
    identities.add(identity);
  }

  return {
    punteos: normalizedPunteos,
    issues: [],
    evidence: {
      source: "erp_existing_invoice_punteos",
      status: "verified",
      checked: true,
      authoritative: true,
      preserve_existing: false,
      existing_invoice_id: remoteFacturaId,
      total,
    },
  };
};

export const filterFacturaERPWarningsAfterDuplicateVerification = (
  warnings: readonly string[],
  existingInvoiceVerified: boolean,
): string[] => {
  if (!existingInvoiceVerified) return [...warnings];
  return warnings.filter((warning) => {
    const normalized = warning
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-ES");
    return !normalized.includes("la factura ya existe en erp") &&
      !normalized.includes(
        "las referencias de albaran fueron consultadas en erp y no se encontraron coincidencias ma",
      );
  });
};

const facturaERPDocumentedReferenceContext = (
  extraction: JsonObject,
  matchEvidence: JsonObject,
) => {
  const documentedReferences = new Map<string, string>();
  const addReference = (value: unknown) => {
    const literal = text(value, null);
    const key = normalizedDocumentedReference(literal);
    if (literal && key && !documentedReferences.has(key)) {
      documentedReferences.set(key, literal);
    }
  };

  for (const albaran of jsonObjectArray(extraction.albaranes_referenciados)) {
    addReference(albaran.referencia);
  }
  for (const linea of jsonObjectArray(extraction.lineas)) {
    addReference(linea.referencia_albaran);
  }

  const punteoEvidence = jsonObjectOrEmpty(matchEvidence.punteos);
  for (const reference of jsonObjectArray(punteoEvidence.references)) {
    addReference(reference.referencia);
  }
  const evidenceDocumentedCount = integerValue(
    punteoEvidence.documented_count,
    null,
  );
  const expectedReferenceCount = Math.max(
    documentedReferences.size,
    evidenceDocumentedCount && evidenceDocumentedCount > 0
      ? evidenceDocumentedCount
      : 0,
  );
  return { documentedReferences, expectedReferenceCount };
};

export const getFacturaERPDocumentedReferenceCount = (
  extraction: JsonObject,
  matchEvidence: JsonObject = {},
) => facturaERPDocumentedReferenceContext(extraction, matchEvidence).expectedReferenceCount;

/**
 * Una señal positiva de n8n/IA nunca basta para resolver referencias. Edge
 * deriva las referencias documentadas del detalle extraído y exige una
 * selección MA revalidada, exacta, única y uno-a-uno para cada referencia.
 * La evidencia de n8n solo amplía el conjunto que debe revisarse; nunca
 * sustituye la verificación de los punteos seleccionados por Edge.
 */
export const getFacturaERPDocumentedReferenceIssues = ({
  factura,
  extraction,
  matchEvidence = {},
  punteos,
  existingInvoiceVerified = false,
}: FacturaERPDocumentedReferenceValidationInput): FacturaValidationIssue[] => {
  if (resolveFacturaProveedorTipo(factura) !== "acreedor") return [];
  // Una factura ya existente no tiene punteos pendientes que volver a
  // seleccionar. Este booleano solo puede proceder de la consulta Edge anterior.
  if (existingInvoiceVerified) return [];

  const { documentedReferences, expectedReferenceCount } =
    facturaERPDocumentedReferenceContext(extraction, matchEvidence);
  if (expectedReferenceCount === 0) return [];

  if (documentedReferences.size !== expectedReferenceCount) {
    return [{
      field: "punteos",
      message:
        `La factura declara ${expectedReferenceCount} referencias de albaran, pero solo ${documentedReferences.size} contienen una identidad literal verificable por Edge.`,
      severity: "error",
    }];
  }

  const selectedPunteos = punteos.filter(isPunteoExplicitlySelected);
  const edgeEvidence = jsonObjectOrEmpty(
    matchEvidence.punteos_edge_verification,
  );
  const edgeStatus = text(edgeEvidence.status, null);
  const edgeVerifiedCount = integerValue(edgeEvidence.verified, null);
  const selectedByReference = new Map<string, JsonObject[]>();
  const selectedSourceIdentities = new Set<string>();
  let hasInvalidSelectedIdentity = false;

  for (const punteo of selectedPunteos) {
    const raw = jsonObjectOrEmpty(punteo.raw);
    const referenceKey = normalizedDocumentedReference(
      punteo.referencia_documentada ??
        raw.referencia_documentada ??
        punteo.Ref,
    );
    const sourceTable = text(punteo.source_table, null)?.toLowerCase() ?? null;
    const sourceId = positiveIdentityInteger(punteo.source_id);
    if (
      !referenceKey ||
      sourceTable !== "albmaterial" ||
      !sourceId
    ) {
      hasInvalidSelectedIdentity = true;
      continue;
    }
    const matches = selectedByReference.get(referenceKey) ?? [];
    matches.push(punteo);
    selectedByReference.set(referenceKey, matches);
    const sourceIdentity = `${sourceTable}:${sourceId}`;
    if (selectedSourceIdentities.has(sourceIdentity)) {
      hasInvalidSelectedIdentity = true;
    }
    selectedSourceIdentities.add(sourceIdentity);
  }

  const unresolvedReferences = [...documentedReferences.entries()]
    .filter(([key]) => (selectedByReference.get(key)?.length ?? 0) !== 1)
    .map(([, literal]) => literal);
  const exactOneToOne =
    !hasInvalidSelectedIdentity &&
    unresolvedReferences.length === 0 &&
    selectedPunteos.length === expectedReferenceCount &&
    selectedSourceIdentities.size === expectedReferenceCount;
  const edgeVerified =
    edgeStatus === "verified" &&
    edgeVerifiedCount === expectedReferenceCount;

  if (exactOneToOne && edgeVerified) return [];

  const unresolvedDetail = unresolvedReferences.length > 0
    ? ` Referencias pendientes o ambiguas: ${unresolvedReferences.slice(0, 5).join(", ")}${unresolvedReferences.length > 5 ? "..." : ""}.`
    : "";
  return [{
    field: "punteos",
    message:
      `Las ${expectedReferenceCount} referencias de albaran documentadas no tienen una resolucion MA exacta, unica y revalidada por Edge.${unresolvedDetail}`,
    severity: "error",
  }];
};

export const buildFacturaERPExactMAPunteoConsulta = (
  factura: JsonObject,
  punteo: JsonObject,
): string | null => {
  if (resolveFacturaProveedorTipo(factura) !== "acreedor") return null;
  const empresaId = positiveIdentityInteger(factura.FRR_Idempresa);
  const proveedorId = positiveIdentityInteger(factura.FRR_idproveedor);
  const sourceTable = text(punteo.source_table, null)?.toLowerCase() ?? null;
  const sourceId = positiveIdentityInteger(punteo.source_id);
  const referencia = text(punteo.Ref, null);
  if (
    !empresaId ||
    !proveedorId ||
    sourceTable !== "albmaterial" ||
    !sourceId ||
    !referencia ||
    referencia.length > 255
  ) {
    return null;
  }

  const params = new URLSearchParams({
    source_table: "albmaterial",
    proveedor_id: String(proveedorId),
    empresa_id: String(empresaId),
    referencia,
    solo_pendientes: "true",
    limit: "2",
    offset: "0",
  });
  return `albaranes-gastos/punteables?${params.toString()}`;
};

/**
 * Revalida desde Edge cada solicitud de seleccion MA. La decision es atomica:
 * cualquier respuesta ambigua, incompleta o discordante conserva todos los
 * candidatos sin seleccionar.
 */
export const verifyFacturaERPExactMAPunteos = async (
  factura: JsonObject,
  requestedPunteos: JsonObject[],
  readERP: (consulta: string) => Promise<unknown>,
): Promise<FacturaERPExactMAPunteoVerification> => {
  const sanitized = sanitizeUntrustedPunteoSelections(requestedPunteos);
  const requestedIndexes = requestedPunteos
    .map((punteo, index) => isPunteoExplicitlySelected(punteo) ? index : -1)
    .filter((index) => index >= 0);
  if (requestedIndexes.length === 0) {
    return {
      punteos: sanitized,
      issues: [],
      evidence: {
        source: "erp_exact_ma_reference",
        status: "not_requested",
        requested: 0,
        verified: 0,
      },
    };
  }

  const rejectAll = (
    reason: string,
    message: string,
  ): FacturaERPExactMAPunteoVerification => ({
    punteos: sanitized,
    issues: [{
      field: "punteos",
      message,
      severity: "error",
    }],
    evidence: {
      source: "erp_exact_ma_reference",
      status: "rejected",
      reason,
      requested: requestedIndexes.length,
      verified: 0,
    },
  });

  if (requestedIndexes.length > 25) {
    return rejectAll(
      "too_many_candidates",
      "Hay mas de 25 punteos solicitados; no se selecciona ninguno automaticamente.",
    );
  }
  if (resolveFacturaProveedorTipo(factura) !== "acreedor") {
    return rejectAll(
      "unsupported_provider_type",
      "La seleccion automatica de punteos solo esta habilitada para acreedores MA.",
    );
  }

  const identities = new Set<string>();
  const requests: Array<{
    index: number;
    consulta: string;
    sourceId: number;
    referencia: string;
  }> = [];
  for (const index of requestedIndexes) {
    const punteo = requestedPunteos[index];
    const consulta = buildFacturaERPExactMAPunteoConsulta(factura, punteo);
    const sourceId = positiveIdentityInteger(punteo.source_id);
    const referencia = text(punteo.Ref, null);
    if (!consulta || !sourceId || !referencia) {
      return rejectAll(
        "invalid_candidate_identity",
        "Un punteo solicitado no contiene una identidad MA completa y verificable.",
      );
    }
    const identity = `albmaterial:${sourceId}`;
    if (identities.has(identity)) {
      return rejectAll(
        "duplicate_candidate_identity",
        "La solicitud contiene el mismo punteo MA mas de una vez.",
      );
    }
    identities.add(identity);
    requests.push({ index, consulta, sourceId, referencia });
  }

  const empresaId = positiveIdentityInteger(factura.FRR_Idempresa);
  const proveedorId = positiveIdentityInteger(factura.FRR_idproveedor);
  try {
    const responses = await Promise.all(
      requests.map(async (request) => ({
        request,
        payload: await readERP(request.consulta),
      })),
    );
    for (const { request, payload } of responses) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return rejectAll(
          "invalid_response",
          "El ERP no devolvio un catalogo valido para verificar los punteos MA.",
        );
      }
      const envelope = payload as JsonObject;
      if (
        !Array.isArray(envelope.items) ||
        envelope.items.length !== 1 ||
        envelope.total !== 1
      ) {
        return rejectAll(
          "non_unique_reference",
          "Una referencia MA no tiene una coincidencia exacta y unica pendiente; no se selecciona ningun punteo.",
        );
      }
      const item = envelope.items[0];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return rejectAll(
          "invalid_candidate",
          "El ERP devolvio un candidato MA malformado.",
        );
      }
      const candidate = item as JsonObject;
      const linkedInvoiceId = integerValue(
        candidate.factura_recibida_id,
        null,
      );
      if (
        text(candidate.source_table, null)?.toLowerCase() !== "albmaterial" ||
        positiveIdentityInteger(candidate.source_id) !== request.sourceId ||
        text(candidate.Ref, null) !== request.referencia ||
        positiveIdentityInteger(candidate.empresa) !== empresaId ||
        positiveIdentityInteger(candidate.acreedor_id) !== proveedorId ||
        (linkedInvoiceId !== null && linkedInvoiceId !== 0)
      ) {
        return rejectAll(
          "candidate_mismatch",
          "La identidad devuelta por el ERP no coincide exactamente con el punteo MA solicitado.",
        );
      }
    }

    const verifiedIndexes = new Set(requests.map((request) => request.index));
    return {
      punteos: sanitized.map((punteo, index) =>
        verifiedIndexes.has(index)
          ? { ...punteo, S: true, Ver: true }
          : punteo
      ),
      issues: [],
      evidence: {
        source: "erp_exact_ma_reference",
        status: "verified",
        requested: requestedIndexes.length,
        verified: requestedIndexes.length,
      },
    };
  } catch {
    return rejectAll(
      "erp_unavailable",
      "No se pudo verificar de forma completa el catalogo MA; todos los punteos quedan sin seleccionar.",
    );
  }
};

const REGIMEN_HISTORY_MIN_INVOICES = 3;
const REGIMEN_HISTORY_MIN_CONFIDENCE = 0.98;
const EXPENSE_HISTORY_MIN_INVOICES = 3;
const EXPENSE_HISTORY_MIN_CONFIDENCE = 0.98;
const EXPENSE_HISTORY_LIMIT = 10;
const IVA_ACTIVE_AMOUNT_EPSILON = 0.005;

const normalizedIvaRate = (value: unknown): number | null => {
  const parsed = numberValue(value, null);
  if (parsed === null || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 1000) / 1000;
};

/**
 * Firma de tipos IVA realmente usados. Los porcentajes de slots ERP con base y
 * cuota a cero son plantillas y no describen esta factura. Los tipos repetidos
 * se colapsan porque el regimen no depende de cuantos grupos compartan el tipo.
 */
export const getFacturaActiveIvaSignature = (
  factura: JsonObject,
): number[] | null => {
  const rates = new Set<number>();
  for (let position = 1; position <= 5; position += 1) {
    const base = numberValue(factura[`FRR_base${position}`], 0) ?? 0;
    const quota = numberValue(factura[`FRR_cuota${position}`], 0) ?? 0;
    if (
      Math.abs(base) < IVA_ACTIVE_AMOUNT_EPSILON &&
      Math.abs(quota) < IVA_ACTIVE_AMOUNT_EPSILON
    ) {
      continue;
    }
    const rate = normalizedIvaRate(factura[`FRR_iva${position}`]);
    if (rate === null) return null;
    rates.add(rate);
  }
  return [...rates].sort((left, right) => left - right);
};

const sameIvaSignature = (left: number[], right: number[]) =>
  left.length === right.length &&
  left.every((value, index) => Math.abs(value - right[index]) < 0.0005);

const normalizeIvaSignature = (value: unknown): number[] | null => {
  if (!Array.isArray(value)) return null;
  const rates = value.map(normalizedIvaRate);
  if (rates.some((rate) => rate === null)) return null;
  return [...new Set(rates as number[])].sort((left, right) => left - right);
};

export const buildFacturaERPRegimenSuggestionConsulta = (
  factura: JsonObject,
  providerType: FacturaProveedorTipo | null,
): { consulta: string; signature: number[] } | null => {
  if (positiveRuleInteger(factura.FRR_idregimen)) return null;
  const empresaId = positiveRuleInteger(factura.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(factura.FRR_idproveedor);
  const signature = getFacturaActiveIvaSignature(factura);
  if (!empresaId || !proveedorId || !providerType || !signature?.length) return null;

  const params = new URLSearchParams({
    empresa_id: String(empresaId),
    proveedor_id: String(proveedorId),
    proveedor_tipo: providerType,
  });
  for (let position = 1; position <= 5; position += 1) {
    for (const field of ["iva", "base", "cuota"] as const) {
      const value = numberValue(factura[`FRR_${field}${position}`], null);
      if (value !== null) params.set(`${field}${position}`, String(value));
    }
  }
  return {
    consulta: `facturasrecibidas/regimen-sugerido?${params.toString()}`,
    signature,
  };
};

export const resolveFacturaERPRegimenFromHistory = (
  factura: JsonObject,
  providerType: FacturaProveedorTipo | null,
  payload: unknown,
): FacturaERPAccountingRuleResolution => {
  const resolved = { ...factura };
  const applied: JsonObject = {};
  const issues: FacturaValidationIssue[] = [];
  const query = buildFacturaERPRegimenSuggestionConsulta(resolved, providerType);
  if (!query) {
    return {
      factura: resolved,
      applied,
      issues,
      evidence: {
        source: "erp_history",
        status: positiveRuleInteger(resolved.FRR_idregimen)
          ? "skipped_existing_value"
          : "skipped_missing_context",
      },
    };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    issues.push({
      field: "FRR_idregimen",
      message: "El historico ERP no devolvio una respuesta valida para resolver el regimen IVA.",
      severity: "warning",
    });
    return {
      factura: resolved,
      applied,
      issues,
      evidence: { source: "erp_history", status: "invalid_response" },
    };
  }

  const response = payload as JsonObject;
  const filters = response.filtros && typeof response.filtros === "object" &&
      !Array.isArray(response.filtros)
    ? response.filtros as JsonObject
    : {};
  const responseSignature = normalizeIvaSignature(response.firma_iva);
  const empresaId = positiveRuleInteger(resolved.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(resolved.FRR_idproveedor);
  const responseProviderType = text(filters.proveedor_tipo, null)?.toLowerCase() ?? null;
  const contextMatches =
    positiveRuleInteger(filters.empresa_id) === empresaId &&
    positiveRuleInteger(filters.proveedor_id) === proveedorId &&
    responseProviderType === providerType &&
    responseSignature !== null &&
    sameIvaSignature(responseSignature, query.signature);

  const counts = Array.isArray(response.recuentos)
    ? response.recuentos
      .map((entry) => {
        const row = entry && typeof entry === "object" && !Array.isArray(entry)
          ? entry as JsonObject
          : {};
        const regimenId = positiveRuleInteger(row.regimen_id);
        const uses = positiveRuleInteger(row.usos);
        return regimenId && uses ? { regimenId, uses } : null;
      })
      .filter((entry): entry is { regimenId: number; uses: number } => entry !== null)
      .sort((left, right) => right.uses - left.uses || left.regimenId - right.regimenId)
    : [];
  const total = counts.reduce((sum, entry) => sum + entry.uses, 0);
  const winner = counts[0] ?? null;
  const uniqueWinner = winner !== null &&
    (counts.length === 1 || winner.uses > counts[1].uses);
  const confidence = winner && total > 0 ? winner.uses / total : 0;
  const suggestion = response.sugerencia && typeof response.sugerencia === "object" &&
      !Array.isArray(response.sugerencia)
    ? response.sugerencia as JsonObject
    : {};
  const suggestedRegimen = positiveRuleInteger(suggestion.regimen_id);
  const responseTotal = integerValue(response.total_historicos_coincidentes, null);
  const responseConfidence = numberValue(suggestion.confianza, null);
  const responseConsistent =
    response.estado === "sugerido" &&
    contextMatches &&
    total >= REGIMEN_HISTORY_MIN_INVOICES &&
    responseTotal === total &&
    uniqueWinner &&
    confidence >= REGIMEN_HISTORY_MIN_CONFIDENCE &&
    suggestedRegimen === winner?.regimenId &&
    responseConfidence !== null &&
    Math.abs(responseConfidence - confidence) < 0.000001;

  const evidence: JsonObject = {
    source: "erp_history",
    status: text(response.estado, "invalid_response"),
    criterio: "mismo_proveedor_empresa_circuito_y_firma_iva_activa",
    firma_iva: query.signature,
    total_historicos: total,
    coincidencias: winner?.uses ?? 0,
    confianza: total > 0 ? Number(confidence.toFixed(6)) : null,
    alternativas: counts.slice(1).map((entry) => ({
      regimen_id: entry.regimenId,
      usos: entry.uses,
    })),
  };

  if (response.estado !== "sugerido") {
    return { factura: resolved, applied, issues, evidence };
  }
  if (!responseConsistent || !suggestedRegimen) {
    issues.push({
      field: "FRR_idregimen",
      message: "La sugerencia historica de regimen IVA no supera las comprobaciones de seguridad.",
      severity: "warning",
    });
    evidence.status = "rejected_inconsistent_response";
    return { factura: resolved, applied, issues, evidence };
  }

  resolved.FRR_idregimen = suggestedRegimen;
  applied.FRR_idregimen = suggestedRegimen;
  evidence.status = "applied";
  evidence.regimen_id = suggestedRegimen;
  return { factura: resolved, applied, issues, evidence };
};

type FacturaERPExpenseHistoryCandidate = {
  account: string;
  description: string | null;
  invoiceUses: number;
  lineUses: number;
  share: number;
  existsInCatalog: boolean;
  invoiceBlock: string | null;
  lastUsedAt: string | null;
};

const hasFacturaERPExpenseDistribution = (factura: JsonObject) =>
  [1, 2, 3, 4].some((position) => {
    const account = text(factura[`FRR_ctagasto${position}`], null);
    const amount = numberValue(factura[`FRR_igasto${position}`], null);
    // El frontend serializa slots vacios como importe 0. Eso no puede impedir
    // que Edge consulte el historico ni puede considerarse una distribucion.
    return account !== null || (amount !== null && Math.abs(amount) > 0.005);
  });

/**
 * Consulta de historico de gasto siempre acotada por empresa, proveedor y
 * circuito ya confirmado. La cuenta que pueda haber enviado n8n no participa:
 * en ingestiones no confiables se elimina antes de llegar a este punto.
 */
export const buildFacturaERPExpenseHistoryConsulta = (
  factura: JsonObject,
  providerType: FacturaProveedorTipo | null,
): string | null => {
  if (hasFacturaERPExpenseDistribution(factura)) return null;
  const empresaId = positiveRuleInteger(factura.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(factura.FRR_idproveedor);
  if (!empresaId || !proveedorId || !providerType) return null;

  const params = new URLSearchParams({
    empresa_id: String(empresaId),
    proveedor_id: String(proveedorId),
    proveedor_tipo: providerType,
    limit: String(EXPENSE_HISTORY_LIMIT),
  });
  return `facturasrecibidas/cuentas-gasto-historicas?${params.toString()}`;
};

const normalizeExpenseHistoryCandidate = (
  value: unknown,
  totalInvoices: number,
): FacturaERPExpenseHistoryCandidate | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as JsonObject;
  const account = text(row.cuenta, null);
  const invoiceUses = positiveRuleInteger(row.usos_facturas);
  const lineUses = positiveRuleInteger(row.usos_lineas);
  const share = numberValue(row.porcentaje_facturas, null);
  if (
    !account ||
    !/^\d{11}$/.test(account) ||
    !invoiceUses ||
    !lineUses ||
    lineUses < invoiceUses ||
    invoiceUses > totalInvoices ||
    share === null ||
    share <= 0 ||
    share > 1 ||
    Math.abs(share - invoiceUses / totalInvoices) > 0.000001 ||
    typeof row.existe_en_catalogo !== "boolean"
  ) {
    return null;
  }
  const rawBlock = text(row.bloqueo_facturas, null);
  const invoiceBlock = rawBlock?.toUpperCase() ?? null;
  if (invoiceBlock !== null && invoiceBlock !== "S" && invoiceBlock !== "N") {
    return null;
  }
  const rawLastUsedAt = text(row.ultima_fecha_uso, null);
  const lastUsedAt = rawLastUsedAt === null
    ? null
    : dateValue(rawLastUsedAt, null);
  if (rawLastUsedAt !== null && lastUsedAt === null) return null;

  return {
    account,
    description: text(row.descripcion, null),
    invoiceUses,
    lineUses,
    share,
    existsInCatalog: row.existe_en_catalogo,
    invoiceBlock,
    lastUsedAt,
  };
};

const facturaERPExpenseBaseTotal = (factura: JsonObject): number | null => {
  const bases = [1, 2, 3, 4, 5].map((position) =>
    numberValue(factura[`FRR_base${position}`], null)
  );
  if (bases.some((base) => base === null)) return null;
  return Number(
    (bases as number[]).reduce((sum, base) => sum + base, 0).toFixed(2),
  );
};

type FacturaERPExpenseDistributionState = {
  issues: FacturaValidationIssue[];
  pendingFields: string[];
};

const facturaERPExpenseDistributionState = (
  factura: JsonObject,
): FacturaERPExpenseDistributionState => {
  if (resolveFacturaProveedorTipo(factura) !== "acreedor") {
    return { issues: [], pendingFields: [] };
  }

  const issues: FacturaValidationIssue[] = [];
  const pendingFields = new Set<string>();
  let materialSlotCount = 0;
  let expenseTotal = 0;
  for (let position = 1; position <= 4; position += 1) {
    const accountField = `FRR_ctagasto${position}`;
    const amountField = `FRR_igasto${position}`;
    const account = text(factura[accountField], null);
    const amount = numberValue(factura[amountField], null);
    const hasAccount = account !== null;
    const hasMaterialAmount = amount !== null && Math.abs(amount) > 0.005;
    if (!hasAccount && !hasMaterialAmount) continue;

    materialSlotCount += 1;
    if (!account || !/^\d{11}$/.test(account)) {
      pendingFields.add(accountField);
      issues.push({
        field: accountField,
        message: `La cuenta de gasto ${position} debe tener exactamente 11 digitos.`,
        severity: "error",
      });
    }
    if (!hasMaterialAmount) {
      pendingFields.add(amountField);
      issues.push({
        field: amountField,
        message: `Falta un importe valido para la cuenta de gasto ${position}.`,
        severity: "error",
      });
    } else {
      expenseTotal += amount;
    }
  }

  if (materialSlotCount === 0) {
    pendingFields.add("FRR_ctagasto1");
    pendingFields.add("FRR_igasto1");
    issues.push({
      field: "FRR_ctagasto1",
      message:
        "Falta asignar una cuenta de gasto y su importe para esta factura.",
      severity: "error",
    });
    return { issues, pendingFields: [...pendingFields] };
  }

  const baseTotal = facturaERPExpenseBaseTotal(factura);
  if (
    baseTotal !== null &&
    !issues.some((issue) => issue.severity === "error") &&
    Math.abs(expenseTotal - baseTotal) > 0.01
  ) {
    pendingFields.add("FRR_igasto1");
    issues.push({
      field: "FRR_igasto1",
      message:
        `La suma de gastos (${expenseTotal.toFixed(2)}) no coincide con la base de IVA (${baseTotal.toFixed(2)}).`,
      severity: "error",
    });
  }

  return { issues, pendingFields: [...pendingFields] };
};

/**
 * Acepta una cuenta historica solo si la respuesta conserva el contexto exacto,
 * el lider es unico, sigue disponible en el catalogo y domina al menos el 98 %
 * de un minimo de tres facturas. En cualquier otro caso no inventa una cuenta.
 */
export const resolveFacturaERPExpenseAccountFromHistory = (
  factura: JsonObject,
  providerType: FacturaProveedorTipo | null,
  payload: unknown,
): FacturaERPAccountingRuleResolution => {
  const resolved = { ...factura };
  const applied: JsonObject = {};
  const issues: FacturaValidationIssue[] = [];
  const query = buildFacturaERPExpenseHistoryConsulta(resolved, providerType);
  const baseEvidence: JsonObject = {
    source: "erp_history",
    criterio:
      "misma_empresa_proveedor_y_circuito_con_lider_unico_activo_y_dominante",
    min_facturas: EXPENSE_HISTORY_MIN_INVOICES,
    min_confianza: EXPENSE_HISTORY_MIN_CONFIDENCE,
  };
  if (!query) {
    return {
      factura: resolved,
      applied,
      issues,
      evidence: {
        ...baseEvidence,
        status: hasFacturaERPExpenseDistribution(resolved)
          ? "skipped_existing_value"
          : "skipped_missing_context",
      },
    };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    issues.push({
      field: "FRR_ctagasto1",
      message:
        "El historico ERP no devolvio una respuesta valida para resolver la cuenta de gasto.",
      severity: "warning",
    });
    return {
      factura: resolved,
      applied,
      issues,
      evidence: { ...baseEvidence, status: "invalid_response" },
    };
  }

  const response = payload as JsonObject;
  const filters = response.filtros && typeof response.filtros === "object" &&
      !Array.isArray(response.filtros)
    ? response.filtros as JsonObject
    : {};
  const empresaId = positiveRuleInteger(resolved.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(resolved.FRR_idproveedor);
  const responseProviderType = text(filters.proveedor_tipo, null)?.toLowerCase() ?? null;
  const totalInvoices = integerValue(response.total_facturas_con_gasto, null);
  const contextMatches =
    positiveRuleInteger(filters.empresa_id) === empresaId &&
    positiveRuleInteger(filters.proveedor_id) === proveedorId &&
    responseProviderType === providerType &&
    text(filters.fecha_desde, null) === null &&
    text(filters.fecha_hasta, null) === null;
  const rawItems = Array.isArray(response.items) ? response.items : null;
  const candidates = totalInvoices !== null && totalInvoices > 0 && rawItems
    ? rawItems.map((item) => normalizeExpenseHistoryCandidate(item, totalInvoices))
    : [];
  const hasDuplicateAccounts = candidates.some((candidate, index) =>
    candidate !== null &&
    candidates.findIndex((other) => other?.account === candidate.account) !== index
  );
  const responseIsValid =
    contextMatches &&
    totalInvoices !== null &&
    totalInvoices >= 0 &&
    rawItems !== null &&
    rawItems.length <= EXPENSE_HISTORY_LIMIT &&
    candidates.every((candidate) => candidate !== null) &&
    !hasDuplicateAccounts &&
    (totalInvoices > 0 || rawItems.length === 0);
  if (!responseIsValid) {
    issues.push({
      field: "FRR_ctagasto1",
      message:
        "La respuesta historica de cuentas de gasto no supera las comprobaciones de seguridad.",
      severity: "warning",
    });
    return {
      factura: resolved,
      applied,
      issues,
      evidence: { ...baseEvidence, status: "rejected_inconsistent_response" },
    };
  }

  const ranking = (candidates as FacturaERPExpenseHistoryCandidate[])
    .sort((left, right) =>
      right.invoiceUses - left.invoiceUses ||
      String(right.lastUsedAt ?? "").localeCompare(String(left.lastUsedAt ?? "")) ||
      left.account.localeCompare(right.account)
    );
  const winner = ranking[0] ?? null;
  const evidence: JsonObject = {
    ...baseEvidence,
    status: totalInvoices === 0 ? "not_found" : "pending_review",
    filtros: {
      empresa_id: empresaId,
      proveedor_id: proveedorId,
      proveedor_tipo: providerType,
    },
    total_facturas_con_gasto: totalInvoices,
    ranking: ranking.map((candidate, index) => ({
      rank: index + 1,
      cuenta: candidate.account,
      descripcion: candidate.description,
      usos_facturas: candidate.invoiceUses,
      porcentaje_facturas: Number(candidate.share.toFixed(6)),
      existe_en_catalogo: candidate.existsInCatalog,
      bloqueo_facturas: candidate.invoiceBlock,
    })),
  };
  if (!winner || totalInvoices < EXPENSE_HISTORY_MIN_INVOICES) {
    evidence.status = winner ? "insufficient_history" : "not_found";
    return { factura: resolved, applied, issues, evidence };
  }
  const uniqueWinner = ranking.length === 1 ||
    winner.invoiceUses > ranking[1].invoiceUses;
  if (!uniqueWinner || winner.share < EXPENSE_HISTORY_MIN_CONFIDENCE) {
    evidence.status = uniqueWinner ? "insufficient_confidence" : "ambiguous";
    return { factura: resolved, applied, issues, evidence };
  }
  if (!winner.existsInCatalog || winner.invoiceBlock === "S") {
    evidence.status = "unavailable_account";
    return { factura: resolved, applied, issues, evidence };
  }

  const parsedExistingAmount = numberValue(resolved.FRR_igasto1, null);
  const existingAmount = parsedExistingAmount !== null &&
      Math.abs(parsedExistingAmount) > 0.005
    ? parsedExistingAmount
    : null;
  const expenseAmount = existingAmount ?? facturaERPExpenseBaseTotal(resolved);
  if (expenseAmount === null) {
    evidence.status = "incomplete_iva_bases";
    return { factura: resolved, applied, issues, evidence };
  }

  resolved.FRR_ctagasto1 = winner.account;
  applied.FRR_ctagasto1 = winner.account;
  if (existingAmount === null) {
    resolved.FRR_igasto1 = expenseAmount;
    applied.FRR_igasto1 = expenseAmount;
  }
  evidence.status = "applied";
  evidence.resolved = true;
  evidence.selected_account = winner.account;
  evidence.selected_rank = 1;
  evidence.confianza = Number(winner.share.toFixed(6));
  return { factura: resolved, applied, issues, evidence };
};

type AccountingRuleField = {
  ruleKey:
    | "ejercicio_erp"
    | "tipo_factura"
    | "regimen_id"
    | "fecha_ctb_policy"
    | "cuenta_gasto_default"
    | "concepto_template"
    | "contabilizar_default";
  facturaKey:
    | "FRR_ejercicio"
    | "FRR_tipofactura"
    | "FRR_idregimen"
    | "FRR_fechactb"
    | "FRR_ctagasto1"
    | "FRR_Concepto"
    | "FRR_Contabilizar";
  normalize: (value: unknown) => string | number | null;
};

const positiveRuleInteger = (value: unknown) => {
  const parsed = integerValue(value, null);
  return parsed !== null && parsed > 0 ? parsed : null;
};

type FacturaERPIVAProfileCandidate = {
  porcentajes: [
    number | null,
    number | null,
    number | null,
    number | null,
    number | null,
  ];
  usos: number;
  confianza: number;
  source: "dominant" | "most_used";
};

type FacturaERPIVAProfileParseResult = {
  profile: FacturaERPIVAProfileCandidate | null;
  status: "dominant" | "most_used" | "ambiguous" | "no_history";
};

const normalizeFacturaERPIVAPercentages = (
  value: unknown,
): FacturaERPIVAProfileCandidate["porcentajes"] | null => {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const normalized = value.map((percentage) => {
    if (percentage === null) return null;
    if (
      percentage === undefined ||
      (typeof percentage === "string" && percentage.trim() === "")
    ) {
      return undefined;
    }
    const parsed = numberValue(percentage, null);
    return parsed !== null && parsed >= 0 && parsed <= 100
      ? parsed
      : undefined;
  });
  if (normalized.some((percentage) => percentage === undefined)) return null;
  return normalized as FacturaERPIVAProfileCandidate["porcentajes"];
};

const normalizeFacturaERPIVADominantProfileCandidate = (
  value: unknown,
): FacturaERPIVAProfileCandidate | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = value as JsonObject;
  const porcentajes = normalizeFacturaERPIVAPercentages(profile.porcentajes);
  const usos = numberValue(profile.usos, null);
  const confianza = numberValue(profile.confianza, null);
  if (
    !porcentajes ||
    usos === null ||
    !Number.isInteger(usos) ||
    usos <= 0 ||
    confianza === null ||
    confianza < 0 ||
    confianza > 1
  ) {
    return null;
  }
  if (profile.criterio !== "perfil_historico_dominante") {
    return null;
  }
  return { porcentajes, usos, confianza, source: "dominant" };
};

const normalizeFacturaERPIVAHistoricalProfileCandidate = (
  value: unknown,
): FacturaERPIVAProfileCandidate | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = value as JsonObject;
  const porcentajes = normalizeFacturaERPIVAPercentages(profile.porcentajes);
  const usos = numberValue(profile.usos, null);
  const confianza = numberValue(profile.confianza, null);
  const tramos = profile.tramos;
  if (
    !porcentajes ||
    usos === null ||
    !Number.isInteger(usos) ||
    usos <= 0 ||
    confianza === null ||
    confianza < 0 ||
    confianza > 1 ||
    !Array.isArray(tramos) ||
    tramos.length !== 5
  ) {
    return null;
  }

  const tramoPercentages = normalizeFacturaERPIVAPercentages(
    tramos.map((item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as JsonObject).porcentaje
        : undefined
    ),
  );
  if (!tramoPercentages) return null;

  const validTramos = tramos.every((valueTramo: unknown, index: number) => {
    if (!valueTramo || typeof valueTramo !== "object" || Array.isArray(valueTramo)) {
      return false;
    }
    const tramo = valueTramo as JsonObject;
    const posicion = numberValue(tramo.posicion, null);
    const porcentaje = tramoPercentages[index];
    const usosActivos = numberValue(tramo.usos_activos, null);
    const confianzaActiva = numberValue(tramo.confianza_activa, null);
    const profilePercentage = porcentajes[index];
    const samePercentage = porcentaje === profilePercentage ||
      (porcentaje !== null &&
        porcentaje !== undefined &&
        profilePercentage !== null &&
        Math.abs(porcentaje - profilePercentage) < 0.0005);
    return posicion === index + 1 &&
      porcentaje !== undefined &&
      samePercentage &&
      usosActivos !== null &&
      Number.isInteger(usosActivos) &&
      usosActivos >= 0 &&
      confianzaActiva !== null &&
      confianzaActiva >= 0 &&
      confianzaActiva <= 1;
  });
  if (!validTramos) return null;

  return { porcentajes, usos, confianza, source: "most_used" };
};

const parseFacturaERPIVAProfileResponse = (
  payload: unknown,
  expectedRegimenId: number,
): FacturaERPIVAProfileParseResult | undefined => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const response = payload as JsonObject;
  const filters = response.filtros;
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    return undefined;
  }
  const filterValues = filters as JsonObject;
  const regimenId = numberValue(response.regimen_id, null);
  const totalFacturas = numberValue(response.total_facturas, null);
  const estado = text(response.estado, null);
  if (
    regimenId !== expectedRegimenId ||
    !Number.isInteger(regimenId) ||
    totalFacturas === null ||
    !Number.isInteger(totalFacturas) ||
    totalFacturas < 0 ||
    positiveRuleInteger(filterValues.proveedor_id) !== null ||
    text(filterValues.tipo_factura, null) !== null ||
    typeof response.ambiguo !== "boolean" ||
    !["sin_historial", "dominante", "ambiguo"].includes(estado ?? "") ||
    !Array.isArray(response.perfiles)
  ) {
    return undefined;
  }

  if (estado === "sin_historial") {
    return { profile: null, status: "no_history" };
  }
  if (estado === "dominante" && response.ambiguo === false) {
    const profile = normalizeFacturaERPIVADominantProfileCandidate(
      response.plantilla_sugerida,
    );
    return profile ? { profile, status: "dominant" } : undefined;
  }
  if (estado === "ambiguo" && response.ambiguo === true) {
    const profile = response.perfiles
      .map(normalizeFacturaERPIVAHistoricalProfileCandidate)
      .filter((candidate): candidate is FacturaERPIVAProfileCandidate =>
        candidate !== null
      )
      .reduce<FacturaERPIVAProfileCandidate | null>(
        (mostUsed, candidate) =>
          mostUsed === null || candidate.usos > mostUsed.usos
            ? candidate
            : mostUsed,
        null,
      );
    return profile
      ? { profile, status: "most_used" }
      : { profile: null, status: "ambiguous" };
  }
  return undefined;
};

const isFacturaERPIVAProfileMissingPosition = (
  factura: JsonObject,
  position: number,
) => {
  const rate = factura[`FRR_iva${position}`];
  if (!hasUsableValue(rate)) return true;
  if (numberValue(rate, null) !== 0) return false;

  const base = numberValue(factura[`FRR_base${position}`], 0) ?? 0;
  const quota = numberValue(factura[`FRR_cuota${position}`], 0) ?? 0;
  return Math.abs(base) < IVA_ACTIVE_AMOUNT_EPSILON &&
    Math.abs(quota) < IVA_ACTIVE_AMOUNT_EPSILON;
};

/**
 * Completa los porcentajes IVA que el agente no haya informado antes del alta.
 * La plantilla es global para el regimen, igual que en la consulta del frontend;
 * nunca reemplaza un porcentaje ya extraido ni modifica bases o cuotas.
 */
export const loadAndApplyFacturaERPIVAProfileForInsert = async (
  factura: JsonObject,
  readERP: (consulta: string) => Promise<unknown> = fetchERPReadConsulta,
): Promise<FacturaERPIVAProfileResolution> => {
  const resolved = { ...factura };
  const applied: JsonObject = {};
  const regimenId = positiveRuleInteger(resolved.FRR_idregimen);
  const missingPositions = [1, 2, 3, 4, 5].filter(
    (position) => isFacturaERPIVAProfileMissingPosition(resolved, position),
  );
  const baseEvidence: JsonObject = {
    source: "erp_regimen_iva_profile",
    regimen_id: regimenId,
    applied_positions: [],
  };

  if (!regimenId) {
    return {
      factura: resolved,
      applied,
      issues: [],
      evidence: { ...baseEvidence, status: "skipped_missing_regimen" },
    };
  }
  if (missingPositions.length === 0) {
    return {
      factura: resolved,
      applied,
      issues: [],
      evidence: { ...baseEvidence, status: "skipped_complete" },
    };
  }

  let profileResult: FacturaERPIVAProfileParseResult | undefined;
  try {
    profileResult = parseFacturaERPIVAProfileResponse(
      await readERP(`regimenes/${regimenId}/perfiles-iva`),
      regimenId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return {
      factura: resolved,
      applied,
      issues: [{
        field: "iva_tramos",
        message:
          `No se pudo consultar el perfil historico de IVA antes de guardar (${message}).`,
        severity: "warning",
      }],
      evidence: { ...baseEvidence, status: "unavailable" },
    };
  }

  if (profileResult === undefined) {
    return {
      factura: resolved,
      applied,
      issues: [{
        field: "iva_tramos",
        message:
          "El perfil historico de IVA no respeta el contrato y no se ha aplicado.",
        severity: "warning",
      }],
      evidence: { ...baseEvidence, status: "invalid_response" },
    };
  }
  if (profileResult.profile === null) {
    return {
      factura: resolved,
      applied,
      issues: [],
      evidence: { ...baseEvidence, status: profileResult.status },
    };
  }
  const profile = profileResult.profile;

  const appliedPositions: number[] = [];
  for (const position of missingPositions) {
    const percentage = profile.porcentajes[position - 1];
    if (percentage === null) continue;
    const field = `FRR_iva${position}`;
    resolved[field] = percentage;
    applied[field] = percentage;
    appliedPositions.push(position);
  }

  return {
    factura: resolved,
    applied,
    issues: [],
    evidence: {
      ...baseEvidence,
      status: appliedPositions.length > 0 ? "applied" : "no_applicable_percentages",
      profile_source: profile.source,
      profile_percentages: profile.porcentajes,
      usos: profile.usos,
      confianza: profile.confianza,
      applied_positions: appliedPositions,
      preserved_positions: [1, 2, 3, 4, 5].filter(
        (position) => !missingPositions.includes(position),
      ),
    },
  };
};

const normalizedDefaultExpenseAccount = (value: unknown) => {
  const account = text(value, null);
  return account && /^\d{11}$/.test(account) ? account : null;
};

const normalizedConceptTemplate = (value: unknown) => {
  const template = text(value, null);
  return template &&
      template.length <= 50 &&
      template.includes("{proveedor}")
    ? template
    : null;
};

const normalizedDefaultSn = (value: unknown) => snValue(value, null);

/**
 * Reconfirma contra el maestro ERP el circuito sugerido por la evidencia del
 * agente. El ID y la cuenta contable deben coincidir con la cabecera; una
 * caída, una respuesta incompleta o cualquier discrepancia dejan el circuito
 * sin resolver.
 */
export const confirmFacturaProveedorTipoFromERP = async (
  factura: JsonObject,
  hintedProviderType: unknown,
  readERP: (consulta: string) => Promise<unknown>,
): Promise<FacturaERPProviderTypeConfirmation> => {
  const providerType = resolveFacturaProveedorTipo({}, hintedProviderType);
  const providerId = positiveIdentityInteger(factura.FRR_idproveedor);
  if (!providerType || !providerId) {
    return {
      providerType: null,
      providerName: null,
      issues: [],
      evidence: {
        source: "erp_provider_detail",
        status: "skipped_missing_context",
      },
    };
  }

  const providerLabel = providerType === "agricultor" ? "agricultor" : "acreedor";
  const providerRoute = providerType === "agricultor" ? "agricultores" : "acreedores";
  const consulta = `${providerRoute}/${providerId}`;

  try {
    const payload = await readERP(consulta);
    const parsed = parseERPProviderDetailResponse(payload, providerType);
    if (!parsed.ok) {
      return {
        providerType: null,
        providerName: null,
        issues: [{
          field: "FRR_tipofactura",
          message:
            `El detalle ERP de ${providerLabel} no permite confirmar el circuito del proveedor.`,
          severity: "warning",
        }],
        evidence: {
          source: "erp_provider_detail",
          status: "invalid_response",
          provider_id: providerId,
          provider_type: providerType,
        },
      };
    }

    const preflightIssues = getERPProviderPreflightIssues(
      factura,
      parsed.provider,
      providerType,
    );
    if (preflightIssues.length > 0) {
      return {
        providerType: null,
        providerName: null,
        issues: preflightIssues,
        evidence: {
          source: "erp_provider_detail",
          status: "rejected_mismatch",
          provider_id: providerId,
          provider_type: providerType,
        },
      };
    }

    const providerName = text(
      pick(
        parsed.provider,
        providerType === "agricultor"
          ? ["nombre", "proveedor_nombre", "AGR_Nombre"]
          : ["nombre", "proveedor_nombre", "ACR_Nombre"],
      ),
      null,
    );

    return {
      providerType,
      providerName,
      issues: [],
      evidence: {
        source: "erp_provider_detail",
        status: "confirmed",
        provider_id: providerId,
        provider_type: providerType,
      },
    };
  } catch {
    return {
      providerType: null,
      providerName: null,
      issues: [{
        field: "FRR_tipofactura",
        message:
          `No se pudo reconfirmar el circuito de ${providerLabel} contra el ERP.`,
        severity: "warning",
      }],
      evidence: {
        source: "erp_provider_detail",
        status: "unavailable",
        provider_id: providerId,
        provider_type: providerType,
      },
    };
  }
};

const normalizeFacturaNumberForExactMatch = (value: unknown): string | null => {
  const normalized = text(value, null)
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "") ?? "";
  return normalized || null;
};

/**
 * El ejercicio no se acepta desde la extraccion. Solo se intenta recuperar
 * cuando la cabecera ya tiene identidad suficiente para buscar la misma
 * factura historica en el ERP.
 *
 * `/facturasrecibidas/buscar` permite omitir el ejercicio para recuperarlo
 * desde la misma factura. La API acota de forma exacta por empresa, proveedor,
 * numero, fecha y circuito; la respuesta se vuelve a verificar localmente y
 * falla cerrada ante cero, ambiguedad o un envelope incompleto.
 */
export const buildFacturaERPExerciseLookupConsulta = (
  factura: JsonObject,
  providerType: FacturaProveedorTipo | null,
): string | null => {
  if (positiveRuleInteger(factura.FRR_ejercicio)) return null;
  const empresaId = positiveRuleInteger(factura.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(factura.FRR_idproveedor);
  const numeroFactura = text(factura.FRR_numerofactura, null);
  const normalizedNumero = normalizeFacturaNumberForExactMatch(numeroFactura);
  const fechaFactura = dateValue(factura.FRR_fechafactura, null);
  const headerProviderType = resolveFacturaProveedorTipo(factura);
  if (
    !empresaId ||
    !proveedorId ||
    !numeroFactura ||
    !normalizedNumero ||
    !fechaFactura ||
    !providerType ||
    headerProviderType !== providerType
  ) {
    return null;
  }

  const params = new URLSearchParams({
    empresa_id: String(empresaId),
    proveedor_id: String(proveedorId),
    numero_factura: numeroFactura,
    fecha_factura: fechaFactura,
    tipo_factura: providerType === "agricultor" ? "GE" : "OT",
    limit: "200",
    offset: "0",
  });
  return `facturasrecibidas/buscar?${params.toString()}`;
};

const parseFacturaERPExerciseLookupEnvelope = (
  payload: unknown,
): { items: JsonObject[]; total: number } | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as JsonObject;
  const envelope = hasOwn(root, "items")
    ? root
    : root.data && typeof root.data === "object" && !Array.isArray(root.data)
      ? root.data as JsonObject
      : root.result && typeof root.result === "object" && !Array.isArray(root.result)
        ? root.result as JsonObject
        : null;
  if (!envelope || !Array.isArray(envelope.items)) return null;
  const total = integerValue(envelope.total, null);
  if (
    total === null ||
    total < 0 ||
    total !== numberValue(envelope.total, null) ||
    total !== envelope.items.length ||
    envelope.items.some((item) =>
      !item || typeof item !== "object" || Array.isArray(item)
    )
  ) {
    return null;
  }
  return { items: envelope.items as JsonObject[], total };
};

export const resolveFacturaERPExerciseFromExactInvoice = (
  factura: JsonObject,
  providerType: FacturaProveedorTipo | null,
  payload: unknown,
): FacturaERPAccountingRuleResolution => {
  const resolved = { ...factura };
  const applied: JsonObject = {};
  const issues: FacturaValidationIssue[] = [];
  const consulta = buildFacturaERPExerciseLookupConsulta(resolved, providerType);
  if (!consulta) {
    return {
      factura: resolved,
      applied,
      issues,
      evidence: {
        source: "erp_exact_invoice",
        status: positiveRuleInteger(resolved.FRR_ejercicio)
          ? "skipped_existing_value"
          : "skipped_missing_context",
      },
    };
  }

  const envelope = parseFacturaERPExerciseLookupEnvelope(payload);
  if (!envelope) {
    issues.push({
      field: "FRR_ejercicio",
      message:
        "El ERP no devolvio un listado completo y verificable para resolver el ejercicio.",
      severity: "warning",
    });
    return {
      factura: resolved,
      applied,
      issues,
      evidence: { source: "erp_exact_invoice", status: "invalid_response" },
    };
  }

  const expected = {
    empresaId: positiveRuleInteger(resolved.FRR_Idempresa),
    proveedorId: positiveRuleInteger(resolved.FRR_idproveedor),
    numeroFactura: normalizeFacturaNumberForExactMatch(
      resolved.FRR_numerofactura,
    ),
    fechaFactura: dateValue(resolved.FRR_fechafactura, null),
    providerType,
  };
  const candidates: Array<{
    id: number;
    ejercicio: number;
    tipoFactura: string;
  }> = [];

  for (const rawCandidate of envelope.items) {
    const id = positiveRuleInteger(rawCandidate.FRR_id ?? rawCandidate.frr_id ?? rawCandidate.id);
    const empresaId = positiveRuleInteger(
      rawCandidate.FRR_Idempresa ?? rawCandidate.empresa_id,
    );
    const ejercicio = positiveRuleInteger(
      rawCandidate.FRR_ejercicio ?? rawCandidate.ejercicio,
    );
    const proveedorId = positiveRuleInteger(
      rawCandidate.FRR_idproveedor ?? rawCandidate.proveedor_id,
    );
    const numeroFactura = normalizeFacturaNumberForExactMatch(
      rawCandidate.FRR_numerofactura ?? rawCandidate.numero_factura,
    );
    const fechaFactura = dateValue(
      rawCandidate.FRR_fechafactura ?? rawCandidate.fecha_factura,
      null,
    );
    const tipoFactura = text(
      rawCandidate.FRR_tipofactura ?? rawCandidate.tipo_factura,
      null,
    )?.toUpperCase() ?? null;
    if (
      !id ||
      !empresaId ||
      !ejercicio ||
      !proveedorId ||
      !numeroFactura ||
      !fechaFactura ||
      !tipoFactura
    ) {
      issues.push({
        field: "FRR_ejercicio",
        message:
          "El listado ERP contiene una factura incompleta; no se puede resolver el ejercicio de forma segura.",
        severity: "warning",
      });
      return {
        factura: resolved,
        applied,
        issues,
        evidence: {
          source: "erp_exact_invoice",
          status: "invalid_candidate",
          response_total: envelope.total,
        },
      };
    }

    const candidateProviderType: FacturaProveedorTipo =
      tipoFactura === "GE" ? "agricultor" : "acreedor";
    if (
      empresaId === expected.empresaId &&
      proveedorId === expected.proveedorId &&
      numeroFactura === expected.numeroFactura &&
      fechaFactura === expected.fechaFactura &&
      candidateProviderType === expected.providerType
    ) {
      candidates.push({ id, ejercicio, tipoFactura });
    }
  }

  const evidence: JsonObject = {
    source: "erp_exact_invoice",
    criterio:
      "empresa_proveedor_numero_normalizado_fecha_y_circuito_exacto_unico",
    response_total: envelope.total,
    exact_matches: candidates.length,
  };
  if (candidates.length === 0) {
    evidence.status = "not_found";
    return { factura: resolved, applied, issues, evidence };
  }
  if (candidates.length !== 1) {
    evidence.status = "ambiguous";
    return { factura: resolved, applied, issues, evidence };
  }

  const candidate = candidates[0];
  resolved.FRR_ejercicio = candidate.ejercicio;
  applied.FRR_ejercicio = candidate.ejercicio;
  evidence.status = "applied";
  evidence.remote_frr_id = candidate.id;
  evidence.ejercicio = candidate.ejercicio;
  evidence.tipo_factura = candidate.tipoFactura;
  return { factura: resolved, applied, issues, evidence };
};

const accountingRuleFields: AccountingRuleField[] = [
  { ruleKey: "ejercicio_erp", facturaKey: "FRR_ejercicio", normalize: positiveRuleInteger },
  {
    ruleKey: "tipo_factura",
    facturaKey: "FRR_tipofactura",
    normalize: (value) => text(value, null)?.toUpperCase() ?? null,
  },
  { ruleKey: "regimen_id", facturaKey: "FRR_idregimen", normalize: positiveRuleInteger },
  {
    ruleKey: "fecha_ctb_policy",
    facturaKey: "FRR_fechactb",
    normalize: (value) => {
      const policy = text(value, null)?.toLowerCase() ?? null;
      return policy === "manual" || policy === "invoice_date" ? policy : null;
    },
  },
];

const ruleScopeValue = (
  rows: FacturaERPAccountingRuleRow[],
  field: AccountingRuleField,
  scopeLabel: string,
): { value: string | number | null; issue: FacturaValidationIssue | null; defined: boolean } => {
  const values: Array<string | number> = [];
  for (const row of rows) {
    const raw = row[field.ruleKey];
    if (!hasUsableValue(raw)) continue;
    const normalized = field.normalize(raw);
    if (normalized === null) {
      return {
        value: null,
        defined: true,
        issue: {
          field: field.facturaKey,
          message: `La regla ERP activa de ${scopeLabel} contiene un valor no valido para ${field.ruleKey}.`,
          severity: "error",
        },
      };
    }
    values.push(normalized);
  }

  const uniqueValues = [...new Map(values.map((value) => [`${typeof value}:${String(value)}`, value])).values()];
  if (uniqueValues.length > 1) {
    return {
      value: null,
      defined: true,
      issue: {
        field: field.facturaKey,
        message: `Hay varias reglas ERP activas de ${scopeLabel} con valores incompatibles para ${field.ruleKey}.`,
        severity: "error",
      },
    };
  }
  return { value: uniqueValues[0] ?? null, issue: null, defined: uniqueValues.length === 1 };
};

export const resolveFacturaERPAccountingRules = (
  factura: JsonObject,
  rows: FacturaERPAccountingRuleRow[],
  hintedProviderType: unknown = null,
): FacturaERPAccountingRuleResolution => {
  const resolved = { ...factura };
  const applied: JsonObject = {};
  const issues: FacturaValidationIssue[] = [];
  const empresaId = positiveRuleInteger(factura.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(factura.FRR_idproveedor);
  const providerType = resolveFacturaProveedorTipo(factura, hintedProviderType);
  const explicitProviderType = resolveFacturaProveedorTipo(factura);
  const hintedOnlyProviderType = resolveFacturaProveedorTipo({}, hintedProviderType);

  if (
    explicitProviderType &&
    hintedOnlyProviderType &&
    explicitProviderType !== hintedOnlyProviderType
  ) {
    issues.push({
      field: "FRR_tipofactura",
      message:
        "El tipo de factura confirmado no coincide con el maestro de proveedor sugerido por la extraccion.",
      severity: "error",
    });
  }
  if (
    !hasUsableValue(resolved.FRR_tipofactura) &&
    hintedOnlyProviderType
  ) {
    const tipoFactura = hintedOnlyProviderType === "agricultor" ? "GE" : "OT";
    resolved.FRR_tipofactura = tipoFactura;
    applied.FRR_tipofactura = tipoFactura;
  }
  if (!empresaId) return { factura: resolved, applied, issues };

  const activeRows = rows.filter((row) =>
    row.activo === true &&
    positiveRuleInteger(row.empresa_id) === empresaId &&
    (row.proveedor_id === null || row.proveedor_id === undefined || positiveRuleInteger(row.proveedor_id) === proveedorId)
  );
  const companyRows = activeRows.filter((row) => row.proveedor_id === null || row.proveedor_id === undefined);
  // Las reglas por proveedor existentes se definieron para el maestro de
  // acreedores. Los ids de acreedor y agricultor no son globalmente únicos:
  // ante tipo desconocido o GE se aplican solo las reglas generales de empresa.
  const providerRows = proveedorId && providerType === "acreedor"
    ? activeRows.filter((row) => positiveRuleInteger(row.proveedor_id) === proveedorId)
    : [];

  for (const field of accountingRuleFields) {
    const providerValue = ruleScopeValue(providerRows, field, `proveedor ${proveedorId}`);
    const effective = providerValue.defined
      ? providerValue
      : ruleScopeValue(companyRows, field, `empresa ${empresaId}`);
    if (effective.issue) {
      issues.push(effective.issue);
      continue;
    }
    if (!effective.defined || effective.value === null) continue;

    if (field.ruleKey === "tipo_factura" && providerType) {
      const ruleProviderType = effective.value === "GE" ? "agricultor" : "acreedor";
      if (ruleProviderType !== providerType) {
        issues.push({
          field: "FRR_tipofactura",
          message:
            `La regla ERP activa propone ${String(effective.value)}, incompatible con el circuito de ${providerType}; no se aplica.`,
          severity: "error",
        });
        continue;
      }
    }

    if (field.ruleKey === "fecha_ctb_policy") {
      if (effective.value === "manual") continue;
      const invoiceDate = dateValue(resolved.FRR_fechafactura, null);
      if (!invoiceDate) continue;
      if (!hasUsableValue(resolved.FRR_fechactb)) {
        resolved.FRR_fechactb = invoiceDate;
        applied.FRR_fechactb = invoiceDate;
      } else if (dateValue(resolved.FRR_fechactb, null) !== invoiceDate) {
        issues.push({
          field: "FRR_fechactb",
          message: `La fecha CTB explicita no coincide con la regla invoice_date (${invoiceDate}); no se sobrescribe.`,
          severity: "error",
        });
      }
      continue;
    }

    if (!hasUsableValue(resolved[field.facturaKey])) {
      resolved[field.facturaKey] = effective.value;
      applied[field.facturaKey] = effective.value;
      continue;
    }
    if (field.normalize(resolved[field.facturaKey]) !== effective.value) {
      issues.push({
        field: field.facturaKey,
        message: `El valor explicito de ${field.facturaKey} entra en conflicto con la regla ERP activa; no se sobrescribe.`,
        severity: "error",
      });
    }
  }

  return { factura: resolved, applied, issues };
};

export type FacturaERPDeterministicDefaultsContext = {
  providerType?: unknown;
  providerName?: unknown;
  providerConfirmed?: boolean;
};

const deterministicDefaultRuleFields = {
  expenseAccount: {
    ruleKey: "cuenta_gasto_default",
    facturaKey: "FRR_ctagasto1",
    normalize: normalizedDefaultExpenseAccount,
  },
  conceptTemplate: {
    ruleKey: "concepto_template",
    facturaKey: "FRR_Concepto",
    normalize: normalizedConceptTemplate,
  },
  contabilizar: {
    ruleKey: "contabilizar_default",
    facturaKey: "FRR_Contabilizar",
    normalize: normalizedDefaultSn,
  },
} satisfies Record<string, AccountingRuleField>;

/**
 * Materializa defaults contables solo desde reglas aprobadas y contexto ERP ya
 * confirmado. Los importes documentales (bases, cuotas y retencion visible) se
 * conservan; solo los slots IVA realmente inactivos y los defaults fiscales
 * ausentes se convierten en cero. Un tramo activo incompleto queda bloqueado.
 */
export const applyFacturaERPDeterministicDefaults = (
  factura: JsonObject,
  rows: FacturaERPAccountingRuleRow[],
  context: FacturaERPDeterministicDefaultsContext = {},
): FacturaERPAccountingRuleResolution => {
  const resolved = { ...factura };
  const applied: JsonObject = {};
  const issues: FacturaValidationIssue[] = [];
  const empresaId = positiveRuleInteger(resolved.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(resolved.FRR_idproveedor);
  const providerType = context.providerConfirmed === false
    ? null
    : resolveFacturaProveedorTipo(resolved, context.providerType);
  const providerName = text(context.providerName, null);
  let hasMissingActiveBase = false;

  const assignNumber = (key: string, value: number) => {
    if (numberValue(resolved[key], null) === value) return;
    resolved[key] = value;
    applied[key] = value;
  };
  const assignText = (key: string, value: string) => {
    if (text(resolved[key], null) === value) return;
    resolved[key] = value;
    applied[key] = value;
  };

  for (let position = 1; position <= 5; position += 1) {
    const baseKey = `FRR_base${position}`;
    const rateKey = `FRR_iva${position}`;
    const quotaKey = `FRR_cuota${position}`;
    const base = numberValue(resolved[baseKey], null);
    const rate = numberValue(resolved[rateKey], null);
    const quota = numberValue(resolved[quotaKey], null);
    const hasActiveAmount =
      Math.abs(base ?? 0) >= IVA_ACTIVE_AMOUNT_EPSILON ||
      Math.abs(quota ?? 0) >= IVA_ACTIVE_AMOUNT_EPSILON;
    const amountsAreExplicitlyZero =
      base !== null &&
      quota !== null &&
      Math.abs(base) < IVA_ACTIVE_AMOUNT_EPSILON &&
      Math.abs(quota) < IVA_ACTIVE_AMOUNT_EPSILON;
    const hasNonzeroRate =
      Math.abs(rate ?? 0) >= IVA_ACTIVE_AMOUNT_EPSILON;
    const active =
      hasActiveAmount ||
      (hasNonzeroRate && !amountsAreExplicitlyZero);

    if (!active) {
      assignNumber(baseKey, 0);
      assignNumber(rateKey, 0);
      assignNumber(quotaKey, 0);
      continue;
    }

    for (const [key, value, label] of [
      [baseKey, base, "base"],
      [rateKey, rate, "tipo"],
      [quotaKey, quota, "cuota"],
    ] as const) {
      if (value !== null) continue;
      if (label === "base") hasMissingActiveBase = true;
      issues.push({
        field: key,
        message:
          `El tramo IVA activo ${position} no contiene ${label}; no se completa automaticamente.`,
        severity: "error",
      });
    }
  }

  const retentionFields = [
    ["FRR_baseret", "base"],
    ["FRR_ret", "porcentaje"],
    ["FRR_cuotaret", "cuota"],
  ] as const;
  const retentionValues = retentionFields.map(([key]) =>
    numberValue(resolved[key], null)
  );
  if (retentionValues.every((value) => value === null)) {
    for (const [key] of retentionFields) assignNumber(key, 0);
  } else {
    retentionFields.forEach(([key, label], index) => {
      if (retentionValues[index] !== null) return;
      issues.push({
        field: key,
        message:
          `La retencion contiene datos, pero falta ${label}; no se completa automaticamente.`,
        severity: "error",
      });
    });
  }
  if (numberValue(resolved.FRR_CuotaNoDeducible, null) === null) {
    assignNumber("FRR_CuotaNoDeducible", 0);
  }

  const activeRows = empresaId
    ? rows.filter((row) =>
      row.activo === true &&
      positiveRuleInteger(row.empresa_id) === empresaId &&
      (
        row.proveedor_id === null ||
        row.proveedor_id === undefined ||
        positiveRuleInteger(row.proveedor_id) === proveedorId
      )
    )
    : [];
  const companyRows = activeRows.filter((row) =>
    row.proveedor_id === null || row.proveedor_id === undefined
  );
  const providerRows = proveedorId && providerType === "acreedor"
    ? activeRows.filter((row) =>
      positiveRuleInteger(row.proveedor_id) === proveedorId
    )
    : [];
  const effectiveRule = (field: AccountingRuleField) => {
    const providerValue = ruleScopeValue(
      providerRows,
      field,
      `proveedor ${proveedorId}`,
    );
    return providerValue.defined
      ? providerValue
      : ruleScopeValue(companyRows, field, `empresa ${empresaId}`);
  };

  // Estos defaults se han confirmado para el circuito de acreedores. No se
  // trasladan a agricultores: sus cuentas y apuntes siguen otra semantica.
  if (providerType === "acreedor") {
    // Una cuenta general de empresa no describe el gasto de todos los
    // proveedores. Solo una regla explicita del acreedor puede adelantarse al
    // historico ERP; concepto y contabilizacion si conservan la herencia general.
    const expenseAccount = ruleScopeValue(
      providerRows,
      deterministicDefaultRuleFields.expenseAccount,
      `proveedor ${proveedorId}`,
    );
    if (expenseAccount.issue) {
      issues.push(expenseAccount.issue);
    } else if (
      expenseAccount.defined &&
      typeof expenseAccount.value === "string"
    ) {
      if (!hasUsableValue(resolved.FRR_ctagasto1)) {
        assignText("FRR_ctagasto1", expenseAccount.value);
      }
      if (
        !hasUsableValue(resolved.FRR_igasto1) &&
        !hasMissingActiveBase
      ) {
        const totalBase = [1, 2, 3, 4, 5].reduce(
          (sum, position) =>
            sum + (numberValue(resolved[`FRR_base${position}`], 0) ?? 0),
          0,
        );
        assignNumber("FRR_igasto1", Number(totalBase.toFixed(2)));
      }
    }

    const conceptTemplate = effectiveRule(
      deterministicDefaultRuleFields.conceptTemplate,
    );
    if (conceptTemplate.issue) {
      issues.push(conceptTemplate.issue);
    } else if (
      conceptTemplate.defined &&
      typeof conceptTemplate.value === "string"
    ) {
      if (!hasUsableValue(resolved.FRR_Concepto) && !providerName) {
        issues.push({
          field: "FRR_Concepto",
          message:
            "No se pudo construir el concepto porque el maestro ERP no devolvio el nombre del acreedor.",
          severity: "error",
        });
      } else {
        if (!hasUsableValue(resolved.FRR_Concepto) && providerName) {
          assignText(
            "FRR_Concepto",
            conceptTemplate.value
              .replaceAll("{proveedor}", providerName)
              .slice(0, frrDescriptiveTextLimits.FRR_Concepto),
          );
        }
        const concept = text(resolved.FRR_Concepto, null);
        if (concept && !hasUsableValue(resolved.FRR_ObservacionesAEAT)) {
          assignText(
            "FRR_ObservacionesAEAT",
            concept.slice(0, frrDescriptiveTextLimits.FRR_ObservacionesAEAT),
          );
        }
      }
    }

    const contabilizar = effectiveRule(
      deterministicDefaultRuleFields.contabilizar,
    );
    if (contabilizar.issue) {
      issues.push(contabilizar.issue);
    } else if (
      contabilizar.defined &&
      typeof contabilizar.value === "string" &&
      !hasUsableValue(resolved.FRR_Contabilizar)
    ) {
      assignText("FRR_Contabilizar", contabilizar.value);
    }
  }

  // Sin una regla aplicable se mantiene el comportamiento fail-closed.
  if (!hasUsableValue(resolved.FRR_Contabilizar)) {
    assignText("FRR_Contabilizar", "N");
  }

  return {
    factura: resolved,
    applied,
    issues,
    evidence: {
      source: "supabase_edge_defaults",
      status: issues.some((issue) => issue.severity === "error")
        ? "partial"
        : "applied",
      provider_type: providerType,
      provider_name_confirmed: Boolean(providerName),
      applied_fields: Object.keys(applied),
    },
  };
};

export const loadAndResolveFacturaERPAccountingRules = async (
  supabase: ReturnType<typeof createServiceClient>,
  factura: JsonObject,
  hintedProviderType: unknown = null,
  dependencies: FacturaERPAccountingRuleDependencies = {},
): Promise<FacturaERPAccountingRuleResolution> => {
  const empresaId = positiveRuleInteger(factura.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(factura.FRR_idproveedor);
  const readERP = dependencies.readERP ?? fetchERPReadConsulta;
  const explicitProviderType = resolveFacturaProveedorTipo(factura);
  const hintedOnlyProviderType = resolveFacturaProveedorTipo({}, hintedProviderType);
  let confirmedHintedProviderType: FacturaProveedorTipo | null = null;
  let confirmedERPProviderType: FacturaProveedorTipo | null = null;
  let confirmedProviderName: string | null = null;
  let providerConfirmationEvidence: JsonObject | undefined;
  let providerConfirmationIssues: FacturaValidationIssue[] = [];

  // El circuito sugerido nunca se materializa sin reconfirmar id y cuenta. Una
  // cabecera explicita conserva su autoridad, pero el maestro tambien aporta el
  // nombre canonico necesario para construir defaults de concepto.
  const providerTypeToConfirm = hintedOnlyProviderType ?? explicitProviderType;
  if (providerTypeToConfirm) {
    const confirmation = await confirmFacturaProveedorTipoFromERP(
      factura,
      providerTypeToConfirm,
      readERP,
    );
    confirmedERPProviderType = confirmation.providerType;
    if (hintedOnlyProviderType) {
      confirmedHintedProviderType = confirmation.providerType;
    }
    confirmedProviderName = confirmation.providerName;
    providerConfirmationIssues = confirmation.issues;
    providerConfirmationEvidence = confirmation.evidence;
  }

  const providerTypeForRuleScope =
    explicitProviderType ?? confirmedHintedProviderType;
  let ruleRows: FacturaERPAccountingRuleRow[] = [];

  if (empresaId) {
    let query = supabase
      .from("facturas_recibidas_erp_rules")
      .select(
        "empresa_id, proveedor_id, ejercicio_erp, tipo_factura, regimen_id, fecha_ctb_policy, cuenta_gasto_default, concepto_template, contabilizar_default, activo",
      )
      .eq("empresa_id", empresaId)
      .eq("activo", true);
    query = proveedorId && providerTypeForRuleScope === "acreedor"
      ? query.or(`proveedor_id.is.null,proveedor_id.eq.${proveedorId}`)
      : query.is("proveedor_id", null);

    const { data, error } = await query;
    if (error) {
      throw new Error(`ERP_RULES_UNAVAILABLE: no se pudieron cargar las reglas contables (${error.message}).`);
    }
    ruleRows = Array.isArray(data) ? data as FacturaERPAccountingRuleRow[] : [];
  }

  const resolvedRules = resolveFacturaERPAccountingRules(
    factura,
    ruleRows,
    confirmedHintedProviderType,
  );
  let accountingResolution: FacturaERPAccountingRuleResolution = {
    ...resolvedRules,
    issues: [...providerConfirmationIssues, ...resolvedRules.issues],
    ...(providerConfirmationEvidence
      ? { evidence: { proveedor_tipo: providerConfirmationEvidence } }
      : {}),
  };
  const providerType = resolveFacturaProveedorTipo(accountingResolution.factura);
  const providerTypeConfirmedByERP = confirmedERPProviderType === providerType
    ? providerType
    : null;
  const hasProviderTypeConflict = accountingResolution.issues.some((issue) =>
    issue.severity === "error" && issue.field === "FRR_tipofactura"
  );
  const finalizeAccountingResolution = async (
    resolution: FacturaERPAccountingRuleResolution,
  ): Promise<FacturaERPAccountingRuleResolution> => {
    const defaults = applyFacturaERPDeterministicDefaults(
      resolution.factura,
      ruleRows,
      {
        providerType: providerTypeConfirmedByERP,
        providerName: confirmedProviderName,
        providerConfirmed: providerTypeConfirmedByERP !== null,
      },
    );
    const expenseQuery = buildFacturaERPExpenseHistoryConsulta(
      defaults.factura,
      providerTypeConfirmedByERP,
    );
    let expenseResolution: FacturaERPAccountingRuleResolution;
    if (!expenseQuery) {
      expenseResolution = resolveFacturaERPExpenseAccountFromHistory(
        defaults.factura,
        providerTypeConfirmedByERP,
        null,
      );
    } else {
      try {
        expenseResolution = resolveFacturaERPExpenseAccountFromHistory(
          defaults.factura,
          providerTypeConfirmedByERP,
          await readERP(expenseQuery),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido";
        expenseResolution = {
          factura: defaults.factura,
          applied: {},
          issues: [{
            field: "FRR_ctagasto1",
            message:
              `No se pudo consultar el historico ERP para resolver la cuenta de gasto (${message}).`,
            severity: "warning",
          }],
          evidence: {
            source: "erp_history",
            status: "unavailable",
            criterio:
              "misma_empresa_proveedor_y_circuito_con_lider_unico_activo_y_dominante",
          },
        };
      }
    }
    return {
      factura: expenseResolution.factura,
      applied: {
        ...resolution.applied,
        ...defaults.applied,
        ...expenseResolution.applied,
      },
      issues: [
        ...resolution.issues,
        ...defaults.issues,
        ...expenseResolution.issues,
      ],
      evidence: {
        ...(resolution.evidence ?? {}),
        defaults: defaults.evidence ?? {},
        cuenta_gasto: expenseResolution.evidence ?? {},
      },
    };
  };
  let exerciseEvidence: JsonObject | undefined;
  const withProviderConfirmationEvidence = (
    evidence: JsonObject | undefined,
    extra: JsonObject = {},
  ): JsonObject | undefined => {
    const combined: JsonObject = {
      ...(evidence ?? {}),
      ...extra,
    };
    if (providerConfirmationEvidence) {
      combined.proveedor_tipo = providerConfirmationEvidence;
    }
    return Object.keys(combined).length > 0 ? combined : undefined;
  };

  if (
    !positiveRuleInteger(accountingResolution.factura.FRR_ejercicio) &&
    providerType &&
    !hasProviderTypeConflict
  ) {
    const exerciseQuery = buildFacturaERPExerciseLookupConsulta(
      accountingResolution.factura,
      providerType,
    );
    if (exerciseQuery) {
      try {
        const previousResolution = accountingResolution;
        const exercisePayload = await readERP(exerciseQuery);
        const exerciseResolution = resolveFacturaERPExerciseFromExactInvoice(
          previousResolution.factura,
          providerType,
          exercisePayload,
        );
        exerciseEvidence = exerciseResolution.evidence;
        accountingResolution = {
          factura: exerciseResolution.factura,
          applied: {
            ...previousResolution.applied,
            ...exerciseResolution.applied,
          },
          issues: [...previousResolution.issues, ...exerciseResolution.issues],
          evidence: withProviderConfirmationEvidence(
            exerciseResolution.evidence,
          ),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido";
        exerciseEvidence = {
          source: "erp_exact_invoice",
          status: "unavailable",
        };
        accountingResolution = {
          ...accountingResolution,
          issues: [
            ...accountingResolution.issues,
            {
              field: "FRR_ejercicio",
              message:
                `No se pudo consultar la factura exacta ERP para resolver el ejercicio (${message}).`,
              severity: "warning",
            },
          ],
          evidence: withProviderConfirmationEvidence(exerciseEvidence),
        };
      }
    }
  }

  if (
    positiveRuleInteger(accountingResolution.factura.FRR_idregimen) ||
    !providerType ||
    hasProviderTypeConflict
  ) {
    return finalizeAccountingResolution(accountingResolution);
  }

  const regimenQuery = buildFacturaERPRegimenSuggestionConsulta(
    accountingResolution.factura,
    providerType,
  );
  if (!regimenQuery) return finalizeAccountingResolution(accountingResolution);

  try {
    const payload = await readERP(regimenQuery.consulta);
    const historyResolution = resolveFacturaERPRegimenFromHistory(
      accountingResolution.factura,
      providerType,
      payload,
    );
    return finalizeAccountingResolution({
      factura: historyResolution.factura,
      applied: {
        ...accountingResolution.applied,
        ...historyResolution.applied,
      },
      issues: [...accountingResolution.issues, ...historyResolution.issues],
      evidence: withProviderConfirmationEvidence(
        historyResolution.evidence,
        exerciseEvidence ? { ejercicio: exerciseEvidence } : {},
      ),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return finalizeAccountingResolution({
      ...accountingResolution,
      issues: [
        ...accountingResolution.issues,
        {
          field: "FRR_idregimen",
          message:
            `No se pudo consultar el historico ERP para resolver el regimen IVA (${message}).`,
          severity: "warning",
        },
      ],
      evidence: {
        source: "erp_history",
        status: "unavailable",
        ...(exerciseEvidence ? { ejercicio: exerciseEvidence } : {}),
        ...(providerConfirmationEvidence
          ? { proveedor_tipo: providerConfirmationEvidence }
          : {}),
      },
    });
  }
};

/**
 * Mantiene la evidencia contable alineada con la cabecera ya resuelta por Edge.
 *
 * n8n entrega estas ramas como estado inicial pendiente. Las reglas contables
 * se aplican despues, por lo que persistir la evidencia original sin
 * reconciliarla deja valores `null`/`resolved: false` que contradicen a la
 * factura final. Se conservan todas las claves de auditoria originales y solo
 * se actualiza la proyeccion de los cuatro campos contables gobernados por Edge.
 */
export const syncFacturaERPAccountingMatchEvidence = (
  matchEvidence: unknown,
  resolution: FacturaERPAccountingRuleResolution,
): JsonObject => {
  const objectValue = (value: unknown): JsonObject =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonObject
      : {};
  const current = objectValue(matchEvidence);
  const applied = objectValue(resolution.applied);
  const accountingEvidence = objectValue(resolution.evidence);
  const factura = resolution.factura;

  const ejercicio = positiveRuleInteger(factura.FRR_ejercicio);
  const tipoFactura = text(factura.FRR_tipofactura, null)?.toUpperCase() ?? null;
  const regimen = positiveRuleInteger(factura.FRR_idregimen);
  const fechaCtb = dateValue(factura.FRR_fechactb, null);
  const invoiceDate = dateValue(factura.FRR_fechafactura, null);
  const expenseAccount = text(factura.FRR_ctagasto1, null);

  const syncField = (
    evidenceKey: string,
    facturaKey: string,
    value: string | number | null,
    appliedSource: string,
  ): JsonObject => {
    const previous = objectValue(current[evidenceKey]);
    const wasApplied = hasUsableValue(applied[facturaKey]);
    return {
      ...previous,
      source: wasApplied
        ? appliedSource
        : text(previous.source, value === null ? "supabase_edge" : "existing_value"),
      resolved: value !== null,
      value,
    };
  };

  const regimenAppliedFromHistory =
    accountingEvidence.source === "erp_history" &&
    accountingEvidence.status === "applied";
  const expenseHistoryEvidence = objectValue(accountingEvidence.cuenta_gasto);
  const expenseAppliedFromHistory =
    expenseHistoryEvidence.source === "erp_history" &&
    expenseHistoryEvidence.status === "applied";
  const directExerciseEvidence =
    accountingEvidence.source === "erp_exact_invoice"
      ? accountingEvidence
      : objectValue(accountingEvidence.ejercicio);
  const exerciseAppliedFromExactInvoice =
    directExerciseEvidence.source === "erp_exact_invoice" &&
    directExerciseEvidence.status === "applied";
  const fechaEvidence = syncField(
    "fecha_ctb",
    "FRR_fechactb",
    fechaCtb,
    "supabase_edge_rule",
  );
  if (
    hasUsableValue(applied.FRR_fechactb) &&
    fechaCtb !== null &&
    invoiceDate === fechaCtb
  ) {
    fechaEvidence.policy = "invoice_date";
  }

  const accountingPendingFields = [
    ["FRR_ejercicio", ejercicio],
    ["FRR_tipofactura", tipoFactura],
    ["FRR_idregimen", regimen],
    ["FRR_fechactb", fechaCtb],
  ]
    .filter(([, value]) => value === null)
    .map(([field]) => field);
  const expenseDistribution = facturaERPExpenseDistributionState(factura);
  const pendingFields = [
    ...new Set([
      ...accountingPendingFields,
      ...expenseDistribution.pendingFields,
    ]),
  ];
  const previousErpRules = objectValue(current.erp_rules);
  const previousExpenseAccount = objectValue(current.cuenta_gasto);
  const synchronizedExpenseAccount: JsonObject = {
    ...previousExpenseAccount,
    ...expenseHistoryEvidence,
    source: expenseHistoryEvidence.source === "erp_history"
      ? "erp_history"
      : hasUsableValue(applied.FRR_ctagasto1)
      ? "supabase_edge_rule"
      : expenseAccount
      ? "existing_value"
      : "supabase_edge",
    resolved: expenseAccount !== null,
    value: expenseAccount,
    selected_account: expenseAccount,
  };
  if (!expenseAppliedFromHistory) {
    delete synchronizedExpenseAccount.selected_rank;
  }

  const synchronized: JsonObject = {
    ...current,
    ejercicio: syncField(
      "ejercicio",
      "FRR_ejercicio",
      ejercicio,
      exerciseAppliedFromExactInvoice
        ? "erp_exact_invoice"
        : "supabase_edge_rule",
    ),
    tipo_factura: syncField(
      "tipo_factura",
      "FRR_tipofactura",
      tipoFactura,
      "supabase_edge",
    ),
    regimen: syncField(
      "regimen",
      "FRR_idregimen",
      regimen,
      regimenAppliedFromHistory ? "erp_history" : "supabase_edge_rule",
    ),
    fecha_ctb: fechaEvidence,
    cuenta_gasto: synchronizedExpenseAccount,
    erp_rules: {
      ...previousErpRules,
      source: text(previousErpRules.source, "supabase_edge"),
      resolved: pendingFields.length === 0,
      pending_fields: pendingFields,
    },
  };

  if (Object.keys(accountingEvidence).length > 0) {
    synchronized.erp_accounting = accountingEvidence;
  }
  return synchronized;
};

export const getValidationErrors = (factura: JsonObject) => {
  const errors: FacturaValidationIssue[] = [];
  const required = [
    ["FRR_idproveedor", "Falta proveedor/acreedor resuelto."],
    ["FRR_numerofactura", "Falta numero de factura del proveedor."],
    ["FRR_fechafactura", "Falta fecha de factura."],
    ["FRR_fechactb", "Falta fecha CTB."],
    ["FRR_ejercicio", "Falta ejercicio ERP."],
    ["FRR_idregimen", "Falta regimen IVA ERP."],
    ["FRR_tipofactura", "Falta tipo de factura ERP."],
    ["FRR_idcuenta", "Falta cuenta contable del proveedor."],
    ["FRR_totalfac", "Falta total de factura."],
    ["FRR_Idempresa", "Falta empresa ERP."],
  ] as const;

  for (const [field, message] of required) {
    const value = factura[field];
    if (value === null || value === undefined || value === "") {
      errors.push({ field, message, severity: "error" });
    }
  }

  errors.push(...facturaERPExpenseDistributionState(factura).issues);

  const bases = [1, 2, 3, 4, 5].reduce((acc, index) => acc + (numberValue(factura[`FRR_base${index}`], 0) ?? 0), 0);
  const cuotas = [1, 2, 3, 4, 5].reduce((acc, index) => acc + (numberValue(factura[`FRR_cuota${index}`], 0) ?? 0), 0);
  const total = numberValue(factura.FRR_totalfac, null);
  const retencion = numberValue(factura.FRR_cuotaret, 0) ?? 0;
  const suplido = numberValue(factura.FRR_ImpSuplido, 0) ?? 0;

  if (total !== null && Math.abs(bases) + Math.abs(cuotas) > 0) {
    const expected = Number((bases + cuotas - retencion + suplido).toFixed(2));
    if (Math.abs(expected - total) > 0.01) {
      errors.push({
        field: "FRR_totalfac",
        message: `El total no cuadra con bases/cuotas. Esperado ${expected.toFixed(2)}, total ${total.toFixed(2)}.`,
        severity: "error",
      });
    }
  }

  return errors;
};

export const getValidationErrorsForFactura = async (
  factura: JsonObject,
) => getValidationErrors(factura);

const validationMessageKey = (message: string) =>
  message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/g, " ")
    .trim();

const isOperationalERPAvailabilityWarning = (message: string) => {
  const normalized = validationMessageKey(message);
  const hasERPContext = normalized.includes("erp") ||
    normalized.includes("api") ||
    /\/[a-z0-9_-]+/.test(normalized);
  const hasAvailabilityFailure = normalized.includes("no se pudo consultar") ||
    normalized.includes("no se hacen consultas") ||
    normalized.includes("no esta disponible") ||
    normalized.includes("no disponible") ||
    normalized.includes("indisponible") ||
    normalized.includes("unavailable") ||
    normalized.includes("timeout") ||
    normalized.includes("error de transporte");
  return hasERPContext && hasAvailabilityFailure;
};

const validationFieldForWarning = (message: string) => {
  const normalized = validationMessageKey(message);
  if (isOperationalERPAvailabilityWarning(message)) return "metadata.warnings";
  if (normalized.includes("fecha") && normalized.includes("ctb")) return "FRR_fechactb";
  if (normalized.includes("regimen") || normalized.includes("tipo iva")) return "FRR_idregimen";
  if (normalized.includes("tipo") && normalized.includes("factura")) return "FRR_tipofactura";
  if (normalized.includes("ejercicio")) return "FRR_ejercicio";
  if (normalized.includes("cuenta") && (normalized.includes("proveedor") || normalized.includes("acreedor"))) {
    return "FRR_idcuenta";
  }
  if (normalized.includes("proveedor") || normalized.includes("acreedor")) return "FRR_idproveedor";
  if (normalized.includes("duplicad")) return "erp_duplicate";
  return "metadata.warnings";
};

export const extractOperationalERPAvailabilityWarnings = (
  validationErrors: unknown,
  options: { providerPreflightVerified?: boolean } = {},
): string[] => {
  if (options.providerPreflightVerified === true) return [];
  if (!Array.isArray(validationErrors)) return [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const rawIssue of validationErrors) {
    if (!rawIssue || typeof rawIssue !== "object" || Array.isArray(rawIssue)) continue;
    const issue = rawIssue as JsonObject;
    if (text(issue.field, null) !== "metadata.warnings" || issue.severity !== "warning") continue;
    const message = text(issue.message, null);
    if (!message || !isOperationalERPAvailabilityWarning(message)) continue;
    const key = validationMessageKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(message);
  }
  return warnings;
};

export const mergeValidationIssues = (
  issues: FacturaValidationIssue[],
  warnings: string[],
): FacturaValidationIssue[] => {
  const merged: FacturaValidationIssue[] = [];
  const occupiedFields = new Set<string>();
  const genericMessages = new Set<string>();

  const append = (issue: FacturaValidationIssue) => {
    const field = text(issue.field, "metadata.warnings")!;
    const message = text(issue.message, "Aviso de validacion")!;
    const severity = issue.severity === "warning" ? "warning" : "error";
    if (field !== "metadata.warnings") {
      if (occupiedFields.has(field)) return;
      occupiedFields.add(field);
    } else {
      const messageKey = validationMessageKey(message);
      if (genericMessages.has(messageKey)) return;
      genericMessages.add(messageKey);
    }
    const normalizedIssue: FacturaValidationIssue = { field, message, severity };
    const code = text(issue.code, null);
    if (code) normalizedIssue.code = code;
    if (issue.details && typeof issue.details === "object" && !Array.isArray(issue.details)) {
      normalizedIssue.details = issue.details;
    }
    merged.push(normalizedIssue);
  };

  for (const issue of [...issues].sort((left, right) =>
    left.severity === right.severity ? 0 : left.severity === "error" ? -1 : 1
  )) {
    append(issue);
  }
  for (const warning of warnings) {
    const message = text(warning, null);
    if (message) append({ field: validationFieldForWarning(message), message, severity: "warning" });
  }

  return merged;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

const encodeBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const encodeBytesBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

export const signJwtHs256 = async (secret: string, expSeconds: number) => {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify({ sub: "agroiris-edge", iat: now, exp: now + expSeconds }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${encodeBytesBase64Url(new Uint8Array(signature))}`;
};

/**
 * Direct authenticated read against FastAPI. n8n is deliberately excluded
 * from every ERP read/write path and remains only in document extraction.
 */
export const fetchERPReadConsulta = async (consulta: string): Promise<unknown> => {
  if (!isAllowedERPConsulta(consulta)) {
    throw new Error("ERP_READ_QUERY_NOT_ALLOWED: consulta no permitida.");
  }
  const baseUrlValue = Deno.env.get("CAMPOJOYMA_API_V2_BASE_URL")?.trim();
  const sharedSecret = Deno.env.get("CAMPOJOYMA_API_V2_SHARED_SECRET")?.trim();
  if (!baseUrlValue || !sharedSecret) {
    throw new Error("ERP_READ_UNAVAILABLE: falta configuracion interna.");
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(
      baseUrlValue.endsWith("/") ? baseUrlValue : `${baseUrlValue}/`,
    );
  } catch {
    throw new Error("ERP_READ_UNAVAILABLE: URL interna no valida.");
  }
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password) {
    throw new Error("ERP_READ_UNAVAILABLE: la URL interna debe usar HTTPS.");
  }
  const url = new URL(consulta.replace(/^\/+/, ""), baseUrl);
  const upstream = await fetch(url, {
    method: "GET",
    headers: {
      "X-Netagro-Api-Key": sharedSecret,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const { payload } = await parseJsonResponse(upstream);
  const result = upstreamResult(upstream, payload);
  if (!result.ok) {
    throw new Error(
      `ERP_READ_FAILED: ${result.message ?? `HTTP ${upstream.status}`}`,
    );
  }
  return payload;
};
