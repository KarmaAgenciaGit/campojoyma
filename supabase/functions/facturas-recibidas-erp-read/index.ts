import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  corsHeaders,
  getERPReadAuthorizedRoutes,
  integerValue,
  isAllowedERPConsulta,
  jsonResponse,
  parseJsonResponse,
  requestIdValue,
  requireRouteUser,
  signJwtHs256,
  upstreamResult,
} from "../_shared/facturas-recibidas-erp.ts";

const DEFAULT_READ_WEBHOOK_URL = "https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma";
const DEFAULT_EXP_SECONDS = 300;

const parseExpSeconds = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_EXP_SECONDS;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const contractVersion = integerValue(body.contract_version, null);
    if (contractVersion !== null && contractVersion !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return jsonResponse({ error: "contract_version no soportada" }, 422);
    }
    const requestId = contractVersion === FACTURAS_RECIBIDAS_CONTRACT_VERSION
      ? requestIdValue(body.request_id)
      : null;
    const consulta = String(body.consulta ?? "").trim();
    if (!isAllowedERPConsulta(consulta)) {
      return jsonResponse({ error: "Consulta no permitida." }, 422);
    }
    const auth = await requireRouteUser(req, getERPReadAuthorizedRoutes(consulta));
    if (!auth.ok) return auth.response;

    const jwtSecret = Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET")?.trim();
    if (!jwtSecret) return jsonResponse({ error: "N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET no configurado." }, 500);

    const webhookUrl =
      Deno.env.get("N8N_CAMPOJOYMA_READ_WEBHOOK_URL")?.trim() ||
      Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_URL")?.trim() ||
      DEFAULT_READ_WEBHOOK_URL;
    const jwt = await signJwtHs256(
      jwtSecret,
      parseExpSeconds(Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS")),
    );

    const url = new URL(webhookUrl);
    url.searchParams.set("consulta", consulta);
    const upstream = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(30_000),
    });
    const { payload } = await parseJsonResponse(upstream);
    const result = upstreamResult(upstream, payload);
    const responseStatus = upstream.ok && !result.ok ? 502 : upstream.status;

    if (contractVersion === FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          ok: result.ok,
          data: payload,
        },
        responseStatus,
      );
    }
    return jsonResponse(payload, responseStatus);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    return jsonResponse({ error: message }, status);
  }
});
