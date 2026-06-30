import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { ImapFlow } from "npm:imapflow@1.0.179";
import PostalMime from "npm:postal-mime@2.4.4";

type ReviewRequestBody = {
  since_imap?: string;
  since_iso?: string;
  timezone?: string;
  mailbox?: string;
  only_seen?: boolean;
  cursor_uid?: number;
};

type MailboxAddress = { name?: string; address?: string };

type FetchedMessage = {
  uid?: number;
  envelope?: {
    subject?: string;
    from?: MailboxAddress[];
    messageId?: string;
    date?: Date;
  };
  internalDate?: Date;
  source?: unknown;
};

type ParsedAttachment = {
  filename?: string;
  mimeType?: string;
  contentType?: string;
  content?: unknown;
};

type CallerRoleAccessRow = {
  role: string | null;
  allowed_routes: string[] | null;
};

type ArchivoPdfRow = {
  id: number;
  hash_sha256: string;
  nombre_archivo: string | null;
  created_at: string;
};

type ClienteVisibleRow = { clienteid: number | null };

type ComparableAttachment = {
  filename: string | null;
  subject: string | null;
  from: string | null;
  sender_email: string;
  clienteid: number;
  cliente_nombre: string | null;
  email_date: string | null;
  message_id: string | null;
  uid: string | null;
  mime_type: string | null;
  hash_sha256: string;
};

type ErpLoginResponse = { token?: string };

type ErpContactoRow = {
  clienteid?: number | string | null;
  cliente?: string | null;
  dato?: string | null;
  tipo_dato?: string | null;
  persona_contacto?: string | null;
};

type ResolvedCliente = {
  sender_email: string;
  clienteid: number;
  cliente_nombre: string | null;
};

type SenderResolution =
  | { eligible: true; sender_email: string; clienteid: number; cliente_nombre: string | null }
  | { eligible: false; reason: "no_sender_email" | "no_cliente" | "cliente_no_visible" };

