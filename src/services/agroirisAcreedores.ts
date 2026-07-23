import { supabase } from '@/integrations/supabase/client';

export interface AgroIrisAcreedor {
  acreedorid: number;
  sujetoid: number;
  perfilacreedorid: number;
  codigo_fianza: string;
  subgrupoanalisisid: number;
  formacobropagoid: number;
  cuentaid_contrapartida: number;
  tags_acreedor: string;
  activo: boolean;
  observaciones: string;
  acreedorid_facturacion: number;
  nombre_sujeto: string;
  apellido1_sujeto: string;
  apellido2_sujeto: string;
  tipo_documento: string;
  identificador_fiscal: string;
  idiomaid: number;
  divisaid: number;
  imagen_sujeto: string;
  web_sujeto: string;
  nombre_comercial: string;
  empresabancoid: number;
  referencia: string | null;
  cuenta_contable: string | null;
  cuenta_gasto: string | null;
  cuenta_cartera: string | null;
  porcentaje_iva: number | null;
  forma_pago_id: number | null;
  banco_id: number | null;
}

export interface AcreedorSelectOption {
  value: number;
  label: string;
  searchText: string;
  acreedor: AgroIrisAcreedor;
}

export type AcreedorSource = 'erp';

type ERPReadListResponse<T> = {
  items?: T[];
  limit?: number;
  offset?: number;
  total?: number;
};

type ERPAcreedorRow = Record<string, unknown>;

const ERP_READ_FUNCTION = 'facturas-recibidas-erp-read';
const DEFAULT_ERP_ACREEDORES_PAGE_SIZE = 25;
const MAX_ERP_ACREEDORES_PAGE_SIZE = 50;

const cleanText = (value: unknown) => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};

const readText = (source: Record<string, unknown>, keys: string[], fallback: string | null = null) => {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return cleanText(value) ?? fallback;
    }
  }
  return fallback;
};

const readNumber = (source: Record<string, unknown>, keys: string[], fallback: number | null = null) => {
  for (const key of keys) {
    const parsed = Number(source[key]);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return fallback;
};

const readDecimal = (source: Record<string, unknown>, keys: string[], fallback: number | null = null) => {
  for (const key of keys) {
    const parsed = Number(source[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeLookupText = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const looksLikeAcreedorRow = (value: unknown): value is ERPAcreedorRow => {
  if (!isRecord(value)) return false;
  return [
    'ACR_Codigo',
    'ACR_Nombre',
    'ACR_Nif',
    'ACR_IdCuenta',
    'codigo',
    'id',
    'acreedor_id',
    'nombre',
    'nif',
  ].some((key) => key in value);
};

const extractRows = <T extends Record<string, unknown>>(payload: unknown, depth = 0): T[] => {
  if (depth > 4) return [];

  if (Array.isArray(payload)) {
    if (payload.every(looksLikeAcreedorRow)) return payload as T[];

    const nested = payload.flatMap((item) => extractRows<T>(item, depth + 1));
    return nested.length > 0 ? nested : payload.filter(isRecord) as T[];
  }

  if (!isRecord(payload)) return [];
  if (looksLikeAcreedorRow(payload)) return [payload as T];

  for (const key of ['items', 'data', 'result', 'records', 'rows', 'body', 'json', 'payload']) {
    if (key in payload) {
      const nested = extractRows<T>(payload[key], depth + 1);
      if (nested.length > 0) return nested;
    }
  }

  return [];
};

const extractNumberMeta = (payload: unknown, key: 'total' | 'limit' | 'offset', depth = 0): number | null => {
  if (depth > 4) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const value = extractNumberMeta(item, key, depth + 1);
      if (value !== null) return value;
    }
    return null;
  }
  if (!isRecord(payload)) return null;

  const direct = Number(payload[key]);
  if (Number.isFinite(direct)) return Math.trunc(direct);

  for (const nestedKey of ['data', 'result', 'body', 'json', 'payload']) {
    if (nestedKey in payload) {
      const value = extractNumberMeta(payload[nestedKey], key, depth + 1);
      if (value !== null) return value;
    }
  }

  return null;
};

const extractListPage = <T extends Record<string, unknown>>(payload: unknown): ERPReadListResponse<T> => ({
  items: extractRows<T>(payload),
  limit: extractNumberMeta(payload, 'limit') ?? undefined,
  offset: extractNumberMeta(payload, 'offset') ?? undefined,
  total: extractNumberMeta(payload, 'total') ?? undefined,
});

const isTruthyFlag = (value: unknown) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 's', 'si', 'sí', 'y', 'yes'].includes(normalized);
};

const isFalseyFlag = (value: unknown) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['0', 'false', 'n', 'no'].includes(normalized);
};

