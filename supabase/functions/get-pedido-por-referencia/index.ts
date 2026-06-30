import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse(
        { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.json();

    const clienteid = body?.clienteid;
    const referenciaCliente = (body?.referencia_cliente ?? body?.referenciacliente ?? "")
      .toString()
      .trim();

    if (!clienteid || !referenciaCliente) {
      return jsonResponse(
        { error: "clienteid y referencia_cliente son obligatorios" },
        400,
      );
    }

    const { data: pedidos, error: pedidoError } = await supabase
      .from("pedidos")
      .select("id, clienteid, referencia_cliente, fecha_pedido, fecha_carga, created_at")
      .eq("clienteid", clienteid)
      .eq("referencia_cliente", referenciaCliente)
      .order("id", { ascending: false });

    if (pedidoError) {
      console.error("Error fetching pedido:", pedidoError);
      return jsonResponse(
        { error: "No se pudo obtener el pedido", details: pedidoError.message },
        500,
      );
    }

    if (!pedidos || pedidos.length === 0) {
      return jsonResponse(
        {
          error: "Pedido no encontrado con los criterios dados",
          filters: { clienteid, referencia_cliente: referenciaCliente },
        },
        404,
      );
    }

    if (pedidos.length > 1) {
      return jsonResponse(
        {
          error: "Se encontraron múltiples pedidos, refine los filtros",
          filters: { clienteid, referencia_cliente: referenciaCliente },
          coincidencias: pedidos.length,
          pedido_ids: pedidos.map((p) => p.id),
        },
        409,
      );
    }

    const pedido = pedidos[0];

    const { data: lineas, error: lineasError } = await supabase
      .from("pedido_linea")
      .select("pedidodetid, pedidoid, descripcion_salida, numero_palet")
      .eq("pedidoid", pedido.id)
      .order("pedidodetid", { ascending: true });

    if (lineasError) {
      console.error("Error fetching lineas:", lineasError);
      return jsonResponse(
        { error: "No se pudieron obtener las lineas", details: lineasError.message },
        500,
      );
    }

    const lineasResumen = (lineas ?? []).map((linea) => ({
      descripcion_salida: linea.descripcion_salida ?? "",
      numero_palet: linea.numero_palet ?? null,
    }));

    return jsonResponse({
      pedido: {
        id: pedido.id,
        clienteid: pedido.clienteid,
        referencia_cliente: pedido.referencia_cliente,
        fecha_pedido: pedido.fecha_pedido,
        fecha_carga: pedido.fecha_carga,
      },
      lineas: lineasResumen,
    });
  } catch (error) {
    console.error("Server error:", error);
    return jsonResponse(
      { error: "Internal server error", details: (error as Error).message },
      500,
    );
  }
});
