import { supabase } from '@/integrations/supabase/client';
import type {
  FacturaRecibida,
  FacturaRecibidaCtb,
  FacturaRecibidaEstado,
  FacturaRecibidaListFilters,
  FacturaRecibidaPage,
  FacturaValidationIssue,
} from '@/types/facturasRecibidas';

type RawFactura = Record<string, any>;
type RawCtb = Record<string, any>;

export type FacturaRecibidaUpdatePayload = {
  factura_id: string;
  estado?: FacturaRecibidaEstado;
  proveedor_nombre?: string | null;
  proveedor_nif?: string | null;
  factura: Record<string, unknown>;
  ctb: Array<Record<string, unknown>>;
};

const db = supabase as any;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.replace(/^data:.*;base64,/i, ''));
    };
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el PDF.'));
    reader.readAsDataURL(blob);
  });

const getFunctionErrorMessage = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null;
  const error = (data as { error?: unknown }).error;
  return typeof error === 'string' ? error : null;
};

const isFunctionUnavailable = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: unknown; context?: { status?: unknown } }).status ?? (error as { context?: { status?: unknown } }).context?.status;
  const message = String((error as { message?: unknown }).message ?? '').toLowerCase();
  return status === 404 || message.includes('function not found') || message.includes('not found');
};

const numberValue = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const getValidationErrors = (factura: Record<string, unknown>): FacturaValidationIssue[] => {
  const errors: FacturaValidationIssue[] = [];
  const required: Array<[string, string]> = [
    ['FRR_idproveedor', 'Falta proveedor/acreedor resuelto.'],
    ['FRR_numerofactura', 'Falta numero de factura del proveedor.'],
    ['FRR_fechafactura', 'Falta fecha de factura.'],
    ['FRR_totalfac', 'Falta total de factura.'],
    ['FRR_Idempresa', 'Falta empresa Netagro.'],
  ];

  required.forEach(([field, message]) => {
    const value = factura[field];
    if (value === null || value === undefined || value === '') {
      errors.push({ field, message, severity: 'error' });
    }
  });

  if (!factura.FRR_idcuenta) {
    errors.push({ field: 'FRR_idcuenta', message: 'Falta cuenta contable del proveedor.', severity: 'warning' });
  }

  const bases = [1, 2, 3, 4, 5].reduce((sum, index) => sum + numberValue(factura[`FRR_base${index}`]), 0);
  const cuotas = [1, 2, 3, 4, 5].reduce((sum, index) => sum + numberValue(factura[`FRR_cuota${index}`]), 0);
  const total = numberValue(factura.FRR_totalfac, Number.NaN);
  const retencion = numberValue(factura.FRR_cuotaret);
  const suplido = numberValue(factura.FRR_ImpSuplido);

  if (Number.isFinite(total) && Math.abs(bases) + Math.abs(cuotas) > 0) {
    const expected = Number((bases + cuotas - retencion + suplido).toFixed(2));
    if (Math.abs(expected - total) > 0.01) {
      errors.push({
        field: 'FRR_totalfac',
        message: `El total no cuadra con bases/cuotas. Esperado ${expected.toFixed(2)}, total ${total.toFixed(2)}.`,
        severity: 'error',
      });
    }
  }

  return errors;
};

const getValidationErrorsWithAcreedor = async (factura: Record<string, unknown>): Promise<FacturaValidationIssue[]> => {
  const errors = getValidationErrors(factura);
  const proveedorId = numberValue(factura.FRR_idproveedor, Number.NaN);
  if (!Number.isFinite(proveedorId)) return errors;

  const { data, error } = await db
    .from('acreedores_cache')
    .select('ACR_Codigo, ACR_Cuenta')
    .eq('ACR_Codigo', Math.trunc(proveedorId))
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    errors.push({
      field: 'FRR_idproveedor',
      message: 'El proveedor no existe en acreedores_cache/Netagro.',
      severity: 'error',
    });
    return errors;
  }

  const facturaCuenta = typeof factura.FRR_idcuenta === 'string' ? factura.FRR_idcuenta.trim() : '';
  const cacheCuenta = typeof data.ACR_Cuenta === 'string' ? data.ACR_Cuenta.trim() : '';
  if (facturaCuenta && cacheCuenta && facturaCuenta !== cacheCuenta) {
    errors.push({
      field: 'FRR_idcuenta',
      message: `La cuenta contable no coincide con acreedores_cache (${cacheCuenta}).`,
      severity: 'warning',
    });
  }

  return errors;
};

