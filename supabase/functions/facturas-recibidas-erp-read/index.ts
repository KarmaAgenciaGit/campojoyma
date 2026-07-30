import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  corsHeaders,
  getERPReadAuthorizedRoutes,
  integerValue,
  isAllowedERPConsulta,
  jsonResponse,
  requestIdValue,
  requireRouteUser,
  upstreamResult,
} from "../_shared/facturas-recibidas-erp.ts";
import { callNetagroRead } from "../_shared/netagro-api-v3.ts";

const readError = ({
  status,
  code,
  category,
  userMessage,
  requestId,
  retryable = false,
}: {
  status: number;
  code: string;
  category: "validation" | "environment" | "conflict" | "transport" | "accounting";
  userMessage: string;
  requestId: string | null;
  retryable?: boolean;
}) =>
  jsonResponse({
    contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
    code,
    category,
    user_message: userMessage,
    error: userMessage,
    technical_details: {},
    retryable,
    reconciliation_required: false,
    request_id: requestId,
    target_id: null,
    dataset_epoch: null,
  }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return readError({
      status: 405,
      code: "invalid_operation",
      category: "validation",
      userMessage: "Método no permitido.",
      requestId: null,
    });
  }

  let responseRequestId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const contractVersion = integerValue(body.contract_version, null);
    if (contractVersion !== null && contractVersion !== FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return readError({
        status: 422,
        code: "invalid_contract",
        category: "validation",
        userMessage: "contract_version no soportada.",
        requestId: null,
      });
    }
    const requestId = contractVersion === FACTURAS_RECIBIDAS_CONTRACT_VERSION
      ? requestIdValue(body.request_id)
      : null;
    responseRequestId = requestId;
    const consulta = String(body.consulta ?? "").trim();
    if (!isAllowedERPConsulta(consulta)) {
      return readError({
        status: 422,
        code: "invalid_query",
        category: "validation",
        userMessage: "Consulta no permitida.",
        requestId,
      });
    }
    const auth = await requireRouteUser(req, getERPReadAuthorizedRoutes(consulta));
    if (!auth.ok) {
      const status = auth.response.status;
      return readError({
        status,
        code: status === 403
          ? "forbidden"
          : status === 401
            ? "unauthorized"
            : "upstream_unavailable",
        category: status >= 500 ? "transport" : "validation",
        userMessage: status === 403
          ? "No tiene permiso para realizar esta consulta."
          : status === 401
            ? "Debe iniciar sesión para consultar Netagro."
            : "No se pudo comprobar el acceso a Netagro.",
        requestId,
        retryable: status >= 500,
      });
    }

    const { response: upstream, payload } = await callNetagroRead(consulta);
    const result = upstreamResult(upstream, payload);
    const responseStatus = upstream.ok && !result.ok ? 502 : upstream.status;
    if (!result.ok) {
      return readError({
        status: responseStatus,
        code: "upstream_unavailable",
        category: "transport",
        userMessage: "Netagro no pudo completar la consulta solicitada.",
        requestId,
        retryable: responseStatus >= 500,
      });
    }

    if (contractVersion === FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
          request_id: requestId,
          ok: true,
          data: payload,
        },
        responseStatus,
      );
    }
    return jsonResponse(payload, responseStatus);
  } catch (error) {
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    const userMessage = status === 504
      ? "La consulta a Netagro ha tardado demasiado. Puede volver a intentarlo."
      : "No se pudo consultar Netagro en este momento.";
    console.error("facturas-recibidas-erp-read error", error);
    return readError({
      status,
      code: "upstream_unavailable",
      category: "transport",
      userMessage,
      requestId: responseRequestId,
      retryable: status === 504,
    });
  }
});
