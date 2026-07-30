import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  ERPAttemptMatchesIdentity,
  ERPWriterRelationsMatchSnapshot,
  FACTURAS_RECIBIDAS_CONTRACT_VERSION,
  FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
  buildERPDuplicateConsulta,
  corsHeaders,
  forceFacturaERPAccountingDisabled,
  getFacturaSyncEntryDecision,
  getFacturaProveedorTipoFromMatchEvidence,
  getSelectedPunteoPreflightIssues,
  getERPProviderPreflightIssues,
  getValidationErrorsForFactura,
  integerValue,
  hasBlockingERPValidationErrors,
  isFacturaERPReadOnlyReference,
  isEligibleERPCommitAttempt,
  jsonResponse,
  loadAndResolveFacturaERPAccountingRules,
  mergeValidationIssues,
  normalizeAccountingReadback,
  normalizeFrcPayload,
  normalizePunteoPayload,
  parseERPArrayEnvelope,
  parseERPProviderDetailResponse,
  requestIdValue,
  requireRouteUser,
  resolveFacturaProveedorTipo,
  rpcErrorStatus,
  text,
  toERPCtbPayload,
  toERPFacturaPayload,
  toERPSelectedPunteosPayload,
  unwrapERPObject,
  upstreamResult,
  validateAccountingReadback,
  validateERPDuplicateSearchResponse,
  validateERPReadbackAgainstWrite,
  validateERPWriteRequestV2,
  type JsonObject,
} from "../_shared/facturas-recibidas-erp.ts";
import {
  buildERPContractV3,
  buildFacturaWriteIdentity,
  callNetagroRead,
  callNetagroWriteV3,
  fetchNetagroRuntime,
  parseStructuredERPError,
  timestampsReferToSameInstant,
  validateNetagroWriteResponseV3,
  type StructuredERPError,
} from "../_shared/netagro-api-v3.ts";

const asObject = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};

