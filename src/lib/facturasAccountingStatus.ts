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
  const status = String(
    factura?.accounting_status ??
      factura?.asiento_estado ??
      factura?.accounting?.status ??
      'not_requested',
  )
    .trim()
    .toLowerCase();

  if (status === 'created') return 'Creada';
  if (status === 'pending' || status === 'requested') return 'Pendiente';
  if (status === 'reference_unverified') return 'Referencia sin verificar';
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
