// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CuentaContableCombobox } from './CuentaContableCombobox';
import { fetchFacturaCuentas } from '@/services/facturas';

vi.mock('@/services/facturas', () => ({
  fetchFacturaCuentas: vi.fn(),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

describe('CuentaContableCombobox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchFacturaCuentas).mockResolvedValue([
      {
        value: '60200000001',
        label: '60200000001 - Material de oficina',
        description: 'Material de oficina',
        nif: null,
      },
      {
        value: '60200000002',
        label: '60200000002 - Servicios exteriores',
        description: 'Servicios exteriores',
        nif: null,
      },
    ]);
  });

  it('busca por empresa y permite seleccionar con teclado', async () => {
    const onChange = vi.fn();
    render(
      <CuentaContableCombobox
        empresaId={1}
        value={null}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'material' } });

    await screen.findByText('Material de oficina');
    expect(fetchFacturaCuentas).toHaveBeenCalledWith({
      empresaId: 1,
      search: 'material',
      limit: 25,
    });

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('60200000001'));
  });

  it('conserva visible un valor histórico aunque el catálogo no lo encuentre', async () => {
    vi.mocked(fetchFacturaCuentas).mockResolvedValue([]);
    render(
      <CuentaContableCombobox
        empresaId={1}
        value="69999999999"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox')).toHaveValue('69999999999');
    await waitFor(() =>
      expect(fetchFacturaCuentas).toHaveBeenCalledWith({
        empresaId: 1,
        cuenta: '69999999999',
        limit: 10,
      }),
    );
    expect(screen.getByRole('combobox')).toHaveValue('69999999999');
  });

  it('limita la búsqueda visible a número o descripción y no usa el NIF oculto', async () => {
    vi.mocked(fetchFacturaCuentas).mockImplementation(async (options) => {
      if (
        typeof options !== 'string' &&
        options.cuenta === '40000001289'
      ) {
        return [
          {
            value: '40000001289',
            label: '40000001289 - CANALEX, S.A.T. Nº 9207',
            description: 'CANALEX, S.A.T. Nº 9207',
            nif: 'F60300000',
          },
        ];
      }
      return [
        {
          value: '40000001289',
          label: '40000001289 - CANALEX, S.A.T. Nº 9207',
          description: 'CANALEX, S.A.T. Nº 9207',
          nif: 'F60300000',
        },
        {
          value: '60300000001',
          label: '60300000001 - Subcontrataciones',
          description: 'Subcontrataciones',
          nif: null,
        },
      ];
    });

    render(
      <CuentaContableCombobox
        empresaId={1}
        value="40000001289"
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByRole('combobox');
    await waitFor(() =>
      expect(input).toHaveValue('40000001289 - CANALEX, S.A.T. Nº 9207'),
    );

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '603' } });

    await screen.findByText('Subcontrataciones');
    expect(
      screen.queryByText('CANALEX, S.A.T. Nº 9207'),
    ).not.toBeInTheDocument();
    expect(fetchFacturaCuentas).toHaveBeenCalledWith({
      empresaId: 1,
      cuenta: '603',
      limit: 25,
    });
  });

  it('mantiene el prefijo de cuenta al paginar una búsqueda numérica', async () => {
    vi.mocked(fetchFacturaCuentas)
      .mockResolvedValueOnce([
        {
          value: '60200000001',
          label: '60200000001 - Material de oficina',
          description: 'Material de oficina',
          nif: null,
        },
        {
          value: '60200000002',
          label: '60200000002 - Servicios exteriores',
          description: 'Servicios exteriores',
          nif: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          value: '60200000003',
          label: '60200000003 - Reparaciones',
          description: 'Reparaciones',
          nif: null,
        },
      ]);

    render(
      <CuentaContableCombobox
        empresaId={1}
        value={null}
        onChange={vi.fn()}
        searchLimit={2}
      />,
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '602' } });

    const loadMore = await screen.findByRole('button', {
      name: 'Cargar más cuentas',
    });
    fireEvent.click(loadMore);

    await screen.findByText('Reparaciones');
    expect(fetchFacturaCuentas).toHaveBeenNthCalledWith(2, {
      empresaId: 1,
      cuenta: '602',
      limit: 2,
      offset: 2,
    });
  });

  it('pagina la búsqueda remota sin duplicar las cuentas ya cargadas', async () => {
    vi.mocked(fetchFacturaCuentas)
      .mockResolvedValueOnce([
        {
          value: '60200000001',
          label: '60200000001 - Material de oficina',
          description: 'Material de oficina',
          nif: null,
        },
        {
          value: '60200000002',
          label: '60200000002 - Servicios exteriores',
          description: 'Servicios exteriores',
          nif: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          value: '60200000002',
          label: '60200000002 - Servicios exteriores',
          description: 'Servicios exteriores',
          nif: null,
        },
        {
          value: '60200000003',
          label: '60200000003 - Servicios de reparación',
          description: 'Servicios de reparación',
          nif: null,
        },
      ]);

    render(
      <CuentaContableCombobox
        empresaId={1}
        value={null}
        onChange={vi.fn()}
        searchLimit={2}
      />,
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'servicios' } });

    const loadMore = await screen.findByRole('button', {
      name: 'Cargar más cuentas',
    });
    fireEvent.click(loadMore);

    await screen.findByText('Servicios de reparación');
    expect(fetchFacturaCuentas).toHaveBeenNthCalledWith(2, {
      empresaId: 1,
      search: 'servicios',
      limit: 2,
      offset: 2,
    });
    expect(screen.getAllByText('Servicios exteriores')).toHaveLength(1);
  });
});
