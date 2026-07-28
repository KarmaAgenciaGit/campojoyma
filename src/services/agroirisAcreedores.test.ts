import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

import { agroirisAcreedores } from '@/services/agroirisAcreedores';

const erpAcreedor = {
  codigo: 17,
  nombre: 'ONDUSPAN, S.A.',
  nif: 'A04119293',
  cuenta_id: '41000000017',
  cuenta_gasto: '60200000001',
  cuenta_cartera: '41100000017',
  porcentaje_iva: '21.00',
  forma_pago_id: 0,
  banco_id: 0,
  activo: true,
};

const erpAgricultor = {
  codigo: 1957,
  nombre: 'ALMERITERRA-BIO S.L.',
  nif: 'B13702956',
  cuenta_id: '40090001957',
  forma_pago_id: 0,
  banco_id: 0,
  activo: 'S',
  bloqueado: 'N',
};

describe('agroirisAcreedores ERP', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('hidrata el detalle con las claves reales del ERP', async () => {
    invokeMock.mockResolvedValue({ data: { data: erpAcreedor }, error: null });

    const acreedor = await agroirisAcreedores.getAcreedorById(17);

    expect(invokeMock).toHaveBeenCalledWith('facturas-recibidas-erp-read', {
      body: { consulta: 'acreedores/17' },
    });
    expect(acreedor).toMatchObject({
      acreedorid: 17,
      nombre_comercial: 'ONDUSPAN, S.A.',
      identificador_fiscal: 'A04119293',
      cuenta_contable: '41000000017',
      cuenta_gasto: '60200000001',
      cuenta_cartera: '41100000017',
      porcentaje_iva: 21,
      forma_pago_id: 0,
      banco_id: 0,
    });
  });

  it('consulta una sola página remota y limita tamaños excesivos', async () => {
    invokeMock.mockResolvedValue({
      data: { items: [erpAcreedor], limit: 50, offset: 25, total: 1 },
      error: null,
    });

    const acreedores = await agroirisAcreedores.searchAcreedores('ONDUSPAN', {
      limit: 2_000,
      offset: 25,
    });

    expect(acreedores).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('facturas-recibidas-erp-read', {
      body: { consulta: 'acreedores?q=ONDUSPAN&limit=50&offset=25&activo=true' },
    });
  });

  it('usa 25 resultados como página predeterminada', async () => {
    invokeMock.mockResolvedValue({ data: { items: [erpAcreedor] }, error: null });

    await agroirisAcreedores.searchAcreedores('');

    expect(invokeMock).toHaveBeenCalledWith('facturas-recibidas-erp-read', {
      body: { consulta: 'acreedores?limit=25&offset=0&activo=true' },
    });
  });

  it('consulta agricultores sin mezclar un ID coincidente de acreedor', async () => {
    invokeMock.mockResolvedValue({ data: { items: [erpAgricultor] }, error: null });

    const agricultores = await agroirisAcreedores.searchAcreedores('ALMERITERRA', {
      entityType: 'agricultor',
    });

    expect(invokeMock).toHaveBeenCalledWith('facturas-recibidas-erp-read', {
      body: {
        consulta: 'agricultores?q=ALMERITERRA&limit=25&offset=0&activo=true',
      },
    });
    expect(agricultores[0]).toMatchObject({
      acreedorid: 1957,
      nombre_comercial: 'ALMERITERRA-BIO S.L.',
      identificador_fiscal: 'B13702956',
      cuenta_contable: '40090001957',
    });
  });

  it('hidrata el detalle GE desde agricultores', async () => {
    invokeMock.mockResolvedValue({ data: erpAgricultor, error: null });

    const agricultor = await agroirisAcreedores.getAcreedorById(1957, 'agricultor');

    expect(invokeMock).toHaveBeenCalledWith('facturas-recibidas-erp-read', {
      body: { consulta: 'agricultores/1957' },
    });
    expect(agricultor?.nombre_comercial).toBe('ALMERITERRA-BIO S.L.');
  });

  it('propaga una caída de API como error operativo sin fallback local', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('servicio no disponible') });

    await expect(agroirisAcreedores.getAcreedorById(17)).rejects.toThrow(
      'No se pudo consultar el ERP de acreedores: servicio no disponible',
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
