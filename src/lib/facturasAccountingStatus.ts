export type FacturaAccountingStatusSource = {
  accounting_status?: string | null;
  asiento_estado?: string | null;
  accounting?: {
    status?: string | null;
  } | null;
};

export type FacturaAccountingRuntimeSource = {
  accounting_mode?: 'unavailable' | 'official' | string | null;
  capabilities?: {
    accounting_commit?: boolean | null;
  } | null;
};

export const getFacturaAccountingStatusText = (
  factura: FacturaAccountingStatusSource | null | undefined,
  runtime: FacturaAccountingRuntimeSource | null | undefined,
) => {
  const normalizeStatus = (value: unknown) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  const explicitStatus = normalizeStatus(factura?.accounting_status);
  const snapshotStatus =
    normalizeStatus(factura?.asiento_estado) ||
    normalizeStatus(factura?.accounting?.status);
  const status =
    explicitStatus === 'reference_unverified' || !explicitStatus
      ? snapshotStatus || explicitStatus || 'not_requested'
      : explicitStatus;

  if (status === 'created') return 'Contabilizada';
  if (status === 'pending' || status === 'requested') return 'Pendiente';
  if (status === 'reference_unverified') return 'Pendiente de comprobar';
  if (status === 'stale') return 'Caducada';
  if (status === 'error' || status === 'unbalanced') return 'Error';
  if (status === 'unknown') return 'Resultado incierto';
  if (status === 'unavailable') return 'No disponible';
  if (
    runtime?.accounting_mode === 'unavailable' ||
    runtime?.capabilities?.accounting_commit === false
  ) {
    return 'No disponible';
  }
  return 'No solicitada';
};
