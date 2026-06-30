import { supabase } from '@/integrations/supabase/client';

export interface SalesAccountValue {
  id: number;
  total_kilosbrutos: number | null;
  total_kiloscliente: number | null;
  total_kilosnetos: number | null;
  total_piezas: number | null;
  total_bultos: number | null;
  nro_palets: number | null;
  divisaid: number;
  precio: number;
  tipo_precio: string;
}

export interface SalesAccountDetail {
  id: number;
  salidadetalleid: number;
  externo_detalle_id: number | null;
  idcuentaventadet_orizon: number | null;
  valores: SalesAccountValue[];
}

export interface SalesAccountGasto {
  id: number;
  gastoid: number;
  valor_gasto: number;
  acreedorid: number | null;
}

export interface SalesAccount {
  id: number;
  externo_id: number | null;
  idcuentaventa_orizon: number | null;
  serieid: number;
  codigo_cuentaventa: number;
  numero_cuentaventa: string | null;
  fechavaloracion: string;
  observaciones_valoracion: string | null;
  clienteid: number;
  needs_sync: boolean;
  enviado: boolean;
  enviado_por: string | null;
  enviado_en: string | null;
  archivo_pdf_id: number | null;
  total_cuentaventa: number;
  created_at: string;
  updated_at: string;
  llegada_correo: string | null;
  gastos: SalesAccountGasto[];
  detalles: SalesAccountDetail[];
}

export interface SalesAccountWithTotals extends SalesAccount {
  totals: {
    bultos: number;
    kilos_netos: number;
    kilos_cliente: number;
    palets: number;
  };
}

export interface SalesAccountError {
  id: number;
  archivo_pdf_id: number | null;
  codigo: string;
  mensaje: string;
  numero_pagina: number | null;
  created_at: string;
}

export interface SalesAccountPdfInfo {
  account_id: number;
  numero_cuentaventa: string | null;
  fechavaloracion: string | null;
  created_at: string | null;
  clienteid: number | null;
  idcuentaventa_orizon: number | null;
  total_cuentaventa: number;
}

export interface SalesAccountSalidaDetalleLink {
  salidadetalleid: number;
  cuentaventa_id: number;
  numero_cuentaventa: string | null;
  codigo_cuentaventa: number;
  fechavaloracion: string | null;
  clienteid: number;
  idcuentaventa_orizon: number | null;
}

export interface SalesAccountPageParams {
  page: number;
  pageSize: number;
  orderBy?: 'date_desc' | 'date_asc' | 'numero_asc' | 'numero_desc';
  search?: string | null;
  searchClientIds?: number[];
  clienteId?: number | null;
  ceoxStatus?: 'all' | 'in_ceox' | 'not_in_ceox';
  alertFilter?: 'all' | 'errors' | 'warnings' | 'clean';
  detalleFilter?: 'all' | 'with' | 'without';
  fechaFrom?: string | null;
  fechaTo?: string | null;
}

export interface SalesAccountPageResult {
  accounts: SalesAccountWithTotals[];
  pageAccountIds: number[];
  totalGroups: number;
  totalAccounts: number;
}

type SalesAccountPageRpcRow = {
  row_type: 'meta' | 'item';
  total_groups: number | null;
  total_items: number | null;
  group_key: string | null;
  group_rank: number | null;
  group_sort_date: string | null;
  row_sort_date: string | null;
  row_json: { id?: number | string | null } | null;
};

type RpcResponse = {
  data: unknown;
  error:
    | {
        message: string;
        code?: string;
        details?: string;
        hint?: string;
      }
    | null;
};

const safeNumber = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);
const ACCOUNT_SELECT = `
  id,
  externo_id,
  idcuentaventa_orizon,
  serieid,
  codigo_cuentaventa,
  numero_cuentaventa,
  fechavaloracion,
  observaciones_valoracion,
  clienteid,
  needs_sync,
  enviado,
  enviado_por,
  enviado_en,
  archivo_pdf_id,
  total_cuentaventa,
  created_at,
  updated_at,
  llegada_correo,
  cuentaventa_gastos (
    id,
    gastoid,
    valor_gasto,
    acreedorid
  ),
  cuentaventa_detalle (
    id,
    salidadetalleid,
    externo_detalle_id,
    idcuentaventadet_orizon,
    cuentaventa_detalle_valor (
      id,
      total_kilosbrutos,
      total_kiloscliente,
      total_kilosnetos,
      total_piezas,
      total_bultos,
      nro_palets,
      divisaid,
      precio,
      tipo_precio
    )
  )
`;

