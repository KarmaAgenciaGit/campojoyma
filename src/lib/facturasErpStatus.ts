export type FacturaERPReferenceStatus =
  | 'valid'
  | 'legacy_unverified'
  | 'stale'
  | 'unverified';

export type FacturaERPRegistrationState =
  | 'not_validated'
  | 'validated'
  | 'sending'
  | 'registered'
  | 'confirmed'
  | 'uncertain'
  | 'error'
  | 'stale_reference';

export type FacturaERPStatusSource = {
  estado?: string | null;
  sync_status?: string | null;
  erp_error?: string | null;
  erp_validation_status?: string | null;
  erp_reference_status?: string | null;
  erp_target_id?: string | null;
  erp_dataset_epoch?: string | null;
  erp_verified_at?: string | null;
  remote_frr_id?: number | null;
  erp_factura_id?: string | null;
  erp_sent_at?: string | null;
  erp_last_read_at?: string | null;
  erp_readback_matches_remote?: boolean | null;
};

export type FacturaERPValidationSource = {
  erp_validation_status?: string | null;
  erp_validation_request_id?: string | null;
  erp_validated_at?: string | null;
  erp_payload_hash?: string | null;
  erp_business_fingerprint?: string | null;
};

const cleanText = (value: unknown) => String(value ?? '').trim();
const normalizeToken = (value: unknown) => cleanText(value).toLowerCase();

const hasRemoteIdentity = (factura: FacturaERPStatusSource) => {
  const remoteId = Number(
    factura.remote_frr_id ?? cleanText(factura.erp_factura_id),
  );
  return Number.isInteger(remoteId) && remoteId > 0;
};

/**
 * Identifica errores heredados de integraciones anteriores que nunca llegaron
 * a quedar ligados a un entorno ERP ni produjeron una identidad remota. Se
 * conserva el dato para auditoría, pero no representa el estado operativo
 * actual de la factura.
 */
export const isFacturaERPLegacyUnscopedError = (
  factura: FacturaERPStatusSource | null | undefined,
): boolean => {
  if (!factura || !cleanText(factura.erp_error)) return false;
  const syncStatus = normalizeToken(factura.sync_status);
  const hasErrorState =
    normalizeToken(factura.estado) === 'error_erp' ||
    ['error', 'failed', 'failure'].includes(syncStatus);
  const hasAnyEnvironmentIdentity =
    Boolean(cleanText(factura.erp_target_id)) ||
    Boolean(cleanText(factura.erp_dataset_epoch));

  return (
    hasErrorState &&
    !hasAnyEnvironmentIdentity &&
    !hasRemoteIdentity(factura) &&
    !cleanText(factura.erp_verified_at) &&
    !cleanText(factura.erp_sent_at)
  );
};

export const normalizeFacturaERPReferenceStatus = (
  value: unknown,
  context: {
    targetId?: string | null;
    datasetEpoch?: string | null;
    hasRemoteIdentity?: boolean;
    verifiedByCurrentReadback?: boolean;
  } = {},
): FacturaERPReferenceStatus => {
  const normalized = normalizeToken(value);
  const targetId = cleanText(context.targetId);
  const datasetEpoch = cleanText(context.datasetEpoch);
  const hasEnvironment = Boolean(targetId && datasetEpoch);

  if (normalized === 'stale') return 'stale';
  if (normalized === 'legacy_unverified') return 'legacy_unverified';
  if (normalized === 'unverified') return 'unverified';
  if (normalized === 'valid') {
    return hasEnvironment ? 'valid' : 'unverified';
  }
  if (
    context.hasRemoteIdentity &&
    context.verifiedByCurrentReadback &&
    hasEnvironment
  ) {
    return 'valid';
  }
  return context.hasRemoteIdentity ? 'legacy_unverified' : 'unverified';
};

export const getFacturaERPRegistrationState = (
  factura: FacturaERPStatusSource | null | undefined,
): FacturaERPRegistrationState => {
  if (!factura) return 'not_validated';

  const syncStatus = normalizeToken(factura.sync_status);
  const referenceStatus = normalizeFacturaERPReferenceStatus(
    factura.erp_reference_status,
    {
      targetId: factura.erp_target_id,
      datasetEpoch: factura.erp_dataset_epoch,
      hasRemoteIdentity: hasRemoteIdentity(factura),
    },
  );

  if (referenceStatus === 'stale' || syncStatus === 'stale') {
    return 'stale_reference';
  }
  if (syncStatus === 'sending') return 'sending';
  if (syncStatus === 'unknown' || syncStatus === 'reconciling') {
    return 'uncertain';
  }
  if (
    normalizeToken(factura.estado) === 'error_erp' ||
    ['error', 'failed', 'failure'].includes(syncStatus)
  ) {
    if (isFacturaERPLegacyUnscopedError(factura)) return 'not_validated';
    return 'error';
  }

  const hasEnvironment =
    Boolean(cleanText(factura.erp_target_id)) &&
    Boolean(cleanText(factura.erp_dataset_epoch));
  const hasVerifiedReadback = Boolean(cleanText(factura.erp_verified_at));
  const hasConfirmedLifecycle =
    normalizeToken(factura.estado) === 'enviada_erp' ||
    syncStatus === 'sent' ||
    Boolean(cleanText(factura.erp_sent_at));
  if (
    referenceStatus === 'valid' &&
    hasEnvironment &&
    hasVerifiedReadback &&
    hasRemoteIdentity(factura) &&
    hasConfirmedLifecycle
  ) {
    return 'confirmed';
  }
  if (
    syncStatus === 'sent' &&
    hasRemoteIdentity(factura) &&
    Boolean(cleanText(factura.erp_last_read_at)) &&
    factura.erp_readback_matches_remote === true
  ) {
    return 'registered';
  }
  if (
    hasRemoteIdentity(factura) &&
    (referenceStatus === 'legacy_unverified' ||
      referenceStatus === 'unverified')
  ) {
    return 'not_validated';
  }
  if (normalizeToken(factura.erp_validation_status) === 'valid') {
    return 'validated';
  }
  return 'not_validated';
};

export const isFacturaERPConfirmed = (
  factura: FacturaERPStatusSource | null | undefined,
) => getFacturaERPRegistrationState(factura) === 'confirmed';

export const invalidateFacturaERPValidation = <
  T extends FacturaERPValidationSource,
>(
  factura: T,
): T => ({
  ...factura,
  erp_validation_status: 'not_validated',
  erp_validation_request_id: null,
  erp_validated_at: null,
  erp_payload_hash: null,
  erp_business_fingerprint: null,
});

export const facturaERPRegistrationLabels: Record<
  FacturaERPRegistrationState,
  string
> = {
  not_validated: 'No validado',
  validated: 'Validado',
  sending: 'Enviando',
  registered: 'Registrada',
  confirmed: 'Confirmado',
  uncertain: 'Resultado incierto',
  error: 'Error',
  stale_reference: 'Referencia caducada',
};
