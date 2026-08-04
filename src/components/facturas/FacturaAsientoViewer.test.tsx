// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FacturaAsientoViewer } from './FacturaAsientoViewer';

afterEach(() => {
  cleanup();
});

describe('FacturaAsientoViewer', () => {
  it('abre el asiento real recuperado de Netagro para una factura contabilizada', async () => {
    render(
      <FacturaAsientoViewer
        factura={{
          asiento_estado: 'created',
          asiento_numero: '48732',
          asiento_fecha: '2026-06-30',
          asiento_total_debe: 121,
          asiento_total_haber: 121,
          asiento_cuadrado: true,
          numero_factura: 'F-100',
          ejercicio: 25,
          asiento_lineas: [
            {
              posicion: 1,
              cuenta: '41000000001',
              titulo: 'Proveedor de prueba',
              descripcion: 'Factura de prueba',
              documento: 'F-100',
              debe: 0,
              haber: 121,
            },
            {
              posicion: 2,
              cuenta: '60000000001',
              titulo: 'Cuenta de gasto',
              descripcion: 'Factura de prueba',
              documento: 'F-100',
              debe: 100,
              haber: 0,
            },
            {
              posicion: 3,
              cuenta: '47200000001',
              titulo: 'IVA soportado',
              descripcion: 'Factura de prueba',
              documento: 'F-100',
              debe: 21,
              haber: 0,
            },
          ],
        }}
        gastos={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ver asiento' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Asiento contable' })).toBeInTheDocument();
    expect(within(dialog).getByText('Asiento registrado en Netagro.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Asiento n.º 48732/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Vista previa calculada/)).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('genera una previsualización en memoria sin presentarla como asiento real', async () => {
    render(
      <FacturaAsientoViewer
        factura={{
          asiento_estado: 'not_requested',
          proveedor_nombre: 'Proveedor de prueba',
          proveedor_cuenta: '41000000001',
          numero_factura: 'F-101',
          fecha_factura: '2026-07-01',
          ejercicio: 25,
          total: 121,
          iva_tramos: [
            { posicion: 1, base: 100, porcentaje: 21, cuota: 21 },
          ],
        }}
        gastos={[{ posicion: 1, descripcion: '60000000001', importe: 100 }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Ver asiento' }));

    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Vista previa del asiento' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Calculado con los datos actuales de la factura. Aún no se ha registrado.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Vista previa calculada con los datos actuales.')).toBeInTheDocument();
    const table = within(dialog).getByRole('table', { name: 'Detalle del asiento contable' });
    expect(within(table).getByText('Proveedor de prueba')).toBeInTheDocument();
    expect(within(table).getByText('IVA soportado 21 %')).toBeInTheDocument();
    expect(within(table).getAllByText('FRA. Proveedor de prueba')).toHaveLength(3);
    expect(within(table).getByText('60000000001')).toBeInTheDocument();
  });
});
