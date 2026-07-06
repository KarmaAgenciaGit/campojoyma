import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  getValidationErrorsForFactura,
  jsonResponse,
  requireRouteUser,
  signJwtHs256,
  toERPCtbPayload,
  toERPFacturaPayload,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";

const DEFAULT_WRITE_WEBHOOK_URL = "https://n8nbecarios.srv894901.hstgr.cloud/webhook/apiCampojoyma";
const DEFAULT_EXP_SECONDS = 300;

const parseExpSeconds = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_EXP_SECONDS;
};

const toFiniteInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const auth = await requireRouteUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const facturaId = String(body.factura_id ?? body.id ?? "").trim();
    if (!facturaId) return jsonResponse({ error: "factura_id es requerido" }, 422);

    const { data: factura, error: facturaError } = await auth.serviceClient
      .from("facturasrecibidas")
      .select("*")
      .eq("id", facturaId)
      .single();
    if (facturaError || !factura) throw facturaError ?? new Error("Factura no encontrada.");

    if (factura.estado === "enviada_erp") {
      return jsonResponse({ error: "La factura ya fue enviada a ERP." }, 409);
    }

    const { data: ctb, error: ctbError } = await auth.serviceClient
      .from("facturasrecibidas_ctb")
      .select("*")
      .eq("factura_id", facturaId)
      .order("posicion", { ascending: true });
    if (ctbError) throw ctbError;

    const validationErrors = await getValidationErrorsForFactura(auth.serviceClient, factura);
    const blockingErrors = validationErrors.filter((error) => error.severity === "error");
    if (blockingErrors.length > 0) {
      await auth.serviceClient
        .from("facturasrecibidas")
        .update({ estado: "pendiente_revision", validation_errors: validationErrors, updated_by: auth.user.id })
        .eq("id", facturaId);
      return jsonResponse({ error: "La factura no supera la validacion.", validation_errors: validationErrors }, 422);
    }

    const jwtSecret = Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET")?.trim();
    if (!jwtSecret) return jsonResponse({ error: "N8N_CAMPOJOYMA_WEBHOOK_JWT_SECRET no configurado." }, 500);

    const webhookUrl =
      Deno.env.get("N8N_CAMPOJOYMA_WRITE_WEBHOOK_URL")?.trim() ||
      Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_URL")?.trim() ||
      DEFAULT_WRITE_WEBHOOK_URL;
    const jwt = await signJwtHs256(jwtSecret, parseExpSeconds(Deno.env.get("N8N_CAMPOJOYMA_WEBHOOK_JWT_EXP_SECONDS")));

    await auth.serviceClient
      .from("facturasrecibidas")
      .update({ estado: "preparada_erp", validation_errors: validationErrors, updated_by: auth.user.id })
      .eq("id", facturaId);

    const payload = {
      operation: "factura_recibida.create",
      request_id: facturaId,
      factura: toERPFacturaPayload(factura as JsonObject),
      ctb: (ctb ?? []).map((linea, index) => toERPCtbPayload(linea as JsonObject, index + 1)),
    };

    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const upstreamText = await upstream.text();
    let upstreamJson: unknown = upstreamText;
    try {
      upstreamJson = JSON.parse(upstreamText);
    } catch {
      // Keep text response.
    }

    const ok =
      upstream.ok &&
      (!(upstreamJson && typeof upstreamJson === "object") || (upstreamJson as { ok?: unknown }).ok !== false);

    if (!ok) {
      const message =
        upstreamJson && typeof upstreamJson === "object" && typeof (upstreamJson as { message?: unknown }).message === "string"
          ? String((upstreamJson as { message: string }).message)
          : upstreamText || `HTTP ${upstream.status}`;
      await auth.serviceClient
        .from("facturasrecibidas")
        .update({
          estado: "error_erp",
          erp_error: message,
          erp_response: upstreamJson,
          updated_by: auth.user.id,
        })
        .eq("id", facturaId);
      return jsonResponse({ error: message, response: upstreamJson }, upstream.ok ? 502 : upstream.status);
    }

    const responseObject = upstreamJson && typeof upstreamJson === "object" ? upstreamJson as Record<string, unknown> : {};
    const remoteFacturaId = toFiniteInteger(responseObject.FRR_id ?? factura.FRR_id);
    const remoteCtb = Array.isArray(responseObject.ctb)
      ? responseObject.ctb.filter((linea): linea is Record<string, unknown> => Boolean(linea) && typeof linea === "object")
      : [];

    if (remoteFacturaId && ctb?.length) {
      const lineResults = await Promise.all(
        ctb.map((linea, index) => {
          const remoteLine = remoteCtb[index] ?? {};
          const remoteFrcId = toFiniteInteger(remoteLine.FRC_id ?? remoteLine.frc_id ?? remoteLine.id);
          return auth.serviceClient
            .from("facturasrecibidas_ctb")
            .update({
              "FRC_id": remoteFrcId ?? linea.FRC_id ?? null,
              "FRC_idfacturarecibida": remoteFacturaId,
            })
            .eq("id", linea.id);
        }),
      );
      const lineError = lineResults.find((result) => result.error)?.error;
      if (lineError) throw lineError;
    }

    const { data: updated, error: updateError } = await auth.serviceClient
      .from("facturasrecibidas")
      .update({
        estado: "enviada_erp",
        "FRR_id": remoteFacturaId ?? factura.FRR_id,
        "FRR_numero": responseObject.FRR_numero ?? factura.FRR_numero,
        erp_sent_at: new Date().toISOString(),
        erp_sent_by: auth.user.id,
        erp_response: upstreamJson,
        erp_error: null,
        updated_by: auth.user.id,
      })
      .eq("id", facturaId)
      .select("*")
      .single();

    if (updateError) throw updateError;
    return jsonResponse({ factura: updated, response: upstreamJson });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
