import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DEFAULT_WEBHOOK_URL = "https://vps1io.karmaia.app/webhook/entrada_pedidos_agroiris";
const DEFAULT_EXP_SECONDS = 300;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const parseExpSeconds = (rawValue: string | undefined) => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_EXP_SECONDS;
  return Math.floor(parsed);
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const encodeBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const encodeBytesBase64Url = (bytes: Uint8Array): string =>
  bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const signJwtHs256 = async ({
  secret,
  expSeconds,
  issuer,
  audience,
}: {
  secret: string;
  expSeconds: number;
  issuer?: string;
  audience?: string;
}) => {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iat: nowInSeconds,
    exp: nowInSeconds + expSeconds,
  };

  if (issuer?.trim()) payload.iss = issuer.trim();
  if (audience?.trim()) payload.aud = audience.trim();

  const headerBase64Url = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadBase64Url = encodeBase64Url(JSON.stringify(payload));
  const unsignedToken = `${headerBase64Url}.${payloadBase64Url}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsignedToken));
  const signatureBase64Url = encodeBytesBase64Url(new Uint8Array(signature));
  return `${unsignedToken}.${signatureBase64Url}`;
};

const createJsonResponse = (payload: unknown, status: number) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return createJsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const jwtSecret = Deno.env.get("N8N_AGROIRIS_WEBHOOK_JWT_SECRET")?.trim();
    if (!jwtSecret) {
      return createJsonResponse(
        { error: "N8N_AGROIRIS_WEBHOOK_JWT_SECRET no configurado." },
        500,
      );
    }

    const webhookUrl = Deno.env.get("N8N_AGROIRIS_WEBHOOK_URL")?.trim() || DEFAULT_WEBHOOK_URL;
    const expSeconds = parseExpSeconds(Deno.env.get("N8N_AGROIRIS_WEBHOOK_JWT_EXP_SECONDS"));
    const issuer = Deno.env.get("N8N_AGROIRIS_WEBHOOK_JWT_ISS")?.trim();
    const audience = Deno.env.get("N8N_AGROIRIS_WEBHOOK_JWT_AUD")?.trim();

    const payload = await req.json();
    if (!Array.isArray(payload) || payload.length === 0) {
      return createJsonResponse({ error: "Payload inválido: se esperaba un array no vacío." }, 422);
    }

    const jwt = await signJwtHs256({
      secret: jwtSecret,
      expSeconds,
      issuer,
      audience,
    });

    const upstreamResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const upstreamBody = await upstreamResponse.text();
    const upstreamContentType = upstreamResponse.headers.get("content-type") || "application/json";

    return new Response(upstreamBody, {
      status: upstreamResponse.status,
      headers: {
        ...corsHeaders,
        "Content-Type": upstreamContentType,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return createJsonResponse({ error: message }, 500);
  }
});