const asValidationErrors = (value: unknown): FacturaValidationIssue[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is FacturaValidationIssue => Boolean(item) && typeof item === 'object')
    .map((item: any) => ({
      field: String(item.field ?? ''),
      message: String(item.message ?? ''),
      severity: item.severity === 'warning' ? 'warning' : 'error',
    }))
    .filter((item) => item.field || item.message);
};

const mapCtb = (row: RawCtb): FacturaRecibidaCtb => ({
  id: String(row.id),
  factura_id: String(row.factura_id),
  posicion: Number(row.posicion ?? 0),
  FRC_id: row.FRC_id ?? null,
  FRC_idfacturarecibida: row.FRC_idfacturarecibida ?? null,
  FRC_Cuenta: row.FRC_Cuenta ?? null,
  FRC_Importe: row.FRC_Importe ?? null,
  FRC_IdActividad: row.FRC_IdActividad ?? null,
  FRC_Idseccion: row.FRC_Idseccion ?? null,
  FRC_Iddepartamento: row.FRC_Iddepartamento ?? null,
  FRC_Idsubdepartamento: row.FRC_Idsubdepartamento ?? null,
  FRC_IdUsuarioLog: row.FRC_IdUsuarioLog ?? null,
  FRC_FechaLog: row.FRC_FechaLog ?? null,
  FRC_HoraLog: row.FRC_HoraLog ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const mapFactura = (row: RawFactura): FacturaRecibida => ({
  id: String(row.id),
  archivo_pdf_id: row.archivo_pdf_id ?? null,
  estado: (row.estado ?? 'pendiente_revision') as FacturaRecibidaEstado,
  proveedor_nombre: row.proveedor_nombre ?? null,
  proveedor_nif: row.proveedor_nif ?? null,
  source_pdf_name: row.source_pdf_name ?? null,
  confidence: row.confidence ?? null,
  extraction: row.extraction ?? null,
  validation_errors: asValidationErrors(row.validation_errors),
  duplicada_de: row.duplicada_de ?? null,
  netagro_sent_at: row.netagro_sent_at ?? null,
  netagro_response: row.netagro_response ?? null,
  netagro_error: row.netagro_error ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
  FRR_id: row.FRR_id ?? null,
  FRR_numero: row.FRR_numero ?? null,
  FRR_ejercicio: row.FRR_ejercicio ?? null,
  FRR_idcentro: row.FRR_idcentro ?? null,
  FRR_idproveedor: row.FRR_idproveedor ?? null,
  FRR_idcuenta: row.FRR_idcuenta ?? null,
  FRR_numerofactura: row.FRR_numerofactura ?? null,
  FRR_fechafactura: row.FRR_fechafactura ?? null,
  FRR_fechactb: row.FRR_fechactb ?? null,
  FRR_Idempresa: row.FRR_Idempresa ?? null,
  FRR_base1: row.FRR_base1 ?? null,
  FRR_iva1: row.FRR_iva1 ?? null,
  FRR_cuota1: row.FRR_cuota1 ?? null,
  FRR_base2: row.FRR_base2 ?? null,
  FRR_iva2: row.FRR_iva2 ?? null,
  FRR_cuota2: row.FRR_cuota2 ?? null,
  FRR_base3: row.FRR_base3 ?? null,
  FRR_iva3: row.FRR_iva3 ?? null,
  FRR_cuota3: row.FRR_cuota3 ?? null,
  FRR_base4: row.FRR_base4 ?? null,
  FRR_iva4: row.FRR_iva4 ?? null,
  FRR_cuota4: row.FRR_cuota4 ?? null,
  FRR_base5: row.FRR_base5 ?? null,
  FRR_iva5: row.FRR_iva5 ?? null,
  FRR_cuota5: row.FRR_cuota5 ?? null,
  FRR_baseret: row.FRR_baseret ?? null,
  FRR_ret: row.FRR_ret ?? null,
  FRR_cuotaret: row.FRR_cuotaret ?? null,
  FRR_totalfac: row.FRR_totalfac ?? null,
  FRR_tipofactura: row.FRR_tipofactura ?? null,
  FRR_Concepto: row.FRR_Concepto ?? null,
  FRR_Observaciones: row.FRR_Observaciones ?? null,
  FRR_ObservacionesAEAT: row.FRR_ObservacionesAEAT ?? null,
  FRR_ImpSuplido: row.FRR_ImpSuplido ?? null,
  FRR_CuotaNoDeducible: row.FRR_CuotaNoDeducible ?? null,
  ctb: ((row.facturasrecibidas_ctb ?? row.ctb ?? []) as RawCtb[])
    .map(mapCtb)
    .sort((left, right) => left.posicion - right.posicion),
});

class FacturasRecibidasService {
  async list(filters: FacturaRecibidaListFilters): Promise<FacturaRecibidaPage> {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.max(1, Math.min(filters.pageSize || 20, 100));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = db
      .from('facturasrecibidas')
      .select('*, facturasrecibidas_ctb(*)', { count: 'exact' });

    if (filters.estado && filters.estado !== 'all') {
      query = query.eq('estado', filters.estado);
    }

    if (filters.proveedor?.trim()) {
      const value = filters.proveedor.trim().replace(/[%,]/g, '');
      query = query.or(`proveedor_nombre.ilike.%${value}%,FRR_idproveedor.eq.${Number(value) || -1}`);
    }

    if (filters.nif?.trim()) {
      const value = filters.nif.trim().replace(/[%,]/g, '');
      query = query.ilike('proveedor_nif', `%${value}%`);
    }

    if (filters.numero?.trim()) {
      const value = filters.numero.trim().replace(/[%,]/g, '');
      query = query.ilike('FRR_numerofactura', `%${value}%`);
    }

    if (filters.fechaFrom) query = query.gte('FRR_fechafactura', filters.fechaFrom);
    if (filters.fechaTo) query = query.lte('FRR_fechafactura', filters.fechaTo);
    if (typeof filters.totalFrom === 'number') query = query.gte('FRR_totalfac', filters.totalFrom);
    if (typeof filters.totalTo === 'number') query = query.lte('FRR_totalfac', filters.totalTo);

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .order('posicion', { referencedTable: 'facturasrecibidas_ctb', ascending: true })
      .range(from, to);

    if (error) throw error;
    return {
      items: ((data ?? []) as RawFactura[]).map(mapFactura),
      total: count ?? 0,
    };
  }

  async getById(id: string): Promise<FacturaRecibida | null> {
    const { data, error } = await db
      .from('facturasrecibidas')
      .select('*, facturasrecibidas_ctb(*)')
      .eq('id', id)
      .order('posicion', { referencedTable: 'facturasrecibidas_ctb', ascending: true })
      .maybeSingle();

    if (error) throw error;
    return data ? mapFactura(data) : null;
  }

  async getPdfBase64(archivoPdfId: number): Promise<{ base64: string; fileName: string | null }> {
    const { data, error } = await db
      .from('archivos_pdf')
      .select('b64_contenido, storage_bucket, storage_path, nombre_archivo')
      .eq('id', archivoPdfId)
      .single();

    if (error) throw error;
    if (data?.b64_contenido) {
      return {
        base64: data.b64_contenido,
        fileName: data?.nombre_archivo ?? null,
      };
    }

    if (data?.storage_bucket && data?.storage_path) {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(data.storage_bucket)
        .download(data.storage_path);
      if (downloadError) throw downloadError;
      if (blob) {
        return {
          base64: await blobToBase64(blob),
          fileName: data?.nombre_archivo ?? null,
        };
      }
    }

    return {
      base64: '',
      fileName: data?.nombre_archivo ?? null,
    };
  }

  async update(payload: FacturaRecibidaUpdatePayload): Promise<FacturaRecibida> {
    const { data, error } = await supabase.functions.invoke('factura-recibida-update', { body: payload });
    if (error) {
      if (isFunctionUnavailable(error)) return this.updateDirect(payload);
      throw error;
    }
    const message = getFunctionErrorMessage(data);
    if (message) throw new Error(message);
    const updated = await this.getById(payload.factura_id);
    if (!updated) throw new Error('Factura no encontrada tras guardar.');
    return updated;
  }

  async sendToNetagro(facturaId: string): Promise<FacturaRecibida> {
    const { data, error } = await supabase.functions.invoke('factura-recibida-send-netagro', {
      body: { factura_id: facturaId },
    });
    if (error) throw error;
    const message = getFunctionErrorMessage(data);
    if (message) throw new Error(message);
    const updated = await this.getById(facturaId);
    if (!updated) throw new Error('Factura no encontrada tras enviar.');
    return updated;
  }

  async delete(facturaId: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke('factura-recibida-delete', {
      body: { factura_id: facturaId },
    });
    if (error) {
      if (isFunctionUnavailable(error)) return this.deleteDirect(facturaId);
      throw error;
    }
    const message = getFunctionErrorMessage(data);
    if (message) throw new Error(message);
  }

  private async updateDirect(payload: FacturaRecibidaUpdatePayload): Promise<FacturaRecibida> {
    const validationErrors = await getValidationErrorsWithAcreedor(payload.factura);
    const nextEstado =
      payload.estado ?? (validationErrors.some((error) => error.severity === 'error') ? 'pendiente_revision' : 'validada');

    const { error: updateError } = await db
      .from('facturasrecibidas')
      .update({
        ...payload.factura,
        proveedor_nombre: payload.proveedor_nombre ?? null,
        proveedor_nif: payload.proveedor_nif ?? null,
        estado: nextEstado,
        validation_errors: validationErrors,
        netagro_error: null,
      })
      .eq('id', payload.factura_id);

    if (updateError) throw updateError;

    const { error: deleteLinesError } = await db
      .from('facturasrecibidas_ctb')
      .delete()
      .eq('factura_id', payload.factura_id);

    if (deleteLinesError) throw deleteLinesError;

    if (payload.ctb.length > 0) {
      const { error: insertLinesError } = await db.from('facturasrecibidas_ctb').insert(
        payload.ctb.map((linea, index) => ({
          ...linea,
          FRC_id: null,
          FRC_idfacturarecibida: null,
          posicion: Number(linea.posicion ?? index + 1),
          factura_id: payload.factura_id,
        })),
      );
      if (insertLinesError) throw insertLinesError;
    }

    const updated = await this.getById(payload.factura_id);
    if (!updated) throw new Error('Factura no encontrada tras guardar.');
    return updated;
  }

  private async deleteDirect(facturaId: string): Promise<void> {
    const factura = await this.getById(facturaId);
    if (!factura) throw new Error('Factura no encontrada.');
    if (factura.estado === 'enviada_netagro') {
      throw new Error('No se puede borrar una factura enviada a Netagro.');
    }

    const archivoPdfId = factura.archivo_pdf_id;
    const { error: deleteError } = await db.from('facturasrecibidas').delete().eq('id', facturaId);
    if (deleteError) throw deleteError;

    if (archivoPdfId) {
      const { count, error: countError } = await db
        .from('facturasrecibidas')
        .select('*', { count: 'exact', head: true })
        .eq('archivo_pdf_id', archivoPdfId);
      if (countError) throw countError;
      if ((count ?? 0) === 0) {
        const { error: pdfDeleteError } = await db.from('archivos_pdf').delete().eq('id', archivoPdfId);
        if (pdfDeleteError) throw pdfDeleteError;
      }
    }
  }
}

export const facturasRecibidas = new FacturasRecibidasService();