const mapERPRow = (row: ERPAcreedorRow): AgroIrisAcreedor | null => {
  const code = readNumber(row, ['ACR_Codigo', 'codigo', 'id', 'acreedor_id'], null);
  if (!code) return null;

  const name =
    readText(row, ['ACR_Nombre', 'nombre', 'nombre_comercial', 'razon_social'], null) ??
    `Acreedor ${code}`;
  const nif = readText(row, ['ACR_Nif', 'nif', 'cif'], '');
  const cuenta = readText(row, ['cuenta_id', 'ACR_IdCuenta', 'ACR_Cuenta', 'cuenta', 'cuenta_contable'], null);
  const cuentaGasto = readText(row, ['cuenta_gasto', 'ACR_Cuentagasto', 'ACR_CuentaGasto'], null);
  const cuentaCartera = readText(
    row,
    ['cuenta_cartera', 'ACR_IdCuentaCartera', 'ACR_CuentaCartera', 'ACR_CtaCartera'],
    null,
  );
  const porcentajeIva = readDecimal(row, ['porcentaje_iva', 'ACR_PorcentajeIVA', 'ACR_PorcentajeIva'], null);
  const formaPagoId = readNumber(row, ['forma_pago_id', 'ACR_IdFormaPago', 'formacobropagoid'], null);
  const bancoId = readNumber(row, ['banco_id', 'ACR_IdBanco', 'empresabancoid'], null);
  const activoValue = row.activo ?? row.operativo ?? row.ACR_Activo;
  const blocked = isTruthyFlag(row.bloqueado ?? row.ACR_Bloqueado);
  const inactive = isTruthyFlag(row.inactivo_rgpd ?? row.ACR_InactivoRGPD);
  const active = activoValue === undefined || activoValue === null ? !blocked && !inactive : !isFalseyFlag(activoValue);

  return {
    acreedorid: code,
    sujetoid: code,
    perfilacreedorid: 0,
    codigo_fianza: '',
    subgrupoanalisisid: 0,
    formacobropagoid: formaPagoId ?? 0,
    cuentaid_contrapartida: 0,
    tags_acreedor: '',
    activo: active && !blocked && !inactive,
    observaciones: '',
    acreedorid_facturacion: code,
    nombre_sujeto: name,
    apellido1_sujeto: '',
    apellido2_sujeto: '',
    tipo_documento: '',
    identificador_fiscal: nif ?? '',
    idiomaid: 0,
    divisaid: 0,
    imagen_sujeto: '',
    web_sujeto: '',
    nombre_comercial: name,
    empresabancoid: bancoId ?? 0,
    referencia: cuenta,
    cuenta_contable: cuenta,
    cuenta_gasto: cuentaGasto,
    cuenta_cartera: cuentaCartera,
    porcentaje_iva: porcentajeIva,
    forma_pago_id: formaPagoId,
    banco_id: bancoId,
  };
};

class AgroIrisAcreedorService {
  private async getFunctionErrorMessage(error: unknown): Promise<string> {
    const fallback = error instanceof Error ? error.message : 'Error consultando el ERP.';
    const context = isRecord(error) ? error.context : null;
    if (!context || typeof (context as { clone?: unknown }).clone !== 'function') return fallback;

    try {
      const response = (context as Response).clone();
      const text = await response.text();
      if (!text) return fallback;

      try {
        const payload = JSON.parse(text) as unknown;
        if (isRecord(payload)) {
          const message = payload.error ?? payload.message ?? payload.details;
          if (message !== undefined && message !== null && String(message).trim()) return String(message).trim();
        }
      } catch {
        // Keep the raw text below.
      }

      return text.trim() || fallback;
    } catch {
      return fallback;
    }
  }

