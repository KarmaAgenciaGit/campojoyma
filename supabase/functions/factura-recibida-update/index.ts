import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  getValidationErrorsForFactura,
  jsonResponse,
  normalizeFrcPayload,
  normalizeFrrPayload,
  requireRouteUser,
  type JsonObject,
} from "../_shared/facturas-recibidas-netagro.ts";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const facturaId = String(body.factura_id ?? body.id ?? "").trim();
    if (!facturaId) return jsonResponse({ error: "factura_id es requerido" }, 422);

    const facturaInput = asObject(body.factura ?? body.frr ?? body);
    const frr = normalizeFrrPayload(facturaInput);
    const validationErrors = await getValidationErrorsForFactura(auth.serviceClient, frr);
    const explicitEstado = typeof body.estado === "string" ? body.estado : null;
    const nextEstado =
      explicitEstado ??
      (validationErrors.some((error) => error.severity === "error") ? "pendiente_revision" : "validada");

    const { data: updated, error: updateError } = await auth.serviceClient
      .from("facturasrecibidas")
      .update({
        ...frr,
        proveedor_nombre: body.proveedor_nombre ?? facturaInput.proveedor_nombre ?? null,
        proveedor_nif: body.proveedor_nif ?? facturaInput.proveedor_nif ?? null,
        estado: nextEstado,
        validation_errors: validationErrors,
        updated_by: auth.user.id,
        netagro_error: null,
      })
      .eq("id", facturaId)
      .select("*")
      .single();

    if (updateError || !updated) throw updateError ?? new Error("No se pudo actualizar la factura.");

    if (Array.isArray(body.ctb)) {
      const { error: deleteError } = await auth.serviceClient
        .from("facturasrecibidas_ctb")
        .delete()
        .eq("factura_id", facturaId);
      if (deleteError) throw deleteError;

      const lines = body.ctb.map((linea: JsonObject, index: number) => ({
        ...normalizeFrcPayload(linea, index + 1),
        factura_id: facturaId,
      }));

      if (lines.length > 0) {
        const { error: insertError } = await auth.serviceClient.from("facturasrecibidas_ctb").insert(lines);
        if (insertError) throw insertError;
      }
    }

    return jsonResponse({ factura: updated, validation_errors: validationErrors });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