const edgeError = ({
  status,
  error,
  extra = {},
}: {
  status: number;
  error: StructuredERPError;
  extra?: JsonObject;
}) => jsonResponse({
  contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
  ...error,
  technical_details: {},
  error: error.user_message,
  ...extra,
}, status);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return edgeError({
      status: 405,
      error: {
        code: "invalid_operation",
        category: "validation",
        user_message: "Método no permitido.",
        technical_details: {},
        retryable: false,
        reconciliation_required: false,
        request_id: null,
        target_id: null,
        dataset_epoch: null,
      },
    });
  }

  let activeFacturaId: string | null = null;
  let activeRequestId: string | null = null;
  let activeTargetId: string | null = null;
  let activeDatasetEpoch: string | null = null;
  let activeWriterOpened = false;

  try {
    const auth = await requireRouteUser(req);
    if (!auth.ok) {
      const status = auth.response.status;
      return edgeError({
        status,
        error: {
          code: status === 403
            ? "forbidden"
            : status === 401
              ? "unauthorized"
              : "upstream_unavailable",
          category: status >= 500 ? "transport" : "validation",
          user_message: status === 403
            ? "No tiene permiso para operar con facturas recibidas."
            : status === 401
              ? "Debe iniciar sesión para operar con facturas recibidas."
              : "No se pudo comprobar el acceso al flujo ERP.",
          technical_details: {},
          retryable: status >= 500,
          reconciliation_required: false,
          request_id: null,
          target_id: null,
          dataset_epoch: null,
        },
      });
    }

    const body = asObject(await req.json());
    const contractVersion = integerValue(body.contract_version, null);
    const requestId = requestIdValue(body.request_id);
    activeRequestId = requestId;
    if (contractVersion === FACTURAS_RECIBIDAS_CONTRACT_VERSION) {
      return edgeError({
        status: 426,
        error: {
          code: "contract_upgrade_required",
          category: "validation",
          user_message:
            "Este flujo requiere usar primero «Validar con ERP» y confirmar después el envío.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: null,
          dataset_epoch: null,
        },
      });
    }
    if (contractVersion !== FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION) {
      return edgeError({
        status: 422,
        error: {
          code: "invalid_contract",
          category: "validation",
          user_message: "contract_version=3 es requerido.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: null,
          dataset_epoch: null,
        },
      });
    }
    const rawOperation = text(body.operation, null);
    const requestedOperation = rawOperation;
    if (
      !["validate", "commit", "reconcile"].includes(
        requestedOperation ?? "",
      )
    ) {
      return edgeError({
        status: 422,
        error: {
          code: "invalid_operation",
          category: "validation",
          user_message: "operation debe ser validate, commit o reconcile.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: null,
          dataset_epoch: null,
        },
      });
    }

    const facturaId = text(body.factura_id ?? body.id, null);
    const expectedVersion = integerValue(
      body.expected_version ?? body.row_version ?? body.version,
      null,
    );
    activeFacturaId = facturaId;

    if (!facturaId) {
      return edgeError({
        status: 422,
        error: {
          code: "invalid_invoice",
          category: "validation",
          user_message: "factura_id es requerido.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: null,
          dataset_epoch: null,
        },
      });
    }
    if (!expectedVersion || expectedVersion < 1) {
      return edgeError({
        status: 422,
        error: {
          code: "invalid_invoice",
          category: "validation",
          user_message: "expected_version es requerido.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: null,
          dataset_epoch: null,
        },
      });
    }

    await auth.serviceClient.rpc("mark_stale_factura_recibida_syncs_v3", {
      p_cutoff: "00:10:00",
      p_actor: auth.user.id,
    });

    const { data: factura, error: facturaError } = await auth.serviceClient
      .from("facturasrecibidas")
      .select("*")
      .eq("id", facturaId)
      .single();
    if (facturaError || !factura) {
      if (facturaError) console.error("factura-recibida-send-erp load error", facturaError);
      return edgeError({
        status: facturaError ? 500 : 404,
        error: {
          code: facturaError ? "upstream_unavailable" : "not_found",
          category: facturaError ? "transport" : "validation",
          user_message: facturaError
            ? "No se pudo cargar la factura antes de contactar con Netagro."
            : "Factura no encontrada.",
          technical_details: {},
          retryable: Boolean(facturaError),
          reconciliation_required: false,
          request_id: requestId,
          target_id: null,
          dataset_epoch: null,
        },
      });
    }
    if (isFacturaERPReadOnlyReference(factura as JsonObject)) {
      return edgeError({
        status: 409,
        error: {
          code: "reference_read_only",
          category: "conflict",
          user_message:
            "Esta factura es una referencia importada del ERP y no se puede volver a enviar.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: text((factura as JsonObject).erp_target_id, null),
          dataset_epoch: text((factura as JsonObject).erp_dataset_epoch, null),
        },
      });
    }

    const entryDecision = getFacturaSyncEntryDecision(factura as JsonObject, requestId);
    if (entryDecision.mode === "replay") {
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: requestedOperation,
        request_id: requestId,
        target_id: text((factura as JsonObject).erp_target_id, null),
        dataset_epoch: text((factura as JsonObject).erp_dataset_epoch, null),
        payload_hash: text((factura as JsonObject).erp_payload_hash, null),
        ok: true,
        idempotent_replay: true,
        factura,
        version: integerValue((factura as JsonObject).row_version, null),
        response: (factura as JsonObject).erp_response ?? null,
      });
    }
    if (entryDecision.mode === "blocked_sent") {
      return edgeError({
        status: 409,
        error: {
          code: "idempotency_conflict",
          category: "conflict",
          user_message: "La factura ya fue enviada con otro request_id.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: text((factura as JsonObject).erp_target_id, null),
          dataset_epoch: text((factura as JsonObject).erp_dataset_epoch, null),
        },
      });
    }
    if (entryDecision.mode === "blocked_in_flight") {
      return edgeError({
        status: 202,
        error: {
          code: "ambiguous_commit",
          category: "conflict",
          user_message:
            "Hay un envío ERP en curso; no se iniciará otra operación.",
          technical_details: {},
          retryable: false,
          reconciliation_required: true,
          request_id: entryDecision.syncRequestId,
          target_id: text((factura as JsonObject).erp_target_id, null),
          dataset_epoch: text((factura as JsonObject).erp_dataset_epoch, null),
        },
      });
    }
    if (entryDecision.mode === "blocked_reconciliation") {
      return edgeError({
        status: 409,
        error: {
          code: "ambiguous_commit",
          category: "conflict",
          user_message:
            "El resultado incierto no conserva una identidad válida para reconciliar.",
          technical_details: {},
          retryable: false,
          reconciliation_required: true,
          request_id: requestId,
          target_id: text((factura as JsonObject).erp_target_id, null),
          dataset_epoch: text((factura as JsonObject).erp_dataset_epoch, null),
        },
      });
    }
    const reconciliationMode = requestedOperation === "reconcile";
    if (entryDecision.mode === "reconcile" && !reconciliationMode) {
      return edgeError({
        status: 409,
        error: {
          code: "ambiguous_commit",
          category: "conflict",
          user_message:
            "El resultado anterior es incierto. Debe reconciliarse antes de continuar.",
          technical_details: {},
          retryable: false,
          reconciliation_required: true,
          request_id: entryDecision.syncRequestId,
          target_id: text((factura as JsonObject).erp_target_id, null),
          dataset_epoch: text((factura as JsonObject).erp_dataset_epoch, null),
        },
      });
    }
    if (requestedOperation === "reconcile" && entryDecision.mode !== "reconcile") {
      return edgeError({
        status: 409,
        error: {
          code: "reconciliation_not_required",
          category: "conflict",
          user_message: "La factura no tiene un resultado incierto que reconciliar.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: text((factura as JsonObject).erp_target_id, null),
          dataset_epoch: text((factura as JsonObject).erp_dataset_epoch, null),
        },
      });
    }
    const syncRequestId = entryDecision.syncRequestId;
    activeRequestId = syncRequestId;

    let runtime;
    try {
      runtime = await fetchNetagroRuntime();
    } catch (error) {
      console.error("factura-recibida-send-erp runtime error", error);
      return edgeError({
        status: 503,
        error: {
          code: "upstream_unavailable",
          category: "transport",
          user_message: "No se pudo comprobar el entorno Netagro.",
          technical_details: {},
          retryable: true,
          reconciliation_required: false,
          request_id: syncRequestId,
          target_id: null,
          dataset_epoch: null,
        },
      });
    }
    if (!runtime.target_id || !runtime.dataset_epoch) {
      return edgeError({
        status: 503,
        error: {
          code: "stale_environment",
          category: "environment",
          user_message: "El entorno Netagro no tiene una generación provisionada.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: syncRequestId,
          target_id: runtime.target_id,
          dataset_epoch: runtime.dataset_epoch,
        },
      });
    }
    const targetId = runtime.target_id;
    const datasetEpoch = runtime.dataset_epoch;
    activeTargetId = targetId;
    activeDatasetEpoch = datasetEpoch;
    if (
      (body.target_id && text(body.target_id, null) !== targetId) ||
      (body.dataset_epoch && text(body.dataset_epoch, null) !== datasetEpoch)
    ) {
      return edgeError({
        status: 409,
        error: {
          code: "stale_environment",
          category: "environment",
          user_message: "La generación de Netagro ha cambiado. Vuelva a validar la factura.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
        },
      });
    }
    const { data: localTarget, error: targetError } = await auth.serviceClient
      .from("erp_targets")
      .select("*")
      .eq("id", targetId)
      .eq("active", true)
      .maybeSingle();
    if (
      targetError ||
      !localTarget ||
      text((localTarget as JsonObject).dataset_epoch, null) !== datasetEpoch ||
      !timestampsReferToSameInstant(
        (localTarget as JsonObject).snapshot_at,
        runtime.snapshot_at,
      )
    ) {
      return edgeError({
        status: 409,
        error: {
          code: "stale_environment",
          category: "environment",
          user_message:
            "Supabase y Netagro no identifican la misma generación de datos.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
        },
      });
    }
    if (
      !reconciliationMode &&
      (
        (requestedOperation === "validate" &&
          (!runtime.capabilities.validate ||
            (localTarget as JsonObject).write_mode === "disabled")) ||
        (requestedOperation === "commit" &&
          (!runtime.ready_for_commit ||
            !runtime.capabilities.management_commit ||
            (localTarget as JsonObject).write_mode !== "management"))
      )
    ) {
      return edgeError({
        status: 503,
        error: {
          code: "writer_disabled",
          category: "environment",
          user_message:
            requestedOperation === "validate"
              ? "La validación con Netagro no está habilitada."
              : "Las altas de gestión en Netagro no están habilitadas.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
        },
      });
    }

    const callReadResponse = async (consulta: string) => {
      const { response, payload } = await callNetagroRead(consulta);
      return {
        response,
        payload,
        raw: "",
        result: upstreamResult(response, payload),
      };
    };

    const callRead = async (consulta: string) => {
      const call = await callReadResponse(consulta);
      if (!call.result.ok) {
        throw new Error(call.result.message ?? `Lectura ERP HTTP ${call.response.status}`);
      }
      return call.payload;
    };

    const [{ data: ctb, error: ctbError }, { data: punteos, error: punteosError }] = await Promise.all([
      auth.serviceClient
        .from("facturasrecibidas_ctb")
        .select("*")
        .eq("factura_id", facturaId)
        .order("posicion", { ascending: true }),
      auth.serviceClient
        .from("facturasrecibidas_punteos")
        .select("*")
        .eq("factura_id", facturaId)
        .order("posicion", { ascending: true }),
    ]);
    if (ctbError) throw ctbError;
    if (punteosError) throw punteosError;

    const punteoPreflightIssues = getSelectedPunteoPreflightIssues(
      (punteos ?? []) as JsonObject[],
    );
    if (!reconciliationMode && punteoPreflightIssues.length > 0) {
      return edgeError({
        status: 422,
        error: {
          code: "punteo_conflict",
          category: "validation",
          user_message:
            "Los punteos seleccionados no tienen identidades ERP válidas y únicas.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: requestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
        },
        extra: { validation_errors: punteoPreflightIssues },
      });
    }

    let authoritativeFactura = factura as JsonObject;
    const matchedProveedorTipo = getFacturaProveedorTipoFromMatchEvidence(
      (factura as JsonObject).match_evidence,
      (factura as JsonObject).FRR_idproveedor,
    );
    if (!reconciliationMode) {
      const accountingRules = await loadAndResolveFacturaERPAccountingRules(
        auth.serviceClient,
        factura as JsonObject,
        matchedProveedorTipo,
      );
      authoritativeFactura = forceFacturaERPAccountingDisabled(accountingRules.factura);
      const structuralIssues = await getValidationErrorsForFactura(authoritativeFactura);
      const validationErrors = mergeValidationIssues(
        [...accountingRules.issues, ...structuralIssues],
        [],
      );
      const blockingErrors = validationErrors.filter((error) => error.severity === "error");
      if (blockingErrors.length > 0) {
        return edgeError({
          status: 422,
          error: {
            code: accountingRules.issues.length > 0
              ? "invalid_accounting_rule"
              : "invalid_invoice",
            category: "validation",
            user_message: "La factura no supera la validación.",
            technical_details: {},
            retryable: false,
            reconciliation_required: false,
            request_id: requestId,
            target_id: targetId,
            dataset_epoch: datasetEpoch,
          },
          extra: { validation_errors: validationErrors },
        });
      }
    }

    const cabecera = toERPFacturaPayload(authoritativeFactura);
    const ctbPayload = (ctb ?? []).map((linea, index) =>
      toERPCtbPayload(linea as JsonObject, index + 1)
    );
    const punteosPayload = toERPSelectedPunteosPayload(
      (punteos ?? []) as JsonObject[],
    );
    const { businessFingerprint } = await buildFacturaWriteIdentity({
      cabecera,
      ctb: ctbPayload,
      punteos: punteosPayload,
    });
    let authoritativePayloadHash = text(
      (factura as JsonObject).erp_payload_hash,
      null,
    );
    let authoritativeBusinessFingerprint = text(
      (factura as JsonObject).erp_business_fingerprint,
      businessFingerprint,
    )!;

    const finishPhase = async ({
      phase,
      status,
      response = null,
      httpStatus = null,
      errorCode = null,
      errorCategory = null,
      error = null,
      retryable = false,
      reconciliationRequired = false,
    }: {
      phase: "commit" | "readback" | "reconcile";
      status: "in_progress" | "succeeded" | "failed" | "unknown";
      response?: unknown;
      httpStatus?: number | null;
      errorCode?: string | null;
      errorCategory?: string | null;
      error?: string | null;
      retryable?: boolean;
      reconciliationRequired?: boolean;
    }) => {
      const { data, error: rpcError } = await auth.serviceClient.rpc(
        "finish_factura_recibida_sync_v3",
        {
          p_factura_id: facturaId,
          p_request_id: syncRequestId,
          p_phase: phase,
          p_status: status,
          p_response: response,
          p_http_status: httpStatus,
          p_error_code: errorCode,
          p_error_category: errorCategory,
          p_error: error,
          p_retryable: retryable,
          p_reconciliation_required: reconciliationRequired,
          p_actor: auth.user.id,
        },
      );
      if (rpcError) throw new Error(rpcError.message);
      return asObject(data);
    };

    const readERPReadback = async (
      remoteFacturaId: number,
      expectedFactura: JsonObject,
    ): Promise<JsonObject> => {
      const accountingRequested = String(expectedFactura.FRR_Contabilizar ?? "N") === "S";
      const [headerRaw, ctbRaw, punteosRaw, accountingRaw] = await Promise.all([
        callRead(`facturasrecibidas/${remoteFacturaId}`),
        callRead(`facturasrecibidas/${remoteFacturaId}/ctb`),
        callRead(`facturasrecibidas/${remoteFacturaId}/punteos?include_lines=false`),
        accountingRequested
          ? callRead(`facturasrecibidas/${remoteFacturaId}/asiento`)
          : Promise.resolve({ status: "not_requested" }),
      ]);
      const ctbEnvelope = parseERPArrayEnvelope(ctbRaw, ["items", "ctb", "results", "data"]);
      if (!ctbEnvelope.ok) throw new Error(`Readback CTB invalido: ${ctbEnvelope.error}`);
      const punteosEnvelope = parseERPArrayEnvelope(
        punteosRaw,
        ["items", "punteos", "results", "data"],
      );
      if (!punteosEnvelope.ok) {
        throw new Error(`Readback de punteos invalido: ${punteosEnvelope.error}`);
      }
      return {
        factura: unwrapERPObject(headerRaw),
        ctb: ctbEnvelope.items.map((linea, index) =>
          normalizeFrcPayload(linea, index + 1, { preserveRemoteIds: true })
        ),
        punteos: punteosEnvelope.items.map((punteo, index) =>
          normalizePunteoPayload(punteo, index + 1)
        ),
        accounting: normalizeAccountingReadback(accountingRaw),
      };
    };

    if (reconciliationMode) {
      const reconciliationError = ({
        message,
        code = "ambiguous_commit",
        status = 202,
        category = "conflict",
        extra = {},
      }: {
        message: string;
        code?: string;
        status?: number;
        category?: StructuredERPError["category"];
        extra?: JsonObject;
      }) =>
        edgeError({
          status,
          error: {
            code,
            category,
            user_message: message,
            technical_details: {},
            retryable: false,
            reconciliation_required: true,
            request_id: syncRequestId,
            target_id: targetId,
            dataset_epoch: datasetEpoch,
          },
          extra: {
            requested_request_id: requestId,
            ...extra,
          },
        });
      if (
        !authoritativePayloadHash ||
        !authoritativeBusinessFingerprint ||
        text((factura as JsonObject).erp_target_id, null) !== targetId ||
        text((factura as JsonObject).erp_dataset_epoch, null) !== datasetEpoch
      ) {
        return edgeError({
          status: 409,
          error: {
            code: "stale_environment",
            category: "environment",
            user_message:
              "El intento incierto no pertenece a la generación Netagro actual.",
            technical_details: {},
            retryable: false,
            reconciliation_required: true,
            request_id: syncRequestId,
            target_id: targetId,
            dataset_epoch: datasetEpoch,
          },
        });
      }
      const reconciliationPayloadHash = authoritativePayloadHash;
      const reconciliationBusinessFingerprint =
        authoritativeBusinessFingerprint;
      const { data: attempts, error: attemptError } = await auth.serviceClient
        .from("facturasrecibidas_sync_attempts")
        .select(
          "request_id, phase, status, request_payload, response_payload, erp_target_id, erp_dataset_epoch, circuit, payload_hash, business_fingerprint",
        )
        .eq("factura_id", facturaId)
        .eq("request_id", syncRequestId)
        .in("phase", ["dry_run", "commit"]);
      if (attemptError) throw attemptError;
      const attemptRows = Array.isArray(attempts) ? attempts as JsonObject[] : [];
      const commitAttempt = attemptRows.find((attempt) => attempt.phase === "commit");
      const dryRunAttempt = attemptRows.find((attempt) => attempt.phase === "dry_run");
      if (!commitAttempt || !isEligibleERPCommitAttempt(commitAttempt as JsonObject, syncRequestId)) {
        return reconciliationError({
          message:
            "No existe un intento de envío ambiguo o confirmado que se pueda reconciliar.",
          code: "reconciliation_not_eligible",
          status: 409,
        });
      }
      const expectedCircuit = text(cabecera.FRR_tipofactura, null) === "GE"
        ? "genero"
        : "acreedores";
      const attemptsMatchIdentity = [commitAttempt, dryRunAttempt].every(
        (attempt) =>
          ERPAttemptMatchesIdentity(attempt, {
            targetId,
            datasetEpoch,
            circuit: expectedCircuit,
            payloadHash: reconciliationPayloadHash,
            businessFingerprint: reconciliationBusinessFingerprint,
          }),
      );
      if (!attemptsMatchIdentity) {
        return edgeError({
          status: 409,
          error: {
            code: "stale_environment",
            category: "environment",
            user_message:
              "El intento incierto no coincide con el entorno y circuito validados.",
            technical_details: {},
            retryable: false,
            reconciliation_required: true,
            request_id: syncRequestId,
            target_id: targetId,
            dataset_epoch: datasetEpoch,
          },
        });
      }

      await finishPhase({
        phase: "reconcile",
        status: "in_progress",
        response: { requested_request_id: requestId },
      });

      if (text(dryRunAttempt?.status, null) !== "succeeded") {
        const message = "La validación ERP original no consta como completada.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return reconciliationError({
          message,
          code: "reconciliation_invalid_snapshot",
        });
      }
      const originalRequest = validateERPWriteRequestV2(dryRunAttempt?.request_payload, {
        requestId: syncRequestId,
        expectedDryRun: true,
      });
      if (!originalRequest.ok) {
        const message = originalRequest.errors.join(" ");
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return reconciliationError({
          message: "La validación original no conserva un snapshot verificable.",
          code: "reconciliation_invalid_snapshot",
        });
      }
      const snapshotPunteoIssues = getSelectedPunteoPreflightIssues(
        originalRequest.punteos.map((punteo) => ({ ...punteo, S: true })),
      );
      if (snapshotPunteoIssues.length > 0) {
        const message = "El request original contiene punteos sin identidad ERP valida y unica.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return reconciliationError({
          message: "La validación original contiene punteos sin identidad válida y única.",
          code: "reconciliation_invalid_snapshot",
          extra: { validation_errors: snapshotPunteoIssues },
        });
      }
      if (!ERPWriterRelationsMatchSnapshot({
        currentCtb: ctbPayload,
        currentPunteos: punteosPayload,
        snapshotCtb: originalRequest.ctb,
        snapshotPunteos: originalRequest.punteos,
      })) {
        const message = "CTB o punteos locales ya no coinciden con el request original.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return reconciliationError({
          message: "La distribución CTB o los punteos ya no coinciden con la validación.",
          code: "reconciliation_local_drift",
        });
      }
      const reconciliationCabecera = originalRequest.cabecera;
      const reconciliationCtb = originalRequest.ctb;
      const reconciliationPunteos = originalRequest.punteos;

      let reconciledRemoteId = integerValue(
        (factura as JsonObject).remote_frr_id ?? (factura as JsonObject).FRR_id,
        null,
      );
      if ((!reconciledRemoteId || reconciledRemoteId <= 0) && commitAttempt.status === "succeeded") {
        const committedResponse = validateNetagroWriteResponseV3(
          commitAttempt.response_payload,
          {
            operation: "commit",
            requestId: syncRequestId,
            targetId,
            datasetEpoch,
            payloadHash: reconciliationPayloadHash,
          },
        );
        if (committedResponse.ok) {
          reconciledRemoteId = integerValue(
            committedResponse.response.FRR_id ??
              asObject(committedResponse.response.factura).FRR_id,
            null,
          );
        }
      }
      if (!reconciledRemoteId || reconciledRemoteId <= 0) {
        const duplicateConsulta = buildERPDuplicateConsulta(reconciliationCabecera);
        if (!duplicateConsulta) {
          const message = "Faltan datos para localizar la factura ambigua en el ERP.";
          await finishPhase({ phase: "reconcile", status: "unknown", error: message });
          return reconciliationError({
            message,
            code: "reconciliation_incomplete",
          });
        }
        let duplicateCall: Awaited<ReturnType<typeof callReadResponse>>;
        try {
          duplicateCall = await callReadResponse(duplicateConsulta);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Busqueda ERP no disponible.";
          console.error("factura-recibida-send-erp reconcile duplicate error", error);
          await finishPhase({ phase: "reconcile", status: "unknown", error: message });
          return reconciliationError({
            message: "No se pudo localizar de forma única la factura ambigua.",
            code: "upstream_unavailable",
            category: "transport",
          });
        }
        const duplicateValidation = duplicateCall.result.ok
          ? validateERPDuplicateSearchResponse(duplicateCall.payload, reconciliationCabecera)
          : null;
        if (
          !duplicateValidation?.ok ||
          duplicateValidation.total !== 1 ||
          duplicateValidation.candidates.length !== 1
        ) {
          const message = duplicateValidation?.error ??
            "La busqueda ERP no devolvio exactamente un candidato coincidente.";
          await finishPhase({
            phase: "reconcile",
            status: "unknown",
            response: duplicateCall.payload,
            httpStatus: duplicateCall.response.status,
            error: message,
          });
          return reconciliationError({
            message:
              "La búsqueda ERP no devolvió exactamente una factura coincidente.",
          });
        }
        reconciledRemoteId = integerValue(duplicateValidation.candidates[0].FRR_id, null);
      }

      if (!reconciledRemoteId || reconciledRemoteId <= 0) {
        const message = "No se pudo determinar un FRR_id unico para reconciliar.";
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return reconciliationError({
          message: "No se pudo determinar una referencia ERP única para reconciliar.",
        });
      }

      const reconciledWriteResponse = {
        contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
        request_id: syncRequestId,
        ok: true,
        dry_run: false,
        FRR_id: reconciledRemoteId,
        reconciled: true,
      };
      let reconciledReadback: JsonObject;
      try {
        reconciledReadback = await readERPReadback(reconciledRemoteId, reconciliationCabecera);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Readback ERP no disponible.";
        console.error("factura-recibida-send-erp reconcile readback error", error);
        await finishPhase({ phase: "reconcile", status: "unknown", error: message });
        return reconciliationError({
          message: "La factura candidata no se pudo confirmar mediante lectura ERP.",
          category: "transport",
          extra: { remote_frr_id: reconciledRemoteId },
        });
      }

      if (String(reconciliationCabecera.FRR_Contabilizar ?? "N") === "S") {
        const accountingCheck = validateAccountingReadback(asObject(reconciledReadback.accounting));
        if (!accountingCheck.ok) {
          const message = "El asiento solicitado no esta confirmado como created con Debe/Haber cuadrado.";
          await finishPhase({
            phase: "reconcile",
            status: "unknown",
            response: reconciledReadback,
            error: message,
          });
          return reconciliationError({
            message:
              "La referencia contable no está confirmada con un asiento visible y cuadrado.",
            code: "accounting_unavailable",
            category: "accounting",
            extra: {
              remote_frr_id: reconciledRemoteId,
              accounting: accountingCheck,
            },
          });
        }
      }

      const reconciliationReadbackCheck = validateERPReadbackAgainstWrite({
        remoteFacturaId: reconciledRemoteId,
        cabecera: reconciliationCabecera,
        ctb: reconciliationCtb,
        punteos: reconciliationPunteos,
        readback: reconciledReadback,
      });
      if (!reconciliationReadbackCheck.ok) {
        const message = "El candidato ERP no coincide exactamente con el payload local confirmado.";
        await finishPhase({
          phase: "reconcile",
          status: "unknown",
          response: reconciledReadback,
          error: message,
        });
        return reconciliationError({
          message,
          code: "readback_mismatch",
          extra: {
            remote_frr_id: reconciledRemoteId,
            validation_errors: reconciliationReadbackCheck.errors,
          },
        });
      }

      const { data: finalized, error: finalizeError } = await auth.serviceClient.rpc(
        "finalize_factura_recibida_sync_v3",
        {
          p_factura_id: facturaId,
          p_request_id: syncRequestId,
          p_target_id: targetId,
          p_dataset_epoch: datasetEpoch,
          p_payload_hash: reconciliationPayloadHash,
          p_business_fingerprint: reconciliationBusinessFingerprint,
          p_write_response: reconciledWriteResponse,
          p_readback: reconciledReadback,
          p_actor: auth.user.id,
        },
      );
      if (finalizeError) {
        console.error("factura-recibida-send-erp reconcile finalize error", finalizeError);
        await finishPhase({
          phase: "reconcile",
          status: "unknown",
          response: reconciledReadback,
          error: finalizeError.message,
        });
        return reconciliationError({
          message: "No se pudo confirmar exactamente la factura reconciliada.",
          code: "readback_mismatch",
          extra: { remote_frr_id: reconciledRemoteId },
        });
      }
      await finishPhase({
        phase: "reconcile",
        status: "succeeded",
        response: reconciledReadback,
      });
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: "reconcile",
        request_id: syncRequestId,
        requested_request_id: requestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        payload_hash: reconciliationPayloadHash,
        ok: true,
        reconciled: true,
        ...asObject(finalized),
        response: reconciledWriteResponse,
        readback: reconciledReadback,
      });
    }

    const preflightError = ({
      status,
      code,
      message,
      category = "validation",
      extra = {},
    }: {
      status: number;
      code: string;
      message: string;
      category?: StructuredERPError["category"];
      extra?: JsonObject;
    }) =>
      edgeError({
        status,
        error: {
          code,
          category,
          user_message: message,
          technical_details: {},
          retryable: status >= 500,
          reconciliation_required: false,
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
        },
        extra,
      });

    const proveedorId = integerValue(authoritativeFactura.FRR_idproveedor, null);
    const proveedorTipo = resolveFacturaProveedorTipo(
      authoritativeFactura,
      matchedProveedorTipo,
    );
    if (!proveedorTipo) {
      return preflightError({
        status: 422,
        code: "invalid_invoice",
        message:
          "El tipo de factura no permite determinar si el proveedor es acreedor o agricultor.",
        extra: {
          validation_errors: [{
            field: "FRR_tipofactura",
            message:
              "Falta un tipo de factura ERP válido para resolver el maestro del proveedor.",
            severity: "error",
          }],
        },
      });
    }
    const proveedorLabel = proveedorTipo === "agricultor" ? "agricultor" : "acreedor";
    const proveedorRoute = proveedorTipo === "agricultor" ? "agricultores" : "acreedores";
    let providerCall: Awaited<ReturnType<typeof callReadResponse>>;
    try {
      providerCall = await callReadResponse(`${proveedorRoute}/${proveedorId}`);
    } catch (error) {
      console.error("factura-recibida-send-erp provider lookup error", error);
      return preflightError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        message: `No se pudo validar el ${proveedorLabel} contra el ERP.`,
      });
    }

    const providerStatus = integerValue(
      asObject(providerCall.payload).status ?? asObject(providerCall.payload).status_code,
      providerCall.response.status,
    );
    if (!providerCall.result.ok) {
      if (providerCall.response.status === 404 || providerStatus === 404) {
        return preflightError({
          status: 422,
          code: "invalid_account",
          message: `El ${proveedorLabel} seleccionado no existe en el ERP.`,
          extra: {
            validation_errors: [{
              field: "FRR_idproveedor",
              message: `El ${proveedorLabel} seleccionado no existe en el ERP.`,
              severity: "error",
            }],
          },
        });
      }
      return preflightError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        message: `No se pudo validar el ${proveedorLabel} contra el ERP.`,
      });
    }

    const providerDetail = parseERPProviderDetailResponse(providerCall.payload, proveedorTipo);
    if (!providerDetail.ok) {
      return preflightError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        message: `El ERP devolvió un detalle de ${proveedorLabel} no verificable.`,
      });
    }

    const providerIssues = getERPProviderPreflightIssues(
      authoritativeFactura,
      providerDetail.provider,
      proveedorTipo,
    );
    if (providerIssues.length > 0) {
      return preflightError({
        status: 422,
        code: "invalid_account",
        message: `El ${proveedorLabel} o su cuenta no coinciden con el maestro ERP.`,
        extra: { validation_errors: providerIssues },
      });
    }

    const duplicateConsulta = buildERPDuplicateConsulta(authoritativeFactura);
    if (!duplicateConsulta) {
      return preflightError({
        status: 422,
        code: "invalid_invoice",
        message: "Faltan datos para comprobar el duplicado exacto en el ERP.",
      });
    }

    let duplicateCall: Awaited<ReturnType<typeof callReadResponse>>;
    try {
      duplicateCall = await callReadResponse(duplicateConsulta);
    } catch (error) {
      console.error("factura-recibida-send-erp duplicate lookup error", error);
      return preflightError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        message: "No se pudo comprobar si la factura ya existe en el ERP.",
      });
    }
    if (!duplicateCall.result.ok) {
      return preflightError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        message: "No se pudo comprobar si la factura ya existe en el ERP.",
      });
    }

    const duplicateValidation = validateERPDuplicateSearchResponse(
      duplicateCall.payload,
      authoritativeFactura,
    );
    if (!duplicateValidation.ok) {
      return preflightError({
        status: 503,
        code: "upstream_unavailable",
        category: "transport",
        message: "El ERP devolvió una respuesta de duplicados no verificable.",
      });
    }
    const duplicateCandidates = duplicateValidation.candidates;
    const duplicateTotal = duplicateValidation.total!;
    if (duplicateTotal > 0 || duplicateCandidates.length > 0) {
      return preflightError({
        status: 409,
        code: "duplicate_invoice",
        category: "conflict",
        message:
          "La factura ya existe en el ERP para la misma empresa, ejercicio, proveedor y número.",
        extra: {
          duplicate_total: duplicateTotal,
          duplicate_candidates: duplicateCandidates,
        },
      });
    }

    const validatePayload = buildERPContractV3({
      operation: "validate",
      requestId: syncRequestId,
      targetId,
      datasetEpoch,
      cabecera,
      ctb: ctbPayload,
      punteos: punteosPayload,
    });

    const performValidation = async () => {
      let validationCall;
      try {
        validationCall = await callNetagroWriteV3(validatePayload);
      } catch (error) {
        console.error("factura-recibida-send-erp validation transport error", error);
        return {
          ok: false as const,
          response: edgeError({
            status: 503,
            error: {
              code: "upstream_unavailable",
              category: "transport",
              user_message: "No se pudo validar la factura con Netagro.",
              technical_details: {},
              retryable: true,
              reconciliation_required: false,
              request_id: syncRequestId,
              target_id: targetId,
              dataset_epoch: datasetEpoch,
            },
          }),
        };
      }

      if (!validationCall.response.ok) {
        const structured = parseStructuredERPError(validationCall.payload, {
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
          category: validationCall.response.status >= 500
            ? "transport"
            : "validation",
          retryable: validationCall.response.status >= 500,
        });
        return {
          ok: false as const,
          response: edgeError({
            status: validationCall.response.status,
            error: structured,
          }),
        };
      }

      const responseObject = asObject(validationCall.payload);
      const serverPayloadHash = text(responseObject.payload_hash, null);
      if (!serverPayloadHash || !/^[0-9a-f]{64}$/.test(serverPayloadHash)) {
        return {
          ok: false as const,
          response: edgeError({
            status: 502,
            error: {
              code: "upstream_invalid_response",
              category: "transport",
              user_message: "Netagro no devolvió una validación verificable.",
              technical_details: {},
              retryable: true,
              reconciliation_required: false,
              request_id: syncRequestId,
              target_id: targetId,
              dataset_epoch: datasetEpoch,
            },
          }),
        };
      }
      const contract = validateNetagroWriteResponseV3(validationCall.payload, {
        operation: "validate",
        requestId: syncRequestId,
        targetId,
        datasetEpoch,
        payloadHash: serverPayloadHash,
      });
      if (!contract.ok) {
        return {
          ok: false as const,
          response: edgeError({
            status: 502,
            error: {
              code: "upstream_invalid_response",
              category: "transport",
              user_message: "Netagro no confirmó la identidad de la validación.",
              technical_details: {},
              retryable: true,
              reconciliation_required: false,
              request_id: syncRequestId,
              target_id: targetId,
              dataset_epoch: datasetEpoch,
            },
          }),
        };
      }

      const valid = !hasBlockingERPValidationErrors(validationCall.payload);
      const validationMessage = valid
        ? null
        : "La factura no supera la validación de Netagro.";
      const { data: validationState, error: validationRpcError } =
        await auth.serviceClient.rpc(
          "record_factura_recibida_validation_v3",
          {
            p_factura_id: facturaId,
            p_expected_version: expectedVersion,
            p_request_id: syncRequestId,
            p_target_id: targetId,
            p_dataset_epoch: datasetEpoch,
            p_payload_hash: serverPayloadHash,
            p_business_fingerprint: businessFingerprint,
            p_payload: validatePayload,
            p_response: validationCall.payload,
            p_valid: valid,
            p_http_status: validationCall.response.status,
            p_error_code: valid ? null : "validation_failed",
            p_error_category: valid ? null : "validation",
            p_error: validationMessage,
            p_retryable: false,
            p_actor: auth.user.id,
          },
        );
      if (validationRpcError) {
        return {
          ok: false as const,
          response: edgeError({
            status: rpcErrorStatus(validationRpcError.message),
            error: {
              code: validationRpcError.message.includes("STALE_ENVIRONMENT")
                ? "stale_environment"
                : "validation_state_error",
              category: validationRpcError.message.includes("STALE_ENVIRONMENT")
                ? "environment"
                : "conflict",
              user_message:
                "No se pudo fijar la validación; vuelva a intentarlo antes de enviar.",
              technical_details: {},
              retryable: false,
              reconciliation_required: false,
              request_id: syncRequestId,
              target_id: targetId,
              dataset_epoch: datasetEpoch,
            },
          }),
        };
      }
      authoritativePayloadHash = serverPayloadHash;
      authoritativeBusinessFingerprint = businessFingerprint;
      if (!valid) {
        return {
          ok: false as const,
          response: jsonResponse({
            contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
            operation: "validate",
            request_id: syncRequestId,
            target_id: targetId,
            dataset_epoch: datasetEpoch,
            payload_hash: serverPayloadHash,
            ok: false,
            code: "validation_failed",
            category: "validation",
            user_message: validationMessage,
            error: validationMessage,
            technical_details: {},
            retryable: false,
            reconciliation_required: false,
            validation: validationCall.payload,
            ...asObject(validationState),
          }, 422),
        };
      }
      return {
        ok: true as const,
        payloadHash: serverPayloadHash,
        state: asObject(validationState),
        upstream: validationCall.payload,
      };
    };

    if (requestedOperation === "validate") {
      const validation = await performValidation();
      if (!validation.ok) return validation.response;
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: "validate",
        request_id: syncRequestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        payload_hash: validation.payloadHash,
        ok: true,
        validation: validation.upstream,
        ...validation.state,
      });
    }

    if (!authoritativePayloadHash || !authoritativeBusinessFingerprint) {
      return edgeError({
        status: 409,
        error: {
          code: "validation_required",
          category: "conflict",
          user_message: "Debe validar de nuevo la factura antes de enviarla.",
          technical_details: {},
          retryable: false,
          reconciliation_required: false,
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
        },
      });
    }

    const commitPayload = buildERPContractV3({
      operation: "commit",
      requestId: syncRequestId,
      targetId,
      datasetEpoch,
      cabecera,
      ctb: ctbPayload,
      punteos: punteosPayload,
    });
    const { data: beginData, error: beginError } = await auth.serviceClient.rpc(
      "begin_factura_recibida_sync_v3",
      {
        p_factura_id: facturaId,
        p_expected_version: expectedVersion,
        p_request_id: syncRequestId,
        p_target_id: targetId,
        p_dataset_epoch: datasetEpoch,
        p_payload_hash: authoritativePayloadHash,
        p_business_fingerprint: authoritativeBusinessFingerprint,
        p_payload: commitPayload,
        p_actor: auth.user.id,
      },
    );
    if (beginError) {
      return edgeError({
        status: rpcErrorStatus(beginError.message),
        error: {
          code: beginError.message.includes("VALIDATION_REQUIRED")
            ? "validation_required"
            : beginError.message.includes("STALE_ENVIRONMENT")
              ? "stale_environment"
              : beginError.message.includes("WRITER_DISABLED")
                ? "writer_disabled"
                : "idempotency_conflict",
          category: beginError.message.includes("STALE_ENVIRONMENT") ||
              beginError.message.includes("WRITER_DISABLED")
            ? "environment"
            : "conflict",
          user_message:
            "La validación ya no coincide con el estado actual de la factura.",
          technical_details: {},
          retryable: false,
          reconciliation_required:
            beginError.message.includes("SYNC_RECONCILIATION_REQUIRED"),
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
        },
      });
    }
    const begin = asObject(beginData);
    if (begin.replayed === true && begin.terminal === true) {
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: "commit",
        request_id: syncRequestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        payload_hash: authoritativePayloadHash,
        ok: true,
        idempotent_replay: true,
        factura: begin.factura,
        version: begin.version,
        response: begin.response,
      });
    }
    activeWriterOpened = true;

    let commitCall;
    try {
      commitCall = await callNetagroWriteV3(commitPayload);
    } catch (error) {
      console.error("factura-recibida-send-erp commit transport error", error);
      const state = await finishPhase({
        phase: "commit",
        status: "unknown",
        errorCode: "ambiguous_commit",
        errorCategory: "transport",
        error: "Netagro puede haber creado la factura.",
        retryable: false,
        reconciliationRequired: true,
      });
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: "commit",
        request_id: syncRequestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        payload_hash: authoritativePayloadHash,
        ok: false,
        code: "ambiguous_commit",
        category: "transport",
        user_message:
          "El resultado es incierto. No se reenviará hasta reconciliar.",
        technical_details: {},
        retryable: false,
        reconciliation_required: true,
        factura: state.factura,
        version: state.version,
      }, 202);
    }

    const commitStructuredError = !commitCall.response.ok
      ? parseStructuredERPError(commitCall.payload, {
        request_id: syncRequestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        retryable: commitCall.response.status >= 500,
        reconciliation_required: commitCall.response.status >= 500,
      })
      : null;
    const commitContract = validateNetagroWriteResponseV3(commitCall.payload, {
      operation: "commit",
      requestId: syncRequestId,
      targetId,
      datasetEpoch,
      payloadHash: authoritativePayloadHash,
    });
    const commitHasBlockingValidation =
      hasBlockingERPValidationErrors(commitCall.payload);
    if (
      !commitCall.response.ok ||
      !commitContract.ok ||
      commitHasBlockingValidation
    ) {
      const ambiguous = commitStructuredError?.reconciliation_required === true ||
        commitCall.response.status >= 500 ||
        (commitCall.response.ok && !commitContract.ok);
      const structured = commitStructuredError ?? {
        code: ambiguous ? "ambiguous_commit" : "validation_failed",
        category: ambiguous ? "transport" : "validation",
        user_message: ambiguous
          ? "No se pudo confirmar el resultado del alta en Netagro."
          : "Netagro rechazó el alta de la factura.",
        technical_details: {},
        retryable: false,
        reconciliation_required: ambiguous,
        request_id: syncRequestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
      } satisfies StructuredERPError;
      const state = await finishPhase({
        phase: "commit",
        status: ambiguous ? "unknown" : "failed",
        response: commitCall.payload,
        httpStatus: commitCall.response.status,
        errorCode: structured.code,
        errorCategory: structured.category,
        error: structured.user_message,
        retryable: structured.retryable,
        reconciliationRequired: structured.reconciliation_required,
      });
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: "commit",
        ...structured,
        technical_details: {},
        error: structured.user_message,
        payload_hash: authoritativePayloadHash,
        factura: state.factura,
        version: state.version,
      }, ambiguous ? 202 : commitCall.response.status);
    }

    const commitResponse = asObject(commitCall.payload);
    const remoteFacturaId = integerValue(
      commitResponse.FRR_id ?? asObject(commitResponse.factura).FRR_id,
      null,
    );
    if (!remoteFacturaId || remoteFacturaId <= 0) {
      const state = await finishPhase({
        phase: "commit",
        status: "unknown",
        response: commitCall.payload,
        httpStatus: commitCall.response.status,
        errorCode: "ambiguous_commit",
        errorCategory: "transport",
        error: "Netagro no devolvió un identificador de factura verificable.",
        retryable: false,
        reconciliationRequired: true,
      });
      return jsonResponse({
        contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
        operation: "commit",
        request_id: syncRequestId,
        target_id: targetId,
        dataset_epoch: datasetEpoch,
        payload_hash: authoritativePayloadHash,
        code: "ambiguous_commit",
        category: "transport",
        user_message:
          "Netagro no confirmó el identificador del alta; es necesario reconciliar.",
        error:
          "Netagro no confirmó el identificador del alta; es necesario reconciliar.",
        technical_details: {},
        retryable: false,
        reconciliation_required: true,
        factura: state.factura,
        version: state.version,
      }, 202);
    }

    const normalizedWriteResponse = {
      contract_version: FACTURAS_RECIBIDAS_CONTRACT_VERSION,
      request_id: syncRequestId,
      ok: true,
      dry_run: false,
      FRR_id: remoteFacturaId,
    };
    await finishPhase({
      phase: "commit",
      status: "succeeded",
      response: commitCall.payload,
      httpStatus: commitCall.response.status,
    });
    await finishPhase({ phase: "readback", status: "in_progress" });

    let readback: JsonObject;
    try {
      const accountingRequested = String(authoritativeFactura.FRR_Contabilizar ?? "N") === "S";
      const [headerRaw, ctbRaw, punteosRaw, accountingRaw] = await Promise.all([
        callRead(`facturasrecibidas/${remoteFacturaId}`),
        callRead(`facturasrecibidas/${remoteFacturaId}/ctb`),
        callRead(`facturasrecibidas/${remoteFacturaId}/punteos?include_lines=false`),
        accountingRequested
          ? callRead(`facturasrecibidas/${remoteFacturaId}/asiento`)
          : Promise.resolve({ status: "not_requested" }),
      ]);
      const ctbEnvelope = parseERPArrayEnvelope(ctbRaw, ["items", "ctb", "results", "data"]);
      if (!ctbEnvelope.ok) {
        throw new Error(`Readback CTB invalido: ${ctbEnvelope.error}`);
      }
      const punteosEnvelope = parseERPArrayEnvelope(
        punteosRaw,
        ["items", "punteos", "results", "data"],
      );
      if (!punteosEnvelope.ok) {
        throw new Error(`Readback de punteos invalido: ${punteosEnvelope.error}`);
      }
      readback = {
        factura: unwrapERPObject(headerRaw),
        ctb: ctbEnvelope.items.map((linea, index) =>
          normalizeFrcPayload(linea, index + 1, { preserveRemoteIds: true })
        ),
        punteos: punteosEnvelope.items.map((punteo, index) =>
          normalizePunteoPayload(punteo, index + 1)
        ),
        accounting: normalizeAccountingReadback(accountingRaw),
      };
    } catch (error) {
      console.error("factura-recibida-send-erp readback transport error", error);
      const state = await finishPhase({
        phase: "readback",
        status: "unknown",
        response: normalizedWriteResponse,
        errorCode: "ambiguous_commit",
        errorCategory: "transport",
        error:
          "La factura fue creada, pero no se pudo confirmar su lectura completa.",
        retryable: false,
        reconciliationRequired: true,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
          operation: "commit",
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
          payload_hash: authoritativePayloadHash,
          ok: false,
          code: "ambiguous_commit",
          category: "transport",
          user_message:
            "La factura fue creada, pero no se pudo confirmar su lectura completa.",
          reconciliation_required: true,
          remote_frr_id: remoteFacturaId,
          error: "La factura fue escrita, pero no se pudo confirmar su lectura completa.",
          technical_details: {},
          retryable: false,
          factura: state.factura,
          version: state.version,
        },
        202,
      );
    }

    if (String(authoritativeFactura.FRR_Contabilizar ?? "N") === "S") {
      const accountingCheck = validateAccountingReadback(asObject(readback.accounting));
      if (!accountingCheck.ok) {
        const state = await finishPhase({
          phase: "readback",
          status: "unknown",
          response: readback,
          errorCode: "accounting_unavailable",
          errorCategory: "accounting",
          error:
            "El ERP no devolvio un asiento creado con ID tecnico, numero visible y apuntes Debe/Haber cuadrados.",
          retryable: false,
          reconciliationRequired: true,
        });
        return jsonResponse(
          {
            contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
            operation: "commit",
            request_id: syncRequestId,
            target_id: targetId,
            dataset_epoch: datasetEpoch,
            payload_hash: authoritativePayloadHash,
            code: "accounting_unavailable",
            category: "accounting",
            user_message:
              "La factura fue creada, pero el asiento contable completo aún no está confirmado.",
            technical_details: {},
            reconciliation_required: true,
            retryable: false,
            remote_frr_id: remoteFacturaId,
            accounting: accountingCheck,
            error:
              "La factura fue creada, pero el asiento contable completo aún no está confirmado.",
            factura: state.factura,
            version: state.version,
          },
          202,
        );
      }
    }

    const readbackCheck = validateERPReadbackAgainstWrite({
      remoteFacturaId,
      cabecera,
      ctb: ctbPayload,
      punteos: punteosPayload,
      readback,
    });
    if (!readbackCheck.ok) {
      const state = await finishPhase({
        phase: "readback",
        status: "unknown",
        response: readback,
        errorCode: "readback_mismatch",
        errorCategory: "conflict",
        error: "El readback no coincide exactamente con la cabecera, CTB o punteos enviados.",
        retryable: false,
        reconciliationRequired: true,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
          operation: "commit",
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
          payload_hash: authoritativePayloadHash,
          reconciliation_required: true,
          retryable: false,
          remote_frr_id: remoteFacturaId,
          code: "readback_mismatch",
          category: "conflict",
          user_message:
            "La factura fue escrita, pero su lectura no coincide con el payload confirmado.",
          technical_details: {},
          error: "La factura fue escrita, pero su lectura no coincide con el payload confirmado.",
          validation_errors: readbackCheck.errors,
          factura: state.factura,
          version: state.version,
        },
        202,
      );
    }

    const { data: finalized, error: finalizeError } = await auth.serviceClient.rpc(
      "finalize_factura_recibida_sync_v3",
      {
        p_factura_id: facturaId,
        p_request_id: syncRequestId,
        p_target_id: targetId,
        p_dataset_epoch: datasetEpoch,
        p_payload_hash: authoritativePayloadHash,
        p_business_fingerprint: authoritativeBusinessFingerprint,
        p_write_response: normalizedWriteResponse,
        p_readback: readback,
        p_actor: auth.user.id,
      },
    );
    if (finalizeError) {
      const state = await finishPhase({
        phase: "readback",
        status: "unknown",
        response: readback,
        errorCode: "readback_mismatch",
        errorCategory: "conflict",
        error: "No se pudo cerrar el readback exacto de la factura.",
        retryable: false,
        reconciliationRequired: true,
      });
      return jsonResponse(
        {
          contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
          operation: "commit",
          request_id: syncRequestId,
          target_id: targetId,
          dataset_epoch: datasetEpoch,
          payload_hash: authoritativePayloadHash,
          reconciliation_required: true,
          retryable: false,
          remote_frr_id: remoteFacturaId,
          code: "readback_mismatch",
          category: "conflict",
          user_message: "No se pudo confirmar exactamente el alta en Netagro.",
          technical_details: {},
          error: "No se pudo confirmar exactamente el alta en Netagro.",
          factura: state.factura,
          version: state.version,
        },
        202,
      );
    }

    return jsonResponse({
      contract_version: FACTURAS_RECIBIDAS_WRITE_CONTRACT_VERSION,
      operation: "commit",
      request_id: syncRequestId,
      target_id: targetId,
      dataset_epoch: datasetEpoch,
      payload_hash: authoritativePayloadHash,
      ok: true,
      ...asObject(finalized),
      response: commitCall.payload,
      readback,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    console.error("factura-recibida-send-erp error", error);
    if (activeWriterOpened && activeFacturaId && activeRequestId) {
      return edgeError({
        status: 202,
        error: {
          code: "ambiguous_commit",
          category: "transport",
          user_message:
            "La operación no respondió a tiempo. Se comprobará antes de permitir otro envío.",
          technical_details: {},
          retryable: false,
          reconciliation_required: true,
          request_id: activeRequestId,
          target_id: activeTargetId,
          dataset_epoch: activeDatasetEpoch,
        },
      });
    }
    return edgeError({
      status: rpcErrorStatus(message),
      error: {
        code: message.includes("STALE_ENVIRONMENT")
          ? "stale_environment"
          : message.includes("WRITER_DISABLED")
            ? "writer_disabled"
            : message.includes("VERSION_CONFLICT")
              ? "version_conflict"
              : "upstream_unavailable",
        category: message.includes("STALE_ENVIRONMENT") ||
            message.includes("WRITER_DISABLED")
          ? "environment"
          : message.includes("CONFLICT")
            ? "conflict"
            : "transport",
        user_message:
          "No se pudo completar la operación con Netagro. Revise el estado antes de reintentar.",
        technical_details: {},
        retryable: false,
        reconciliation_required: false,
        request_id: activeRequestId,
        target_id: activeTargetId,
        dataset_epoch: activeDatasetEpoch,
      },
    });
  }
});