  private async erpRead<T>(consulta: string): Promise<T> {
    const { data, error } = await supabase.functions.invoke(ERP_READ_FUNCTION, {
      body: { consulta },
    });
    if (error) {
      const details = await this.getFunctionErrorMessage(error);
      throw new Error(`No se pudo consultar el ERP de acreedores: ${details}`);
    }
    if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
      throw new Error(`No se pudo consultar el ERP de acreedores: ${String((data as { error: string }).error)}`);
    }
    return data as T;
  }

  private mapAcreedoresERPPage(payload: unknown): ERPReadListResponse<ERPAcreedorRow> {
    const page = extractListPage<ERPAcreedorRow>(payload);
    return {
      ...page,
      items: (page.items ?? []).filter(looksLikeAcreedorRow),
    };
  }

  private async searchAcreedoresERP(query: string, limit: number, offset: number): Promise<AgroIrisAcreedor[]> {
    const cleaned = query.trim();
    const pageSize = Math.min(Math.max(1, Math.trunc(limit)), MAX_ERP_ACREEDORES_PAGE_SIZE);
    const pageOffset = Math.max(0, Math.trunc(offset));
    const pagination = `limit=${encodeURIComponent(String(pageSize))}&offset=${encodeURIComponent(String(pageOffset))}&activo=true`;
    const consultas = cleaned
      ? [
          `acreedores?q=${encodeURIComponent(cleaned)}&${pagination}`,
          `acreedores?nombre=${encodeURIComponent(cleaned)}&${pagination}`,
          `acreedores?nif=${encodeURIComponent(cleaned)}&${pagination}`,
          `acreedores?codigo=${encodeURIComponent(cleaned)}&${pagination}`,
        ]
      : [`acreedores?${pagination}`];

    for (const consulta of consultas) {
      const payload = await this.erpRead<unknown>(consulta);
      const page = this.mapAcreedoresERPPage(payload);
      const acreedores = (page.items ?? []).map(mapERPRow).filter((item): item is AgroIrisAcreedor => Boolean(item));
      if (acreedores.length > 0) {
        return acreedores;
      }
    }

    return [];
  }

  async searchAcreedores(
    query: string,
    options: { limit?: number; offset?: number; source?: AcreedorSource } = {},
  ): Promise<AgroIrisAcreedor[]> {
    const limit = options.limit ?? DEFAULT_ERP_ACREEDORES_PAGE_SIZE;
    const offset = options.offset ?? 0;
    return this.searchAcreedoresERP(query, limit, offset);
  }

  async getAcreedorById(acreedorid: number): Promise<AgroIrisAcreedor | null> {
    const normalizedId = Math.trunc(Number(acreedorid));
    if (!Number.isFinite(normalizedId) || normalizedId <= 0) return null;

    const payload = await this.erpRead<unknown>(`acreedores/${encodeURIComponent(String(normalizedId))}`);
    const [row] = extractRows<ERPAcreedorRow>(payload);
    return row ? mapERPRow(row) : null;
  }

  formatAcreedoresForSelect(acreedores: AgroIrisAcreedor[]): AcreedorSelectOption[] {
    return acreedores
      .filter((acreedor) => acreedor.activo)
      .map((acreedor) => {
        const label = acreedor.nombre_comercial.trim();
        const rawSearchText = `${acreedor.nombre_comercial} ${acreedor.nombre_sujeto} ${acreedor.identificador_fiscal} ${acreedor.acreedorid}`;
        const searchText = `${rawSearchText.toLowerCase()} ${normalizeLookupText(rawSearchText)}`;

        return {
          value: acreedor.acreedorid,
          label,
          searchText,
          acreedor,
        };
      })
      .sort((a, b) => a.acreedor.nombre_comercial.localeCompare(b.acreedor.nombre_comercial));
  }
}

export const agroirisAcreedores = new AgroIrisAcreedorService();
