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
] as const;

export const sanitizeUntrustedFacturaAccountingFields = (frr: JsonObject): JsonObject => {
  const sanitized = { ...frr };
  for (const field of EDGE_AUTHORITATIVE_ACCOUNTING_FIELDS) delete sanitized[field];
  sanitized.FRR_Contabilizar = "N";
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
    ctb: isERPReference ? ctb.map((linea) => ({ ...linea })) : [],
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
    remote_id: text(pick(input, ["remote_id", "id", "ID", "ALB_id", "GTO_id", "AMA_id"]), null),
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
    }
    if (sourceId === null || sourceId <= 0) {
      issues.push({
        field: `punteos.${index}.source_id`,
        message: `El punteo seleccionado en posicion ${position} no tiene source_id positivo.`,
        severity: "error",
      });
    }
    if (!sourceTable || sourceId === null || sourceId <= 0) return;

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
  for (let index = 0; index < Math.min(ctb.length, actualCtb.length); index += 1) {
    const expectedLine = toERPCtbPayload(ctb[index], index + 1);
    const actualLine = toERPCtbPayload(actualCtb[index], index + 1);
    for (const key of ctbKeys) {
      const tolerance = key === "FRC_Importe" ? 0.01 : 0;
      if (erpReadbackValueMatches(expectedLine[key], actualLine[key], tolerance)) continue;
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

export const parseERPProviderDetailResponse = (
  payload: unknown,
): { ok: boolean; provider: JsonObject; error: string | null } => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, provider: {}, error: "El detalle de acreedor ERP no es un objeto." };
  }
  const envelope = payload as JsonObject;
  let provider = envelope;
  for (const key of ["acreedor", "provider", "data", "result", "item"]) {
    if (!hasOwn(envelope, key)) continue;
    const candidate = envelope[key];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, provider: {}, error: "El envelope de acreedor ERP es invalido." };
    }
    provider = candidate as JsonObject;
    break;
  }
  const providerId = integerValue(
    pick(provider, ["id", "codigo", "acreedor_id", "ACR_Codigo"]),
    null,
  );
  if (!providerId || providerId <= 0) {
    return { ok: false, provider: {}, error: "El detalle ERP no contiene un id de acreedor positivo." };
  }
  return { ok: true, provider, error: null };
};

export const buildERPDuplicateConsulta = (factura: JsonObject): string | null => {
  const empresaId = integerValue(factura.FRR_Idempresa, null);
  const ejercicio = integerValue(factura.FRR_ejercicio, null);
  const proveedorId = integerValue(factura.FRR_idproveedor, null);
  const numeroFactura = text(factura.FRR_numerofactura, null);
  if (!empresaId || empresaId < 1 || !ejercicio || ejercicio < 1 || !proveedorId || proveedorId < 1 || !numeroFactura) {
    return null;
  }

  const params = new URLSearchParams({
    empresa_id: String(empresaId),
    ejercicio: String(ejercicio),
    proveedor_id: String(proveedorId),
    numero_factura: numeroFactura,
    limit: "10",
  });
  return `facturasrecibidas/buscar?${params.toString()}`;
};

