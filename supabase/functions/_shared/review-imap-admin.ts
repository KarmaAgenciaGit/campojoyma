import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { ImapFlow } from "npm:imapflow@1.0.179";
import PostalMime from "npm:postal-mime@2.4.4";

type ReviewAction = "list" | "detail" | "set_seen";

type ReviewListRequestBody = {
  action: "list";
  since_imap?: string;
  since_iso?: string;
  timezone?: string;
  page?: number;
  page_size?: number;
  sort_order?: "asc" | "desc";
  filter_start_iso?: string;
  filter_end_iso?: string;
  subject_contains?: string;
  from_contains?: string;
};

type ReviewDetailRequestBody = {
  action: "detail";
  uid?: number;
  message_id?: string;
};

type ReviewSetSeenRequestBody = {
  action: "set_seen";
  uid?: number;
  seen?: boolean;
  message_id?: string;
};

type ReviewRequestBody = {
  action?: ReviewAction | string;
  since_imap?: string;
  since_iso?: string;
  timezone?: string;
  page?: number;
  page_size?: number;
  sort_order?: "asc" | "desc" | string;
  filter_start_iso?: string;
  filter_end_iso?: string;
  subject_contains?: string;
  from_contains?: string;
  uid?: number;
  seen?: boolean;
  message_id?: string;
};

type MailboxAddress = { name?: string; address?: string };

type ParsedAttachment = {
  filename?: unknown;
  mimeType?: unknown;
  contentType?: unknown;
  contentId?: unknown;
  content?: unknown;
  size?: unknown;
};

type ImapBodyNode = {
  type?: string;
  subtype?: string;
  disposition?: unknown;
  dispositionParameters?: Record<string, unknown> | null;
  parameters?: Record<string, unknown> | null;
  childNodes?: ImapBodyNode[];
};

type FetchedMessage = {
  uid?: number;
  envelope?: {
    subject?: string;
    from?: MailboxAddress[];
    to?: MailboxAddress[];
    cc?: MailboxAddress[];
    messageId?: string;
    date?: Date;
  };
  internalDate?: Date;
  flags?: unknown;
  bodyStructure?: ImapBodyNode | null;
  source?: unknown;
};

type FlagsFetchedMessage = {
  uid?: number;
  flags?: unknown;
};

type ClienteBehaviorRuleRow = {
  clienteid: number | null;
  skip_name_includes: string[] | null;
  require_name_prefixes: string[] | null;
  skip_name_includes_pedidos?: string[] | null;
  require_name_prefixes_pedidos?: string[] | null;
  skip_name_includes_cuentaventa?: string[] | null;
  require_name_prefixes_cuentaventa?: string[] | null;
};

type ClientePdfFilters = {
  skip_name_includes: string[];
  require_name_prefixes: string[];
};

type ArchivoPdfHashRow = {
  hash_sha256: string | null;
};

type ClienteVisibleRow = {
  clienteid: number | null;
};

type ErpLoginResponse = {
  token?: string;
};

type ErpContactoRow = {
  clienteid?: number | string | null;
  cliente?: string | null;
  dato?: string | null;
  tipo_dato?: string | null;
  persona_contacto?: string | null;
};

type ErpContactoIndexed = {
  row: ErpContactoRow;
  datoNorm: string;
  tipoNorm: string;
  personaNorm: string;
};

type CallerRoleAccessRow = {
  role: string | null;
  allowed_routes: string[] | null;
};

type ResolvedCliente = {
  sender_email: string;
  clienteid: number;
  cliente_nombre: string | null;
};

type ListMessageDraft = {
  uid: number;
  message_id: string | null;
  subject: string | null;
  from: string | null;
  email_date: string | null;
  seen: boolean;
  attachment_count: number;
  pdf_hashes: string[];
  ignored_pdf_count: number;
};

type ListFilters = {
  startDate: Date;
  endDate: Date | null;
  subjectContains: string | null;
  fromContains: string | null;
  sortOrder: "asc" | "desc";
};

type AttachmentDetail = {
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  download_base64: string | null;
  has_pdf_missing_in_db: boolean;
  ignored_by_rule: boolean;
};

type ScopeConfig = {
  functionName: string;
  mailbox: string;
  filterScope: "pedidos" | "cuentaventa";
  allowedRoutes: string[];
  authErrorText: string;
  missingConfigText: string;
  invalidCredsText: string;
  timeoutText: string;
  imapEnv: {
    host: string[];
    user: string[];
    pass: string[];
    port: string[];
    secure: string[];
    tlsRejectUnauthorized: string[];
    connectionTimeout: string[];
    greetingTimeout: string[];
    authTimeout: string[];
    socketTimeout: string[];
    scanLimit: string[];
  };
};

const DEFAULT_LOOKBACK_DAYS = 2;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SCAN_LIMIT = 500;
const MAX_SCAN_LIMIT = 5000;
const MESSAGE_ID_LOOKBACK_DAYS = 7;
const ATTACHMENT_DOWNLOAD_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_CONNECTION_TIMEOUT_MS = 15000;
const DEFAULT_GREETING_TIMEOUT_MS = 15000;
const DEFAULT_AUTH_TIMEOUT_MS = 15000;
const DEFAULT_SOCKET_TIMEOUT_MS = 30000;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const DEFAULT_CORS_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";

const ERP_IP = "46.24.40.100";
const ERP_LOGIN_URL = `http://${ERP_IP}:7001/api/login/Login`;
const ERP_CONTACTOS_URL = `http://${ERP_IP}:7000/api/cliente/clientecontactoinforme`;
const ERP_LOGIN_BODY = { login: "ORIZON", password: "ORIZON" };
const ERP_LOGIN_TIMEOUT_MS = 3000;
const ERP_CONTACTOS_TIMEOUT_MS = 6000;
const ERP_CONTACTOS_TTL_MS = 5 * 60 * 1000;

let erpTokenCache: string | null = null;
let erpContactosCache: ErpContactoRow[] | null = null;
let erpContactosCacheAt = 0;
let erpContactosIndexCache: ErpContactoIndexed[] | null = null;

