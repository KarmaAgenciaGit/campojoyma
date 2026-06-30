import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const parseClienteId = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

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

    const clienteid = parseClienteId(body?.clienteid);
    const referenciaCliente = (body?.referencia_cliente ?? body?.referenciacliente ?? "")
      .toString()
      .trim();

    if (!clienteid || !referenciaCliente) {
      return jsonResponse(
        { error: "clienteid y referencia_cliente son obligatorios" },
        400,
      );
    }

    const { data: behaviorRule, error: behaviorError } = await supabase
      .from("cliente_behavior_rules")
      .select("allow_duplicate_reference")
      .eq("clienteid", clienteid)
      .maybeSingle();

    if (behaviorError) {
      return jsonResponse(
        { error: "No se pudo consultar cliente_behavior_rules", details: behaviorError.message },
        500,
      );
    }

    const allowDuplicateReference = Boolean(behaviorRule?.allow_duplicate_reference);

    const { count, error: duplicateError } = await supabase
      .from("pedidos")
      .select("id", { count: "exact", head: true })
      .eq("clienteid", clienteid)
      .eq("referencia_cliente", referenciaCliente);

    if (duplicateError) {
      return jsonResponse(
        { error: "No se pudo verificar referencias duplicadas", details: duplicateError.message },
        500,
      );
    }

    const duplicates = count ?? 0;
    const exists = duplicates > 0;
    const blocked = exists && !allowDuplicateReference;

    if (blocked) {
      return jsonResponse(
        {
          success: false,
          blocked: true,
          reason: "Referencia duplicada no permitida para este cliente",
          clienteid,
          referencia_cliente: referenciaCliente,
          duplicates,
          allow_duplicate_reference: allowDuplicateReference,
        },
        409,
      );
    }

    return jsonResponse({
      success: true,
      blocked: false,
      clienteid,
      referencia_cliente: referenciaCliente,
      duplicates,
      exists,
      allow_duplicate_reference: allowDuplicateReference,
    });
  } catch (error) {
    return jsonResponse(
      { error: "Internal server error", details: (error as Error).message },
      500,
    );
  }
});
