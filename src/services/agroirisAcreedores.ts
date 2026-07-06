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
}

export interface AcreedorSelectOption {
  value: number;
  label: string;
  searchText: string;
  acreedor: AgroIrisAcreedor;
}

export type AcreedorSource = 'cache' | 'erp';

type AcreedorCacheRow = {
  ACR_Codigo: number;
  ACR_Nombre: string | null;
  ACR_Nif: string | null;
  ACR_Cuenta: string | null;
  activo: boolean | null;
};

type ERPReadListResponse<T> = {
  items?: T[];
  limit?: number;
  offset?: number;
  total?: number;
};

type ERPAcreedorRow = Record<string, unknown>;
type ERPFetchResult = {
  acreedores: AgroIrisAcreedor[];
  complete: boolean;
};

const ERP_READ_FUNCTION = 'facturas-recibidas-erp-read';
const db = supabase as any;
const ERP_ACREEDORES_PAGE_SIZE = 200;
const ERP_ACREEDORES_PREFETCH_CONCURRENCY = 4;

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

const mapCacheRow = (row: AcreedorCacheRow): AgroIrisAcreedor => {
  const code = Number(row.ACR_Codigo);
  const name = String(row.ACR_Nombre ?? '').trim() || `Acreedor ${code}`;

  return {
    acreedorid: code,
    sujetoid: code,
    perfilacreedorid: 0,
    codigo_fianza: '',
    subgrupoanalisisid: 0,
    formacobropagoid: 0,
    cuentaid_contrapartida: 0,
    tags_acreedor: '',
    activo: row.activo !== false,
    observaciones: '',
    acreedorid_facturacion: code,
    nombre_sujeto: name,
    apellido1_sujeto: '',
    apellido2_sujeto: '',
    tipo_documento: '',
    identificador_fiscal: String(row.ACR_Nif ?? '').trim(),
    idiomaid: 0,
    divisaid: 0,
    imagen_sujeto: '',
    web_sujeto: '',
    nombre_comercial: name,
    empresabancoid: 0,
    referencia: row.ACR_Cuenta ?? null,
    cuenta_contable: row.ACR_Cuenta ?? null,
  };
};

const mapERPRow = (row: ERPAcreedorRow): AgroIrisAcreedor | null => {
  const code = readNumber(row, ['ACR_Codigo', 'codigo', 'id', 'acreedor_id'], null);
  if (!code) return null;

  const name =
    readText(row, ['ACR_Nombre', 'nombre', 'nombre_comercial', 'razon_social'], null) ??
    `Acreedor ${code}`;
  const nif = readText(row, ['ACR_Nif', 'nif', 'cif'], '');
  const cuenta = readText(row, ['ACR_IdCuenta', 'ACR_Cuenta', 'cuenta', 'cuenta_contable'], null);
  const activoValue = row.activo ?? row.ACR_Activo;
  const blocked = isTruthyFlag(row.ACR_Bloqueado);
  const inactive = isTruthyFlag(row.ACR_InactivoRGPD);
  const active = activoValue === undefined || activoValue === null ? !blocked && !inactive : !isFalseyFlag(activoValue);

  return {
    acreedorid: code,
    sujetoid: code,
    perfilacreedorid: 0,
    codigo_fianza: '',
    subgrupoanalisisid: 0,
    formacobropagoid: 0,
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
    empresabancoid: 0,
    referencia: cuenta,
    cuenta_contable: cuenta,
  };
};

