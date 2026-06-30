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

const toPositiveIntOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const hasClientHint = (rawBody: Record<string, unknown> | null, url: URL): boolean =>
  Boolean(
    rawBody?.clienteid ??
      rawBody?.cliente_id ??
      rawBody?.clienteObtenido ??
      rawBody?.cliente_obtenido ??
      url.searchParams.get("clienteid") ??
      url.searchParams.get("cliente_id"),
  );

const resolveClienteId = (rawBody: Record<string, unknown> | null, url: URL): number | null => {
  const nestedFromClienteObtenido = (rawBody?.clienteObtenido as { clienteX?: { clienteid?: unknown } } | undefined)
    ?.clienteX?.clienteid;
  const nestedFromClienteObtenidoSnake =
    (rawBody?.cliente_obtenido as { clienteX?: { clienteid?: unknown } } | undefined)?.clienteX?.clienteid;

  return toPositiveIntOrNull(
    rawBody?.clienteid ??
      rawBody?.cliente_id ??
      nestedFromClienteObtenido ??
      nestedFromClienteObtenidoSnake ??
      url.searchParams.get("clienteid") ??
      url.searchParams.get("cliente_id"),
  );
};

type ClienteVisibleRow = { clienteid: number | null };
type ClienteBehaviorRuleRow = {
  skip_name_includes: string[] | null;
  require_name_prefixes: string[] | null;
  skip_name_includes_pedidos: string[] | null;
  require_name_prefixes_pedidos: string[] | null;
  skip_name_includes_cuentaventa: string[] | null;
  require_name_prefixes_cuentaventa: string[] | null;
};
type VisibilityScope = "pedidos" | "cuentaventa";

const resolveVisibilityScope = (
  rawBody: Record<string, unknown> | null,
  url: URL,
): VisibilityScope | null => {
  const rawScope =
    rawBody?.visibilidad_scope ??
    rawBody?.visibility_scope ??
    rawBody?.scope ??
    url.searchParams.get("visibilidad_scope") ??
    url.searchParams.get("visibility_scope") ??
    url.searchParams.get("scope");

  if (rawScope === null || rawScope === undefined || rawScope === "") {
    return "pedidos";
  }

  const normalized = String(rawScope).trim().toLowerCase();
  if (!normalized) return "pedidos";

  if (["pedido", "pedidos", "orders"].includes(normalized)) return "pedidos";
  if (
    ["cuentaventa", "cuenta_venta", "cuentas_venta", "sales", "sales_accounts"].includes(
      normalized,
    )
  ) {
    return "cuentaventa";
  }

  return null;
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(trimmed);
  }
  return result;
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

    let rawBody: Record<string, unknown> | null = null;
    if (req.method === "POST") {
      try {
        rawBody = await req.json();
      } catch {
        rawBody = null;
      }
    }

    const clienteid = resolveClienteId(rawBody, url);
    if (clienteid === null && hasClientHint(rawBody, url)) {
      return jsonResponse(
        {
          error: "clienteid inválido. Debe ser un entero positivo.",
        },
        400,
      );
    }

    const visibilityScope = resolveVisibilityScope(rawBody, url);
    if (!visibilityScope) {
      return jsonResponse(
        {
          error:
            "visibilidad_scope inválido. Valores permitidos: pedidos | cuentaventa.",
        },
        400,
      );
    }

    const visibilityTable =
      visibilityScope === "cuentaventa"
        ? "clientes_visibles_cuentaventa"
        : "clientes_visibles";

    const { data, error } = await supabase
      .from(visibilityTable)
      .select("clienteid")
      .order("clienteid", { ascending: true });

    if (error) {
      return jsonResponse(
        {
          error: "No se pudo cargar la lista de clientes aceptados",
          details: error.message,
        },
        500,
      );
    }

    const acceptedIdsSet = new Set<number>();
    (data as ClienteVisibleRow[] | null ?? []).forEach((row) => {
      const id = toPositiveIntOrNull(row?.clienteid);
      if (id !== null) acceptedIdsSet.add(id);
    });

    const clientesAceptados = Array.from(acceptedIdsSet).sort((a, b) => a - b);
    const clienteAceptado = clienteid !== null ? acceptedIdsSet.has(clienteid) : null;
    const defaultPdfFilters = {
      skip_name_includes: [] as string[],
      require_name_prefixes: [] as string[],
    };
    let pdfFilters = { ...defaultPdfFilters };
    let hasBehaviorRule = false;

    if (clienteid !== null) {
      const { data: behaviorRule, error: behaviorError } = await supabase
        .from("cliente_behavior_rules")
        .select(
          [
            "skip_name_includes",
            "require_name_prefixes",
            "skip_name_includes_pedidos",
            "require_name_prefixes_pedidos",
            "skip_name_includes_cuentaventa",
            "require_name_prefixes_cuentaventa",
          ].join(", "),
        )
        .eq("clienteid", clienteid)
        .maybeSingle();

      if (behaviorError) {
        return jsonResponse(
          {
            error: "No se pudo cargar filtros de PDF para el cliente",
            details: behaviorError.message,
          },
          500,
        );
      }

      const typedRule = (behaviorRule ?? null) as ClienteBehaviorRuleRow | null;
      if (typedRule) {
        hasBehaviorRule = true;
        const skipNameIncludes =
          visibilityScope === "cuentaventa"
            ? normalizeStringList(
              typedRule.skip_name_includes_cuentaventa ??
                typedRule.skip_name_includes,
            )
            : normalizeStringList(
              typedRule.skip_name_includes_pedidos ??
                typedRule.skip_name_includes,
            );
        const requireNamePrefixes =
          visibilityScope === "cuentaventa"
            ? normalizeStringList(
              typedRule.require_name_prefixes_cuentaventa ??
                typedRule.require_name_prefixes,
            )
            : normalizeStringList(
              typedRule.require_name_prefixes_pedidos ??
                typedRule.require_name_prefixes,
            );

        pdfFilters = {
          skip_name_includes: skipNameIncludes,
          require_name_prefixes: requireNamePrefixes,
        };
      }
    }

    return jsonResponse({
      success: true,
      checked_at: new Date().toISOString(),
      total_clientes_aceptados: clientesAceptados.length,
      clientes_aceptados: clientesAceptados,
      clienteid_evaluado: clienteid,
      cliente_aceptado: clienteAceptado,
      dejar_pasar: clienteAceptado,
      visibilidad_scope: visibilityScope,
      visibilidad_tabla: visibilityTable,
      cliente_behavior_rule_found: hasBehaviorRule,
      filtros_pdf: pdfFilters,
      skip_name_includes: pdfFilters.skip_name_includes,
      require_name_prefixes: pdfFilters.require_name_prefixes,
    });
  } catch (error) {
    const details = error instanceof Error ? error.message : "Unexpected error";
    return jsonResponse({ error: "Internal server error", details }, 500);
  }
});
