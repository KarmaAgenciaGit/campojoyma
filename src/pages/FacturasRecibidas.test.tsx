// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FacturaRecibida } from '../services/apiContracts';

const mocks = vi.hoisted(() => ({
  confirmar: vi.fn(),
  fetchById: vi.fn(),
  fetchPage: vi.fn(),
  fetchRegimenes: vi.fn(),
  fetchRuntime: vi.fn(),
  fetchTiposIva: vi.fn(),
  historialProveedor: vi.fn(),
  perfilesIvaRegimen: vi.fn(),
  resolveErpRules: vi.fn(),
  saveFactura: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../components/FilterSelect', () => ({
  FilterSelect: ({
    value,
    options,
    onChange,
    ariaLabel,
    disabled,
  }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={`${ariaLabel}-${option.value}`} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../components/AcreedorCombobox', () => ({
  AcreedorCombobox: ({
    value,
    disabled,
  }: {
    value?: string | number | null;
    disabled?: boolean;
  }) => (
    <input
      aria-label="Selector de acreedor"
      value={String(value ?? '')}
      disabled={disabled}
      readOnly
    />
  ),
}));

vi.mock('../components/CuentaContableCombobox', () => ({
  CuentaContableCombobox: ({
    value,
    disabled,
    onChange,
  }: {
    value?: string | null;
    disabled?: boolean;
    onChange?: (value: string | null) => void;
  }) => (
    <input
      aria-label="Cuenta de gasto"
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

vi.mock('../components/facturas/FacturaAsientoViewer', () => ({
  FacturaAsientoViewer: () => <button type="button">Ver asiento</button>,
}));

vi.mock('../components/facturas/FacturaIssuesOverlay', () => ({
  FacturaIssuesOverlay: () => null,
}));

vi.mock('../components/facturas/FacturaPunteosTable', () => ({
  FacturaPunteosTable: () => null,
}));

vi.mock('../components/PdfViewer', () => ({
  PdfViewer: () => <div data-testid="pdf-viewer" />,
}));

vi.mock('../components/ui/radio-group', () => ({
  RadioGroup: ({
    children,
    disabled,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
  }) => <fieldset disabled={disabled}>{children}</fieldset>,
  RadioGroupItem: ({ value, ...props }: { value: string; 'aria-label'?: string }) => (
    <input type="radio" value={value} {...props} />
  ),
}));

vi.mock('../hooks/useConfirmacion', () => ({
  useConfirmacion: () => ({
    confirmar: mocks.confirmar,
    dialogo: null,
  }),
}));

vi.mock('../hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('../hooks/useFacturaCuentasGastoHistoricas', () => ({
  useFacturaCuentasGastoHistoricas: () => ({
    items: [],
    loading: false,
    error: null,
  }),
}));

vi.mock('../services/facturasRecibidasErpRules', () => ({
  facturasRecibidasErpRules: {
    resolve: mocks.resolveErpRules,
  },
}));

vi.mock('../services/facturasRecibidasHistorial', async () => {
  const actual = await vi.importActual<typeof import('../services/facturasRecibidasHistorial')>(
    '../services/facturasRecibidasHistorial',
  );
  return {
    ...actual,
    obtenerHistorialProveedor: mocks.historialProveedor,
    obtenerPerfilesIvaRegimen: mocks.perfilesIvaRegimen,
  };
});

vi.mock('../services/facturas', async () => {
  const actual = await vi.importActual<typeof import('../services/facturas')>(
    '../services/facturas',
  );
  return {
    ...actual,
    fetchFacturaRecibidaById: mocks.fetchById,
    fetchFacturasRecibidasPage: mocks.fetchPage,
    fetchFacturaRegimenes: mocks.fetchRegimenes,
    fetchFacturaTiposIva: mocks.fetchTiposIva,
    fetchFacturasRecibidasERPRuntime: mocks.fetchRuntime,
    getFacturaPdfSignedUrl: vi.fn().mockResolvedValue(null),
    saveFacturaRecibida: mocks.saveFactura,
  };
});

import FacturasRecibidas, { applyProveedorERPDetail } from './FacturasRecibidas';

const factura: FacturaRecibida = {
  id: 'factura-ejido',
  estado: 'pendiente_revision',
  proveedor_nombre: 'EJIDO CARTON, S.L.',
  proveedor_nif: 'B04249231',
  proveedor_codigo: '596',
  proveedor_cuenta: '41000000596',
  numero_factura: '26140889',
  referencia: null,
  ejercicio: 25,
  fecha_ctb: '2026-05-31',
  fecha_ctb_source: 'invoice_date',
  tipo_iva_codigo: '2110',
  asiento: null,
  asiento_tecnico: null,
  asiento_numero: null,
  asiento_fecha: null,
  asiento_estado: 'not_requested',
  asiento_lineas: [],
  fr_alm: '1',
  fr_sufa: 'OT',
  fecha_factura: '2026-05-31',
  iva_tramos: [
    { posicion: 1, base: 4397.57, porcentaje: 21, cuota: 923.49 },
    { posicion: 2, base: null, porcentaje: null, cuota: null },
    { posicion: 3, base: null, porcentaje: null, cuota: null },
    { posicion: 4, base: null, porcentaje: null, cuota: null },
    { posicion: 5, base: null, porcentaje: null, cuota: null },
  ],
  base_imponible: 4397.57,
  iva_porcentaje: 21,
  iva_importe: 923.49,
  base_retencion: 0,
  retencion_porcentaje: 0,
  retencion_importe: 0,
  clave_irpf: '',
  cuota_no_deducible: 0,
  cuenta_suplido: '',
  importe_suplido: 0,
  total: 5321.06,
  asunto_email: null,
  concepto_asiento: 'FRA. EJIDO CARTON, S.L.',
  obs_aeat: '',
  observaciones: '',
  contabilizar: 'S',
  genera_cartera: 'N',
  forma_pago: '',
  cta_cartera: '',
  banco: '',
  tipo_doc: '',
  fecha_vto: null,
  importe_vto: null,
  vencimientos: [
    { posicion: 1, fecha: null, importe: null },
    { posicion: 2, fecha: null, importe: null },
    { posicion: 3, fecha: null, importe: null },
    { posicion: 4, fecha: null, importe: null },
  ],
  validation_errors: [],
  erp_last_attempt_at: null,
  erp_sent_at: null,
  erp_response: null,
  erp_error: null,
  erp_payload: null,
  erp_factura_id: null,
  sync_status: 'idle',
  accounting_requested: false,
  accounting_status: 'not_requested',
  accounting_error: null,
  pdf_path: null,
  pdf_nombre: null,
  pdf_mime_type: null,
  pdf_size: null,
  created_at: '2026-08-01T10:00:00.000Z',
  updated_at: '2026-08-01T10:00:00.000Z',
  ctb_lineas: [],
  punteos: [],
  facturas_recibidas_lineas: [
    {
      id: 'gasto-1',
      factura_recibida_id: 'factura-ejido',
      posicion: 1,
      descripcion: '60200000001',
      importe: 4397.57,
    },
  ],
};

const historicalVatProfile = {
  regimen_id: 2110,
  filtros: { proveedor_id: null, tipo_factura: null },
  total_facturas: 25,
  estado: 'dominante' as const,
  ambiguo: false,
  perfiles: [],
  perfil_mas_usado: {
    porcentajes: [21, 10, 4, 5, 0] as [number, number, number, number, number],
    usos: 25,
    confianza: 1,
    tramos: [],
  },
  plantilla_sugerida: {
    porcentajes: [21, 10, 4, 5, 0] as [number, number, number, number, number],
    usos: 25,
    confianza: 1,
    criterio: 'perfil_historico_dominante' as const,
  },
};

const renderDetail = () =>
  render(
    <MemoryRouter initialEntries={['/facturas/factura-ejido']}>
      <Routes>
        <Route path="/facturas/:facturaId" element={<FacturasRecibidas />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();

  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
  });

  mocks.confirmar.mockResolvedValue(true);
  mocks.fetchById.mockResolvedValue(structuredClone(factura));
  mocks.fetchPage.mockResolvedValue({
    items: [structuredClone(factura)],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  mocks.fetchRegimenes.mockResolvedValue([
    { value: '2110', label: '2110 — Régimen general' },
  ]);
  mocks.fetchTiposIva.mockResolvedValue([
    { value: '21', porcentaje: 21, label: '21 % — General', nombre: 'General' },
    { value: '10', porcentaje: 10, label: '10 % — Reducido', nombre: 'Reducido' },
    { value: '4', porcentaje: 4, label: '4 % — Superreducido', nombre: 'Superreducido' },
    { value: '5', porcentaje: 5, label: '5 % — Histórico', nombre: 'Histórico' },
    { value: '0', porcentaje: 0, label: '0 % — Sin IVA', nombre: 'Sin IVA' },
  ]);
  mocks.fetchRuntime.mockResolvedValue({
    target_id: 'netagro-test',
    dataset_epoch: 'test-snapshot',
    snapshot_at: '2026-08-05T08:00:00Z',
    write_mode: 'management',
    accounting_mode: 'sql_test',
    accounting_write_mode: 'sql_test',
    accounting_ready_for_commit: true,
    ready_for_commit: true,
    capabilities: {
      validate: true,
      management_commit: true,
      accounting_commit: true,
    },
  });
  mocks.historialProveedor.mockResolvedValue([]);
  mocks.perfilesIvaRegimen.mockResolvedValue(historicalVatProfile);
  mocks.resolveErpRules.mockResolvedValue({
    punteo_difference_policy: 'warning',
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('FacturasRecibidas — modo consulta y edición', () => {
  it('abre una factura en consulta, sin Guardar ni autohidratación de IVA', async () => {
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Factura recibida' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('26140889')).toBeDisabled();

    await waitFor(() => expect(mocks.fetchTiposIva).toHaveBeenCalledTimes(1));
    expect(mocks.perfilesIvaRegimen).not.toHaveBeenCalled();
    for (const posicion of [2, 3, 4, 5]) {
      expect(screen.getByLabelText(`IVA del tramo ${posicion}`)).toHaveValue('');
    }
  });

  it('solo habilita Guardar tras un cambio y Cancelar restaura el baseline', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));

    const saveButton = await screen.findByRole('button', { name: 'Guardar' });
    const invoiceNumberInput = screen.getByDisplayValue('26140889');
    expect(saveButton).toBeDisabled();
    expect(invoiceNumberInput).toBeEnabled();

    fireEvent.change(invoiceNumberInput, { target: { value: '26140889-EDITADA' } });
    await waitFor(() => expect(saveButton).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByDisplayValue('26140889')).toBeDisabled();
    expect(screen.queryByDisplayValue('26140889-EDITADA')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
    expect(mocks.saveFactura).not.toHaveBeenCalled();
  });
});

describe('applyProveedorERPDetail', () => {
  const proveedor = {
    codigo: 209,
    nombre: 'MONTAJES Y MATERIAL AUXILIAR, S.L.',
    nif: 'B04112942',
    cuenta: '41000000209',
    cuentaGasto: '60200000001',
    cuentaCartera: '41100000209',
    porcentajeIva: 21,
    formaPagoId: 100,
    bancoId: 1,
    raw: {},
  };

  it('no materializa datos de cartera cuando Genera cartera es No', () => {
    const resolved = applyProveedorERPDetail(
      {
        ...factura,
        genera_cartera: 'N',
        cta_cartera: '41100000999',
        forma_pago: '9',
        banco: '8',
      },
      proveedor,
    );

    expect(resolved.cta_cartera).toBeNull();
    expect(resolved.forma_pago).toBeNull();
    expect(resolved.banco).toBeNull();
  });

  it('aplica los datos de pago del maestro cuando Genera cartera es Si', () => {
    const resolved = applyProveedorERPDetail(
      { ...factura, genera_cartera: 'S' },
      proveedor,
    );

    expect(resolved.cta_cartera).toBe('41100000209');
    expect(resolved.forma_pago).toBe('100');
    expect(resolved.banco).toBe('1');
  });
});
