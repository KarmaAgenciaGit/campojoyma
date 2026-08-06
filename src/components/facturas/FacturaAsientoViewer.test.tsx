// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchCuentaIvaMock } = vi.hoisted(() => ({
  fetchCuentaIvaMock: vi.fn(),
}));

vi.mock('@/services/facturas', () => ({
  fetchFacturaCuentaIvaHistorica: fetchCuentaIvaMock,
}));

import { FacturaAsientoViewer } from './FacturaAsientoViewer';
import type { FacturaCuentaIvaHistorica } from '@/services/facturas';

const resolvedIvaAccount = (
  overrides: Partial<FacturaCuentaIvaHistorica> = {},
): FacturaCuentaIvaHistorica => ({
  estado: 'resuelta',
  cuenta: '47200000008',
  descripcion: 'IVA SOPORTADO 21%',
  usosFacturas: 100,
  totalFacturas: 100,
  confianza: 1,
  criterio: {
    minFacturas: 3,
    minConfianza: 0.98,
    requiereLiderUnico: true,
    origen: 'asientos_reales_enlazados_FR',
    coincidenciaImporte: 'apunte_472_unico_coincide_con_cuota_iva',
  },
  alternativas: [],
  filtros: {
    empresaId: 1,
    ejercicio: 25,
    regimenId: 2110,
    tipoFactura: 'OT',
    porcentaje: 21,
    proveedorId: null,
  },
  ...overrides,
});

beforeEach(() => {
  fetchCuentaIvaMock.mockReset();
});

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
    expect(fetchCuentaIvaMock).not.toHaveBeenCalled();

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

  it('resuelve la cuenta historica al abrir sin modificar la factura', async () => {
    let resolveRequest!: (value: FacturaCuentaIvaHistorica) => void;
    fetchCuentaIvaMock.mockReturnValue(
      new Promise<FacturaCuentaIvaHistorica>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const factura = {
      id: 'factura-ejido',
      asiento_estado: 'not_requested',
      proveedor_nombre: 'EJIDO CARTON, S.L.',
      proveedor_codigo: '596',
      proveedor_cuenta: '41000000596',
      numero_factura: '26140889',
      fr_alm: '1',
      ejercicio: 25,
      tipo_iva_codigo: '2110',
      fr_sufa: 'OT',
      total: 121,
      iva_tramos: [
        { posicion: 1 as const, base: 100, porcentaje: 21, cuota: 21 },
      ],
    };
    const initialFactura = structuredClone(factura);

    render(
      <FacturaAsientoViewer
        factura={factura}
        gastos={[{ posicion: 1, descripcion: '60000000001', importe: 100 }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver asiento' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Consultando cuentas de IVA…')).toBeInTheDocument();
    expect(fetchCuentaIvaMock).toHaveBeenCalledWith({
      empresaId: 1,
      ejercicio: 25,
      regimenId: 2110,
      tipoFactura: 'OT',
      porcentaje: 21,
    });
    expect(fetchCuentaIvaMock.mock.calls[0][0]).not.toHaveProperty('proveedorId');

    await act(async () => {
      resolveRequest(resolvedIvaAccount());
    });

    const table = within(dialog).getByRole('table', {
      name: 'Detalle del asiento contable',
    });
    expect(await within(table).findByText('47200000008')).toBeInTheDocument();
    expect(factura).toEqual(initialFactura);
  });

  it('mantiene el guion cuando el historico de la cuenta es ambiguo', async () => {
    fetchCuentaIvaMock.mockResolvedValue(
      resolvedIvaAccount({
        estado: 'ambiguo',
        cuenta: null,
        descripcion: null,
        usosFacturas: 8,
        totalFacturas: 10,
        confianza: 0.8,
      }),
    );

    render(
      <FacturaAsientoViewer
        factura={{
          asiento_estado: 'not_requested',
          proveedor_nombre: 'Proveedor ambiguo',
          proveedor_cuenta: '41000000001',
          numero_factura: 'F-AMB',
          fr_alm: '1',
          ejercicio: 25,
          tipo_iva_codigo: '2110',
          fr_sufa: 'OT',
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
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveAttribute(
        'aria-busy',
        'false',
      ),
    );
    const table = within(dialog).getByRole('table', {
      name: 'Detalle del asiento contable',
    });
    const ivaTitle = within(table).getByText('IVA soportado 21 %');
    const ivaRow = ivaTitle.closest('tr');
    expect(ivaRow).not.toBeNull();
    expect(ivaRow?.querySelectorAll('td')[1]).toHaveTextContent('—');
  });
});