export const getERPProviderPreflightIssues = (
  factura: JsonObject,
  providerPayload: unknown,
): FacturaValidationIssue[] => {
  const provider = unwrapERPObject(providerPayload);
  const expectedProviderId = integerValue(factura.FRR_idproveedor, null);
  const actualProviderId = integerValue(
    pick(provider, ["id", "codigo", "acreedor_id", "ACR_Codigo"]),
    null,
  );
  const expectedAccount = text(factura.FRR_idcuenta, null);
  const actualAccount = text(
    pick(provider, ["cuenta_id", "ACR_IdCuenta", "ACR_Cuenta", "cuenta", "cuenta_contable"]),
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
  const activo = firstOwnedFlag(["activo", "ACR_Activo"]);
  const bloqueado = firstOwnedFlag(["bloqueado", "ACR_Bloqueado"]);
  const inactivoRgpd = firstOwnedFlag(["inactivo_rgpd", "ACR_InactivoRGPD"]);

  if (activo.present && !booleanValue(activo.value, false)) {
    issues.push({
      field: "FRR_idproveedor",
      message: "El acreedor seleccionado no esta activo en el ERP.",
      severity: "error",
    });
  }
  if (bloqueado.present && !falseOperationalFlag(bloqueado.value)) {
    issues.push({
      field: "FRR_idproveedor",
      message: "El acreedor seleccionado esta bloqueado en el ERP.",
      severity: "error",
    });
  }
  if (inactivoRgpd.present && !falseOperationalFlag(inactivoRgpd.value)) {
    issues.push({
      field: "FRR_idproveedor",
      message: "El acreedor seleccionado esta inactivo por RGPD en el ERP.",
      severity: "error",
    });
  }

  if (!expectedProviderId || !actualProviderId || actualProviderId !== expectedProviderId) {
    issues.push({
      field: "FRR_idproveedor",
      message: "El acreedor seleccionado no coincide con el detalle devuelto por el ERP.",
      severity: "error",
    });
  }
  if (!actualAccount) {
    issues.push({
      field: "FRR_idcuenta",
      message: "El ERP no devuelve una cuenta contable para el acreedor seleccionado.",
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
  };
  if (
    !expected.FRR_Idempresa ||
    !expected.FRR_ejercicio ||
    !expected.FRR_idproveedor ||
    !expected.FRR_numerofactura
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
    };
    if (
      !normalized.FRR_id ||
      normalized.FRR_id <= 0 ||
      normalized.FRR_Idempresa !== expected.FRR_Idempresa ||
      normalized.FRR_ejercicio !== expected.FRR_ejercicio ||
      normalized.FRR_idproveedor !== expected.FRR_idproveedor ||
      normalized.FRR_numerofactura !== expected.FRR_numerofactura
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
    keys: new Set(["account_schema", "limit", "offset", "q", "cuenta", "nif"]),
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
    keys: new Set(["empresa_id", "ejercicio", "proveedor_id", "numero_factura", "schema", "limit", "offset"]),
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
    path: /^albaranes-gastos\/punteables$/,
    keys: new Set([
      "schema",
      "limit",
      "offset",
      "source_table",
      "proveedor_id",
      "empresa_id",
      "fecha_desde",
      "fecha_hasta",
      "solo_pendientes",
      "include_lines",
    ]),
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

export type FacturaValidationIssue = {
  field: string;
  message: string;
  severity: "error" | "warning";
};

export type FacturaERPAccountingRuleRow = {
  empresa_id?: unknown;
  proveedor_id?: unknown;
  ejercicio_erp?: unknown;
  tipo_factura?: unknown;
  regimen_id?: unknown;
  fecha_ctb_policy?: unknown;
  activo?: unknown;
};

export type FacturaERPAccountingRuleResolution = {
  factura: JsonObject;
  applied: JsonObject;
  issues: FacturaValidationIssue[];
};

type AccountingRuleField = {
  ruleKey: "ejercicio_erp" | "tipo_factura" | "regimen_id" | "fecha_ctb_policy";
  facturaKey: "FRR_ejercicio" | "FRR_tipofactura" | "FRR_idregimen" | "FRR_fechactb";
  normalize: (value: unknown) => string | number | null;
};

const positiveRuleInteger = (value: unknown) => {
  const parsed = integerValue(value, null);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const accountingRuleFields: AccountingRuleField[] = [
  { ruleKey: "ejercicio_erp", facturaKey: "FRR_ejercicio", normalize: positiveRuleInteger },
  { ruleKey: "tipo_factura", facturaKey: "FRR_tipofactura", normalize: (value) => text(value, null) },
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
): FacturaERPAccountingRuleResolution => {
  const resolved = { ...factura };
  const applied: JsonObject = {};
  const issues: FacturaValidationIssue[] = [];
  const empresaId = positiveRuleInteger(factura.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(factura.FRR_idproveedor);

  if (!empresaId) return { factura: resolved, applied, issues };

  const activeRows = rows.filter((row) =>
    row.activo === true &&
    positiveRuleInteger(row.empresa_id) === empresaId &&
    (row.proveedor_id === null || row.proveedor_id === undefined || positiveRuleInteger(row.proveedor_id) === proveedorId)
  );
  const companyRows = activeRows.filter((row) => row.proveedor_id === null || row.proveedor_id === undefined);
  const providerRows = proveedorId
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

export const loadAndResolveFacturaERPAccountingRules = async (
  supabase: ReturnType<typeof createServiceClient>,
  factura: JsonObject,
): Promise<FacturaERPAccountingRuleResolution> => {
  const empresaId = positiveRuleInteger(factura.FRR_Idempresa);
  const proveedorId = positiveRuleInteger(factura.FRR_idproveedor);
  if (!empresaId) return resolveFacturaERPAccountingRules(factura, []);

  let query = supabase
    .from("facturas_recibidas_erp_rules")
    .select("empresa_id, proveedor_id, ejercicio_erp, tipo_factura, regimen_id, fecha_ctb_policy, activo")
    .eq("empresa_id", empresaId)
    .eq("activo", true);
  query = proveedorId
    ? query.or(`proveedor_id.is.null,proveedor_id.eq.${proveedorId}`)
    : query.is("proveedor_id", null);

  const { data, error } = await query;
  if (error) {
    throw new Error(`ERP_RULES_UNAVAILABLE: no se pudieron cargar las reglas contables (${error.message}).`);
  }
  return resolveFacturaERPAccountingRules(
    factura,
    Array.isArray(data) ? data as FacturaERPAccountingRuleRow[] : [],
  );
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
    merged.push({ field, message, severity });
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
