import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  corsHeaders,
  integerValue,
  jsonResponse,
  requestIdValue,
  requireRouteUser,
  rpcErrorStatus,
  text,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = asObject(await req.json());
    const requestId = requestIdValue(body.request_id);
    const facturaId = text(body.factura_id ?? body.id, null);
    const expectedVersion = integerValue(
      body.expected_version ?? body.row_version ?? body.version,
      null,
    );
    if (!facturaId) return jsonResponse({ error: "factura_id es requerido" }, 422);
    if (!expectedVersion || expectedVersion < 1) {
      return jsonResponse({ error: "expected_version es requerido" }, 422);
    }

    const { data: factura, error: getError } = await auth.serviceClient
      .from("facturasrecibidas")
      .select("id")
      .eq("id", facturaId)
      .single();
    if (getError || !factura) {
      return jsonResponse({ error: getError?.message ?? "Factura no encontrada" }, getError ? 500 : 404);
    }

    const { data, error } = await auth.serviceClient.rpc("delete_factura_recibida_v2", {
      p_factura_id: facturaId,
      p_expected_version: expectedVersion,
      p_actor: auth.user.id,
      p_request_id: requestId,
      p_reason: text(body.reason, "Eliminacion solicitada desde la aplicacion"),
    });
    if (error) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          error: error.message,
        },
        rpcErrorStatus(error.message),
      );
    }

    return jsonResponse({
      contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
      request_id: requestId,
      ...asObject(data),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: message }, rpcErrorStatus(message));
  }
});
