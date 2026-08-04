import { describe, expect, it } from 'vitest';

import { calculateFacturaIvaCuota, isFacturaIvaCuotaOutdated } from './facturasIva';

describe('cálculo individual de cuotas de IVA', () => {
  it('mantiene el redondeo a dos decimales del formulario', () => {
    expect(calculateFacturaIvaCuota(42_341.52, 21)).toBe(8_891.72);
    expect(calculateFacturaIvaCuota(-100, 21)).toBe(-21);
  });

  it('solo calcula cuando existen base y porcentaje', () => {
    expect(calculateFacturaIvaCuota(null, 21)).toBeNull();
    expect(calculateFacturaIvaCuota(100, null)).toBeNull();
    expect(calculateFacturaIvaCuota(0, 0)).toBe(0);
  });

  it('activa la calculadora únicamente si la cuota no coincide', () => {
    expect(isFacturaIvaCuotaOutdated(42_341.52, 21, 8_891.72)).toBe(false);
    expect(isFacturaIvaCuotaOutdated(42_341.52, 21, 8_000)).toBe(true);
    expect(isFacturaIvaCuotaOutdated(100, 10, null)).toBe(true);
    expect(isFacturaIvaCuotaOutdated(null, 10, null)).toBe(false);
  });

  it('se reactiva al cambiar el porcentaje y se apaga tras recalcular', () => {
    const cuotaInicial = calculateFacturaIvaCuota(100, 21);
    expect(cuotaInicial).toBe(21);
    expect(isFacturaIvaCuotaOutdated(100, 21, cuotaInicial)).toBe(false);

    expect(isFacturaIvaCuotaOutdated(100, 10, cuotaInicial)).toBe(true);
    const cuotaActualizada = calculateFacturaIvaCuota(100, 10);
    expect(cuotaActualizada).toBe(10);
    expect(isFacturaIvaCuotaOutdated(100, 10, cuotaActualizada)).toBe(false);
  });
});
