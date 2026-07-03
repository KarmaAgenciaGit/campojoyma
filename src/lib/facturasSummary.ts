import type { FacturaRecibida, FacturaRecibidaEstado } from '@/services/apiContracts';

export const facturaEstadoLabels: Record<FacturaRecibidaEstado, string> = {
  borrador: 'Borrador',
  pendiente_revision: 'Pendiente revision',
  validada: 'Validada',
  enviada_gsbase: 'Enviada',
  error_gsbase: 'Error de envio',
  descartada: 'Descartada',
};

export const facturaEstadoOrder: FacturaRecibidaEstado[] = [
  'pendiente_revision',
  'validada',
  'enviada_gsbase',
  'error_gsbase',
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

export type FacturaGsbaseStatus = 'en_gys' | 'fuera_gys';

export const facturaGsbaseStatusLabels: Record<FacturaGsbaseStatus, string> = {
  en_gys: 'Enviado a Netagro',
  fuera_gys: 'No enviado a Netagro',
};

export type FacturaGsbaseSummary = {
  status: FacturaGsbaseStatus;
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
  pendingPaymentAmount: number;
  lineCount: number;
  albaranCount: number;
  invoicesWithAlbaranes: number;
  invoicesWithPdf: number;
  invoicesWithProviderCode: number;
  missingProviderCount: number;
  reviewQueueCount: number;
  pendingReviewCount: number;
  draftCount: number;
  readyForGsbaseCount: number;
  sentToGsbaseCount: number;
  gsbaseErrorCount: number;
  discardedCount: number;
  validationIssueCount: number;
  statusBreakdown: FacturaEstadoSummary[];
  gsbaseBreakdown: FacturaGsbaseSummary[];
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

export const parseFacturaAlbaranes = (value?: string | null) =>
  cleanText(value)
    .split(/[;,\n\r|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const getFacturaActivityDate = (factura: FacturaRecibida) =>
  factura.gsbase_sent_at ||
  factura.gsbase_last_attempt_at ||
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

export const isFacturaInGys = (factura: FacturaRecibida) =>
  factura.estado === 'enviada_gsbase' || Boolean(factura.gsbase_sent_at);

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
  const byGsbaseStatus: Record<FacturaGsbaseStatus, number> = {
    en_gys: 0,
    fuera_gys: 0,
  };
  const amountByGsbaseStatus: Record<FacturaGsbaseStatus, number> = {
    en_gys: 0,
    fuera_gys: 0,
  };
  const albaranCodes = new Set<string>();

  let totalAmount = 0;
  let baseAmount = 0;
  let ivaAmount = 0;
  let pendingPaymentAmount = 0;
  let lineCount = 0;
  let invoicesWithAlbaranes = 0;
  let invoicesWithPdf = 0;
  let invoicesWithProviderCode = 0;
  let missingProviderCount = 0;
  let validationIssueCount = 0;

  visibleFacturas.forEach((factura) => {
    const total = toNumber(factura.total);
    const gsbaseStatus: FacturaGsbaseStatus = isFacturaInGys(factura) ? 'en_gys' : 'fuera_gys';
    byEstado[factura.estado] += 1;
    amountByEstado[factura.estado] += total;
    byGsbaseStatus[gsbaseStatus] += 1;
    amountByGsbaseStatus[gsbaseStatus] += total;
    totalAmount += total;
    baseAmount += toNumber(factura.base_imponible);
    ivaAmount += toNumber(factura.iva_importe);
    pendingPaymentAmount += toNumber(factura.pendiente_pago);
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

    const albaranes = parseFacturaAlbaranes(factura.albaranes);
    if (albaranes.length > 0) {
      invoicesWithAlbaranes += 1;
      albaranes.forEach((albaran) => albaranCodes.add(albaran));
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
    pendingPaymentAmount,
    lineCount,
    albaranCount: albaranCodes.size,
    invoicesWithAlbaranes,
    invoicesWithPdf,
    invoicesWithProviderCode,
    missingProviderCount,
    reviewQueueCount: byEstado.borrador + byEstado.pendiente_revision,
    pendingReviewCount: byEstado.pendiente_revision,
    draftCount: byEstado.borrador,
    readyForGsbaseCount: visibleFacturas.filter(
      (factura) =>
        !isFacturaInGys(factura) &&
        factura.estado !== 'descartada' &&
        (factura.estado === 'validada' || factura.estado === 'error_gsbase' || Boolean(factura.gsbase_payload)),
    ).length,
    sentToGsbaseCount: byGsbaseStatus.en_gys,
    gsbaseErrorCount: byEstado.error_gsbase,
    discardedCount: facturas.filter((factura) => factura.estado === 'descartada').length,
    validationIssueCount,
    statusBreakdown: facturaEstadoOrder.map((estado) => ({
      estado,
      label: facturaEstadoLabels[estado],
      count: byEstado[estado],
      amount: amountByEstado[estado],
      percentage: totalCount > 0 ? (byEstado[estado] / totalCount) * 100 : 0,
    })),
    gsbaseBreakdown: (['en_gys', 'fuera_gys'] as FacturaGsbaseStatus[]).map((status) => ({
      status,
      label: facturaGsbaseStatusLabels[status],
      count: byGsbaseStatus[status],
      amount: amountByGsbaseStatus[status],
      percentage: totalCount > 0 ? (byGsbaseStatus[status] / totalCount) * 100 : 0,
    })),
    latestFactura: latestFacturas[0] ?? null,
    latestFacturas,
  };
};
