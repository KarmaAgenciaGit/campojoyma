import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse, requireRouteUser } from "../_shared/facturas-recibidas-netagro.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const facturaId = String(body.factura_id ?? body.id ?? "").trim();
    if (!facturaId) return jsonResponse({ error: "factura_id es requerido" }, 422);

    const { data: factura, error: getError } = await auth.serviceClient
      .from("facturasrecibidas")
      .select("id, estado, archivo_pdf_id")
      .eq("id", facturaId)
      .single();
    if (getError || !factura) throw getError ?? new Error("Factura no encontrada.");
    if (factura.estado === "enviada_netagro") {
      return jsonResponse({ error: "No se puede borrar una factura enviada a Netagro." }, 409);
    }

    const archivoPdfId = factura.archivo_pdf_id as number | null;
    const { error: deleteError } = await auth.serviceClient
      .from("facturasrecibidas")
      .delete()
      .eq("id", facturaId);
    if (deleteError) throw deleteError;

    if (archivoPdfId) {
      const { count: facturas } = await auth.serviceClient
        .from("facturasrecibidas")
        .select("*", { count: "exact", head: true })
        .eq("archivo_pdf_id", archivoPdfId);

      if ((facturas ?? 0) === 0) {
        await auth.serviceClient.from("archivos_pdf").delete().eq("id", archivoPdfId);
      }
    }

    return jsonResponse({ deleted: true, factura_id: facturaId });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