type ErpContactoIndexed = {
  row: ErpContactoRow;
  datoNorm: string;
  tipoNorm: string;
  personaNorm: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SEARCH_FILE_ALLOWED_ROUTES = new Set(["/buscar-archivo", "/admin/buscar-archivo"]);
const SALES_MAILBOX = "INBOX";
const SALES_VISIBILITY_TABLE = "clientes_visibles_cuentaventa";

const ERP_IP = "46.24.40.100";
const ERP_LOGIN_URL = `http://${ERP_IP}:7001/api/login/Login`;
const ERP_CONTACTOS_URL = `http://${ERP_IP}:7000/api/cliente/clientecontactoinforme`;
const ERP_LOGIN_BODY = { login: "ORIZON", password: "ORIZON" };
const ERP_LOGIN_TIMEOUT_MS = 3_000;
const ERP_CONTACTOS_TIMEOUT_MS = 6_000;
const ERP_CONTACTOS_TTL_MS = 5 * 60 * 1000;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TEXT_ENCODER = new TextEncoder();

let ERP_TOKEN_CACHE: string | null = null;
let ERP_CONTACTOS_CACHE: ErpContactoRow[] | null = null;
let ERP_CONTACTOS_CACHE_AT = 0;
let ERP_CONTACTOS_INDEX_CACHE: ErpContactoIndexed[] | null = null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const getEnvOrThrow = (key: string) => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing required env var: ${key}`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`Missing required env var: ${key}`);
  return normalized;
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

const toNullableString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized === "" ? null : normalized;
};

const normalizePath = (path: string) => {
  const clean = path.split("?")[0].replace(/\/+$/, "");
  return clean === "" ? "/" : clean;
};

const hasSearchFileAccess = (allowedRoutes: unknown): boolean => {
  if (!Array.isArray(allowedRoutes)) return false;
  return allowedRoutes.some((route) =>
    typeof route === "string" && SEARCH_FILE_ALLOWED_ROUTES.has(normalizePath(route))
  );
};

const parseBooleanEnv = (value: string | undefined, defaultValue: boolean) => {
  if (!value) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
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

const getUserIdFromAuthHeader = (authHeader: string): string | null => {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadBase64 + "=".repeat((4 - (payloadBase64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof payload?.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
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
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const getDateStartPayload = (body: ReviewRequestBody) => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const defaultSinceImap = `${start.getDate()}-${months[start.getMonth()]}-${start.getFullYear()}`;

  const sinceImap = toNullableString(body?.since_imap) ?? defaultSinceImap;
  const sinceIso = toNullableString(body?.since_iso) ?? start.toISOString();
  const timezone = toNullableString(body?.timezone) ?? "UTC";
  const onlySeen = typeof body?.only_seen === "boolean"
    ? body.only_seen
    : parseBooleanEnv(getEnvFirst(["IMAP_SALES_ONLY_SEEN", "IMAP_CUENTAS_VENTA_ONLY_SEEN"]), true);

  const parsedSinceIso = new Date(sinceIso);
  const parsedSinceImap = parseImapDateString(sinceImap);
  const sinceDate = !Number.isNaN(parsedSinceIso.getTime())
    ? parsedSinceIso
    : parsedSinceImap ?? start;

  return {
    sinceImap,
    sinceIso,
    timezone,
    mailbox: SALES_MAILBOX,
    onlySeen,
    sinceDate,
  };
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

const extractEmails = (value: unknown): string[] => {
  if (!value) return [];
  const matches = String(value).match(EMAIL_RE);
  return matches ? matches.map((email) => email.toLowerCase()) : [];
};

const toPositiveInt = (value: unknown): number | null => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
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

const parseFromAddresses = (from: MailboxAddress[] | undefined): string | null => {
  if (!Array.isArray(from) || from.length === 0) return null;
  const labels = from
    .map((entry) => {
      const address = toNullableString(entry?.address);
      const name = toNullableString(entry?.name);
      if (name && address) return `${name} <${address}>`;
      return address ?? name;
    })
    .filter((entry): entry is string => Boolean(entry));

  return labels.length > 0 ? labels.join(", ") : null;
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
    for (let i = 0; i < value.length; i += 1) {
      bytes[i] = value.charCodeAt(i) & 0xff;
    }
    return bytes;
  }
  return null;
};

const isPdfAttachment = (attachment: ParsedAttachment) => {
  const filename = toNullableString(attachment.filename);
  const mimeType = toNullableString(attachment.mimeType ?? attachment.contentType);
  const hasPdfExtension = filename ? filename.toLowerCase().endsWith(".pdf") : false;
  const isPdfMime = mimeType ? mimeType.toLowerCase().includes("pdf") : false;
  return hasPdfExtension || isPdfMime;
};

const computeHashFromBase64 = async (base64Value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", TEXT_ENCODER.encode(base64Value));
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const chunkArray = <T>(values: T[], chunkSize: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
};

const createErpResolver = async () => {
  let erpToken: string | null = ERP_TOKEN_CACHE;
  const now = Date.now();
  let contactosCache: ErpContactoRow[] | null =
    ERP_CONTACTOS_CACHE && now - ERP_CONTACTOS_CACHE_AT < ERP_CONTACTOS_TTL_MS
      ? ERP_CONTACTOS_CACHE
      : null;
  let contactosIndexCache: ErpContactoIndexed[] | null =
    contactosCache && ERP_CONTACTOS_INDEX_CACHE
      ? ERP_CONTACTOS_INDEX_CACHE
      : null;
  const senderCache = new Map<string, ResolvedCliente | null>();

  const erpLogin = async (): Promise<string> => {
    if (erpToken) return erpToken;
    const response = await fetchWithTimeout(
      ERP_LOGIN_URL,
      {
        method: "POST",
        headers: {
          accept: "text/plain",
          "Content-Type": "application/json",
        },
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
    ERP_TOKEN_CACHE = token;
    return token;
  };

  const erpGetContactos = async (): Promise<ErpContactoRow[]> => {
    if (contactosCache) return contactosCache;
    const token = await erpLogin();
    const response = await fetchWithTimeout(
      ERP_CONTACTOS_URL,
      {
        method: "GET",
        headers: {
          accept: "text/plain",
          Authorization: `Bearer ${token}`,
        },
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
    ERP_CONTACTOS_CACHE = contactosCache;
    ERP_CONTACTOS_CACHE_AT = Date.now();
    ERP_CONTACTOS_INDEX_CACHE = null;
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
    ERP_CONTACTOS_INDEX_CACHE = contactosIndexCache;
    return contactosIndexCache;
  };

  const resolveBySenderEmail = async (senderEmail: string): Promise<ResolvedCliente | null> => {
    const emailLower = senderEmail.toLowerCase();
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

const fetchComparableAttachmentsFromImap = async (params: {
  host: string;
  port: number;
  secure: boolean;
  tlsRejectUnauthorized: boolean;
  user: string;
  pass: string;
  mailbox: string;
  onlySeen: boolean;
  sinceDate: Date;
  cursorUid: number | null;
  maxMessages: number;
  resolveSender: (senderEmail: string | null) => Promise<SenderResolution>;
}): Promise<{
  comparable: ComparableAttachment[];
  receivedItems: number;
  skippedNonPdf: number;
  skippedWithoutHash: number;
  excludedNoCliente: number;
  excludedClienteNoVisible: number;
  hasMore: boolean;
  nextCursorUid: number | null;
  processedMessages: number;
  remainingMessages: number;
}> => {
  const client = new ImapFlow({
    host: params.host,
    port: params.port,
    secure: params.secure,
    auth: { user: params.user, pass: params.pass },
    tls: { rejectUnauthorized: params.tlsRejectUnauthorized },
    logger: false,
  });

  const comparable: ComparableAttachment[] = [];
  let receivedItems = 0;
  let skippedNonPdf = 0;
  let skippedWithoutHash = 0;
  let excludedNoCliente = 0;
  let excludedClienteNoVisible = 0;
  let hasMore = false;
  let nextCursorUid: number | null = null;
  let processedMessages = 0;
  let remainingMessages = 0;

  await client.connect();
  try {
    await client.mailboxOpen(params.mailbox, { readOnly: true });
    const searchQuery = params.onlySeen ? { seen: true, since: params.sinceDate } : { since: params.sinceDate };
    const uids = await client.search(searchQuery);
    const sortedUids = Array.isArray(uids) ? [...uids].sort((a, b) => a - b) : [];
    const cursorUid = params.cursorUid;
    const filteredUids = cursorUid ? sortedUids.filter((uid) => uid > cursorUid) : sortedUids;
    const maxMessages = Math.max(1, params.maxMessages);
    const batchUids = filteredUids.slice(0, maxMessages);
    hasMore = filteredUids.length > batchUids.length;
    nextCursorUid = hasMore && batchUids.length ? batchUids[batchUids.length - 1] : null;
    processedMessages = batchUids.length;
    remainingMessages = Math.max(0, filteredUids.length - batchUids.length);

    if (!uids || uids.length === 0) {
      return {
        comparable,
        receivedItems,
        skippedNonPdf,
        skippedWithoutHash,
        excludedNoCliente,
        excludedClienteNoVisible,
        hasMore,
        nextCursorUid,
        processedMessages,
        remainingMessages,
      };
    }
    if (batchUids.length === 0) {
      return {
        comparable,
        receivedItems,
        skippedNonPdf,
        skippedWithoutHash,
        excludedNoCliente,
        excludedClienteNoVisible,
        hasMore: false,
        nextCursorUid: null,
        processedMessages: 0,
        remainingMessages: 0,
      };
    }

    for await (
      const messageRaw of client.fetch(batchUids, {
        uid: true,
        envelope: true,
        internalDate: true,
        source: true,
      })
    ) {
      const message = messageRaw as FetchedMessage;
      const messageSource = normalizeContentToUint8Array(message.source);
      if (!messageSource) continue;

      const parser = new PostalMime();
      const parsed = await parser.parse(messageSource);
      const attachments = Array.isArray((parsed as { attachments?: unknown[] }).attachments)
        ? ((parsed as { attachments: unknown[] }).attachments as ParsedAttachment[])
        : [];
      const from = parseFromAddresses(message.envelope?.from);
      const senderEmail = extractEmails(from)[0] ?? null;
      const senderResolution = await params.resolveSender(senderEmail);

      for (const attachment of attachments) {
        receivedItems += 1;
        if (!isPdfAttachment(attachment)) {
          skippedNonPdf += 1;
          continue;
        }
        if (!senderResolution.eligible) {
          if (senderResolution.reason === "cliente_no_visible") excludedClienteNoVisible += 1;
          else excludedNoCliente += 1;
          continue;
        }

        const contentBytes = normalizeContentToUint8Array(attachment.content);
        if (!contentBytes || contentBytes.length === 0) {
          skippedWithoutHash += 1;
          continue;
        }

        const base64Payload = encodeBase64(contentBytes);
        if (!base64Payload) {
          skippedWithoutHash += 1;
          continue;
        }

        comparable.push({
          filename: toNullableString(attachment.filename),
          subject: toNullableString(message.envelope?.subject),
          from,
          sender_email: senderResolution.sender_email,
          clienteid: senderResolution.clienteid,
          cliente_nombre: senderResolution.cliente_nombre,
          email_date: (message.internalDate ?? message.envelope?.date ?? null)?.toISOString() ?? null,
          message_id: toNullableString(message.envelope?.messageId),
          uid: message.uid ? String(message.uid) : null,
          mime_type: toNullableString(attachment.mimeType ?? attachment.contentType),
          hash_sha256: await computeHashFromBase64(base64Payload),
        });
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  return {
    comparable,
    receivedItems,
    skippedNonPdf,
    skippedWithoutHash,
    excludedNoCliente,
    excludedClienteNoVisible,
    hasMore,
    nextCursorUid,
    processedMessages,
    remainingMessages,
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = getEnvOrThrow("SUPABASE_URL");
    const serviceRoleKey = getEnvOrThrow("SUPABASE_SERVICE_ROLE_KEY");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    let body: ReviewRequestBody = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { sinceImap, sinceIso, timezone, mailbox, onlySeen, sinceDate } = getDateStartPayload(body);
    const cursorUid = toPositiveInt((body as { cursor_uid?: unknown } | null)?.cursor_uid);
    const configuredMaxMessages = Number(
      getEnvFirst(["IMAP_SALES_PENDING_MAX_MESSAGES", "IMAP_CUENTAS_VENTA_PENDING_MAX_MESSAGES"]) ?? "8",
    );
    const maxMessages = Number.isFinite(configuredMaxMessages) && configuredMaxMessages > 0
      ? Math.floor(configuredMaxMessages)
      : 8;

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const callerUserId = getUserIdFromAuthHeader(authHeader);
    if (!callerUserId) return jsonResponse({ error: "No autorizado" }, 401);

    const { data: callerRole, error: roleError } = await supabase
      .from("user_roles")
      .select("role, allowed_routes")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (roleError) return jsonResponse({ error: "No autorizado para revisar cuentas de venta pendientes" }, 403);

    const typedRole = (callerRole ?? null) as CallerRoleAccessRow | null;
    const isAdmin = typedRole?.role === "admin";
    const hasRouteAccess = hasSearchFileAccess(typedRole?.allowed_routes);
    if (!isAdmin && !hasRouteAccess) {
      return jsonResponse({ error: "No autorizado para revisar cuentas de venta pendientes" }, 403);
    }

    const imapHost = getEnvFirstOrThrow(["IMAP_SALES_HOST", "IMAP_CUENTAS_VENTA_HOST"]);
    const imapUser = getEnvFirstOrThrow(["IMAP_SALES_USER", "IMAP_CUENTAS_VENTA_USER"]);
    const imapPass = getEnvFirstOrThrow(["IMAP_SALES_PASS", "IMAP_CUENTAS_VENTA_PASS"]);
    const imapPort = Number(getEnvFirst(["IMAP_SALES_PORT", "IMAP_CUENTAS_VENTA_PORT"]) ?? "993");
    if (!Number.isFinite(imapPort) || imapPort <= 0) return jsonResponse({ error: "IMAP_SALES_PORT inválido" }, 500);
    const imapSecure = parseBooleanEnv(
      getEnvFirst(["IMAP_SALES_SECURE", "IMAP_SALES_TLS", "IMAP_CUENTAS_VENTA_SECURE", "IMAP_CUENTAS_VENTA_TLS"]),
      true,
    );
    const imapTlsRejectUnauthorized = parseBooleanEnv(
      getEnvFirst(["IMAP_SALES_TLS_REJECT_UNAUTHORIZED", "IMAP_CUENTAS_VENTA_TLS_REJECT_UNAUTHORIZED"]),
      true,
    );

    const visiblePromise = supabase.from(SALES_VISIBILITY_TABLE).select("clienteid");
    const erpPromise = createErpResolver();
    const [visibleResult, erpResolver] = await Promise.all([visiblePromise, erpPromise]);

    const { data: visibleRows, error: visibleError } = visibleResult;
    if (visibleError) {
      return jsonResponse(
        {
          error: "No se pudo cargar clientes visibles para cuentas de venta",
          details: visibleError.message,
        },
        500,
      );
    }

    const visibleClienteIds = new Set<number>();
    (visibleRows as ClienteVisibleRow[] | null ?? []).forEach((row) => {
      const clienteid = toPositiveInt((row as { clienteid?: unknown } | null)?.clienteid);
      if (clienteid) visibleClienteIds.add(clienteid);
    });

    const senderResolutionCache = new Map<string, SenderResolution>();
    const ERP_RESOLUTION_PREFIX = "ERP_RESOLUTION_FAILED:";
    const resolveSender = async (senderEmail: string | null): Promise<SenderResolution> => {
      if (!senderEmail) return { eligible: false, reason: "no_sender_email" };

      const emailLower = senderEmail.toLowerCase();
      const cached = senderResolutionCache.get(emailLower);
      if (cached) return cached;

      let resolvedCliente: ResolvedCliente | null;
      try {
        resolvedCliente = await erpResolver.resolveBySenderEmail(emailLower);
      } catch (error) {
        throw new Error(`${ERP_RESOLUTION_PREFIX}${getErrorMessage(error)}`);
      }

      if (!resolvedCliente) {
        const result: SenderResolution = { eligible: false, reason: "no_cliente" };
        senderResolutionCache.set(emailLower, result);
        return result;
      }

      if (!visibleClienteIds.has(resolvedCliente.clienteid)) {
        const result: SenderResolution = { eligible: false, reason: "cliente_no_visible" };
        senderResolutionCache.set(emailLower, result);
        return result;
      }

      const result: SenderResolution = {
        eligible: true,
        sender_email: resolvedCliente.sender_email,
        clienteid: resolvedCliente.clienteid,
        cliente_nombre: resolvedCliente.cliente_nombre,
      };
      senderResolutionCache.set(emailLower, result);
      return result;
    };

    let imapResult: Awaited<ReturnType<typeof fetchComparableAttachmentsFromImap>>;
    try {
      imapResult = await fetchComparableAttachmentsFromImap({
        host: imapHost,
        port: imapPort,
        secure: imapSecure,
        tlsRejectUnauthorized: imapTlsRejectUnauthorized,
        user: imapUser,
        pass: imapPass,
        mailbox,
        onlySeen,
        sinceDate,
        cursorUid,
        maxMessages,
        resolveSender,
      });
    } catch (error) {
      const message = getErrorMessage(error);
      if (message.startsWith(ERP_RESOLUTION_PREFIX)) {
        return jsonResponse(
          {
            error: "No se pudo resolver cliente por remitente (ERP)",
            details: message.slice(ERP_RESOLUTION_PREFIX.length),
          },
          500,
        );
      }
      throw error;
    }

    const {
      comparable,
      receivedItems,
      skippedNonPdf,
      skippedWithoutHash,
      excludedNoCliente,
      excludedClienteNoVisible,
      hasMore,
      nextCursorUid,
      processedMessages,
      remainingMessages,
    } = imapResult;
    const eligibleComparable = comparable;

    const uniqueHashes = Array.from(new Set(eligibleComparable.map((item) => item.hash_sha256)));
    const archivosByHash = new Map<string, ArchivoPdfRow>();

    if (uniqueHashes.length > 0) {
      for (const hashChunk of chunkArray(uniqueHashes, 300)) {
        const { data: existingRows, error: existingError } = await supabase
          .from("archivos_pdf")
          .select("id, hash_sha256, nombre_archivo, created_at")
          .in("hash_sha256", hashChunk);

        if (existingError) {
          return jsonResponse({ error: "No se pudo comparar contra archivos_pdf", details: existingError.message }, 500);
        }

        (existingRows ?? []).forEach((row) => {
          const typed = row as ArchivoPdfRow;
          if (!archivosByHash.has(typed.hash_sha256)) archivosByHash.set(typed.hash_sha256, typed);
        });
      }
    }

    const comparedItems = eligibleComparable.map((item) => {
      const matched = archivosByHash.get(item.hash_sha256) ?? null;
      return {
        ...item,
        exists_in_db: Boolean(matched),
        archivo_pdf_id: matched?.id ?? null,
        archivo_pdf_nombre: matched?.nombre_archivo ?? null,
        archivo_pdf_created_at: matched?.created_at ?? null,
      };
    });

    const pendingItems = comparedItems.filter((item) => !item.exists_in_db);
    const foundItems = comparedItems.filter((item) => item.exists_in_db);

    console.log(
      JSON.stringify({
        service: "review-imap-pending-sales-accounts",
        received_items: receivedItems,
        pdf_candidates: comparable.length,
        eligible_after_cliente_filter: eligibleComparable.length,
        excluded_no_cliente: excludedNoCliente,
        excluded_cliente_no_visible: excludedClienteNoVisible,
        compared: comparedItems.length,
        missing_in_db: pendingItems.length,
        processed_messages: processedMessages,
        remaining_messages: remainingMessages,
        has_more: hasMore,
        next_cursor_uid: nextCursorUid,
        mailbox,
      }),
    );

    return jsonResponse({
      success: true,
      checked_at: new Date().toISOString(),
      timeframe: {
        since_imap: sinceImap,
        since_iso: sinceIso,
        timezone,
        mailbox,
        only_seen: onlySeen,
      },
      totals: {
        received_items: receivedItems,
        pdf_candidates: comparable.length,
        skipped_non_pdf: skippedNonPdf,
        skipped_without_hash: skippedWithoutHash,
        eligible_after_cliente_filter: eligibleComparable.length,
        excluded_no_cliente: excludedNoCliente,
        excluded_cliente_no_visible: excludedClienteNoVisible,
        compared: comparedItems.length,
        found_in_db: foundItems.length,
        missing_in_db: pendingItems.length,
        processed_messages: processedMessages,
        remaining_messages: remainingMessages,
      },
      pagination: {
        has_more: hasMore,
        next_cursor_uid: nextCursorUid,
      },
      pending: pendingItems,
      found: foundItems,
    });
  } catch (error) {
    const details = getErrorMessage(error);
    if (
      details.startsWith("Missing required env var: IMAP_SALES_") ||
      details.startsWith("Missing required env var: IMAP_CUENTAS_VENTA_")
    ) {
      return jsonResponse({ error: "Configuración IMAP de cuentas de venta incompleta", details }, 500);
    }
    return jsonResponse({ error: "Internal server error", details }, 500);
  }
});
