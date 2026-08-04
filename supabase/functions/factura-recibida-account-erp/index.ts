import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
  integerValue,
  isFacturaERPReadOnlyReference,
  isValidRequestId,
  type JsonObject,
  jsonResponse,
  requireRouteUser,
  text,
} from "../_shared/facturas-recibidas-erp.ts";
import {
  buildAccountingContractV3,
  callNetagroAccountingV3,
  fetchNetagroRuntime,
  getFacturaAccountingResumePlan,
  parseStructuredERPError,
  type StructuredERPError,
  timestampsReferToSameInstant,
  validateNetagroAccountingResponseV3,
} from "../_shared/netagro-api-v3.ts";

const ACCOUNTING_OPERATION = "account";
const RETRYABLE_STATUSES = new Set(["requested", "error"]);
const STARTABLE_STATUSES = new Set(["not_requested", ...RETRYABLE_STATUSES]);
const UNCERTAIN_STATUSES = new Set(["unknown"]);
const RESUMABLE_STATUSES = new Set(["pending"]);

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};

const positiveInteger = (value: unknown): number | null => {
  const parsed = integerValue(value, null);
  if (
    parsed === null ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    (typeof value === "number" && !Number.isInteger(value)) ||
    (typeof value === "string" && !/^[1-9][0-9]*$/.test(value.trim()))
  ) {
    return null;
  }
  return parsed;
};

const isSha256 = (value: string | null): value is string =>
  Boolean(value && /^[0-9a-f]{64}$/.test(value));

const edgeError = ({
  status,
  error,
  facturaId = null,
  extra = {},
}: {
  status: number;
  error: StructuredERPError;
  facturaId?: string | null;
  extra?: JsonObject;
}) =>
  jsonResponse({
    contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
    operation: ACCOUNTING_OPERATION,
    ...error,
    technical_details: {},
    error: error.user_message,
    factura_id: facturaId,
    ...extra,
  }, status);

const accountingError = ({
  status,
  code,
  category,
  userMessage,
  requestId,
  targetId = null,
  datasetEpoch = null,
  facturaId = null,
  retryable = false,
  reconciliationRequired = false,
  extra = {},
}: {
  status: number;
  code: string;
  category: StructuredERPError["category"];
  userMessage: string;
  requestId: string | null;
  targetId?: string | null;
  datasetEpoch?: string | null;
  facturaId?: string | null;
  retryable?: boolean;
  reconciliationRequired?: boolean;
  extra?: JsonObject;
}) =>
  edgeError({
    status,
    facturaId,
    error: {
      code,
      category,
      user_message: userMessage,
      technical_details: {},
      retryable,
      reconciliation_required: reconciliationRequired,
      request_id: requestId,
      target_id: targetId,
      dataset_epoch: datasetEpoch,
    },
    extra,
  });

