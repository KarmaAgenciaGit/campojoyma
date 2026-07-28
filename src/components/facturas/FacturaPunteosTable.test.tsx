// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  AlbaranEntradaLineaERP,
  FacturaRecibidaPunteo,
} from '@/services/apiContracts';

import { FacturaPunteosTable } from './FacturaPunteosTable';

afterEach(() => {
  cleanup();
});

const punteo: FacturaRecibidaPunteo = {
  id: 'erp:punteo:AEH:211790',
  posicion: 1,
  remote_id: 'AEH:211790',
  source_table: 'albentrada_his',
  source_id: 211790,
  albaran_id: 82548,
  importe_factura: 129.2,
  origen: 'GE',
  serie: 'A26',
  albaran: 8436,
  ref: null,
  fecha: '2026-07-27',
  importe_punteado: 0,
  importe: 129.2,
  seleccionado: true,
  ver: true,
  line_count: 1,
};

const line: AlbaranEntradaLineaERP = {
  id: 87097,
  albaran_id: 82548,
  linea: 0,
  partida: 10843601,
  genero_id: 161100,
  genero_nombre: 'SANDIA MINI',
  categoria_id: 0,
  categoria_nombre: null,
  categoria_calibre: null,
  categoria_calibre_nombre: null,
  envase_id: 701,
  envase_nombre: 'BOX PEQUEÑO',
  cultivo_id: 3966,
  tipo_cultivo_id: 1,
  tipo_cultivo_abreviatura: 'BIO',
  tipo_cultivo_nombre: 'ECOLOGICO',
  calidad_codigo: null,
  kilos_brutos: 24225,
  kilos_netos: 21194,
  palets: 0,
  bultos: 88,
  piezas: 0,
  precio: 0,
  importe: 0,
};

