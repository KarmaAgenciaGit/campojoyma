// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AsientoContableTable } from './AsientoContableTable';

describe('AsientoContableTable', () => {
  it('reproduce la cabecera, columnas y totales del visualizador de Netagro', () => {
    render(
      <AsientoContableTable
        status="created"
        asientoNumero="48732"
        asientoFecha="2026-06-30"
        ejercicio={25}
        centro={1}
        documento="A-00748886"
        totalDebe={51233.24}
        totalHaber={51233.24}
        balanced
        lines={[
          {
            posicion: 1,
            cuenta: '41000000017',
            titulo: 'ONDUSPAN, S.A',
            descripcion: 'FRA. ONDUSPAN, S.A',
            documento: 'A-00748886',
            debe: 0,
            haber: 51233.24,
            actividad_id: 1,
            seccion_id: 1,
          },
          {
            posicion: 2,
            cuenta: '60200000001',
            titulo: 'COMPRAS ENVASES Y EMBALAJES',
            descripcion: 'FRA. ONDUSPAN, S.A',
            documento: 'A-00748886',
            debe: 42341.52,
            haber: 0,
            actividad_id: 1,
            seccion_id: 1,
          },
          {
            posicion: 3,
            cuenta: '47200000008',
            titulo: 'IVA SOPORTADO 21%',
            descripcion: 'FRA. ONDUSPAN, S.A',
            documento: 'A-00748886',
            debe: 8891.72,
            haber: 0,
            actividad_id: 1,
            seccion_id: 1,
          },
        ]}
      />,
    );

    expect(screen.getByText(/Asiento n.º 48732/)).toBeInTheDocument();
    expect(screen.getByText(/con fecha 30\/06\/2026/)).toBeInTheDocument();
    expect(screen.getByText('Ejercicio:')).toBeInTheDocument();
    expect(screen.getByText('Centro:')).toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Detalle del asiento 48732' });
    expect(within(table).getByText('Título')).toBeInTheDocument();
    expect(within(table).getByText('Documento')).toBeInTheDocument();
    expect(within(table).getByText('Act.')).toBeInTheDocument();
    expect(within(table).getByText('Secc.')).toBeInTheDocument();
    expect(within(table).getByText('COMPRAS ENVASES Y EMBALAJES')).toBeInTheDocument();
    expect(within(table).getAllByText('A-00748886')).toHaveLength(3);

    expect(screen.getByText('Total debe')).toBeInTheDocument();
    expect(screen.getByText('Total haber')).toBeInTheDocument();
    const descuadre = screen.getByText('Descuadre').parentElement;
    expect(descuadre).not.toBeNull();
    expect(within(descuadre as HTMLElement).getByText(/0,00/)).toBeInTheDocument();
  });

  it('explica que un asiento no disponible no se fabrica en el frontend', () => {
    render(<AsientoContableTable lines={[]} status="unavailable" />);
    expect(screen.getByText('La contabilización no está disponible.')).toBeInTheDocument();
  });

  it('distingue una referencia técnica de un asiento contable acreditado', () => {
    render(<AsientoContableTable lines={[]} status="reference_only" />);
    expect(screen.getByText('No se ha podido comprobar el detalle del asiento.')).toBeInTheDocument();
  });

  it('rotula de forma inequívoca una previsualización con datos', () => {
    render(
      <AsientoContableTable
        preview
        lines={[
          {
            posicion: 1,
            cuenta: '60000000001',
            descripcion: 'Factura de prueba',
            debe: 100,
            haber: 0,
          },
        ]}
      />,
    );

    expect(screen.getByText('Vista previa del asiento')).toBeInTheDocument();
  });

  it('explica cuándo faltan datos para construir la previsualización', () => {
    render(<AsientoContableTable preview lines={[]} />);
    expect(
      screen.getByText('No hay datos suficientes para previsualizar el asiento.'),
    ).toBeInTheDocument();
  });
});