const rpcFailureResponse = ({
  message,
  requestId,
  targetId,
  datasetEpoch,
  facturaId,
}: {
  message: string;
  requestId: string;
  targetId: string;
  datasetEpoch: string;
  facturaId: string;
}) => {
  if (message.includes("IDEMPOTENCY_CONFLICT")) {
    return accountingError({
      status: 409,
      code: "idempotency_conflict",
      category: "conflict",
      userMessage: "Ya existe otra operación contable para esta factura.",
      requestId,
      targetId,
      datasetEpoch,
      facturaId,
    });
  }
  if (message.includes("ACCOUNTING_RECONCILIATION_REQUIRED")) {
    return accountingError({
      status: 202,
      code: "ambiguous_commit",
      category: "accounting",
      userMessage:
        "El resultado contable está pendiente de comprobación. No se repetirá automáticamente.",
      requestId,
      targetId,
      datasetEpoch,
      facturaId,
      reconciliationRequired: true,
    });
  }
  if (message.includes("STALE_ENVIRONMENT")) {
    return accountingError({
      status: 409,
      code: "stale_environment",
      category: "environment",
      userMessage:
        "El entorno de pruebas ha cambiado. Actualice la factura antes de continuar.",
      requestId,
      targetId,
      datasetEpoch,
      facturaId,
    });
  }
  if (
    message.includes("ACCOUNTING_NOT_READY") ||
    message.includes("ACCOUNTING_NOT_REQUESTED")
  ) {
    return accountingError({
      status: 409,
      code: "accounting_not_ready",
      category: "accounting",
      userMessage: "La factura todavía no está preparada para contabilizarse.",
      requestId,
      targetId,
      datasetEpoch,
      facturaId,
    });
  }
  if (message.includes("NOT_FOUND")) {
    return accountingError({
      status: 404,
      code: "not_found",
      category: "validation",
      userMessage: "Factura no encontrada.",
      requestId,
      targetId,
      datasetEpoch,
      facturaId,
    });
  }
  return accountingError({
    status: 503,
    code: "upstream_unavailable",
    category: "transport",
    userMessage: "No se pudo guardar el estado de la contabilización.",
    requestId,
    targetId,
    datasetEpoch,
    facturaId,
    retryable: true,
  });
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return accountingError({
      status: 405,
      code: "invalid_operation",
      category: "validation",
      userMessage: "Método no permitido.",
      requestId: null,
    });
  }

  let activeFacturaId: string | null = null;
  let activeRequestId: string | null = null;
  let activeTargetId: string | null = null;
  let activeDatasetEpoch: string | null = null;
  let commitOpened = false;

  try {
    const auth = await requireRouteUser(req);
    if (!auth.ok) {
      const status = auth.response.status;
      return accountingError({
        status,
        code: status === 403
          ? "forbidden"
          : status === 401
          ? "unauthorized"
          : "upstream_unavailable",
        category: status >= 500 ? "transport" : "validation",
        userMessage: status === 403
          ? "No tiene permiso para contabilizar facturas recibidas."
          : status === 401
          ? "Debe iniciar sesión para contabilizar facturas recibidas."
          : "No se pudo comprobar el acceso al flujo contable.",
        requestId: null,
        retryable: status >= 500,
      });
    }

    const body = asObject(await req.json().catch(() => null));
    const contractVersion = integerValue(body.contract_version, null);
    const rawRequestId = text(body.request_id, null);
    const facturaId = text(body.factura_id, null);
    const expectedVersion = positiveInteger(body.expected_version);

    activeFacturaId = facturaId;
    activeRequestId = rawRequestId;

    if (contractVersion !== FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION) {
      return accountingError({
        status: 422,
        code: "invalid_contract",
        category: "validation",
        userMessage: "contract_version=3 es requerido.",
        requestId: rawRequestId,
        facturaId,
      });
    }
    if (!rawRequestId || !isValidRequestId(rawRequestId)) {
      return accountingError({
        status: 422,
        code: "invalid_request_id",
        category: "validation",
        userMessage: "request_id debe ser un UUID válido.",
        requestId: rawRequestId,
        facturaId,
      });
    }
    const requestId = rawRequestId.trim();
    activeRequestId = requestId;

    if (!facturaId || !isValidRequestId(facturaId)) {
      return accountingError({
        status: 422,
        code: "invalid_invoice",
        category: "validation",
        userMessage: "factura_id debe ser un UUID válido.",
        requestId,
        facturaId,
      });
    }
    if (expectedVersion === null) {
      return accountingError({
        status: 422,
        code: "invalid_invoice",
        category: "validation",
        userMessage: "expected_version es requerido.",
        requestId,
        facturaId,
      });
    }

    const { data: factura, error: facturaLoadError } = await auth.serviceClient
      .from("facturasrecibidas")
      .select("*")
      .eq("id", facturaId)
      .maybeSingle();
    if (facturaLoadError) {
      console.error(
        "factura-recibida-account-erp load error",
        facturaLoadError.message,
      );
      return accountingError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        userMessage: "No se pudo cargar la factura.",
        requestId,
        facturaId,
        retryable: true,
      });
    }
    if (!factura) {
      return accountingError({
        status: 404,
        code: "not_found",
        category: "validation",
        userMessage: "Factura no encontrada.",
        requestId,
        facturaId,
      });
    }

    const invoice = factura as JsonObject;
    const currentVersion = positiveInteger(invoice.row_version);
    const accountingStatus = text(invoice.accounting_status, "not_requested")!
      .toLowerCase();
    const storedRequestId = text(invoice.accounting_request_id, null);
    const storedPayloadHash = text(invoice.accounting_payload_hash, null);
    const storedInvoiceFingerprint = text(
      invoice.accounting_invoice_fingerprint,
      null,
    );

    if (currentVersion === null) {
      return accountingError({
        status: 409,
        code: "version_conflict",
        category: "conflict",
        userMessage:
          "La versión de la factura no es válida. Actualícela antes de continuar.",
        requestId,
        targetId: text(invoice.erp_target_id, null),
        datasetEpoch: text(invoice.erp_dataset_epoch, null),
        facturaId,
      });
    }

    const targetId = text(invoice.erp_target_id, null);
    const datasetEpoch = text(invoice.erp_dataset_epoch, null);
    const remoteFacturaId = positiveInteger(
      invoice.remote_frr_id ?? invoice.FRR_id,
    );
    activeTargetId = targetId;
    activeDatasetEpoch = datasetEpoch;

    if (
      text(invoice.sync_status, null) !== "sent" ||
      text(invoice.erp_reference_status, null) !== "valid" ||
      !targetId ||
      !datasetEpoch ||
      !isValidRequestId(datasetEpoch) ||
      remoteFacturaId === null
    ) {
      return accountingError({
        status: 409,
        code: "accounting_not_ready",
        category: "accounting",
        userMessage: "La factura todavía no está confirmada en el ERP.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }
    if (isFacturaERPReadOnlyReference(invoice)) {
      return accountingError({
        status: 409,
        code: "reference_read_only",
        category: "conflict",
        userMessage: "Esta referencia del ERP es de solo consulta.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }
    if (invoice.accounting_requested !== true) {
      return accountingError({
        status: 409,
        code: "accounting_not_requested",
        category: "accounting",
        userMessage: "La factura no está marcada para contabilizar.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }
    if (accountingStatus === "created" && storedRequestId !== requestId) {
      return accountingError({
        status: 409,
        code: "idempotency_conflict",
        category: "conflict",
        userMessage: "La factura ya está contabilizada con otra operación.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }

    if (UNCERTAIN_STATUSES.has(accountingStatus)) {
      if (storedRequestId !== requestId) {
        return accountingError({
          status: 409,
          code: "idempotency_conflict",
          category: "conflict",
          userMessage:
            "Existe otra operación contable pendiente para esta factura.",
          requestId,
          targetId,
          datasetEpoch,
          facturaId,
        });
      }
      return accountingError({
        status: 202,
        code: "ambiguous_commit",
        category: "accounting",
        userMessage:
          "El resultado contable está pendiente de comprobación. No se repetirá automáticamente.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        reconciliationRequired: true,
        extra: {
          accounting_status: accountingStatus,
          accounting_request_id: storedRequestId,
          factura: invoice,
          version: currentVersion,
        },
      });
    }
    if (
      accountingStatus !== "created" &&
      !STARTABLE_STATUSES.has(accountingStatus) &&
      !RESUMABLE_STATUSES.has(accountingStatus)
    ) {
      return accountingError({
        status: 409,
        code: "accounting_not_ready",
        category: "accounting",
        userMessage:
          "El estado contable de la factura debe revisarse antes de continuar.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }

    const sameContinuableRequest = storedRequestId === requestId &&
      (
        RETRYABLE_STATUSES.has(accountingStatus) ||
        RESUMABLE_STATUSES.has(accountingStatus)
      );
    if (
      accountingStatus !== "created" &&
      currentVersion !== expectedVersion &&
      !sameContinuableRequest
    ) {
      return accountingError({
        status: 409,
        code: "version_conflict",
        category: "conflict",
        userMessage: "La factura ha cambiado. Actualícela antes de continuar.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        extra: { version: currentVersion },
      });
    }

    // Un resultado ya confirmado se devuelve desde el snapshot inmutable de
    // Supabase. No vuelve a abrirse el writer aunque el API esté apagado.
    if (accountingStatus === "created") {
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: ACCOUNTING_OPERATION,
        request_id: requestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        factura_id: facturaId,
        ok: true,
        management_confirmed: true,
        accounting_confirmed: true,
        accounting_status: "created",
        idempotent_replay: true,
        factura: invoice,
        version: currentVersion,
        accounting_response: invoice.accounting_response ?? null,
      });
    }

    let runtime;
    try {
      runtime = await fetchNetagroRuntime();
    } catch (error) {
      console.error(
        "factura-recibida-account-erp runtime error",
        error instanceof Error ? error.message : "Error desconocido",
      );
      return accountingError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        userMessage: "No se pudo comprobar el entorno del ERP.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        retryable: true,
      });
    }

    const { data: localTarget, error: targetLoadError } = await auth
      .serviceClient
      .from("erp_targets")
      .select(
        "id, environment, dataset_epoch, snapshot_at, accounting_mode, active",
      )
      .eq("id", targetId)
      .maybeSingle();
    if (targetLoadError) {
      console.error(
        "factura-recibida-account-erp target error",
        targetLoadError.message,
      );
      return accountingError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        userMessage: "No se pudo comprobar el entorno del ERP.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        retryable: true,
      });
    }

    const local = asObject(localTarget);
    const localAccountingMode = text(local.accounting_mode, "unavailable")!;
    const environmentConsistent = Boolean(
      localTarget &&
        local.active === true &&
        text(local.id, null) === targetId &&
        text(local.dataset_epoch, null) === datasetEpoch &&
        runtime.target_id === targetId &&
        runtime.dataset_epoch === datasetEpoch &&
        timestampsReferToSameInstant(local.snapshot_at, runtime.snapshot_at),
    );
    const allowedAccountingMode = ["official", "sql_test"].includes(
      localAccountingMode,
    ) && localAccountingMode === runtime.accounting_mode;
    const sqlTestIsolated = localAccountingMode !== "sql_test" ||
      text(local.environment, null) === "test";
    const accountingEnabled = environmentConsistent &&
      allowedAccountingMode &&
      sqlTestIsolated &&
      runtime.accounting_ready_for_commit &&
      runtime.capabilities.accounting_commit &&
      (localAccountingMode !== "sql_test" ||
        runtime.accounting_write_mode === "sql_test");

    if (!environmentConsistent) {
      return accountingError({
        status: 409,
        code: "stale_environment",
        category: "environment",
        userMessage:
          "La copia de pruebas del ERP ha cambiado. Actualice la factura.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }
    if (!accountingEnabled) {
      return accountingError({
        status: 503,
        code: "accounting_unavailable",
        category: "accounting",
        userMessage: "La contabilización no está habilitada en este entorno.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }

    const recordAccounting = async ({
      status,
      response = null,
      payloadHash = null,
      invoiceFingerprint = null,
      error = null,
    }: {
      status: "pending" | "created" | "error" | "unknown";
      response?: unknown;
      payloadHash?: string | null;
      invoiceFingerprint?: string | null;
      error?: string | null;
    }) => {
      const { data, error: recordError } = await auth.serviceClient.rpc(
        "record_factura_recibida_accounting_v3",
        {
          p_factura_id: facturaId,
          p_request_id: requestId,
          p_target_id: targetId,
          p_dataset_epoch: datasetEpoch,
          p_status: status,
          p_response: response,
          p_payload_hash: payloadHash,
          p_invoice_fingerprint: invoiceFingerprint,
          p_error: error,
          p_actor: auth.user.id,
        },
      );
      if (recordError) throw new Error(recordError.message);
      return asObject(data);
    };

    const recordUnknownAfterCommit = async ({
      response = null,
      payloadHash = null,
      invoiceFingerprint = null,
      message,
    }: {
      response?: unknown;
      payloadHash?: string | null;
      invoiceFingerprint?: string | null;
      message: string;
    }): Promise<JsonObject> => {
      try {
        return await recordAccounting({
          status: "unknown",
          response,
          payloadHash,
          invoiceFingerprint,
          error: message,
        });
      } catch (recordError) {
        console.error(
          "factura-recibida-account-erp unknown state error",
          recordError instanceof Error
            ? recordError.message
            : "Error desconocido",
        );
        return {};
      }
    };

    const { data: prepared, error: prepareError } = await auth.serviceClient
      .rpc(
        "prepare_factura_recibida_accounting_v3",
        {
          p_factura_id: facturaId,
          p_request_id: requestId,
          p_target_id: targetId,
          p_dataset_epoch: datasetEpoch,
          p_actor: auth.user.id,
        },
      );
    if (prepareError) {
      return rpcFailureResponse({
        message: prepareError.message,
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }

    const preparedState = asObject(prepared);
    const preparedFactura = asObject(preparedState.factura);
    if (text(preparedFactura.accounting_status, null) === "created") {
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: ACCOUNTING_OPERATION,
        request_id: requestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        factura_id: facturaId,
        ok: true,
        management_confirmed: true,
        accounting_confirmed: true,
        accounting_status: "created",
        idempotent_replay: true,
        ...preparedState,
        accounting_response: preparedFactura.accounting_response ?? null,
      });
    }
    if (preparedState.reconciliation_required === true) {
      return accountingError({
        status: 202,
        code: "ambiguous_commit",
        category: "accounting",
        userMessage:
          "El resultado contable está pendiente de comprobación. No se repetirá automáticamente.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        reconciliationRequired: true,
        extra: preparedState,
      });
    }

    const accountingPayload = (operation: "validate" | "commit") =>
      buildAccountingContractV3({
        operation,
        requestId,
        targetId,
        datasetEpoch,
      });

    const preparedPayloadHash = text(
      preparedFactura.accounting_payload_hash,
      null,
    );
    const preparedInvoiceFingerprint = text(
      preparedFactura.accounting_invoice_fingerprint,
      null,
    );
    const resumePlan = getFacturaAccountingResumePlan({
      resumePhase: preparedState.resume_phase,
      payloadHash: preparedPayloadHash,
      invoiceFingerprint: preparedInvoiceFingerprint,
    });

    // Once Supabase says phase=commit, validation must never run again. A
    // transport failure there could otherwise downgrade an already-open commit
    // and make a different request look retryable.
    if (resumePlan === "reconcile") {
      return accountingError({
        status: 202,
        code: "ambiguous_commit",
        category: "accounting",
        userMessage:
          "El resultado contable está pendiente de comprobación. No se repetirá automáticamente.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        reconciliationRequired: true,
        extra: preparedState,
      });
    }

    let payloadHash: string | null = resumePlan === "commit"
      ? preparedPayloadHash
      : null;
    let invoiceFingerprint: string | null = resumePlan === "commit"
      ? preparedInvoiceFingerprint
      : null;
    let pendingState: JsonObject = preparedState;

    if (resumePlan === "validate") {
      let validationCall;
      try {
        validationCall = await callNetagroAccountingV3(
          remoteFacturaId,
          accountingPayload("validate"),
        );
      } catch (error) {
        console.error(
          "factura-recibida-account-erp validation transport error",
          error instanceof Error ? error.message : "Error desconocido",
        );
        const message = "No se pudo validar la contabilización.";
        let state: JsonObject = preparedState;
        try {
          state = await recordAccounting({ status: "error", error: message });
        } catch (recordError) {
          console.error(
            "factura-recibida-account-erp validation state error",
            recordError instanceof Error
              ? recordError.message
              : "Error desconocido",
          );
        }
        return accountingError({
          status: 503,
          code: "upstream_unavailable",
          category: "transport",
          userMessage: message,
          requestId,
          targetId,
          datasetEpoch,
          facturaId,
          retryable: true,
          extra: state,
        });
      }

      const validationResponse = asObject(validationCall.payload);
      const validationContract = validateNetagroAccountingResponseV3(
        validationCall.payload,
        {
          operation: "validate",
          requestId,
          targetId,
          datasetEpoch,
          facturaId: remoteFacturaId,
        },
      );
      payloadHash = text(validationResponse.payload_hash, null);
      invoiceFingerprint = text(
        validationResponse.invoice_fingerprint,
        null,
      );
      const safePayloadHash = isSha256(payloadHash) ? payloadHash : null;
      const safeInvoiceFingerprint = isSha256(invoiceFingerprint)
        ? invoiceFingerprint
        : null;
      if (
        !validationCall.response.ok ||
        !validationContract.ok ||
        validationResponse.eligible !== true ||
        !isSha256(payloadHash) ||
        !isSha256(invoiceFingerprint)
      ) {
        const structured = !validationCall.response.ok
          ? parseStructuredERPError(validationCall.payload, {
            category: "accounting",
            user_message:
              "La factura no cumple las condiciones para contabilizarse.",
            request_id: requestId,
            target_id: targetId,
            dataset_epoch: datasetEpoch,
          })
          : null;
        const message = structured?.user_message ??
          "La factura no cumple las condiciones para contabilizarse.";
        const uncertain = structured?.reconciliation_required === true ||
          structured?.code === "ambiguous_commit" ||
          structured?.code === "idempotency_in_progress";
        let state: JsonObject = preparedState;
        try {
          state = await recordAccounting({
            status: uncertain ? "unknown" : "error",
            response: validationCall.payload,
            payloadHash: safePayloadHash,
            invoiceFingerprint: safeInvoiceFingerprint,
            error: message,
          });
        } catch (recordError) {
          console.error(
            "factura-recibida-account-erp validation record error",
            recordError instanceof Error
              ? recordError.message
              : "Error desconocido",
          );
        }
        return accountingError({
          status: uncertain
            ? 202
            : structured?.category === "conflict"
            ? 409
            : validationCall.response.status >= 500
            ? 503
            : 422,
          code: uncertain
            ? "ambiguous_commit"
            : structured?.code ?? "accounting_validation_failed",
          category: structured?.category ?? "accounting",
          userMessage: message,
          requestId,
          targetId,
          datasetEpoch,
          facturaId,
          retryable: uncertain
            ? false
            : structured?.retryable ?? validationCall.response.status >= 500,
          reconciliationRequired: uncertain,
          extra: state,
        });
      }
      if (
        storedRequestId === requestId &&
        ((storedPayloadHash && storedPayloadHash !== payloadHash) ||
          (storedInvoiceFingerprint &&
            storedInvoiceFingerprint !== invoiceFingerprint))
      ) {
        let state: JsonObject = preparedState;
        try {
          state = await recordAccounting({
            status: "error",
            payloadHash: storedPayloadHash,
            invoiceFingerprint: storedInvoiceFingerprint,
            error: "La identidad contable cambió para la misma operación.",
          });
        } catch (recordError) {
          console.error(
            "factura-recibida-account-erp identity state error",
            recordError instanceof Error
              ? recordError.message
              : "Error desconocido",
          );
        }
        return accountingError({
          status: 409,
          code: "idempotency_conflict",
          category: "conflict",
          userMessage: "La factura cambió durante la operación contable.",
          requestId,
          targetId,
          datasetEpoch,
          facturaId,
          extra: state,
        });
      }

      try {
        pendingState = await recordAccounting({
          status: "pending",
          response: validationCall.payload,
          payloadHash,
          invoiceFingerprint,
        });
      } catch (recordError) {
        console.error(
          "factura-recibida-account-erp pending state error",
          recordError instanceof Error
            ? recordError.message
            : "Error desconocido",
        );
        return accountingError({
          status: 503,
          code: "upstream_unavailable",
          category: "transport",
          userMessage: "No se pudo preparar la contabilización.",
          requestId,
          targetId,
          datasetEpoch,
          facturaId,
          retryable: true,
          extra: preparedState,
        });
      }
    }

    if (!isSha256(payloadHash) || !isSha256(invoiceFingerprint)) {
      return accountingError({
        status: 202,
        code: "ambiguous_commit",
        category: "accounting",
        userMessage:
          "El resultado contable está pendiente de comprobación. No se repetirá automáticamente.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        reconciliationRequired: true,
        extra: pendingState,
      });
    }

    const { data: commitClaim, error: commitClaimError } = await auth
      .serviceClient
      .rpc(
        "begin_factura_recibida_accounting_commit_v3",
        {
          p_factura_id: facturaId,
          p_request_id: requestId,
          p_target_id: targetId,
          p_dataset_epoch: datasetEpoch,
          p_payload_hash: payloadHash,
          p_invoice_fingerprint: invoiceFingerprint,
          p_actor: auth.user.id,
        },
      );
    if (commitClaimError) {
      return rpcFailureResponse({
        message: commitClaimError.message,
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
      });
    }

    const commitClaimState = asObject(commitClaim);
    if (
      commitClaimState.commit_authorized !== true ||
      commitClaimState.reconciliation_required === true
    ) {
      return accountingError({
        status: 202,
        code: "ambiguous_commit",
        category: "accounting",
        userMessage:
          "El resultado contable está pendiente de comprobación. No se repetirá automáticamente.",
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        reconciliationRequired: true,
        extra: commitClaimState,
      });
    }

    let commitCall;
    try {
      // From this persisted boundary onwards the request may have reached the
      // Netagro writer. Any interruption is sticky and requires reconciliation.
      commitOpened = true;
      commitCall = await callNetagroAccountingV3(
        remoteFacturaId,
        accountingPayload("commit"),
      );
    } catch (error) {
      console.error(
        "factura-recibida-account-erp commit transport error",
        error instanceof Error ? error.message : "Error desconocido",
      );
      const message =
        "El resultado de la contabilización es incierto. No se repetirá automáticamente.";
      const state = await recordUnknownAfterCommit({
        payloadHash,
        invoiceFingerprint,
        message,
      });
      commitOpened = false;
      return accountingError({
        status: 202,
        code: "ambiguous_commit",
        category: "accounting",
        userMessage: message,
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        reconciliationRequired: true,
        extra: Object.keys(state).length > 0 ? state : pendingState,
      });
    }

    const structuredCommitError = !commitCall.response.ok
      ? parseStructuredERPError(commitCall.payload, {
        category: "accounting",
        request_id: requestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        retryable: commitCall.response.status >= 500,
        reconciliation_required: commitCall.response.status >= 500,
      })
      : null;
    const commitContract = validateNetagroAccountingResponseV3(
      commitCall.payload,
      {
        operation: "commit",
        requestId,
        targetId,
        datasetEpoch,
        facturaId: remoteFacturaId,
        payloadHash,
        invoiceFingerprint,
        requireCreated: true,
      },
    );

    if (!commitCall.response.ok || !commitContract.ok) {
      const uncertain =
        structuredCommitError?.reconciliation_required === true ||
        structuredCommitError?.code === "ambiguous_commit" ||
        structuredCommitError?.code === "idempotency_in_progress" ||
        commitCall.response.status >= 500 ||
        (commitCall.response.ok && !commitContract.ok);
      const message = structuredCommitError?.user_message ??
        (uncertain
          ? "El resultado de la contabilización es incierto."
          : "No se pudo completar la contabilización.");
      let state: JsonObject;
      let recordFailed = false;
      try {
        state = await recordAccounting({
          status: uncertain ? "unknown" : "error",
          response: commitCall.payload,
          payloadHash,
          invoiceFingerprint,
          error: message,
        });
      } catch (recordError) {
        console.error(
          "factura-recibida-account-erp commit state error",
          recordError instanceof Error
            ? recordError.message
            : "Error desconocido",
        );
        state = pendingState;
        recordFailed = true;
      }
      const effectiveUncertain = uncertain || recordFailed;
      if (!recordFailed) commitOpened = false;
      return accountingError({
        status: effectiveUncertain
          ? 202
          : structuredCommitError?.category === "conflict"
          ? 409
          : 422,
        code: effectiveUncertain
          ? "ambiguous_commit"
          : structuredCommitError?.code ?? "accounting_failed",
        category: structuredCommitError?.category ?? "accounting",
        userMessage: message,
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        retryable: effectiveUncertain
          ? false
          : structuredCommitError?.retryable ?? false,
        reconciliationRequired: effectiveUncertain,
        extra: state,
      });
    }

    try {
      const state = await recordAccounting({
        status: "created",
        response: commitCall.payload,
        payloadHash,
        invoiceFingerprint,
      });
      commitOpened = false;
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: ACCOUNTING_OPERATION,
        request_id: requestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        factura_id: facturaId,
        ok: true,
        management_confirmed: true,
        accounting_confirmed: true,
        accounting_status: "created",
        idempotent_replay: false,
        ...state,
        accounting_response: commitCall.payload,
      });
    } catch (recordError) {
      console.error(
        "factura-recibida-account-erp created state error",
        recordError instanceof Error
          ? recordError.message
          : "Error desconocido",
      );
      const message =
        "El asiento se recibió, pero no se pudo confirmar localmente. Debe revisarse antes de reintentar.";
      const state = await recordUnknownAfterCommit({
        response: commitCall.payload,
        payloadHash,
        invoiceFingerprint,
        message,
      });
      commitOpened = false;
      return accountingError({
        status: 202,
        code: "ambiguous_commit",
        category: "accounting",
        userMessage: message,
        requestId,
        targetId,
        datasetEpoch,
        facturaId,
        reconciliationRequired: true,
        extra: Object.keys(state).length > 0 ? state : pendingState,
      });
    }
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Error desconocido";
    console.error("factura-recibida-account-erp error", message);

    return accountingError({
      status: commitOpened ? 202 : 503,
      code: commitOpened ? "ambiguous_commit" : "upstream_unavailable",
      category: commitOpened ? "accounting" : "transport",
      userMessage: commitOpened
        ? "El resultado de la contabilización es incierto. Debe revisarse antes de reintentar."
        : "No se pudo completar la contabilización.",
      requestId: activeRequestId,
      targetId: activeTargetId,
      datasetEpoch: activeDatasetEpoch,
      facturaId: activeFacturaId,
      retryable: !commitOpened,
      reconciliationRequired: commitOpened,
    });
  }
});
