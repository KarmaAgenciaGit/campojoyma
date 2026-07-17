// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AsientoContableTable } from './AsientoContableTable';

describe('AsientoContableTable', () => {
  it('muestra el Debe/Haber real y confirma que el asiento está cuadrado', () => {
    render(
      <AsientoContableTable
        status="created"
        lines={[
          {
            posicion: 1,
            cuenta: '60200000001',
            descripcion: 'Compra envases',
            debe: 42341.52,
            haber: 0,
          },
          {
            posicion: 2,
            cuenta: '47200000000',
            descripcion: 'IVA soportado',
            debe: 8891.72,
            haber: 0,
          },
          {
            posicion: 3,
            cuenta: '41000000017',
            descripcion: 'ONDUSPAN, S.A',
            debe: 0,
            haber: 51233.24,
          },
        ]}
      />,
    );

    expect(screen.getByText('60200000001')).toBeInTheDocument();
    expect(screen.getByText('41000000017')).toBeInTheDocument();
    expect(screen.getByText('Asiento cuadrado')).toBeInTheDocument();
    expect(screen.getAllByText(/51\.233,24/)).toHaveLength(3);
  });

  it('explica que un asiento no disponible no se fabrica en el frontend', () => {
    render(<AsientoContableTable lines={[]} status="unavailable" />);
    expect(
      screen.getByText('El ERP no expone todavía el detalle oficial del asiento.'),
    ).toBeInTheDocument();
  });

  it('distingue una referencia técnica de un asiento contable acreditado', () => {
    render(<AsientoContableTable lines={[]} status="reference_only" />);
    expect(
      screen.getByText(
        'El ERP solo devuelve el identificador técnico; no se puede acreditar el asiento visible ni sus apuntes.',
      ),
    ).toBeInTheDocument();
  });
});
