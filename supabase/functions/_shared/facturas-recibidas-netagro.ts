import { createClient } from "jsr:@supabase/supabase-js@2";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = Record<string, unknown>;

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
  return createClient(supabaseUrl, serviceRoleKey);
};

export const createAuthClient = (authHeader: string) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
};

export const requireAgentToken = (req: Request) => {
  const expected =
    Deno.env.get("N8N_FACTURAS_RECIBIDAS_INGEST_TOKEN")?.trim() ||
    Deno.env.get("N8N_AGENT_TOKEN")?.trim();
  if (!expected) return { ok: false, response: jsonResponse({ error: "Token de ingesta no configurado." }, 500) };

  const headerToken = req.headers.get("x-agent-token")?.trim();
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const received = headerToken || bearer;
  if (!received || received !== expected) {
    return { ok: false, response: jsonResponse({ error: "Unauthorized" }, 401) };
  }
  return { ok: true };
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

export const cleanBase64 = (value: unknown) => {
  const raw = text(value, null);
  if (!raw) return null;
  return raw.replace(/^data:.*;base64,/i, "").replace(/\s/g, "");
};

export const sha256Base64 = async (base64: string) => {
  const buffer = new TextEncoder().encode(base64);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const ensureArchivoPdf = async (
  supabase: ReturnType<typeof createClient>,
  base64: string | null,
  fileName: string | null,
) => {
  if (!base64) return { archivoPdfId: null as number | null, reused: false, hash: null as string | null };

  const hash = await sha256Base64(base64);
  const { data: existingPdf, error: searchError } = await supabase
    .from("archivos_pdf")
    .select("id")
    .eq("hash_sha256", hash)
    .maybeSingle();

  if (searchError) throw searchError;
  if (existingPdf?.id) {
    return { archivoPdfId: Number(existingPdf.id), reused: true, hash };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("archivos_pdf")
    .insert({
      hash_sha256: hash,
      b64_contenido: base64,
      storage_bucket: null,
      storage_path: null,
      storage_uploaded_at: null,
      nombre_archivo: fileName,
      tamanio_bytes: Math.floor((base64.length * 3) / 4),
      mime_type: "application/pdf",
    })
    .select("id")
    .single();

  if (insertError || !inserted) throw insertError ?? new Error("No se pudo guardar el PDF.");
  return { archivoPdfId: Number(inserted.id), reused: false, hash };
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

export const normalizeFrrPayload = (input: JsonObject) => {
  const out: JsonObject = {};
  for (const key of frrNumericKeys) out[key] = numberValue(input[key], null);
  for (const key of frrIntegerKeys) out[key] = integerValue(input[key], null);
  for (const key of frrDateKeys) out[key] = dateValue(input[key], null);
  for (const key of frrTextKeys) out[key] = text(input[key], null);

  const fechaFactura = dateValue(pick(input, ["FRR_fechafactura", "fecha_factura", "fecha"]), null);
  const ejercicio = integerValue(input.FRR_ejercicio, fechaFactura ? Number(fechaFactura.slice(0, 4)) : new Date().getFullYear());

  out.FRR_numerofactura = text(pick(input, ["FRR_numerofactura", "numero_factura", "numero_factura_proveedor", "invoice_number"]), out.FRR_numerofactura as string | null);
  out.FRR_fechafactura = fechaFactura ?? out.FRR_fechafactura;
  out.FRR_fechactb = dateValue(pick(input, ["FRR_fechactb", "fecha_contable", "fecha_registro_contable"]), out.FRR_fechafactura as string | null);
  out.FRR_ejercicio = ejercicio;
  out.FRR_idproveedor = integerValue(pick(input, ["FRR_idproveedor", "proveedor_id", "acreedor_id", "id_proveedor"]), out.FRR_idproveedor as number | null);
  out.FRR_idcuenta = text(pick(input, ["FRR_idcuenta", "cuenta_proveedor", "cuenta_contable"]), out.FRR_idcuenta as string | null);
  out.FRR_Idempresa = integerValue(pick(input, ["FRR_Idempresa", "empresa_id"]), (out.FRR_Idempresa as number | null) ?? 1);
  out.FRR_totalfac = numberValue(pick(input, ["FRR_totalfac", "total", "total_factura", "importe_total"]), out.FRR_totalfac as number | null);
  out.FRR_base1 = numberValue(pick(input, ["FRR_base1", "base_imponible", "base"]), (out.FRR_base1 as number | null) ?? 0);
  out.FRR_iva1 = numberValue(pick(input, ["FRR_iva1", "iva_porcentaje", "tipo_iva"]), (out.FRR_iva1 as number | null) ?? 0);
  out.FRR_cuota1 = numberValue(pick(input, ["FRR_cuota1", "iva_importe", "cuota_iva"]), (out.FRR_cuota1 as number | null) ?? 0);
  out.FRR_baseret = numberValue(pick(input, ["FRR_baseret", "retencion_base"]), (out.FRR_baseret as number | null) ?? 0);
  out.FRR_ret = numberValue(pick(input, ["FRR_ret", "retencion_porcentaje"]), (out.FRR_ret as number | null) ?? 0);
  out.FRR_cuotaret = numberValue(pick(input, ["FRR_cuotaret", "retencion_importe"]), (out.FRR_cuotaret as number | null) ?? 0);
  out.FRR_Concepto = text(pick(input, ["FRR_Concepto", "concepto", "descripcion"]), out.FRR_Concepto as string | null);
  out.FRR_tipofactura = text(pick(input, ["FRR_tipofactura", "tipo_factura"]), (out.FRR_tipofactura as string | null) ?? "1");
  out.FRR_Modificable = text(input.FRR_Modificable, "S");
  out.FRR_GeneraCartera = text(input.FRR_GeneraCartera, "N");
  out.FRR_Contabilizar = text(input.FRR_Contabilizar, "S");
  out.FRR_FechaLog = dateValue(input.FRR_FechaLog, new Date().toISOString().slice(0, 10));
  out.FRR_HoraLog = text(input.FRR_HoraLog, new Date().toISOString().slice(11, 19));

  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
};

export const normalizeFrcPayload = (input: JsonObject, position: number) => {
  const out: JsonObject = { posicion: position };
  for (const key of frcNumericKeys) out[key] = numberValue(input[key], null);
  for (const key of frcIntegerKeys) out[key] = integerValue(input[key], null);
  for (const key of frcDateKeys) out[key] = dateValue(input[key], null);
  for (const key of frcTextKeys) out[key] = text(input[key], null);

  out.FRC_Importe = numberValue(pick(input, ["FRC_Importe", "importe", "amount"]), (out.FRC_Importe as number | null) ?? 0);
  out.FRC_Cuenta = text(pick(input, ["FRC_Cuenta", "cuenta", "cuenta_contable"]), out.FRC_Cuenta as string | null);
  out.FRC_FechaLog = dateValue(input.FRC_FechaLog, new Date().toISOString().slice(0, 10));
  out.FRC_HoraLog = text(input.FRC_HoraLog, new Date().toISOString().slice(11, 19));
  out.FRC_id = null;
  out.FRC_idfacturarecibida = null;
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
};

export const getValidationErrors = (factura: JsonObject) => {
  const errors: Array<{ field: string; message: string; severity: "error" | "warning" }> = [];
  const required = [
    ["FRR_idproveedor", "Falta proveedor/acreedor resuelto."],
    ["FRR_numerofactura", "Falta numero de factura del proveedor."],
    ["FRR_fechafactura", "Falta fecha de factura."],
    ["FRR_totalfac", "Falta total de factura."],
    ["FRR_Idempresa", "Falta empresa Netagro."],
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
  supabase: ReturnType<typeof createClient>,
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
      message: "El proveedor no existe en acreedores_cache/Netagro.",
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