const mapRawAccountWithTotals = (raw: any): SalesAccountWithTotals => {
  const gastos: SalesAccountGasto[] = (raw.cuentaventa_gastos || []).map((g: any) => ({
    id: g.id,
    gastoid: g.gastoid,
    valor_gasto: safeNumber(g.valor_gasto),
    acreedorid: g.acreedorid ?? null,
  }));

  const detalles: SalesAccountDetail[] = (raw.cuentaventa_detalle || []).map((d: any) => ({
    id: d.id,
    salidadetalleid: d.salidadetalleid,
    externo_detalle_id: d.externo_detalle_id ?? null,
    idcuentaventadet_orizon: d.idcuentaventadet_orizon ?? null,
    valores: (d.cuentaventa_detalle_valor || []).map((v: any) => ({
      id: v.id,
      total_kilosbrutos: v.total_kilosbrutos,
      total_kiloscliente: v.total_kiloscliente,
      total_kilosnetos: v.total_kilosnetos,
      total_piezas: v.total_piezas,
      total_bultos: v.total_bultos,
      nro_palets: v.nro_palets,
      divisaid: v.divisaid,
      precio: safeNumber(v.precio),
      tipo_precio: v.tipo_precio,
    })),
  }));

  const totals = detalles.reduce(
    (acc, d) => {
      for (const v of d.valores) {
        acc.bultos += safeNumber(v.total_bultos);
        acc.kilos_netos += safeNumber(v.total_kilosnetos);
        acc.kilos_cliente += safeNumber(v.total_kiloscliente);
        acc.palets += safeNumber(v.nro_palets);
      }
      return acc;
    },
    { bultos: 0, kilos_netos: 0, kilos_cliente: 0, palets: 0 },
  );

  return {
    id: raw.id,
    externo_id: raw.externo_id ?? null,
    idcuentaventa_orizon: raw.idcuentaventa_orizon ?? null,
    serieid: raw.serieid,
    codigo_cuentaventa: raw.codigo_cuentaventa,
    numero_cuentaventa: raw.numero_cuentaventa,
    fechavaloracion: raw.fechavaloracion,
    observaciones_valoracion: raw.observaciones_valoracion ?? null,
    clienteid: raw.clienteid,
    needs_sync: raw.needs_sync,
    enviado: raw.enviado,
    enviado_por: raw.enviado_por ?? null,
    enviado_en: raw.enviado_en ?? null,
    archivo_pdf_id: raw.archivo_pdf_id ?? null,
    total_cuentaventa: safeNumber(raw.total_cuentaventa),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    llegada_correo: raw.llegada_correo ?? null,
    gastos,
    detalles,
    totals,
  };
};

class SalesAccountsService {
  private rpcClient = supabase as unknown as {
    rpc: (fn: string, params?: Record<string, unknown>) => Promise<RpcResponse>;
  };