const renderTable = (
  overrides: Partial<ComponentProps<typeof FacturaPunteosTable>> = {},
) => {
  const props: ComponentProps<typeof FacturaPunteosTable> = {
    punteos: [punteo],
    readOnly: true,
    selectedCount: 1,
    selectedTotal: 129.2,
    baseDifference: 0,
    expensesDifference: 0,
    onSelectionChange: vi.fn(),
    loadEntryLines: vi.fn().mockResolvedValue([line]),
    loadMaterialLines: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return { ...render(<FacturaPunteosTable {...props} />), props };
};

describe('FacturaPunteosTable', () => {
  it('carga el detalle por AEN y lo expande como grid dentro de una única tabla', async () => {
    const loadEntryLines = vi.fn().mockResolvedValue([line]);
    renderTable({ loadEntryLines });

    expect(screen.getAllByRole('table')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ver líneas' }));

    expect(loadEntryLines).toHaveBeenCalledWith(82548);
    expect(await screen.findByText('SANDIA MINI')).toBeInTheDocument();
    expect(screen.getByText('10.843.601')).toBeInTheDocument();
    expect(screen.getByText('BIO')).toBeInTheDocument();
    expect(screen.getByText('ECOLOGICO')).toBeInTheDocument();
    expect(screen.getByText('BOX PEQUEÑO')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(screen.queryByText('SANDIA MINI')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver líneas' }));
    expect(await screen.findByText('SANDIA MINI')).toBeInTheDocument();
    expect(loadEntryLines).toHaveBeenCalledTimes(1);
  });

  it('muestra carga, error local y permite reintentar sin afectar la tabla', async () => {
    let rejectFirstRequest: ((reason?: unknown) => void) | undefined;
    const loadEntryLines = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<AlbaranEntradaLineaERP[]>((_resolve, reject) => {
            rejectFirstRequest = reject;
          }),
      )
      .mockResolvedValueOnce([line]);

    renderTable({ loadEntryLines });
    fireEvent.click(screen.getByRole('button', { name: 'Ver líneas' }));
    expect(screen.getByRole('status')).toHaveTextContent('Consultando líneas del albarán');

    rejectFirstRequest?.(new Error('upstream detail'));
    expect(
      await screen.findByText('No se pudieron cargar las líneas del albarán.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('SANDIA MINI')).toBeInTheDocument();
    expect(loadEntryLines).toHaveBeenCalledTimes(2);
  });

  it('explica una respuesta vacía y no vuelve a solicitarla al reabrir', async () => {
    const loadEntryLines = vi.fn().mockResolvedValue([]);
    renderTable({ loadEntryLines });

    fireEvent.click(screen.getByRole('button', { name: 'Ver líneas' }));
    expect(await screen.findByText('Este albarán no tiene líneas.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver líneas' }));

    expect(screen.getByText('Este albarán no tiene líneas.')).toBeInTheDocument();
    expect(loadEntryLines).toHaveBeenCalledTimes(1);
  });

  it('no ofrece detalle sin AEN válido y delega la selección editable', async () => {
    const onSelectionChange = vi.fn();
    const loadEntryLines = vi.fn().mockResolvedValue([line]);
    renderTable({
      punteos: [{ ...punteo, albaran_id: null, seleccionado: false }],
      readOnly: false,
      onSelectionChange,
      loadEntryLines,
    });

    expect(screen.queryByRole('button', { name: 'Ver líneas' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Detalle no disponible')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar punteo 8436' }));

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenCalledWith(
        expect.objectContaining({ albaran: 8436 }),
        true,
      );
    });
    expect(loadEntryLines).not.toHaveBeenCalled();
  });

  it('no confunde un albarán MA sin source_id válido con una cabecera de entrada GE', () => {
    const loadEntryLines = vi.fn().mockResolvedValue([line]);
    const loadMaterialLines = vi.fn().mockResolvedValue([]);
    renderTable({
      punteos: [{
        ...punteo,
        source_table: 'albmaterial',
        source_id: 0,
        albaran_id: 23210,
        origen: 'MA',
        albaran: 2108,
      }],
      loadEntryLines,
      loadMaterialLines,
    });

    expect(screen.queryByRole('button', { name: 'Ver líneas' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Detalle no disponible')).toBeInTheDocument();
    expect(loadEntryLines).not.toHaveBeenCalled();
    expect(loadMaterialLines).not.toHaveBeenCalled();
  });

  it('carga MA de forma perezosa, ignora líneas persistidas y cachea al reabrir', async () => {
    const loadEntryLines = vi.fn().mockResolvedValue([line]);
    const loadMaterialLines = vi.fn().mockResolvedValue([{
      id: 53384,
      posicion: 1,
      articulo_id: 370,
      descripcion: 'CC60x40x18',
      referencia: 'MONTADA',
      cantidad: 100,
      precio: 0.901,
      importe: 87.4,
      observaciones: '7396911',
    }]);
    renderTable({
      punteos: [{
        ...punteo,
        source_table: 'albmaterial',
        source_id: 23210,
        albaran_id: 23210,
        origen: 'MA',
        albaran: 2108,
        lines_loaded: true,
        lines: [{
          id: 99999,
          posicion: 1,
          articulo_id: 999,
          descripcion: 'DATO PERSISTIDO',
          referencia: null,
          cantidad: 1,
          precio: 1,
          importe: 1,
          observaciones: null,
        }],
      }],
      loadEntryLines,
      loadMaterialLines,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ver líneas' }));

    expect(loadMaterialLines).toHaveBeenCalledWith(23210);
    expect(await screen.findByText('CC60x40x18')).toBeInTheDocument();
    expect(screen.getByText('MONTADA')).toBeInTheDocument();
    expect(screen.queryByText('DATO PERSISTIDO')).not.toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    expect(loadEntryLines).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver líneas' }));
    expect(await screen.findByText('CC60x40x18')).toBeInTheDocument();
    expect(loadMaterialLines).toHaveBeenCalledTimes(1);
  });

  it('muestra el error MA y permite reintentar solo con el cargador de materiales', async () => {
    let rejectFirstRequest: ((reason?: unknown) => void) | undefined;
    const loadEntryLines = vi.fn().mockResolvedValue([line]);
    const loadMaterialLines = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<NonNullable<FacturaRecibidaPunteo['lines']>>((_resolve, reject) => {
            rejectFirstRequest = reject;
          }),
      )
      .mockResolvedValueOnce([{
        id: 53384,
        posicion: 1,
        articulo_id: 370,
        descripcion: 'CC60x40x18',
        referencia: null,
        cantidad: 100,
        precio: 0.901,
        importe: 87.4,
        observaciones: null,
      }]);

    renderTable({
      punteos: [{
        ...punteo,
        source_table: 'albmaterial',
        source_id: 23210,
        albaran_id: 23210,
        origen: 'MA',
        albaran: 2108,
      }],
      loadEntryLines,
      loadMaterialLines,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ver líneas' }));
    expect(screen.getByRole('status')).toHaveTextContent('Consultando líneas del albarán');

    rejectFirstRequest?.(new Error('upstream material detail'));
    expect(
      await screen.findByText('No se pudieron cargar las líneas del albarán.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('CC60x40x18')).toBeInTheDocument();
    expect(loadMaterialLines).toHaveBeenCalledTimes(2);
    expect(loadEntryLines).not.toHaveBeenCalled();
  });
});
