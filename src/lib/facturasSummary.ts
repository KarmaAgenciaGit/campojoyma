import type { FacturaRecibida, FacturaRecibidaEstado } from '@/services/apiContracts';

export const facturaEstadoLabels: Record<FacturaRecibidaEstado, string> = {
  borrador: 'Borrador',
  pendiente_revision: 'Pendiente revision',
  validada: 'Validada',
  enviada_erp: 'Enviada',
  error_erp: 'Error de envio',
  descartada: 'Descartada',
};

export const facturaEstadoOrder: FacturaRecibidaEstado[] = [
  'pendiente_revision',
  'validada',
  'enviada_erp',
  'error_erp',
  'borrador',
  'descartada',
];

export type FacturaEstadoSummary = {
  estado: FacturaRecibidaEstado;
  label: string;
  count: number;
  amount: number;
  percentage: number;
};

export type FacturaERPStatus = 'en_erp' | 'fuera_erp';

export const facturaERPStatusLabels: Record<FacturaERPStatus, string> = {
  en_erp: 'Enviado a ERP',
  fuera_erp: 'No enviado a ERP',
};

export type FacturaERPSummary = {
  status: FacturaERPStatus;
  label: string;
  count: number;
  amount: number;
  percentage: number;
};

export type FacturasSummary = {
  facturas: FacturaRecibida[];
  totalCount: number;
  totalAmount: number;
  baseAmount: number;
  ivaAmount: number;
  lineCount: number;
  invoicesWithPdf: number;
  invoicesWithProviderCode: number;
  missingProviderCount: number;
  reviewQueueCount: number;
  pendingReviewCount: number;
  draftCount: number;
  readyForERPCount: number;
  sentToERPCount: number;
  erpErrorCount: number;
  discardedCount: number;
  validationIssueCount: number;
  statusBreakdown: FacturaEstadoSummary[];
  erpBreakdown: FacturaERPSummary[];
  latestFactura: FacturaRecibida | null;
  latestFacturas: FacturaRecibida[];
};

const toNumber = (value: number | string | null | undefined) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const cleanText = (value?: string | null) => (value ?? '').trim();