class AgroIrisAcreedorService {
  private acreedoresPromise: Promise<AgroIrisAcreedor[]> | null = null;
  private erpAcreedoresPromise: Promise<AgroIrisAcreedor[]> | null = null;
  private erpAcreedoresPromiseLimit = 0;
  private erpAcreedoresCache: AgroIrisAcreedor[] | null = null;
  private erpAcreedoresCacheComplete = false;

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
    if (error) throw new Error(await this.getFunctionErrorMessage(error));
    if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
      throw new Error(String((data as { error: string }).error));
    }
    return data as T;
  }

  private async fetchAcreedores(): Promise<AgroIrisAcreedor[]> {
    const { data, error } = await db
      .from('acreedores_cache')
      .select('ACR_Codigo, ACR_Nombre, ACR_Nif, ACR_Cuenta, activo')
      .eq('activo', true)
      .order('ACR_Nombre', { ascending: true });

    if (error) throw error;
    return ((data ?? []) as AcreedorCacheRow[]).map(mapCacheRow);
  }

  private async searchAcreedoresCache(query: string, limit: number): Promise<AgroIrisAcreedor[]> {
    const cleaned = query.trim();
    let request = db
      .from('acreedores_cache')
      .select('ACR_Codigo, ACR_Nombre, ACR_Nif, ACR_Cuenta, activo')
      .eq('activo', true)
      .order('ACR_Nombre', { ascending: true })
      .limit(limit);

    if (cleaned) {
      const safeSearch = cleaned.replace(/[,%]/g, ' ').trim();
      request = request.or(`ACR_Nombre.ilike.%${safeSearch}%,ACR_Nif.ilike.%${safeSearch}%,ACR_Codigo.eq.${Number(safeSearch) || -1}`);
    }

    const { data, error } = await request;
    if (error) throw error;
    return ((data ?? []) as AcreedorCacheRow[]).map(mapCacheRow);
  }

  private mapAcreedoresERPPage(payload: unknown): ERPReadListResponse<ERPAcreedorRow> {
    const page = extractListPage<ERPAcreedorRow>(payload);
    return {
      ...page,
      items: (page.items ?? []).filter(looksLikeAcreedorRow),
    };
  }

  private async fetchAcreedoresERPPage(offset: number, limit: number): Promise<ERPReadListResponse<ERPAcreedorRow>> {
    const consulta = `acreedores?limit=${encodeURIComponent(String(limit))}&offset=${encodeURIComponent(String(offset))}`;
    const payload = await this.erpRead<unknown>(consulta);
    return this.mapAcreedoresERPPage(payload);
  }

  private async fetchAcreedoresERPBatch(offsets: number[], pageSize: number): Promise<ERPReadListResponse<ERPAcreedorRow>[]> {
    const pages: ERPReadListResponse<ERPAcreedorRow>[] = [];

    for (let index = 0; index < offsets.length; index += ERP_ACREEDORES_PREFETCH_CONCURRENCY) {
      const batch = offsets.slice(index, index + ERP_ACREEDORES_PREFETCH_CONCURRENCY);
      const batchPages = await Promise.all(batch.map((offset) => this.fetchAcreedoresERPPage(offset, pageSize)));
      pages.push(...batchPages);
    }

    return pages;
  }

  private async fetchAcreedoresERPUncached(limit: number): Promise<ERPFetchResult> {
    const requestedLimit = Math.max(1, limit);
    const pageSize = Math.min(ERP_ACREEDORES_PAGE_SIZE, requestedLimit);
    const firstPage = await this.fetchAcreedoresERPPage(0, pageSize);
    const total = typeof firstPage.total === 'number' ? firstPage.total : null;
    const targetCount = total === null ? requestedLimit : Math.min(requestedLimit, total);
    const offsets: number[] = [];

    for (let offset = pageSize; offset < targetCount; offset += pageSize) {
      offsets.push(offset);
    }

    const pages = offsets.length > 0 ? [firstPage, ...(await this.fetchAcreedoresERPBatch(offsets, pageSize))] : [firstPage];
    const acreedores = pages
      .flatMap((page) => page.items ?? [])
      .map(mapERPRow)
      .filter((item): item is AgroIrisAcreedor => Boolean(item))
      .slice(0, requestedLimit);
    const complete = total !== null ? requestedLimit >= total && acreedores.length >= total : acreedores.length < requestedLimit;

    return { acreedores, complete };
  }

  private async fetchAcreedoresERP(limit: number): Promise<AgroIrisAcreedor[]> {
    const requestedLimit = Math.max(1, limit);

    if (this.erpAcreedoresCache && (this.erpAcreedoresCacheComplete || this.erpAcreedoresCache.length >= requestedLimit)) {
      return this.erpAcreedoresCache.slice(0, requestedLimit);
    }

    if (this.erpAcreedoresPromise && this.erpAcreedoresPromiseLimit >= requestedLimit) {
      const acreedores = await this.erpAcreedoresPromise;
      return acreedores.slice(0, requestedLimit);
    }

    this.erpAcreedoresPromiseLimit = requestedLimit;
    this.erpAcreedoresPromise = this.fetchAcreedoresERPUncached(requestedLimit)
      .then(({ acreedores, complete }) => {
        if (!this.erpAcreedoresCache || acreedores.length >= this.erpAcreedoresCache.length) {
          this.erpAcreedoresCache = acreedores;
          this.erpAcreedoresCacheComplete = complete;
        }
        return acreedores;
      })
      .finally(() => {
        this.erpAcreedoresPromise = null;
        this.erpAcreedoresPromiseLimit = 0;
      });

    return this.erpAcreedoresPromise;
  }

  private filterAcreedoresLocal(acreedores: AgroIrisAcreedor[], query: string, limit: number): AgroIrisAcreedor[] {
    const cleaned = normalizeLookupText(query);
    if (!cleaned) return acreedores.slice(0, limit);

    return acreedores
      .filter((acreedor) => {
        const searchText = normalizeLookupText(
          `${acreedor.nombre_comercial} ${acreedor.nombre_sujeto} ${acreedor.identificador_fiscal} ${acreedor.acreedorid}`,
        );
        return searchText.includes(cleaned);
      })
      .slice(0, limit);
  }

  private async searchAcreedoresERP(query: string, limit: number): Promise<AgroIrisAcreedor[]> {
    const cleaned = query.trim();
    const encodedLimit = encodeURIComponent(String(Math.min(Math.max(1, limit), ERP_ACREEDORES_PAGE_SIZE)));
    if (limit > ERP_ACREEDORES_PAGE_SIZE || this.erpAcreedoresCacheComplete) {
      const acreedores = await this.fetchAcreedoresERP(limit);
      return this.filterAcreedoresLocal(acreedores, cleaned, limit);
    }

    if (!cleaned) {
      return this.fetchAcreedoresERP(limit);
    }

    const consultas = cleaned
      ? [
          `acreedores?q=${encodeURIComponent(cleaned)}&limit=${encodedLimit}`,
          `acreedores?nombre=${encodeURIComponent(cleaned)}&limit=${encodedLimit}`,
          `acreedores?nif=${encodeURIComponent(cleaned)}&limit=${encodedLimit}`,
          `acreedores?codigo=${encodeURIComponent(cleaned)}&limit=${encodedLimit}`,
        ]
      : [];

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

  async getAcreedores(): Promise<AgroIrisAcreedor[]> {
    if (this.acreedoresPromise) return this.acreedoresPromise;

    this.acreedoresPromise = this.fetchAcreedores().finally(() => {
      this.acreedoresPromise = null;
    });

    return this.acreedoresPromise;
  }

  async searchAcreedores(
    query: string,
    options: { limit?: number; source?: AcreedorSource } = {},
  ): Promise<AgroIrisAcreedor[]> {
    const limit = options.limit ?? 25;
    const source = options.source ?? 'cache';

    if (source === 'erp') {
      return this.searchAcreedoresERP(query, limit);
    }

    return this.searchAcreedoresCache(query, limit);
  }

  prefetchAcreedores(options: { limit?: number; source?: AcreedorSource } = {}): void {
    const limit = options.limit ?? 25;
    const source = options.source ?? 'cache';

    if (source === 'erp') {
      void this.fetchAcreedoresERP(limit).catch((error) => {
        console.error('Error precargando acreedores del ERP:', error);
      });
      return;
    }

    void this.getAcreedores().catch((error) => {
      console.error('Error precargando acreedores:', error);
    });
  }

  async getAcreedorById(acreedorid: number, source: AcreedorSource = 'cache'): Promise<AgroIrisAcreedor | null> {
    if (source === 'erp') {
      const acreedor = await this.erpRead<ERPAcreedorRow>(`acreedores/${encodeURIComponent(String(acreedorid))}`);
      return mapERPRow(acreedor);
    }

    const { data, error } = await db
      .from('acreedores_cache')
      .select('ACR_Codigo, ACR_Nombre, ACR_Nif, ACR_Cuenta, activo')
      .eq('ACR_Codigo', acreedorid)
      .maybeSingle();

    if (error) {
      console.error(`Error obteniendo acreedor ${acreedorid}:`, error);
      return null;
    }

    return data ? mapCacheRow(data as AcreedorCacheRow) : null;
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
