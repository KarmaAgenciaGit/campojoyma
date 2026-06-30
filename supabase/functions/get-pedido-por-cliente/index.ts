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
    const {
      clienteid,
      sujetodomicilioid_destino,
      fecha_carga,
      tipo_pedido,
    } = body ?? {};

    if (!clienteid || !sujetodomicilioid_destino || !fecha_carga) {
      return jsonResponse(
        {
          error:
            "clienteid, sujetodomicilioid_destino y fecha_carga son obligatorios",
        },
        400,
      );
    }

    // Buscar el pedido único por los tres filtros proporcionados.
    let pedidoQuery = supabase
      .from("pedidos")
      .select(
        "id, referencia_cliente, referencia2_cliente, fecha_carga, clienteid, clienteid_envio, sujetodomicilioid_destino, sujetodomicilioid_envio, pedidoclienteid, archivo_pdf_id, enviado, needs_sync, tipo_pedido",
      )
      .eq("clienteid", clienteid)
      .eq("sujetodomicilioid_destino", sujetodomicilioid_destino)
      .eq("fecha_carga", fecha_carga);

    if (tipo_pedido) {
      pedidoQuery = pedidoQuery.eq("tipo_pedido", tipo_pedido);
    }

    const { data: pedidos, error: pedidoError } = await pedidoQuery;

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
          filters: { clienteid, sujetodomicilioid_destino, fecha_carga },
        },
        404,
      );
    }

    if (pedidos.length > 1) {
      return jsonResponse(
        {
          error: "Se encontraron múltiples pedidos, refine los filtros",
          filters: {
            clienteid,
            sujetodomicilioid_destino,
            fecha_carga,
            tipo_pedido,
          },
          coincidencias: pedidos.length,
        },
        409,
      );
    }

    const pedido = pedidos[0];

    // Obtener líneas del pedido.
    const { data: lineas, error: lineasError } = await supabase
      .from("pedido_linea")
      .select(
        "pedidodetid, pedidoid, confeccionpaletid, catalogoconfecid, confeccionsalidaid, grupoconfeccionid, generoid, tipocultivoid, origenid, calibreid, bultos, descripcion_salida, bultosxpalet, numero_palet, piezasxbulto, total_piezas, catconfecpiezaid, kilosxbulto, kilos_cliente, catconfeckilosbultoid, created_at, updated_at, idpedidodet_orizon",
      )
      .eq("pedidoid", pedido.id)
      .order("pedidodetid", { ascending: true });

    if (lineasError) {
      console.error("Error fetching líneas:", lineasError);
      return jsonResponse(
        { error: "No se pudieron obtener las líneas", details: lineasError.message },
        500,
      );
    }

    const lineaIds = (lineas ?? []).map((l) => l.pedidodetid);
    let centrosByLinea: Record<string, unknown[]> = {};

    if (lineaIds.length > 0) {
      const { data: centros, error: centrosError } = await supabase
        .from("pedido_linea_centro")
        .select(
          "pedcentroid, pedidodetid, asignacion, numero_palets, subprov, created_at, updated_at, pedidocentroid_orizon",
        )
        .in("pedidodetid", lineaIds)
        .order("pedcentroid", { ascending: true });

      if (centrosError) {
        console.error("Error fetching centros:", centrosError);
        return jsonResponse(
          { error: "No se pudieron obtener los centros", details: centrosError.message },
          500,
        );
      }

      centrosByLinea = (centros ?? []).reduce<Record<string, unknown[]>>(
        (acc, centro) => {
          const key = String(centro.pedidodetid);
          if (!acc[key]) acc[key] = [];
          acc[key].push(centro);
          return acc;
        },
        {},
      );
    }

    const lineasConCentros = (lineas ?? []).map((linea) => ({
      ...linea,
      centros: centrosByLinea[String(linea.pedidodetid)] ?? [],
    }));

    return jsonResponse({
      pedido: {
        id: pedido.id,
        referencia_cliente: pedido.referencia_cliente,
        referencia2_cliente: pedido.referencia2_cliente ?? null,
        pedidoclienteid: pedido.pedidoclienteid,
        fecha_carga: pedido.fecha_carga,
        clienteid: pedido.clienteid,
        clienteid_envio: pedido.clienteid_envio,
        sujetodomicilioid_destino: pedido.sujetodomicilioid_destino,
        sujetodomicilioid_envio: pedido.sujetodomicilioid_envio,
        archivo_pdf_id: pedido.archivo_pdf_id,
        enviado: pedido.enviado,
        needs_sync: pedido.needs_sync,
      },
      lineas: lineasConCentros,
    });
  } catch (error) {
    console.error("Server error:", error);
    return jsonResponse(
      { error: "Internal server error", details: (error as Error).message },
      500,
    );
  }
});
