const IVA_CALCULATION_EPSILON = 0.000001;

export const calculateFacturaIvaCuota = (
  base: number | null | undefined,
  porcentaje: number | null | undefined,
): number | null => {
  if (
    base === null ||
    base === undefined ||
    porcentaje === null ||
    porcentaje === undefined ||
    !Number.isFinite(base) ||
    !Number.isFinite(porcentaje) ||
    porcentaje < 0
  ) {
    return null;
  }

  return Number(((base * porcentaje) / 100).toFixed(2));
};

export const isFacturaIvaCuotaOutdated = (
  base: number | null | undefined,
  porcentaje: number | null | undefined,
  cuota: number | null | undefined,
): boolean => {
  const calculada = calculateFacturaIvaCuota(base, porcentaje);
  if (calculada === null) return false;
  if (cuota === null || cuota === undefined || !Number.isFinite(cuota)) return true;
  return Math.abs(cuota - calculada) > IVA_CALCULATION_EPSILON;
};
