// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AcreedorCombobox } from './AcreedorCombobox';
import { agroirisAcreedores, type AgroIrisAcreedor } from '@/services/agroirisAcreedores';

vi.mock('@/services/agroirisAcreedores', () => ({
  agroirisAcreedores: {
    getAcreedorById: vi.fn(),
    searchAcreedores: vi.fn(),
    formatAcreedoresForSelect: (acreedores: AgroIrisAcreedor[]) =>
      acreedores.map((acreedor) => ({
        value: acreedor.acreedorid,
        label: acreedor.nombre_comercial,
        searchText: acreedor.nombre_comercial.toLowerCase(),
        acreedor,
      })),
  },
}));

const acreedores = [
  { acreedorid: 101, nombre_comercial: 'ADRIAN APARICIO VERA' },
  { acreedorid: 102, nombre_comercial: 'APARTOTEL MELIA CASTILLA' },
  { acreedorid: 103, nombre_comercial: 'JAPANTA, S.L.' },
] as AgroIrisAcreedor[];
const agricultor = {
  acreedorid: 1957,
  nombre_comercial: 'ALMERITERRA-BIO S.L.',
} as AgroIrisAcreedor;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe('AcreedorCombobox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agroirisAcreedores.searchAcreedores).mockResolvedValue(acreedores);
    vi.mocked(agroirisAcreedores.getAcreedorById).mockImplementation(async (id) => {
      return acreedores.find((acreedor) => acreedor.acreedorid === id) ?? null;
    });
  });

  it('permite recorrer y seleccionar acreedores con el teclado', async () => {
    const onChange = vi.fn();
    render(<AcreedorCombobox value={null} onChange={onChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ap' } });

    await screen.findByText('ADRIAN APARICIO VERA');
    await screen.findByText('APARTOTEL MELIA CASTILLA');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-102'));

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveAttribute('aria-activedescendant', expect.stringContaining('option-101'));

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(101));
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('resuelve un proveedor GE contra agricultores aunque coincida el ID', async () => {
    vi.mocked(agroirisAcreedores.getAcreedorById).mockResolvedValue(agricultor);

    render(
      <AcreedorCombobox
        value={1957}
        onChange={vi.fn()}
        entityType="agricultor"
        disabled
      />,
    );

    await waitFor(() => {
      expect(agroirisAcreedores.getAcreedorById).toHaveBeenCalledWith(
        1957,
        'agricultor',
      );
    });
    expect(await screen.findByDisplayValue('ALMERITERRA-BIO S.L.')).toBeInTheDocument();
  });
});