const buildCorsHeaders = (req: Request): HeadersInit => ({
  "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
  "Access-Control-Allow-Headers": req.headers.get("access-control-request-headers") ?? DEFAULT_CORS_ALLOW_HEADERS,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin, Access-Control-Request-Headers",
});

const jsonResponse = (req: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
    },
  });

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const toNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
};

const normalizePath = (path: string) => {
  const clean = path.split("?")[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

const normalizeMessageId = (value: unknown): string | null => {
  const normalized = toNullableString(value);
  if (!normalized) return null;
  const withoutAngles = normalized.replace(/^<\s*/, "").replace(/\s*>$/, "");
  return withoutAngles ? withoutAngles.toLowerCase() : null;
};

const normalizeContentId = (value: unknown): string | null => {
  const normalized = toNullableString(value);
  if (!normalized) return null;
  const withoutAngles = normalized.replace(/^<\s*/, "").replace(/\s*>$/, "");
  return withoutAngles ? withoutAngles.toLowerCase() : null;
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const normalized = normalize(item);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const toPositiveInt = (value: unknown): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
};

const toBoundedPositiveInt = (value: unknown, fallback: number, minValue = 1, maxValue = Number.MAX_SAFE_INTEGER) => {
  const parsed = toPositiveInt(value);
  if (!parsed) return fallback;
  return Math.min(maxValue, Math.max(minValue, parsed));
};

const toBoolean = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;

const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const getEnvFirst = (keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (!value) continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return undefined;
};

const getEnvFirstOrThrow = (keys: string[]) => {
  const value = getEnvFirst(keys);
  if (value) return value;
  throw new Error(`Missing required env var: ${keys[0] ?? "UNKNOWN_ENV"}`);
};

const hasAllowedRouteAccess = (allowedRoutes: unknown, requiredRoutes: string[]) => {
  if (!Array.isArray(allowedRoutes) || requiredRoutes.length === 0) return false;
  const normalizedRequiredRoutes = new Set(requiredRoutes.map(normalizePath));
  return allowedRoutes.some((route) =>
    typeof route === "string" && normalizedRequiredRoutes.has(normalizePath(route))
  );
};

const extractEmails = (value: unknown): string[] => {
  if (!value) return [];
  const matches = String(value).match(EMAIL_RE);
  return matches ? matches.map((email) => email.toLowerCase()) : [];
};

const parseAddressLine = (value: MailboxAddress[] | undefined): string | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const labels = value
    .map((entry) => {
      const address = toNullableString(entry?.address);
      const name = toNullableString(entry?.name);
      if (name && address) return `${name} <${address}>`;
      return address ?? name;
    })
    .filter((entry): entry is string => Boolean(entry));
  return labels.length > 0 ? labels.join(", ") : null;
};

const hasSeenFlag = (flags: unknown): boolean => {
  if (!flags) return false;
  if (flags instanceof Set) {
    return Array.from(flags).some((flag) => String(flag).toLowerCase() === "\\seen");
  }
  if (Array.isArray(flags)) {
    return flags.some((flag) => String(flag).toLowerCase() === "\\seen");
  }
  return String(flags).toLowerCase().includes("\\seen");
};

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number, step: string) => {
  const controller = new AbortController();
  const fetchPromise = fetch(url, { ...init, signal: controller.signal });

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`ERP ${step} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch (error) {
    fetchPromise.catch(() => undefined);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const parseImapDateString = (value: string): Date | null => {
  const match = /^(\d{1,2})-([a-z]{3})-(\d{4})$/i.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const monthToken = match[2].toLowerCase();
  const year = Number(match[3]);
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const month = months[monthToken];
  if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  const date = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseIsoDateOrNull = (value: unknown): Date | null => {
  const normalized = toNullableString(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveCidImagesInHtml = (html: string, cidToDataUri: Map<string, string>): string => {
  let resolvedHtml = html;
  for (const [contentId, dataUri] of cidToDataUri.entries()) {
    const escapedContentId = escapeRegExp(contentId);
    const directPattern = new RegExp(`cid:\\s*${escapedContentId}`, "gi");
    const angledPattern = new RegExp(`cid:\\s*<\\s*${escapedContentId}\\s*>`, "gi");
    resolvedHtml = resolvedHtml.replace(angledPattern, dataUri);
    resolvedHtml = resolvedHtml.replace(directPattern, dataUri);
  }
  return resolvedHtml;
};

const normalizeContentToUint8Array = (value: unknown): Uint8Array | null => {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (typeof value === "string") {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
    return bytes;
  }
  return null;
};

const getAttachmentSizeBytes = (attachment: ParsedAttachment): number | null => {
  const explicit = Number(attachment.size);
  if (Number.isFinite(explicit) && explicit > 0) return Math.trunc(explicit);
  const contentBytes = normalizeContentToUint8Array(attachment.content);
  return contentBytes?.byteLength ?? null;
};

const getDispositionValue = (value: unknown): string | null => {
  if (typeof value === "string") return value.toLowerCase();
  if (value && typeof value === "object") {
    const maybeValue = (value as { value?: unknown }).value;
    if (typeof maybeValue === "string") return maybeValue.toLowerCase();
  }
  return null;
};

const getNodeFilename = (node: ImapBodyNode): string | null => {
  const fromDisposition = toNullableString(
    (node.dispositionParameters as { filename?: unknown } | null)?.filename,
  );
  if (fromDisposition) return fromDisposition;
  return toNullableString((node.parameters as { name?: unknown } | null)?.name);
};

const countAttachmentsFromBodyStructure = (node: ImapBodyNode | null | undefined): number => {
  if (!node || typeof node !== "object") return 0;

  const children = Array.isArray(node.childNodes) ? node.childNodes : [];
  const type = toNullableString(node.type)?.toLowerCase();
  const subtype = toNullableString(node.subtype)?.toLowerCase();
  const disposition = getDispositionValue(node.disposition);
  const filename = getNodeFilename(node);

  const isAttachment = disposition === "attachment" ||
    (disposition === "inline" && Boolean(filename)) ||
    Boolean(filename) ||
    (type === "application" && subtype === "pdf");

  let total = isAttachment ? 1 : 0;
  for (const child of children) {
    total += countAttachmentsFromBodyStructure(child);
  }
  return total;
};

const isPdfAttachment = (attachment: ParsedAttachment) => {
  const filename = toNullableString(attachment.filename);
  const mimeType = toNullableString(attachment.mimeType ?? attachment.contentType);
  return Boolean(
    (filename && filename.toLowerCase().endsWith(".pdf")) ||
      (mimeType && mimeType.toLowerCase().includes("pdf")),
  );
};

const computeHashFromBytes = async (bytes: Uint8Array): Promise<string> => {
  const base64Payload = encodeBase64(Uint8Array.from(bytes));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(base64Payload));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const scoreContacto = (
  contacto: ErpContactoIndexed,
  emailLower: string,
  domain: string | null,
  domainNoTld: string | null,
) => {
  const dato = contacto.datoNorm;
  if (!dato) return 0;
  let score = 0;
  if (dato === emailLower) score += 1000;
  if (emailLower && dato.includes(emailLower)) score += 800;
  if (domain && dato.includes(domain)) score += 600;
  if (domainNoTld && dato.includes(domainNoTld)) score += 400;
  if (contacto.tipoNorm === "e") score += 50;
  if (contacto.personaNorm.includes("salid")) score += 10;
  return score;
};

const createErpResolver = async () => {
  let erpToken: string | null = erpTokenCache;
  const now = Date.now();
  let contactosCache: ErpContactoRow[] | null =
    erpContactosCache && now - erpContactosCacheAt < ERP_CONTACTOS_TTL_MS ? erpContactosCache : null;
  let contactosIndexCache: ErpContactoIndexed[] | null =
    contactosCache && erpContactosIndexCache ? erpContactosIndexCache : null;
  const senderCache = new Map<string, ResolvedCliente | null>();

  const erpLogin = async (): Promise<string> => {
    if (erpToken) return erpToken;
    const response = await fetchWithTimeout(
      ERP_LOGIN_URL,
      {
        method: "POST",
        headers: { accept: "text/plain", "Content-Type": "application/json" },
        body: JSON.stringify(ERP_LOGIN_BODY),
      },
      ERP_LOGIN_TIMEOUT_MS,
      "login",
    );
    if (!response.ok) throw new Error(`ERP login failed: ${response.status} ${response.statusText}`);
    const parsed = (await parseJsonResponse(response)) as ErpLoginResponse | null;
    const token = toNullableString(parsed?.token);
    if (!token) throw new Error("ERP login response without token");
    erpToken = token;
    erpTokenCache = token;
    return token;
  };

  const erpGetContactos = async (): Promise<ErpContactoRow[]> => {
    if (contactosCache) return contactosCache;
    const token = await erpLogin();
    const response = await fetchWithTimeout(
      ERP_CONTACTOS_URL,
      {
        method: "GET",
        headers: { accept: "text/plain", Authorization: `Bearer ${token}` },
      },
      ERP_CONTACTOS_TIMEOUT_MS,
      "contactos",
    );
    if (!response.ok) throw new Error(`ERP contactos failed: ${response.status} ${response.statusText}`);
    const parsed = await parseJsonResponse(response);
    let rows: unknown[] = [];
    if (Array.isArray(parsed)) rows = parsed;
    else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown[] }).data)) {
      rows = (parsed as { data: unknown[] }).data;
    } else {
      throw new Error("ERP contactos response is not an array");
    }
    contactosCache = rows as ErpContactoRow[];
    erpContactosCache = contactosCache;
    erpContactosCacheAt = Date.now();
    erpContactosIndexCache = null;
    contactosIndexCache = null;
    return contactosCache;
  };

  const getContactosIndex = async () => {
    if (contactosIndexCache) return contactosIndexCache;
    const contactos = await erpGetContactos();
    contactosIndexCache = contactos.map((row) => ({
      row,
      datoNorm: normalize(row?.dato),
      tipoNorm: normalize(row?.tipo_dato),
      personaNorm: normalize(row?.persona_contacto),
    }));
    erpContactosIndexCache = contactosIndexCache;
    return contactosIndexCache;
  };

  const resolveBySenderEmail = async (senderEmail: string | null): Promise<ResolvedCliente | null> => {
    const emailLower = toNullableString(senderEmail)?.toLowerCase() ?? null;
    if (!emailLower) return null;
    if (senderCache.has(emailLower)) return senderCache.get(emailLower) ?? null;
    const domain = emailLower.includes("@") ? emailLower.split("@")[1] : null;
    const domainNoTld = domain ? domain.split(".").slice(0, -1).join(".") : null;
    const contactosIndex = await getContactosIndex();

    let bestContacto: ErpContactoIndexed | null = null;
    let bestScore = 0;
    for (const contacto of contactosIndex) {
      const score = scoreContacto(contacto, emailLower, domain, domainNoTld);
      if (score > bestScore) {
        bestScore = score;
        bestContacto = contacto;
      }
    }

    if (!bestContacto || bestScore <= 0) {
      senderCache.set(emailLower, null);
      return null;
    }

    const clienteid = toPositiveInt(bestContacto.row.clienteid);
    if (!clienteid) {
      senderCache.set(emailLower, null);
      return null;
    }

    const resolved: ResolvedCliente = {
      sender_email: emailLower,
      clienteid,
      cliente_nombre: toNullableString(bestContacto.row.cliente),
    };
    senderCache.set(emailLower, resolved);
    return resolved;
  };

  return { resolveBySenderEmail };
};

const emptyClientePdfFilters = (): ClientePdfFilters => ({
  skip_name_includes: [],
  require_name_prefixes: [],
});

const resolveClientePdfFilters = (rule: ClienteBehaviorRuleRow | null | undefined, scope: ScopeConfig["filterScope"]): ClientePdfFilters => {
  if (!rule) return emptyClientePdfFilters();
  if (scope === "pedidos") {
    return {
      skip_name_includes: normalizeStringList(rule.skip_name_includes_pedidos ?? rule.skip_name_includes),
      require_name_prefixes: normalizeStringList(rule.require_name_prefixes_pedidos ?? rule.require_name_prefixes),
    };
  }
  return {
    skip_name_includes: normalizeStringList(rule.skip_name_includes_cuentaventa ?? rule.skip_name_includes),
    require_name_prefixes: normalizeStringList(rule.require_name_prefixes_cuentaventa ?? rule.require_name_prefixes),
  };
};

const evaluatePdfIgnoreByName = (
  filename: string | null,
  filters: ClientePdfFilters | null | undefined,
): { ignored: boolean } => {
  const effectiveFilters = filters ?? emptyClientePdfFilters();
  const normalizedFilename = normalize(filename);
  if (
    effectiveFilters.require_name_prefixes.length > 0 &&
    !effectiveFilters.require_name_prefixes.some((prefix) => normalizedFilename.startsWith(prefix))
  ) {
    return { ignored: true };
  }
  if (effectiveFilters.skip_name_includes.some((token) => normalizedFilename.includes(token))) {
    return { ignored: true };
  }
  return { ignored: false };
};

const getVisibleClientesTable = (scope: ScopeConfig["filterScope"]) =>
  scope === "pedidos" ? "clientes_visibles" : "clientes_visibles_cuentaventa";

const loadVisibleClienteIds = async (
  supabase: any,
  scope: ScopeConfig["filterScope"],
): Promise<Set<number>> => {
  const { data, error } = await supabase.from(getVisibleClientesTable(scope)).select("clienteid");
  if (error) throw new Error(error.message);
  const visibleClienteIds = new Set<number>();
  (data as ClienteVisibleRow[] | null ?? []).forEach((row) => {
    const clienteid = toPositiveInt(row?.clienteid);
    if (clienteid) visibleClienteIds.add(clienteid);
  });
  return visibleClienteIds;
};

const shouldSuppressPendingByVisibility = (
  resolvedClient: ResolvedCliente | null | undefined,
  visibleClienteIds: Set<number>,
): boolean => {
  const clienteid = resolvedClient?.clienteid ?? null;
  return Boolean(clienteid && !visibleClienteIds.has(clienteid));
};

const loadClientePdfFiltersMap = async (
  supabase: any,
  clienteIds: number[],
  scope: ScopeConfig["filterScope"],
): Promise<Map<number, ClientePdfFilters>> => {
  const uniqueClienteIds = Array.from(new Set(clienteIds.filter((clienteid) => clienteid > 0)));
  const filtersMap = new Map<number, ClientePdfFilters>();
  if (uniqueClienteIds.length === 0) return filtersMap;
  const { data, error } = await supabase
    .from("cliente_behavior_rules")
    .select([
      "clienteid",
      "skip_name_includes",
      "require_name_prefixes",
      "skip_name_includes_pedidos",
      "require_name_prefixes_pedidos",
      "skip_name_includes_cuentaventa",
      "require_name_prefixes_cuentaventa",
    ].join(", "))
    .in("clienteid", uniqueClienteIds);
  if (error) throw new Error(error.message);
  (data as ClienteBehaviorRuleRow[] | null ?? []).forEach((row) => {
    const clienteid = toPositiveInt(row?.clienteid);
    if (!clienteid) return;
    filtersMap.set(clienteid, resolveClientePdfFilters(row, scope));
  });
  return filtersMap;
};

const loadExistingPdfHashes = async (
  supabase: any,
  hashes: string[],
): Promise<Set<string>> => {
  const uniqueHashes = Array.from(new Set(hashes.filter(Boolean)));
  const existing = new Set<string>();
  for (let index = 0; index < uniqueHashes.length; index += 300) {
    const chunk = uniqueHashes.slice(index, index + 300);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("archivos_pdf")
      .select("hash_sha256")
      .in("hash_sha256", chunk);
    if (error) throw new Error(error.message);
    (data as ArchivoPdfHashRow[] | null ?? []).forEach((row) => {
      const hash = toNullableString(row?.hash_sha256);
      if (hash) existing.add(hash);
    });
  }
  return existing;
};

const createImapClient = (params: {
  host: string;
  port: number;
  secure: boolean;
  tlsRejectUnauthorized: boolean;
  user: string;
  pass: string;
  connectionTimeoutMs: number;
  greetingTimeoutMs: number;
  authTimeoutMs: number;
  socketTimeoutMs: number;
}) =>
  new ImapFlow({
    host: params.host,
    port: params.port,
    secure: params.secure,
    auth: { user: params.user, pass: params.pass },
    tls: { rejectUnauthorized: params.tlsRejectUnauthorized },
    connectionTimeout: params.connectionTimeoutMs,
    greetingTimeout: params.greetingTimeoutMs,
    authTimeout: params.authTimeoutMs,
    socketTimeout: params.socketTimeoutMs,
    logger: false,
  });

const findUidByMessageIdInRecentMessages = async (client: ImapFlow, messageId: string): Promise<number | null> => {
  const normalizedTarget = normalizeMessageId(messageId);
  if (!normalizedTarget) return null;
  const sinceDate = new Date(Date.now() - MESSAGE_ID_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const uids = await client.search({ since: sinceDate }, { uid: true });
  const candidates = Array.isArray(uids) ? [...uids].sort((a, b) => b - a).slice(0, 300) : [];
  for await (const rawMessage of client.fetch(candidates, { uid: true, envelope: true }, { uid: true })) {
    const message = rawMessage as FetchedMessage;
    const uid = toPositiveInt(message.uid);
    if (!uid) continue;
    if (normalizeMessageId(message.envelope?.messageId) === normalizedTarget) return uid;
  }
  return null;
};

const getListTimeframe = (body: ReviewListRequestBody, mailbox: string) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - DEFAULT_LOOKBACK_DAYS);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const defaultSinceImap = `${start.getDate()}-${months[start.getMonth()]}-${start.getFullYear()}`;
  const defaultSinceIso = new Date(
    Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0),
  ).toISOString();
  const sinceImap = toNullableString(body?.since_imap) ?? defaultSinceImap;
  const sinceIso = toNullableString(body?.since_iso) ?? defaultSinceIso;
  const timezone = toNullableString(body?.timezone) ?? "UTC";
  const parsedSinceIso = new Date(sinceIso);
  const parsedSinceImap = parseImapDateString(sinceImap);
  const sinceDate = !Number.isNaN(parsedSinceIso.getTime()) ? parsedSinceIso : parsedSinceImap ?? start;
  const page = Math.max(1, toPositiveInt(body?.page) ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, toPositiveInt(body?.page_size) ?? DEFAULT_PAGE_SIZE));
  return { sinceImap, sinceIso, timezone, sinceDate, page, pageSize, mailbox };
};

const parseListSortOrder = (value: unknown): "asc" | "desc" => {
  const normalized = toNullableString(value)?.toLowerCase();
  return normalized === "asc" ? "asc" : "desc";
};

const getListFilters = (body: ReviewListRequestBody, timeframe: ReturnType<typeof getListTimeframe>): ListFilters => {
  const rawStartDate = parseIsoDateOrNull(body?.filter_start_iso);
  const rawEndDate = parseIsoDateOrNull(body?.filter_end_iso);
  const startDate = rawStartDate && rawStartDate > timeframe.sinceDate ? rawStartDate : timeframe.sinceDate;
  const endDate = rawEndDate;
  if (endDate && startDate > endDate) {
    throw new Error("El filtro de fecha/hora es inválido. La fecha/hora final no puede ser anterior a la inicial.");
  }
  return {
    startDate,
    endDate,
    subjectContains: normalize(body?.subject_contains) || null,
    fromContains: normalize(body?.from_contains) || null,
    sortOrder: parseListSortOrder(body?.sort_order),
  };
};

const matchesListFilters = (message: FetchedMessage, filters: ListFilters): boolean => {
  const messageDate = message.internalDate ?? message.envelope?.date ?? null;
  if (!messageDate) return false;
  if (messageDate < filters.startDate) return false;
  if (filters.endDate && messageDate > filters.endDate) return false;
  if (filters.subjectContains && !normalize(message.envelope?.subject).includes(filters.subjectContains)) return false;
  if (filters.fromContains && !normalize(parseAddressLine(message.envelope?.from)).includes(filters.fromContains)) return false;
  return true;
};

const getMessageSortTimestamp = (message: FetchedMessage): number => {
  const emailDate = message.internalDate ?? message.envelope?.date ?? null;
  const timestamp = emailDate?.getTime() ?? 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const compareMessagesForList = (left: FetchedMessage, right: FetchedMessage, sortOrder: "asc" | "desc") => {
  const timestampDelta = getMessageSortTimestamp(left) - getMessageSortTimestamp(right);
  if (timestampDelta !== 0) {
    return sortOrder === "asc" ? timestampDelta : -timestampDelta;
  }

  const uidDelta = (toPositiveInt(left.uid) ?? 0) - (toPositiveInt(right.uid) ?? 0);
  return sortOrder === "asc" ? uidDelta : -uidDelta;
};

const parseAttachmentsForList = async (
  sourceBytes: Uint8Array,
  filters: ClientePdfFilters,
): Promise<{ attachmentCount: number; ignoredPdfCount: number; pdfHashes: string[] }> => {
  const parser = new PostalMime();
  const parsed = await parser.parse(sourceBytes);
  const attachments = Array.isArray((parsed as { attachments?: unknown[] }).attachments)
    ? ((parsed as { attachments: unknown[] }).attachments as ParsedAttachment[])
    : [];

  const pdfHashes: string[] = [];
  let ignoredPdfCount = 0;
  for (const attachment of attachments) {
    if (!isPdfAttachment(attachment)) continue;
    const filename = toNullableString(attachment.filename);
    if (evaluatePdfIgnoreByName(filename, filters).ignored) {
      ignoredPdfCount += 1;
      continue;
    }
    const contentBytes = normalizeContentToUint8Array(attachment.content);
    if (!contentBytes || contentBytes.byteLength === 0) continue;
    pdfHashes.push(await computeHashFromBytes(contentBytes));
  }

  return { attachmentCount: attachments.length, ignoredPdfCount, pdfHashes };
};

const parseAttachmentsForDetail = async (
  sourceBytes: Uint8Array,
  filters: ClientePdfFilters,
  existingHashes: Set<string>,
  options?: { suppressPdfPending?: boolean },
): Promise<{ bodyText: string | null; bodyHtml: string | null; attachments: AttachmentDetail[] }> => {
  const parser = new PostalMime();
  const parsed = await parser.parse(sourceBytes);
  const attachments = Array.isArray((parsed as { attachments?: unknown[] }).attachments)
    ? ((parsed as { attachments: unknown[] }).attachments as ParsedAttachment[])
    : [];
  const bodyText = typeof (parsed as { text?: unknown }).text === "string" ? (parsed as { text: string }).text : null;
  let bodyHtml = typeof (parsed as { html?: unknown }).html === "string" ? (parsed as { html: string }).html : null;
  const suppressPdfPending = options?.suppressPdfPending ?? false;

  const out: AttachmentDetail[] = [];
  const cidToDataUri = new Map<string, string>();
  for (const attachment of attachments) {
    const filename = toNullableString(attachment.filename);
    const mimeType = toNullableString(attachment.mimeType ?? attachment.contentType);
    const normalizedMimeType = mimeType?.toLowerCase() ?? null;
    const sizeBytes = getAttachmentSizeBytes(attachment);
    const contentBytes = normalizeContentToUint8Array(attachment.content);
    const contentId = normalizeContentId(attachment.contentId);
    const ignored = isPdfAttachment(attachment) && evaluatePdfIgnoreByName(filename, filters).ignored;
    let downloadBase64: string | null = null;
    let hasPdfMissingInDb = false;

    if (contentBytes && contentBytes.byteLength > 0 && contentBytes.byteLength <= ATTACHMENT_DOWNLOAD_MAX_BYTES) {
      downloadBase64 = encodeBase64(contentBytes);
    }

    if (contentId && normalizedMimeType?.startsWith("image/") && downloadBase64) {
      cidToDataUri.set(contentId, `data:${normalizedMimeType};base64,${downloadBase64}`);
    }

    if (!suppressPdfPending && isPdfAttachment(attachment) && !ignored && contentBytes && contentBytes.byteLength > 0) {
      const hash = await computeHashFromBytes(contentBytes);
      hasPdfMissingInDb = !existingHashes.has(hash);
    }

    out.push({
      filename,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      download_base64: downloadBase64,
      has_pdf_missing_in_db: hasPdfMissingInDb,
      ignored_by_rule: ignored,
    });
  }

  if (bodyHtml && cidToDataUri.size > 0) {
    bodyHtml = resolveCidImagesInHtml(bodyHtml, cidToDataUri);
  }

  return { bodyText, bodyHtml, attachments: out };
};

export const serveReviewImapAdmin = (config: ScopeConfig) => {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: buildCorsHeaders(req) });
    }

    if (req.method !== "POST") {
      return jsonResponse(req, { error: "Method not allowed" }, 405);
    }

    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return jsonResponse(req, { error: "Unauthorized" }, 401);
      const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!accessToken) return jsonResponse(req, { error: "Unauthorized" }, 401);

      const supabaseUrl = getEnvFirstOrThrow(["SUPABASE_URL"]);
      const serviceRoleKey = getEnvFirstOrThrow(["SUPABASE_SERVICE_ROLE_KEY"]);
      const supabase = createClient(supabaseUrl, serviceRoleKey);

      const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
      if (authError || !authData?.user?.id) {
        return jsonResponse(req, { error: "No autorizado" }, 401);
      }

      const { data: roleRow, error: roleError } = await supabase
        .from("user_roles")
        .select("role, allowed_routes")
        .eq("user_id", authData.user.id)
        .maybeSingle();

      const typedRoleRow = (roleRow ?? null) as CallerRoleAccessRow | null;
      const isAdmin = typedRoleRow?.role === "admin";
      const hasRouteAccess = hasAllowedRouteAccess(typedRoleRow?.allowed_routes, config.allowedRoutes);

      if (roleError || (!isAdmin && !hasRouteAccess)) {
        return jsonResponse(req, { error: config.authErrorText }, 403);
      }

      let body: ReviewRequestBody = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const action = toNullableString(body.action)?.toLowerCase();
      if (action !== "list" && action !== "detail" && action !== "set_seen") {
        return jsonResponse(req, { error: "Acción inválida. Usa action=list, action=detail o action=set_seen." }, 400);
      }

      const imapHost = getEnvFirstOrThrow(config.imapEnv.host);
      const imapUser = getEnvFirstOrThrow(config.imapEnv.user);
      const imapPass = getEnvFirstOrThrow(config.imapEnv.pass);
      const imapPort = Number(getEnvFirst(config.imapEnv.port) ?? "993");
      if (!Number.isFinite(imapPort) || imapPort <= 0) {
        return jsonResponse(req, { error: `${config.imapEnv.port[0]} inválido` }, 500);
      }

      const imapSecure = parseBooleanEnv(getEnvFirst(config.imapEnv.secure), true);
      const imapTlsRejectUnauthorized = parseBooleanEnv(getEnvFirst(config.imapEnv.tlsRejectUnauthorized), true);
      const imapConnectionTimeoutMs = toBoundedPositiveInt(getEnvFirst(config.imapEnv.connectionTimeout), DEFAULT_CONNECTION_TIMEOUT_MS, 1000, 120000);
      const imapGreetingTimeoutMs = toBoundedPositiveInt(getEnvFirst(config.imapEnv.greetingTimeout), DEFAULT_GREETING_TIMEOUT_MS, 1000, 120000);
      const imapAuthTimeoutMs = toBoundedPositiveInt(getEnvFirst(config.imapEnv.authTimeout), DEFAULT_AUTH_TIMEOUT_MS, 1000, 120000);
      const imapSocketTimeoutMs = toBoundedPositiveInt(getEnvFirst(config.imapEnv.socketTimeout), DEFAULT_SOCKET_TIMEOUT_MS, 1000, 180000);
      const scanLimit = toBoundedPositiveInt(getEnvFirst(config.imapEnv.scanLimit), DEFAULT_SCAN_LIMIT, 1, MAX_SCAN_LIMIT);

      const imapConfig = {
        host: imapHost,
        port: imapPort,
        secure: imapSecure,
        tlsRejectUnauthorized: imapTlsRejectUnauthorized,
        user: imapUser,
        pass: imapPass,
        connectionTimeoutMs: imapConnectionTimeoutMs,
        greetingTimeoutMs: imapGreetingTimeoutMs,
        authTimeoutMs: imapAuthTimeoutMs,
        socketTimeoutMs: imapSocketTimeoutMs,
      };

      const erpResolver = await createErpResolver();

      if (action === "list") {
        const timeframe = getListTimeframe(body as ReviewListRequestBody, config.mailbox);
        let listFilters: ListFilters;
        try {
          listFilters = getListFilters(body as ReviewListRequestBody, timeframe);
        } catch (error) {
          return jsonResponse(req, { error: getErrorMessage(error) }, 400);
        }
        const client = createImapClient(imapConfig);
        await client.connect();
        try {
          await client.mailboxOpen(config.mailbox, { readOnly: true });
          const searchUids = await client.search({ since: timeframe.sinceDate }, { uid: true });
          const sortedUids = Array.isArray(searchUids) ? [...searchUids].sort((a, b) => b - a).slice(0, scanLimit) : [];
          const fetchedMetadata: FetchedMessage[] = [];
          if (sortedUids.length > 0) {
            for await (
              const rawMessage of client.fetch(
                sortedUids,
                { uid: true, envelope: true, internalDate: true, flags: true, bodyStructure: true },
                { uid: true },
              )
            ) {
              fetchedMetadata.push(rawMessage as FetchedMessage);
            }
          }

          const filteredMetadata = fetchedMetadata
            .filter((message) => matchesListFilters(message, listFilters))
            .sort((left, right) => compareMessagesForList(left, right, listFilters.sortOrder));
          const filteredUidList = filteredMetadata
            .map((message) => toPositiveInt(message.uid))
            .filter((uid): uid is number => Boolean(uid));
          const metadataByUid = new Map<number, FetchedMessage>();
          filteredMetadata.forEach((message) => {
            const uid = toPositiveInt(message.uid);
            if (uid) metadataByUid.set(uid, message);
          });

          const totalMessages = filteredUidList.length;
          const totalPages = Math.max(1, Math.ceil(totalMessages / timeframe.pageSize));
          const currentPage = Math.min(timeframe.page, totalPages);
          const pageStart = (currentPage - 1) * timeframe.pageSize;
          const selectedUids = filteredUidList.slice(pageStart, pageStart + timeframe.pageSize);
          const fetchedMessagesByUid = new Map<number, FetchedMessage>();
          if (selectedUids.length > 0) {
            for await (
              const rawMessage of client.fetch(
                selectedUids,
                { uid: true, envelope: true, internalDate: true, flags: true, bodyStructure: true, source: true },
                { uid: true },
              )
            ) {
              const message = rawMessage as FetchedMessage;
              const uid = toPositiveInt(message.uid);
              if (uid) fetchedMessagesByUid.set(uid, message);
            }
          }
          const fetchedMessages = selectedUids
            .map((uid) => fetchedMessagesByUid.get(uid) ?? metadataByUid.get(uid))
            .filter((message): message is FetchedMessage => Boolean(message));

          const clientByUid = new Map<number, ResolvedCliente | null>();
          const clientIds = new Set<number>();
          for (const message of fetchedMessages) {
            const uid = toPositiveInt(message.uid);
            if (!uid) continue;
            const senderEmail = extractEmails(parseAddressLine(message.envelope?.from))[0] ?? null;
            const resolved = await erpResolver.resolveBySenderEmail(senderEmail);
            clientByUid.set(uid, resolved);
            if (resolved?.clienteid) clientIds.add(resolved.clienteid);
          }

          const [filtersMap, visibleClienteIds] = await Promise.all([
            loadClientePdfFiltersMap(supabase, Array.from(clientIds), config.filterScope),
            loadVisibleClienteIds(supabase, config.filterScope),
          ]);
          const drafts: ListMessageDraft[] = [];
          let allHashes: string[] = [];

          for (const message of fetchedMessages) {
            const uid = toPositiveInt(message.uid);
            const sourceBytes = normalizeContentToUint8Array(message.source);
            if (!uid) continue;
            const resolvedClient = clientByUid.get(uid) ?? null;
            const suppressPendingByVisibility = shouldSuppressPendingByVisibility(resolvedClient, visibleClienteIds);
            const filters = resolvedClient?.clienteid ? filtersMap.get(resolvedClient.clienteid) ?? emptyClientePdfFilters() : emptyClientePdfFilters();
            let attachmentCount = countAttachmentsFromBodyStructure(message.bodyStructure ?? null);
            let ignoredPdfCount = 0;
            let pdfHashes: string[] = [];

            if (sourceBytes) {
              try {
                const parsed = await parseAttachmentsForList(sourceBytes, filters);
                attachmentCount = parsed.attachmentCount;
                ignoredPdfCount = parsed.ignoredPdfCount;
                pdfHashes = suppressPendingByVisibility ? [] : parsed.pdfHashes;
                if (!suppressPendingByVisibility) {
                  allHashes = allHashes.concat(parsed.pdfHashes);
                }
              } catch (error) {
                console.warn(
                  JSON.stringify({
                    service: config.functionName,
                    stage: "list_parse_attachments_failed",
                    uid,
                    details: getErrorMessage(error),
                  }),
                );
              }
            }

            drafts.push({
              uid,
              message_id: toNullableString(message.envelope?.messageId),
              subject: toNullableString(message.envelope?.subject),
              from: parseAddressLine(message.envelope?.from),
              email_date: (message.internalDate ?? message.envelope?.date ?? null)?.toISOString() ?? null,
              seen: hasSeenFlag(message.flags),
              attachment_count: attachmentCount,
              pdf_hashes: pdfHashes,
              ignored_pdf_count: ignoredPdfCount,
            });
          }

          const existingHashes = await loadExistingPdfHashes(supabase, allHashes);
          const messages = drafts.map((draft) => {
            const missingPdfCount = draft.pdf_hashes.reduce(
              (acc, hash) => acc + (existingHashes.has(hash) ? 0 : 1),
              0,
            );
            return {
              uid: draft.uid,
              message_id: draft.message_id,
              subject: draft.subject,
              from: draft.from,
              email_date: draft.email_date,
              seen: draft.seen,
              has_attachments: draft.attachment_count > 0,
              attachment_count: draft.attachment_count,
              has_pdf_missing_in_db: missingPdfCount > 0,
              missing_pdf_count: missingPdfCount,
              ignored_pdf_count: draft.ignored_pdf_count,
            };
          });

          return jsonResponse(req, {
            success: true,
            checked_at: new Date().toISOString(),
            timeframe: {
              since_imap: timeframe.sinceImap,
              since_iso: timeframe.sinceIso,
              timezone: timeframe.timezone,
              mailbox: config.mailbox,
            },
            pagination: {
              has_more: currentPage < totalPages,
              next_cursor_uid: null,
              current_page: currentPage,
              total_pages: totalPages,
              total_messages: totalMessages,
              page_size: timeframe.pageSize,
            },
            messages,
          });
        } finally {
          await client.logout().catch(() => undefined);
        }
      }

      if (action === "detail") {
        const requestedUid = toPositiveInt((body as ReviewDetailRequestBody).uid);
        if (!requestedUid) return jsonResponse(req, { error: "uid es obligatorio para action=detail" }, 400);
        const messageId = toNullableString((body as ReviewDetailRequestBody).message_id);
        const client = createImapClient(imapConfig);
        await client.connect();
        try {
          await client.mailboxOpen(config.mailbox, { readOnly: true });
          let fetched = await client.fetchOne(
            String(requestedUid),
            { uid: true, envelope: true, internalDate: true, flags: true, source: true },
            { uid: true },
          ) as FetchedMessage | false;

          if (!fetched && messageId) {
            const fallbackUid = await findUidByMessageIdInRecentMessages(client, messageId);
            if (fallbackUid) {
              fetched = await client.fetchOne(
                String(fallbackUid),
                { uid: true, envelope: true, internalDate: true, flags: true, source: true },
                { uid: true },
              ) as FetchedMessage | false;
            }
          }

          if (!fetched || typeof fetched !== "object") {
            return jsonResponse(req, { error: `No se encontró el correo con uid ${requestedUid}` }, 404);
          }

          const finalUid = toPositiveInt(fetched.uid) ?? requestedUid;
          const sourceBytes = normalizeContentToUint8Array(fetched.source);
          if (!sourceBytes) {
            return jsonResponse(req, { error: `No se encontró el correo con uid ${requestedUid}` }, 404);
          }

          const senderEmail = extractEmails(parseAddressLine(fetched.envelope?.from))[0] ?? null;
          const resolvedClient = await erpResolver.resolveBySenderEmail(senderEmail);
          const [filtersMap, visibleClienteIds] = await Promise.all([
            loadClientePdfFiltersMap(
              supabase,
              resolvedClient?.clienteid ? [resolvedClient.clienteid] : [],
              config.filterScope,
            ),
            loadVisibleClienteIds(supabase, config.filterScope),
          ]);
          const suppressPendingByVisibility = shouldSuppressPendingByVisibility(resolvedClient, visibleClienteIds);
          const filters = resolvedClient?.clienteid ? filtersMap.get(resolvedClient.clienteid) ?? emptyClientePdfFilters() : emptyClientePdfFilters();

          const parser = new PostalMime();
          const parsed = await parser.parse(sourceBytes);
          const parsedAttachments = Array.isArray((parsed as { attachments?: unknown[] }).attachments)
            ? ((parsed as { attachments: unknown[] }).attachments as ParsedAttachment[])
            : [];
          const hashes: string[] = [];
          if (!suppressPendingByVisibility) {
            for (const attachment of parsedAttachments) {
              if (!isPdfAttachment(attachment)) continue;
              if (evaluatePdfIgnoreByName(toNullableString(attachment.filename), filters).ignored) continue;
              const contentBytes = normalizeContentToUint8Array(attachment.content);
              if (!contentBytes || contentBytes.byteLength === 0) continue;
              hashes.push(await computeHashFromBytes(contentBytes));
            }
          }
          const existingHashes = await loadExistingPdfHashes(supabase, hashes);
          const detail = await parseAttachmentsForDetail(sourceBytes, filters, existingHashes, {
            suppressPdfPending: suppressPendingByVisibility,
          });

          return jsonResponse(req, {
            success: true,
            checked_at: new Date().toISOString(),
            message: {
              uid: finalUid,
              subject: toNullableString(fetched.envelope?.subject),
              from: parseAddressLine(fetched.envelope?.from),
              to: parseAddressLine(fetched.envelope?.to),
              cc: parseAddressLine(fetched.envelope?.cc),
              date: (fetched.internalDate ?? fetched.envelope?.date ?? null)?.toISOString() ?? null,
              seen: hasSeenFlag(fetched.flags),
              body_text: detail.bodyText,
              body_html: detail.bodyHtml,
              attachments: detail.attachments,
            },
          });
        } finally {
          await client.logout().catch(() => undefined);
        }
      }

      const requestedUid = toPositiveInt((body as ReviewSetSeenRequestBody).uid);
      if (!requestedUid) return jsonResponse(req, { error: "uid es obligatorio para action=set_seen" }, 400);
      const seen = toBoolean((body as ReviewSetSeenRequestBody).seen);
      if (seen === null) return jsonResponse(req, { error: "seen debe ser boolean para action=set_seen" }, 400);
      const messageId = toNullableString((body as ReviewSetSeenRequestBody).message_id);

      const client = createImapClient(imapConfig);
      await client.connect();
      try {
        const mailboxLock = await client.getMailboxLock(config.mailbox);
        try {
          let fetched = await client.fetchOne(String(requestedUid), { uid: true, flags: true }, { uid: true }) as FlagsFetchedMessage | false;
          if (!fetched && messageId) {
            const fallbackUid = await findUidByMessageIdInRecentMessages(client, messageId);
            if (fallbackUid) {
              fetched = await client.fetchOne(String(fallbackUid), { uid: true, flags: true }, { uid: true }) as FlagsFetchedMessage | false;
            }
          }

          if (!fetched || typeof fetched !== "object") {
            return jsonResponse(req, { error: `No se encontró el correo con uid ${requestedUid}` }, 404);
          }

          const finalUid = toPositiveInt(fetched.uid) ?? requestedUid;
          if (seen) await client.messageFlagsAdd(finalUid, ["\\Seen"], { uid: true });
          else await client.messageFlagsRemove(finalUid, ["\\Seen"], { uid: true });

          const updated = await client.fetchOne(String(finalUid), { uid: true, flags: true }, { uid: true }) as FlagsFetchedMessage | false;
          return jsonResponse(req, {
            success: true,
            checked_at: new Date().toISOString(),
            message: {
              uid: finalUid,
              seen: updated && typeof updated === "object" ? hasSeenFlag(updated.flags) : seen,
            },
          });
        } finally {
          mailboxLock.release();
        }
      } finally {
        await client.logout().catch(() => undefined);
      }
    } catch (error) {
      const details = getErrorMessage(error);
      if (details.startsWith("Missing required env var:")) {
        return jsonResponse(req, { error: config.missingConfigText, details }, 500);
      }

      const lowerDetails = details.toLowerCase();
      if (
        lowerDetails.includes("authenticationfailed") ||
        lowerDetails.includes("invalid credentials") ||
        lowerDetails.includes("login failed")
      ) {
        return jsonResponse(req, { error: config.invalidCredsText, details }, 500);
      }
      if (lowerDetails.includes("timeout")) {
        return jsonResponse(req, { error: config.timeoutText, details }, 504);
      }

      console.error(JSON.stringify({ service: config.functionName, stage: "unhandled_error", details }));
      return jsonResponse(req, { error: "Internal server error", details }, 500);
    }
  });
};
