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

export const requireRouteUser = async (req: Request, route = "/facturas-recibidas") => {
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

  const isAdmin = roleRow?.role === "admin";
  const allowedRoutes = Array.isArray(roleRow?.allowed_routes) ? roleRow.allowed_routes : [];
  if (!isAdmin && !allowedRoutes.includes(route)) {
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

export const requestIdValue = (value: unknown) => {
  const parsed = text(value, null);
  if (!parsed) return crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed)) {
    throw new Error("request_id debe ser un UUID valido.");
  }
  return parsed;
};

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
    ["FRR_ObservacionesAEAT", ["FRR_ObservacionesAEAT", "observaciones_aeat"], text],
    ["FRR_tipofactura", ["FRR_tipofactura", "tipo_factura"], text],
  ];

  for (const [targetKey, aliases, parser] of aliasParsers) {
    const value = pickDefined(input, aliases);
    if (value !== undefined) out[targetKey] = parser(value, null);
  }

  if (!partial) {
    if (out.FRR_fechactb === undefined && out.FRR_fechafactura !== undefined) {
      out.FRR_fechactb = out.FRR_fechafactura;
    }
    if (out.FRR_Idempresa === undefined && hasUsableValue(input.FRR_Idempresa)) {
      out.FRR_Idempresa = integerValue(input.FRR_Idempresa, null);
    }
    out.FRR_Modificable = snValue(input.FRR_Modificable, "S");
    out.FRR_GeneraCartera = snValue(input.FRR_GeneraCartera, "N");
    out.FRR_CancelarporCtb = snValue(input.FRR_CancelarporCtb, "N");
    out.FRR_Contabilizar = snValue(input.FRR_Contabilizar, "S");
    out.FRR_FechaLog = dateValue(input.FRR_FechaLog, new Date().toISOString().slice(0, 10));
    out.FRR_HoraLog = text(input.FRR_HoraLog, new Date().toISOString().slice(11, 19));
  }

  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
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
  const rawSourceTable = text(pick(input, ["source_table", "tabla_origen", "tabla"]), null);
  return {
    posicion: integerValue(pick(input, ["posicion", "position"]), position) ?? position,
    remote_id: text(pick(input, ["remote_id", "id", "ID", "ALB_id", "GTO_id", "AMA_id"]), null),
    source_table: rawSourceTable?.toLowerCase() ?? null,
    source_id: integerValue(pick(input, ["source_id", "id_origen", "AMA_id"]), null),
    importe_factura: numberValue(
      pick(input, ["importe_factura", "importe_a_facturar", "importe_punteado", "Importe P"]),
      null,
    ),
    "Origen": text(pick(input, ["Origen", "origen"]), rawSourceTable === "albmaterial" ? "MA" : null),
    "Serie": text(pick(input, ["Serie", "serie"]), null),
    "Albaran": integerValue(pick(input, ["Albaran", "albaran", "numero_albaran"]), null),
    "Ref": text(pick(input, ["Ref", "ref", "referencia"]), null),
    "Fecha": dateValue(pick(input, ["Fecha", "fecha"]), null),
    "Importe P": numberValue(pick(input, ["Importe P", "importe_p", "importe_punteado"]), 0),
    "Importe": numberValue(pick(input, ["Importe", "importe"]), 0),
    "S": booleanValue(pick(input, ["S", "seleccionado"], true), true),
    "Ver": booleanValue(pick(input, ["Ver", "ver"], false), false),
    empresa_id: integerValue(pick(input, ["empresa_id", "FRR_Idempresa"]), null),
    proveedor_id: integerValue(pick(input, ["proveedor_id", "FRR_idproveedor"]), null),
    cuenta_gasto: text(pick(input, ["cuenta_gasto", "FRR_ctagasto", "FRC_Cuenta"]), null),
    line_count: integerValue(pick(input, ["line_count", "numero_lineas"]), sourceLines.length) ?? sourceLines.length,
    source_lines: sourceLines,
    raw: input,
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

export const toERPFacturaPayload = (factura: JsonObject) =>
  Object.fromEntries(
    Object.entries(normalizeFrrPayload(factura)).filter(
      ([key]) => key.startsWith("FRR_") || key === "FechaVto" || key === "ImporteVto",
    ),
  );

export const toERPCtbPayload = (linea: JsonObject, position: number) =>
  Object.fromEntries(
    Object.entries(normalizeFrcPayload(linea, position)).filter(([key]) => key.startsWith("FRC_")),
  );

export const toERPPunteoPayload = (punteo: JsonObject, position: number) =>
  Object.fromEntries(
    Object.entries(normalizePunteoPayload(punteo, position)).filter(([key]) =>
      [
        "remote_id",
        "source_table",
        "source_id",
        "importe_factura",
        "Origen",
        "Serie",
        "Albaran",
        "Ref",
        "Fecha",
        "Importe P",
        "Importe",
        "S",
        "Ver",
        "empresa_id",
        "proveedor_id",
        "cuenta_gasto",
      ].includes(key),
    ),
  );

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
  operation: "factura_recibida.create",
  request_id: requestId,
  dry_run: dryRun,
  cabecera,
  ctb,
  punteos,
  // Temporary v1 compatibility while n8n and FastAPI are promoted together.
  factura: cabecera,
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
  const ok = response.ok && object.ok !== false && object.success !== false;
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
  const created = status === "created" || accounting.created === true;
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
  {
    path: /^cuentas-contables$/,
    keys: new Set(["account_schema", "limit", "offset", "q", "cuenta", "nif"]),
  },
  {
    path: /^cuentas(?:\/[^/]+)?$/,
    keys: new Set(["schema", "limit", "offset", "q"]),
  },
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

export const getValidationErrors = (factura: JsonObject) => {
  const errors: Array<{ field: string; message: string; severity: "error" | "warning" }> = [];
  const required = [
    ["FRR_idproveedor", "Falta proveedor/acreedor resuelto."],
    ["FRR_numerofactura", "Falta numero de factura del proveedor."],
    ["FRR_fechafactura", "Falta fecha de factura."],
    ["FRR_fechactb", "Falta fecha CTB."],
    ["FRR_ejercicio", "Falta ejercicio ERP."],
    ["FRR_idregimen", "Falta Tipo IVA/regimen ERP."],
    ["FRR_totalfac", "Falta total de factura."],
    ["FRR_Idempresa", "Falta empresa ERP."],
  ] as const;

  for (const [field, message] of required) {
    const value = factura[field];
    if (value === null || value === undefined || value === "") {
      errors.push({ field, message, severity: "error" });
    }
  }

  if (!factura.FRR_idcuenta) {
    errors.push({ field: "FRR_idcuenta", message: "Falta cuenta contable del proveedor.", severity: "warning" });
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
  supabase: ReturnType<typeof createServiceClient>,
  factura: JsonObject,
) => {
  const errors = getValidationErrors(factura);
  const proveedorId = integerValue(factura.FRR_idproveedor, null);

  if (!proveedorId) return errors;

  const { data: acreedor, error } = await supabase
    .from("acreedores_cache")
    .select("ACR_Codigo, ACR_Cuenta")
    .eq("ACR_Codigo", proveedorId)
    .maybeSingle();

  if (error) throw error;
  if (!acreedor) {
    errors.push({
      field: "FRR_idproveedor",
      message: "El proveedor no existe en acreedores_cache/ERP.",
      severity: "error",
    });
    return errors;
  }

  const facturaCuenta = text(factura.FRR_idcuenta, null);
  const acreedorCuenta = text((acreedor as { ACR_Cuenta?: unknown }).ACR_Cuenta, null);
  if (facturaCuenta && acreedorCuenta && facturaCuenta !== acreedorCuenta) {
    errors.push({
      field: "FRR_idcuenta",
      message: `La cuenta contable no coincide con acreedores_cache (${acreedorCuenta}).`,
      severity: "warning",
    });
  }

  return errors;
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
