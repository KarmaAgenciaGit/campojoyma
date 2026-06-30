import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const toNullableNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

type PedidoLookupRow = {
  id: number;
  clienteid: number | null;
  referencia_cliente: string | null;
  referencia2_cliente: string | null;
  created_at: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }

    const referencia = (
      body?.referencia ??
      body?.referencia_cliente ??
      body?.referenciacliente ??
      url.searchParams.get("referencia") ??
      url.searchParams.get("referencia_cliente") ??
      url.searchParams.get("referenciacliente") ??
      ""
    )
      .toString()
      .trim();

    const clienteid = toNullableNumber(
      body?.clienteid ?? body?.cliente_id ?? url.searchParams.get("clienteid"),
    );

    if (!referencia) {
      return jsonResponse({ error: "referencia es obligatoria" }, 400);
    }

    const baseSelect = "id, clienteid, referencia_cliente, referencia2_cliente, created_at";

    let q1 = supabase
      .from("pedidos")
      .select(baseSelect)
      .eq("referencia_cliente", referencia)
      .limit(10);

    let q2 = supabase
      .from("pedidos")
      .select(baseSelect)
      .eq("referencia2_cliente", referencia)
      .limit(10);

    if (clienteid !== null) {
      q1 = q1.eq("clienteid", clienteid);
      q2 = q2.eq("clienteid", clienteid);
    }

    const [r1, r2] = await Promise.all([q1, q2]);
    if (r1.error) {
      return jsonResponse(
        { error: "No se pudo consultar pedidos por referencia_cliente", details: r1.error.message },
        500,
      );
    }
    if (r2.error) {
      return jsonResponse(
        { error: "No se pudo consultar pedidos por referencia2_cliente", details: r2.error.message },
        500,
      );
    }

    const map = new Map<number, PedidoLookupRow>();
    for (const row of [...(r1.data ?? []), ...(r2.data ?? [])] as PedidoLookupRow[]) {
      map.set(row.id, row);
    }

    const matches = Array.from(map.values()).sort((a, b) => b.id - a.id);

    return jsonResponse({
      success: true,
      referencia,
      clienteid,
      exists: matches.length > 0,
      coincidencias: matches.length,
      pedido_ids: matches.map((m) => m.id),
      pedido: matches[0] ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: "Internal server error", details: message }, 500);
  }
});

