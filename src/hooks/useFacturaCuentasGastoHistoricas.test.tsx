// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFacturaCuentasGastoHistoricas } from './useFacturaCuentasGastoHistoricas';
import {
  fetchFacturaCuentasGastoHistoricas,
  type FacturaCuentaGastoHistorica,
} from '@/services/facturas';

vi.mock('@/services/facturas', () => ({
  fetchFacturaCuentasGastoHistoricas: vi.fn(),
}));

const historicalAccount = (
  cuenta: string,
): FacturaCuentaGastoHistorica => ({
  cuenta,
  descripcion: `Cuenta ${cuenta}`,
  usosFacturas: 4,
  usosLineas: 4,
  porcentajeFacturas: 0.8,
  importeNetoTotal: '100.00',
  importeAbsolutoTotal: '100.00',
  primeraFechaUso: '2026-01-01',
  ultimaFechaUso: '2026-07-01',
  existeEnCatalogo: true,
  bloqueoFacturas: 'N',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

describe('useFacturaCuentasGastoHistoricas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('descarta la respuesta de un proveedor anterior', async () => {
    const first = deferred<FacturaCuentaGastoHistorica[]>();
    const second = deferred<FacturaCuentaGastoHistorica[]>();
    vi.mocked(fetchFacturaCuentasGastoHistoricas)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(
      ({ proveedorId }) =>
        useFacturaCuentasGastoHistoricas({
          empresaId: 1,
          proveedorId,
          proveedorTipo: 'acreedor',
        }),
      { initialProps: { proveedorId: 17 } },
    );

    await waitFor(() =>
      expect(fetchFacturaCuentasGastoHistoricas).toHaveBeenCalledWith({
        empresaId: 1,
        proveedorId: 17,
        proveedorTipo: 'acreedor',
        limit: 10,
      }),
    );

    rerender({ proveedorId: 18 });
    expect(result.current.items).toEqual([]);
    await waitFor(() =>
      expect(fetchFacturaCuentasGastoHistoricas).toHaveBeenLastCalledWith({
        empresaId: 1,
        proveedorId: 18,
        proveedorTipo: 'acreedor',
        limit: 10,
      }),
    );

    await act(async () => {
      second.resolve([historicalAccount('60200000018')]);
      await second.promise;
    });
    await waitFor(() =>
      expect(result.current.items.map((item) => item.cuenta)).toEqual([
        '60200000018',
      ]),
    );

    await act(async () => {
      first.resolve([historicalAccount('60200000017')]);
      await first.promise;
    });
    expect(result.current.items.map((item) => item.cuenta)).toEqual([
      '60200000018',
    ]);
  });

  it('no consulta sin empresa/proveedor o cuando esta deshabilitado', () => {
    const { rerender } = renderHook(
      (props: { empresaId: number | null; enabled: boolean }) =>
        useFacturaCuentasGastoHistoricas({
          empresaId: props.empresaId,
          proveedorId: 17,
          proveedorTipo: 'acreedor',
          enabled: props.enabled,
        }),
      { initialProps: { empresaId: null, enabled: true } },
    );

    rerender({ empresaId: 1, enabled: false });
    expect(fetchFacturaCuentasGastoHistoricas).not.toHaveBeenCalled();
  });

  it('espera a que el circuito GE u OT este resuelto', async () => {
    vi.mocked(fetchFacturaCuentasGastoHistoricas).mockResolvedValue([
      historicalAccount('60200000001'),
    ]);
    const { result, rerender } = renderHook(
      (props: { proveedorTipo: 'acreedor' | 'agricultor' | null }) =>
        useFacturaCuentasGastoHistoricas({
          empresaId: 1,
          proveedorId: 17,
          proveedorTipo: props.proveedorTipo,
        }),
      { initialProps: { proveedorTipo: null } },
    );

    expect(result.current.items).toEqual([]);
    expect(fetchFacturaCuentasGastoHistoricas).not.toHaveBeenCalled();

    rerender({ proveedorTipo: 'acreedor' });
    await waitFor(() =>
      expect(fetchFacturaCuentasGastoHistoricas).toHaveBeenCalledWith({
        empresaId: 1,
        proveedorId: 17,
        proveedorTipo: 'acreedor',
        limit: 10,
      }),
    );
  });
});
