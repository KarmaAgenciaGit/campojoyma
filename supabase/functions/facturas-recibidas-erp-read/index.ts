import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  jsonResponse,
  requireRouteUser,
  signJwtHs256,
} from "../_shared/facturas-recibidas-erp.ts";

const DEFAULT_READ_WEBHOOK_URL = "https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma";
const DEFAULT_EXP_SECONDS = 300;

const parseExpSeconds = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_EXP_SECONDS;
};

const isAllowedConsulta = (consulta: string) => {
  if (!consulta || consulta.startsWith("/") || /^https?:\/\//i.test(consulta) || consulta.includes("..")) {
    return false;
  }

  const [path] = consulta.split("?", 1);
  return (
    /^acreedores(?:\/\d+)?$/.test(path) ||
    path === "empresas" ||
    /^facturasrecibidas(?:\/\d+(?:\/ctb)?)?$/.test(path) ||
    path === "facturasrecibidas/tipos" ||
    path === "facturasrecibidas_ctb"
  );
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const consulta = String(body.consulta ?? "").trim();
    if (!isAllowedConsulta(consulta)) {
      return jsonResponse({ error: "Consulta no permitida." }, 422);
    }

    const jwtSecret = Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET")?.trim();
    if (!jwtSecret) return jsonResponse({ error: "N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET no configurado." }, 500);

    const webhookUrl =
      Deno.env.get("N8N_CAMPOJOYMA_READ_WEBHOOK_URL")?.trim() ||
      Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_URL")?.trim() ||
      DEFAULT_READ_WEBHOOK_URL;
    const jwt = await signJwtHs256(jwtSecret, parseExpSeconds(Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS")));

    const url = new URL(webhookUrl);
    url.searchParams.set("consulta", consulta);

    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    const upstreamText = await upstream.text();
    let payload: unknown = upstreamText;
    try {
      payload = JSON.parse(upstreamText);
    } catch {
      // Keep text response.
    }

    return jsonResponse(payload, upstream.status);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
