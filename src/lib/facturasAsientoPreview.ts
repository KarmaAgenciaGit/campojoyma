import type {
  FacturaRecibida,
  FacturaRecibidaAsientoLinea,
  FacturaRecibidaLinea,
} from '@/services/apiContracts';

export type FacturaAsientoPreview = {
  lines: FacturaRecibidaAsientoLinea[];
  totalDebe: number;
  totalHaber: number;
  balanced: boolean;
};

const TOLERANCE = 0.01;

const finiteNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const cleanText = (value: unknown): string | null => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};

const debitCredit = (amount: number, naturalSide: 'debe' | 'haber') => {
  return {
    debe: naturalSide === 'debe' ? amount : 0,
    haber: naturalSide === 'haber' ? amount : 0,
  };
};

export const buildFacturaAsientoPreview = (
  factura: Partial<FacturaRecibida>,
  gastos: FacturaRecibidaLinea[],
): FacturaAsientoPreview => {
  const documento = cleanText(factura.numero_factura);
  const proveedor = cleanText(factura.proveedor_nombre);
  const concepto =
    cleanText(factura.concepto_asiento) ??
    (proveedor ? `FRA. ${proveedor}` : documento ? `FRA. ${documento}` : 'Factura recibida');
  const lines: FacturaRecibidaAsientoLinea[] = [];

  const appendLine = (
    line: Omit<FacturaRecibidaAsientoLinea, 'posicion'>,
  ) => {
    lines.push({ ...line, posicion: lines.length + 1 });
  };

  const expenseRows = gastos
    .map((gasto) => ({
      cuenta: cleanText(gasto.descripcion),
      importe: finiteNumber(gasto.importe),
    }))
    .filter(
      (gasto): gasto is { cuenta: string | null; importe: number } =>
        gasto.importe !== null &&
        (Boolean(gasto.cuenta) || Math.abs(gasto.importe) > TOLERANCE),
    );

  if (expenseRows.length === 0) {
    const base = finiteNumber(factura.base_imponible);
    if (base !== null && Math.abs(base) > TOLERANCE) {
      expenseRows.push({ cuenta: null, importe: base });
    }
  }

  const ivaRows = (factura.iva_tramos ?? [])
    .map((tramo) => ({
      cuota: finiteNumber(tramo.cuota),
      porcentaje: finiteNumber(tramo.porcentaje),
    }))
    .filter(
      (tramo): tramo is { cuota: number; porcentaje: number | null } =>
        tramo.cuota !== null && Math.abs(tramo.cuota) > TOLERANCE,
    );

  if (ivaRows.length === 0) {
    const cuota = finiteNumber(factura.iva_importe);
    if (cuota !== null && Math.abs(cuota) > TOLERANCE) {
      ivaRows.push({
        cuota,
        porcentaje: finiteNumber(factura.iva_porcentaje),
      });
    }
  }

  const retencion = finiteNumber(factura.retencion_importe) ?? 0;
  const expenseTotal = expenseRows.reduce((sum, gasto) => sum + gasto.importe, 0);
  const ivaTotal = ivaRows.reduce((sum, tramo) => sum + tramo.cuota, 0);
  const suppliedTotal = finiteNumber(factura.total);
  const supplierTotal = suppliedTotal ?? expenseTotal + ivaTotal - retencion;

  if (
    Math.abs(supplierTotal) > TOLERANCE ||
    cleanText(factura.proveedor_cuenta) ||
    proveedor
  ) {
    appendLine({
      id: 'preview-proveedor',
      cuenta: cleanText(factura.proveedor_cuenta),
      titulo: proveedor,
      descripcion: concepto,
      documento,
      ...debitCredit(supplierTotal, 'haber'),
    });
  }

  expenseRows.forEach((gasto, index) => {
    appendLine({
      id: `preview-gasto-${index + 1}`,
      cuenta: gasto.cuenta,
      titulo: gasto.cuenta ? 'Cuenta de gasto' : 'Base imponible',
      descripcion: concepto,
      documento,
      ...debitCredit(gasto.importe, 'debe'),
    });
  });

  ivaRows.forEach((tramo, index) => {
    const porcentaje = tramo.porcentaje;
    appendLine({
      id: `preview-iva-${index + 1}`,
      cuenta: null,
      titulo: porcentaje === null ? 'IVA soportado' : `IVA soportado ${porcentaje} %`,
      descripcion: concepto,
      documento,
      ...debitCredit(tramo.cuota, 'debe'),
    });
  });

  if (Math.abs(retencion) > TOLERANCE) {
    const porcentaje = finiteNumber(factura.retencion_porcentaje);
    appendLine({
      id: 'preview-retencion',
      cuenta: null,
      titulo: porcentaje === null ? 'Retención' : `Retención ${porcentaje} %`,
      descripcion: concepto,
      documento,
      ...debitCredit(retencion, 'haber'),
    });
  }

  const totalDebe = lines.reduce((sum, line) => sum + line.debe, 0);
  const totalHaber = lines.reduce((sum, line) => sum + line.haber, 0);

  return {
    lines,
    totalDebe,
    totalHaber,
    balanced: Math.abs(totalDebe - totalHaber) <= TOLERANCE,
  };
};
