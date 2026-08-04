import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
  corsHeaders,
  jsonResponse,
  requestIdValue,
  requireRouteUser,
  text,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";
import {
  fetchNetagroRuntime,
  timestampsReferToSameInstant,
} from "../_shared/netagro-api-v3.ts";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};

const runtimeError = ({
  status,
  code,
  category,
  userMessage,
  requestId,
  targetId = null,
  datasetEpoch = null,
  retryable = false,
}: {
  status: number;
  code: string;
  category: "validation" | "environment" | "conflict" | "transport" | "accounting";
  userMessage: string;
  requestId: string | null;
  targetId?: string | null;
  datasetEpoch?: string | null;
  retryable?: boolean;
}) =>
  jsonResponse({
    contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
    code,
    category,
    user_message: userMessage,
    error: userMessage,
    technical_details: {},
    retryable,
    reconciliation_required: false,
    request_id: requestId,
    target_id: targetId,
    dataset_epoch: datasetEpoch,
  }, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) {
    return runtimeError({
      status: 405,
      code: "invalid_operation",
      category: "validation",
      userMessage: "Método no permitido.",
      requestId: null,
    });
  }

  let activeRequestId: string | null = null;
  let activeTargetId: string | null = null;
  let activeDatasetEpoch: string | null = null;

  try {
    const url = new URL(req.url);
    const requestBody = req.method === "POST"
      ? asObject(await req.json().catch(() => ({})))
      : {};
    const requestId = requestIdValue(
      requestBody.request_id ?? url.searchParams.get("request_id"),
    );
    activeRequestId = requestId;

    const auth = await requireRouteUser(req);
    if (!auth.ok) {
      const status = auth.response.status;
      return runtimeError({
        status,
        code: status === 403
          ? "forbidden"
          : status === 401
            ? "unauthorized"
            : "upstream_unavailable",
        category: status >= 500 ? "transport" : "validation",
        userMessage: status === 403
          ? "No tiene permiso para consultar el estado de Netagro."
          : status === 401
            ? "Debe iniciar sesión para consultar el estado de Netagro."
            : "No se pudo comprobar el acceso al estado de Netagro.",
        requestId,
        retryable: status >= 500,
      });
    }

    const upstream = await fetchNetagroRuntime();
    activeTargetId = upstream.target_id;
    activeDatasetEpoch = upstream.dataset_epoch;
    const { data: localTarget, error: targetError } = upstream.target_id
      ? await auth.serviceClient
        .from("erp_targets")
        .select(
          "id, display_name, environment, dataset_epoch, snapshot_at, write_mode, accounting_mode, active",
        )
        .eq("id", upstream.target_id)
        .maybeSingle()
      : { data: null, error: null };
    if (targetError) throw targetError;

    const local = asObject(localTarget);
    const identityConsistent = Boolean(
      upstream.target_id &&
        upstream.dataset_epoch &&
        local.id === upstream.target_id &&
        text(local.dataset_epoch, null) === upstream.dataset_epoch &&
        timestampsReferToSameInstant(local.snapshot_at, upstream.snapshot_at) &&
        local.active === true,
    );
    const localWriteMode = text(local.write_mode, "disabled")!;
    const localAccountingMode = text(local.accounting_mode, "unavailable")!;
    const localEnvironment = text(local.environment, null);
    const capabilities = {
      validate:
        identityConsistent &&
        localWriteMode !== "disabled" &&
        upstream.capabilities.validate,
      management_commit:
        identityConsistent &&
        localWriteMode === "management" &&
        upstream.ready_for_commit &&
        upstream.capabilities.management_commit,
      accounting_commit:
        identityConsistent &&
        ["official", "sql_test"].includes(localAccountingMode) &&
        localAccountingMode === upstream.accounting_mode &&
        (
          localAccountingMode !== "sql_test" ||
          (
            localEnvironment === "test" &&
            upstream.accounting_write_mode === "sql_test"
          )
        ) &&
        upstream.accounting_ready_for_commit &&
        upstream.capabilities.accounting_commit,
    };

    return jsonResponse({
      contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
      request_id: requestId,
      ok: true,
      runtime: {
        target_id: upstream.target_id,
        dataset_epoch: upstream.dataset_epoch,
        snapshot_at: upstream.snapshot_at,
        write_mode: upstream.write_mode,
        accounting_mode: upstream.accounting_mode,
        accounting_write_mode: upstream.accounting_write_mode,
        accounting_ready_for_commit: capabilities.accounting_commit,
        ready_for_commit: capabilities.management_commit,
        identity_consistent: identityConsistent,
        capabilities,
      },
      local_target: localTarget,
    });
  } catch (error) {
    console.error("facturas-recibidas-erp-runtime error", error);
    const message = error instanceof Error ? error.message : "";
    const invalidRequest = message.includes("request_id");
    return runtimeError({
      status: invalidRequest ? 422 : 503,
      code: invalidRequest ? "invalid_request_id" : "upstream_unavailable",
      category: invalidRequest ? "validation" : "transport",
      userMessage: invalidRequest
        ? "request_id debe ser un UUID válido."
        : "No se pudo consultar el estado de Netagro.",
      requestId: activeRequestId,
      targetId: activeTargetId,
      datasetEpoch: activeDatasetEpoch,
      retryable: !invalidRequest,
    });
  }
});
