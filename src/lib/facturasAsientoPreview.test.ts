import { describe, expect, it } from 'vitest';

import { buildFacturaAsientoPreview } from '@/lib/facturasAsientoPreview';

describe('previsualización del asiento de una factura recibida', () => {
  it('cuadra proveedor, gasto e IVA usando exclusivamente los datos del borrador', () => {
    const preview = buildFacturaAsientoPreview(
      {
        proveedor_nombre: 'Proveedor de prueba',
        proveedor_cuenta: '41000000001',
        numero_factura: 'F-100',
        total: 121,
        iva_tramos: [
          { posicion: 1, base: 100, porcentaje: 21, cuota: 21 },
        ],
      },
      [{ posicion: 1, descripcion: '60000000001', importe: 100 }],
    );

    expect(preview.balanced).toBe(true);
    expect(preview.totalDebe).toBe(121);
    expect(preview.totalHaber).toBe(121);
    expect(preview.lines).toEqual([
      expect.objectContaining({ cuenta: '41000000001', debe: 0, haber: 121 }),
      expect.objectContaining({ cuenta: '60000000001', debe: 100, haber: 0 }),
      expect.objectContaining({ titulo: 'IVA soportado 21 %', debe: 21, haber: 0 }),
    ]);
  });

  it('incluye la retención en el Haber y mantiene el asiento previsto cuadrado', () => {
    const preview = buildFacturaAsientoPreview(
      {
        proveedor_nombre: 'Profesional',
        total: 106,
        retencion_porcentaje: 15,
        retencion_importe: 15,
        iva_importe: 21,
        iva_porcentaje: 21,
      },
      [{ posicion: 1, descripcion: '62300000001', importe: 100 }],
    );

    expect(preview.balanced).toBe(true);
    expect(preview.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ titulo: 'Retención 15 %', debe: 0, haber: 15 }),
      ]),
    );
  });

  it('usa la base sin inventar una cuenta cuando todavía no hay desglose de gastos', () => {
    const preview = buildFacturaAsientoPreview(
      {
        numero_factura: 'F-101',
        base_imponible: 80,
        iva_importe: 8,
        iva_porcentaje: 10,
        total: 88,
      },
      [],
    );

    expect(preview.balanced).toBe(true);
    expect(preview.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cuenta: null, titulo: 'Base imponible', debe: 80 }),
      ]),
    );
  });

  it('mantiene importes negativos en el lado natural de un abono', () => {
    const preview = buildFacturaAsientoPreview(
      { total: -417.45, iva_importe: -72.45, iva_porcentaje: 21 },
      [{ posicion: 1, descripcion: '60000000001', importe: -345 }],
    );

    expect(preview.balanced).toBe(true);
    expect(preview.lines[0]).toMatchObject({ debe: 0, haber: -417.45 });
    expect(preview.lines[1]).toMatchObject({ debe: -345, haber: 0 });
    expect(preview.lines[2]).toMatchObject({ debe: -72.45, haber: 0 });
  });
});