  async getErrorsByPdfIds(pdfIds: number[]): Promise<SalesAccountError[]> {
    if (!pdfIds.length) return [];
    // @ts-expect-error - Tabla añadida por migración y aún no tipada en supabase/types.ts
    const { data, error } = await supabase
      .from('cuentaventa_errores')
      .select('id, archivo_pdf_id, codigo, mensaje, numero_pagina, created_at')
      .in('archivo_pdf_id', pdfIds)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      archivo_pdf_id: row.archivo_pdf_id ?? null,
      codigo: row.codigo,
      mensaje: row.mensaje,
      numero_pagina: row.numero_pagina ?? null,
      created_at: row.created_at,
    }));
  }

  async getTotalCount(): Promise<number> {
    const { count, error } = await supabase
      .from('cuentaventas')
      .select('id', { count: 'exact', head: true });

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  async getAccountsPage(params: SalesAccountPageParams): Promise<SalesAccountPageResult> {
    const rpcParams = {
      p_page: Math.max(1, params.page || 1),
      p_page_size: Math.max(1, params.pageSize || 10),
      p_order: params.orderBy ?? 'date_desc',
      p_search: params.search?.trim() || null,
      p_cliente_id:
        typeof params.clienteId === 'number' && params.clienteId > 0 ? params.clienteId : null,
      p_ceox_status: params.ceoxStatus ?? 'all',
      p_alert_filter: params.alertFilter ?? 'all',
      p_detalle_filter: params.detalleFilter ?? 'all',
      p_fecha_from: params.fechaFrom ?? null,
      p_fecha_to: params.fechaTo ?? null,
      p_search_cliente_ids:
        params.searchClientIds && params.searchClientIds.length > 0
          ? params.searchClientIds.filter((value) => Number.isFinite(value) && value > 0)
          : null,
    };

    const { data, error } = await this.rpcClient.rpc('get_cuentaventas_group_page', rpcParams);

    if (error) {
      throw error;
    }

    const rows = ((data as SalesAccountPageRpcRow[] | null) ?? []) as SalesAccountPageRpcRow[];
    const metaRow = rows.find((row) => row.row_type === 'meta');
    const totalGroups = Number(metaRow?.total_groups ?? 0);
    const totalAccounts = Number(metaRow?.total_items ?? 0);

    const pageAccountIds = Array.from(
      new Set(
        rows
          .filter((row) => row.row_type === 'item' && row.row_json)
          .map((row) => {
            const candidate = row.row_json?.id;
            return typeof candidate === 'number' ? candidate : Number(candidate);
          })
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
    );

    if (pageAccountIds.length === 0) {
      return {
        accounts: [],
        pageAccountIds: [],
        totalGroups,
        totalAccounts,
      };
    }

    const { data: accountRows, error: accountError } = await supabase
      .from('cuentaventas')
      .select(ACCOUNT_SELECT)
      .in('id', pageAccountIds);

    if (accountError) {
      throw accountError;
    }

    const accountsById = new Map<number, SalesAccountWithTotals>(
      ((accountRows ?? []) as any[]).map((raw) => {
        const mapped = mapRawAccountWithTotals(raw);
        return [mapped.id, mapped];
      }),
    );

    return {
      accounts: pageAccountIds
        .map((accountId) => accountsById.get(accountId))
        .filter((account): account is SalesAccountWithTotals => Boolean(account)),
      pageAccountIds,
      totalGroups,
      totalAccounts,
    };
  }

  async getAccounts(pageSize = 1000): Promise<SalesAccountWithTotals[]> {
    const rows: any[] = [];
    const safePageSize = Math.max(1, Math.min(pageSize, 1000));
    let from = 0;

    while (true) {
      const to = from + safePageSize - 1;
      const { data, error } = await supabase
        .from('cuentaventas')
        .select(ACCOUNT_SELECT)
        .order('fechavaloracion', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        throw error;
      }

      const batch = (data ?? []) as any[];
      rows.push(...batch);
      if (batch.length < safePageSize) break;

      from += safePageSize;
      if (from > 50000) break;
    }

    return rows.map((raw: any) => mapRawAccountWithTotals(raw));
  }

  async getAccountsByPdfId(pdfId: number, clienteId?: number | null): Promise<SalesAccountPdfInfo[]> {
    let query = supabase
      .from('cuentaventas')
      .select('id, numero_cuentaventa, fechavaloracion, created_at, clienteid, idcuentaventa_orizon, total_cuentaventa')
      .eq('archivo_pdf_id', pdfId)
      .order('fechavaloracion', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (typeof clienteId === 'number' && clienteId > 0) {
      query = query.eq('clienteid', clienteId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((row: any) => ({
      account_id: row.id,
      numero_cuentaventa: row.numero_cuentaventa ?? null,
      fechavaloracion: row.fechavaloracion ?? null,
      created_at: row.created_at ?? null,
      clienteid: row.clienteid ?? null,
      idcuentaventa_orizon: row.idcuentaventa_orizon ?? null,
      total_cuentaventa: safeNumber(row.total_cuentaventa),
    }));
  }

  async getAccountById(accountId: number): Promise<SalesAccountWithTotals | null> {
    const { data, error } = await supabase
      .from('cuentaventas')
      .select(ACCOUNT_SELECT)
      .eq('id', accountId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return mapRawAccountWithTotals(data);
  }

  async getLinkedAccountsBySalidaDetalleIds(
    salidaDetalleIds: number[],
    options?: { excludeAccountId?: number | null },
  ): Promise<SalesAccountSalidaDetalleLink[]> {
    const uniqueSalidaDetalleIds = Array.from(
      new Set(
        salidaDetalleIds
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
    );

    if (uniqueSalidaDetalleIds.length === 0) return [];

    let detalleQuery = supabase
      .from('cuentaventa_detalle')
      .select('id, salidadetalleid, cuentaventa_id')
      .in('salidadetalleid', uniqueSalidaDetalleIds);

    if (typeof options?.excludeAccountId === 'number' && options.excludeAccountId > 0) {
      detalleQuery = detalleQuery.neq('cuentaventa_id', options.excludeAccountId);
    }

    const { data: detalleRowsRaw, error: detalleErr } = await detalleQuery;
    if (detalleErr) throw detalleErr;

    const detalleRows = (detalleRowsRaw || [])
      .map((row: any) => ({
        id: safeNumber(row.id),
        salidadetalleid: safeNumber(row.salidadetalleid),
        cuentaventa_id: safeNumber(row.cuentaventa_id),
      }))
      .filter((row) => row.id > 0 && row.salidadetalleid > 0 && row.cuentaventa_id > 0);

    if (detalleRows.length === 0) return [];

    const detalleIds = detalleRows.map((row) => row.id);
    const accountIds = Array.from(new Set(detalleRows.map((row) => row.cuentaventa_id)));

    const [{ data: valorRowsRaw, error: valorErr }, { data: accountRowsRaw, error: accountErr }] = await Promise.all([
      supabase.from('cuentaventa_detalle_valor').select('cuentaventa_detalle_id').in('cuentaventa_detalle_id', detalleIds),
      supabase
        .from('cuentaventas')
        .select('id, numero_cuentaventa, codigo_cuentaventa, fechavaloracion, clienteid, idcuentaventa_orizon')
        .in('id', accountIds),
    ]);

    if (valorErr) throw valorErr;
    if (accountErr) throw accountErr;

    const detalleIdsWithValores = new Set(
      (valorRowsRaw || [])
        .map((row: any) => safeNumber(row.cuentaventa_detalle_id))
        .filter((value) => value > 0),
    );

    const accountById = new Map<number, any>(
      (accountRowsRaw || []).map((row: any) => [
        safeNumber(row.id),
        {
          numero_cuentaventa: row.numero_cuentaventa ?? null,
          codigo_cuentaventa: safeNumber(row.codigo_cuentaventa),
          fechavaloracion: row.fechavaloracion ?? null,
          clienteid: safeNumber(row.clienteid),
          idcuentaventa_orizon: row.idcuentaventa_orizon ?? null,
        },
      ]),
    );

    return detalleRows.flatMap((detalle) => {
      if (!detalleIdsWithValores.has(detalle.id)) return [];
      const account = accountById.get(detalle.cuentaventa_id);
      if (!account) return [];

      return [
        {
          salidadetalleid: detalle.salidadetalleid,
          cuentaventa_id: detalle.cuentaventa_id,
          numero_cuentaventa: account.numero_cuentaventa,
          codigo_cuentaventa: account.codigo_cuentaventa,
          fechavaloracion: account.fechavaloracion,
          clienteid: account.clienteid,
          idcuentaventa_orizon: account.idcuentaventa_orizon,
        },
      ];
    });
  }
}

export const salesAccounts = new SalesAccountsService();