const getTimestamp = (value?: string | null) => {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const getFacturaActivityDate = (factura: FacturaRecibida) =>
  factura.erp_sent_at ||
  factura.erp_last_attempt_at ||
  factura.updated_at ||
  factura.created_at ||
  factura.fecha_factura ||
  null;

export const isFacturaUnprocessedUploadDraft = (factura: FacturaRecibida) => {
  const hasLineData = factura.facturas_recibidas_lineas?.some(
    (linea) => cleanText(linea.descripcion) || toNumber(linea.importe) > 0,
  );

  return (
    factura.estado === 'borrador' &&
    Boolean(factura.pdf_path) &&
    !cleanText(factura.proveedor_nombre) &&
    !cleanText(factura.proveedor_nif) &&
    !cleanText(factura.numero_factura) &&
    !cleanText(factura.referencia) &&
    !cleanText(factura.fecha_factura) &&
    !toNumber(factura.total) &&
    !hasLineData
  );
};

export const isFacturaInERP = (factura: FacturaRecibida) =>
  factura.estado === 'enviada_erp' ||
  Boolean(factura.erp_sent_at) ||
  factura.is_readonly_reference === true ||
  factura.source_kind === 'erp_reference' ||
  Boolean(factura.remote_frr_id);

export const buildFacturasSummary = (
  facturas: FacturaRecibida[],
  options: { includeDiscarded?: boolean; latestLimit?: number } = {},
): FacturasSummary => {
  const includeDiscarded = options.includeDiscarded ?? false;
  const latestLimit = options.latestLimit ?? 5;
  const visibleFacturas = facturas.filter((factura) => {
    if (isFacturaUnprocessedUploadDraft(factura)) {
      return false;
    }

    return includeDiscarded || factura.estado !== 'descartada';
  });

  const byEstado = facturaEstadoOrder.reduce(
    (acc, estado) => ({ ...acc, [estado]: 0 }),
    {} as Record<FacturaRecibidaEstado, number>,
  );
  const amountByEstado = facturaEstadoOrder.reduce(
    (acc, estado) => ({ ...acc, [estado]: 0 }),
    {} as Record<FacturaRecibidaEstado, number>,
  );
  const byERPStatus: Record<FacturaERPStatus, number> = {
    en_erp: 0,
    fuera_erp: 0,
  };
  const amountByERPStatus: Record<FacturaERPStatus, number> = {
    en_erp: 0,
    fuera_erp: 0,
  };
  let totalAmount = 0;
  let baseAmount = 0;
  let ivaAmount = 0;
  let lineCount = 0;
  let invoicesWithPdf = 0;
  let invoicesWithProviderCode = 0;
  let missingProviderCount = 0;
  let validationIssueCount = 0;

  visibleFacturas.forEach((factura) => {
    const total = toNumber(factura.total);
    const erpStatus: FacturaERPStatus = isFacturaInERP(factura) ? 'en_erp' : 'fuera_erp';
    byEstado[factura.estado] += 1;
    amountByEstado[factura.estado] += total;
    byERPStatus[erpStatus] += 1;
    amountByERPStatus[erpStatus] += total;
    totalAmount += total;
    baseAmount += toNumber(factura.base_imponible);
    ivaAmount += toNumber(factura.iva_importe);
    lineCount += factura.facturas_recibidas_lineas?.length ?? 0;

    if (factura.pdf_path) {
      invoicesWithPdf += 1;
    }

    if (cleanText(factura.proveedor_codigo)) {
      invoicesWithProviderCode += 1;
    }

    if (!cleanText(factura.proveedor_nombre) && !cleanText(factura.proveedor_nif)) {
      missingProviderCount += 1;
    }

    if ((factura.validation_errors?.length ?? 0) > 0) {
      validationIssueCount += 1;
    }

  });

  const totalCount = visibleFacturas.length;
  const latestFacturas = [...visibleFacturas]
    .sort((left, right) => getTimestamp(getFacturaActivityDate(right)) - getTimestamp(getFacturaActivityDate(left)))
    .slice(0, latestLimit);

  return {
    facturas: visibleFacturas,
    totalCount,
    totalAmount,
    baseAmount,
    ivaAmount,
    lineCount,
    invoicesWithPdf,
    invoicesWithProviderCode,
    missingProviderCount,
    reviewQueueCount: byEstado.borrador + byEstado.pendiente_revision,
    pendingReviewCount: byEstado.pendiente_revision,
    draftCount: byEstado.borrador,
    readyForERPCount: visibleFacturas.filter(
      (factura) =>
        !isFacturaInERP(factura) &&
        factura.estado !== 'descartada' &&
        (factura.estado === 'validada' || factura.estado === 'error_erp' || Boolean(factura.erp_payload)),
    ).length,
    sentToERPCount: byERPStatus.en_erp,
    erpErrorCount: byEstado.error_erp,
    discardedCount: facturas.filter((factura) => factura.estado === 'descartada').length,
    validationIssueCount,
    statusBreakdown: facturaEstadoOrder.map((estado) => ({
      estado,
      label: facturaEstadoLabels[estado],
      count: byEstado[estado],
      amount: amountByEstado[estado],
      percentage: totalCount > 0 ? (byEstado[estado] / totalCount) * 100 : 0,
    })),
    erpBreakdown: (['en_erp', 'fuera_erp'] as FacturaERPStatus[]).map((status) => ({
      status,
      label: facturaERPStatusLabels[status],
      count: byERPStatus[status],
      amount: amountByERPStatus[status],
      percentage: totalCount > 0 ? (byERPStatus[status] / totalCount) * 100 : 0,
    })),
    latestFactura: latestFacturas[0] ?? null,
    latestFacturas,
  };
};
