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
}

export interface AcreedorSelectOption {
  value: number;
  label: string;
  searchText: string;
  acreedor: AgroIrisAcreedor;
}

type AcreedorCacheRow = {
  ACR_Codigo: number;
  ACR_Nombre: string | null;
  ACR_Nif: string | null;
  ACR_Cuenta: string | null;
  activo: boolean | null;
};

const db = supabase as any;

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
  };
};

class AgroIrisAcreedorService {
  private acreedoresPromise: Promise<AgroIrisAcreedor[]> | null = null;

  private async fetchAcreedores(): Promise<AgroIrisAcreedor[]> {
    const { data, error } = await db
      .from('acreedores_cache')
      .select('ACR_Codigo, ACR_Nombre, ACR_Nif, ACR_Cuenta, activo')
      .eq('activo', true)
      .order('ACR_Nombre', { ascending: true });

    if (error) throw error;
    return ((data ?? []) as AcreedorCacheRow[]).map(mapCacheRow);
  }

  async getAcreedores(): Promise<AgroIrisAcreedor[]> {
    if (this.acreedoresPromise) return this.acreedoresPromise;

    this.acreedoresPromise = this.fetchAcreedores().finally(() => {
      this.acreedoresPromise = null;
    });

    return this.acreedoresPromise;
  }

  async getAcreedorById(acreedorid: number): Promise<AgroIrisAcreedor | null> {
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
        const searchText = `${acreedor.nombre_comercial} ${acreedor.nombre_sujeto} ${acreedor.identificador_fiscal} ${acreedor.acreedorid}`.toLowerCase();

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
