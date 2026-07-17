import { useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { legacySupabase as supabase } from '@/integrations/supabase/legacyClient';
import { agroirisAuth } from '@/services/agroirisAuth';
import { useToast } from '@/hooks/use-toast';
import { parseOrizonId } from '@/utils/orizon';
import type { Pedido, TipoPedido, PedidoFilters, PedidoWithMatch } from '@/types/pedidos';
import { agroirisDomicilios } from '@/services/agroirisDomicilios';
import { agroirisClientePlataformas } from '@/services/agroirisClientePlataformas';
import { agroirisClients } from '@/services/agroirisClients';

interface UsePedidosDataOptions {
  tipoPedido: TipoPedido;
  filters: PedidoFilters;
  page: number;
  pageSize: number;
}

interface PedidosRpcRow {
  row_type: 'meta' | 'item';
  total_groups: number | null;
  total_items: number | null;
  group_key: string | null;
  group_rank: number | null;
  group_sort_date: string | null;
  row_sort_date: string | null;
  row_json: Pedido | null;
}

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

interface PedidosQueryData {
  pedidos: PedidoWithMatch[];
  totalGroups: number;
  totalPedidos: number;
  pdfSharedCounts: Record<number, number>; // serializable
  incompleteDataPedidos: number[]; // serializable
  domicilioNombres: Record<number, string>;
  domicilioPlataformas: Record<number, string>;
  clienteNombres: Record<number, string>;
}

type DeletePedidoOptions = {
  silent?: boolean;
  skipInvalidate?: boolean;
  throwOnError?: boolean;
};

type CambioLite = {
  id: number;
  created_at: string;
  clienteid: number | null;
  sujetodomicilioid_destino: number | null;
  fecha_carga: string | null;
  referencia_cliente: string | null;
  archivo_pdf_id: number | null;
  idpedido_orizon: number | null;
  tipo_pedido: string | null;
  revisado: boolean | null;
};

const buildCompositeKey = (
  clienteid: number | null | undefined,
  domicilioid: number | null | undefined,
  fechaCarga: string | null | undefined,
): string =>
  [clienteid, domicilioid, fechaCarga]
    .map((v) => (v === null || v === undefined ? '' : String(v)))
    .join('|');

export const usePedidosData = ({ tipoPedido, filters, page, pageSize }: UsePedidosDataOptions) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const withTimeout = useCallback(
    async <T,>(promise: PromiseLike<T>, label: string, timeoutMs = 15000): Promise<T> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timeout al cargar ${label}. Verifica la conexión y reintenta.`));
        }, timeoutMs);
        promise.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (err) => {
            clearTimeout(timer);
            reject(err);
          },
        );
      });
    },
    [],
  );

  const rpcClient = supabase as unknown as {
    rpc: (fn: string, params?: Record<string, unknown>) => Promise<RpcResponse>;
  };

  const toastRef = useRef(toast);
  const rpcSortByNoticeShownRef = useRef(false);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const fetchCambiosMatch = useCallback(
    async (pedidos: Pedido[]): Promise<Map<number, CambioLite>> => {
      if (pedidos.length === 0) return new Map<number, CambioLite>();

      const cambiosMapById = new Map<number, CambioLite>();
      const pushCambios = (rows: unknown[] | null | undefined) => {
        (rows ?? []).forEach((row) => {
          if (!row || typeof row !== 'object') return;
          const typed = row as Record<string, unknown>;
          const id = Number(typed.id);
          if (!Number.isFinite(id)) return;
          cambiosMapById.set(id, {
            id,
            created_at: typed.created_at as string,
            clienteid: (typed.clienteid as number | null) ?? null,
            sujetodomicilioid_destino: (typed.sujetodomicilioid_destino as number | null) ?? null,
            fecha_carga: (typed.fecha_carga as string | null) ?? null,
            referencia_cliente: (typed.referencia_cliente as string | null) ?? null,
            archivo_pdf_id: (typed.archivo_pdf_id as number | null) ?? null,
            idpedido_orizon: (typed.idpedido_orizon as number | null) ?? null,
            tipo_pedido: (typed.tipo_pedido as string | null) ?? null,
            revisado: (typed.revisado as boolean | null) ?? null,
          });
        });
      };

      const orizonIds = Array.from(
        new Set(
          pedidos
            .map((p) => p.idpedido_orizon)
            .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
        ),
      );

      if (orizonIds.length > 0) {
        const { data, error } = await withTimeout(
          supabase
            .from('cambios_pedidos')
            .select(
              'id, created_at, clienteid, sujetodomicilioid_destino, fecha_carga, tipo_pedido, referencia_cliente, archivo_pdf_id, idpedido_orizon, revisado',
            )
            .eq('tipo_pedido', tipoPedido)
            .in('idpedido_orizon', orizonIds),
          'cambios por id de Orizon',
        );
        if (error) throw error;
        pushCambios(data);
      }

      if (tipoPedido === 'P220') {
        const referencias = Array.from(
          new Set(
            pedidos
              .map((p) => (p.referencia_cliente ?? '').trim())
              .filter((ref): ref is string => Boolean(ref)),
          ),
        );

        if (referencias.length > 0) {
          const { data, error } = await withTimeout(
            supabase
              .from('cambios_pedidos')
              .select(
                'id, created_at, clienteid, sujetodomicilioid_destino, fecha_carga, tipo_pedido, referencia_cliente, archivo_pdf_id, idpedido_orizon, revisado',
              )
              .eq('tipo_pedido', 'P220')
              .in('referencia_cliente', referencias),
            'cambios por referencia',
          );
          if (error) throw error;
          pushCambios(data);
        }
      } else {
        const clienteIds = Array.from(
          new Set(
            pedidos
              .map((p) => p.clienteid)
              .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
          ),
        );
        const domicilioIds = Array.from(
          new Set(
            pedidos
              .map((p) => p.sujetodomicilioid_destino)
              .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
          ),
        );
        const fechasCarga = Array.from(
          new Set(
            pedidos
              .map((p) => p.fecha_carga)
              .filter((fecha): fecha is string => Boolean(fecha)),
          ),
        );

        if (clienteIds.length > 0 && domicilioIds.length > 0 && fechasCarga.length > 0) {
          const { data, error } = await withTimeout(
            supabase
              .from('cambios_pedidos')
              .select(
                'id, created_at, clienteid, sujetodomicilioid_destino, fecha_carga, tipo_pedido, referencia_cliente, archivo_pdf_id, idpedido_orizon, revisado',
              )
              .eq('tipo_pedido', 'P22E')
              .in('clienteid', clienteIds)
              .in('sujetodomicilioid_destino', domicilioIds)
              .in('fecha_carga', fechasCarga),
            'cambios por clave compuesta',
          );
          if (error) throw error;
          pushCambios(data);
        }
      }

      const cambiosByOrizon = new Map<number, CambioLite[]>();
      const cambiosByReferencia = new Map<string, CambioLite[]>();
      const cambiosByCompositeP22E = new Map<string, CambioLite[]>();

      const registerCambio = <K,>(
        mapKey: K | null | undefined | '',
        map: Map<K, CambioLite[]>,
        cambio: CambioLite,
      ) => {
        if (mapKey === null || mapKey === undefined || mapKey === '') return;
        const key = mapKey as K;
        const list = map.get(key) ?? [];
        list.push(cambio);
        map.set(key, list);
      };

      cambiosMapById.forEach((cambio) => {
        registerCambio(cambio.idpedido_orizon, cambiosByOrizon, cambio);
        const refKey = cambio.referencia_cliente?.trim();
        if (refKey) registerCambio(refKey, cambiosByReferencia, cambio);

        const compositeP22E = buildCompositeKey(
          cambio.clienteid,
          cambio.sujetodomicilioid_destino,
          cambio.fecha_carga,
        );
        if (compositeP22E && !compositeP22E.includes('||')) {
          registerCambio(compositeP22E, cambiosByCompositeP22E, cambio);
        }
      });

      const getLatestCambio = <K,>(map: Map<K, CambioLite[]>, key: K) => {
        const list = map.get(key);
        if (!list || list.length === 0) return null;
        return list.reduce<CambioLite | null>((latest, current) => {
          if (!latest) return current;
          return (current.created_at || '').localeCompare(latest.created_at || '') > 0 ? current : latest;
        }, null);
      };

      const matchByPedidoId = new Map<number, CambioLite>();

      pedidos.forEach((pedido) => {
        let matchedCambio: CambioLite | null = null;

        if (pedido.idpedido_orizon) {
          matchedCambio = getLatestCambio(cambiosByOrizon, pedido.idpedido_orizon);
          if (matchedCambio && matchedCambio.tipo_pedido !== pedido.tipo_pedido) {
            matchedCambio = null;
          }
        }

        if (!matchedCambio && pedido.tipo_pedido === 'P220') {
          const referencia = pedido.referencia_cliente?.trim();
          if (referencia) {
            const candidate = getLatestCambio(cambiosByReferencia, referencia);
            if (candidate && candidate.tipo_pedido === 'P220') {
              matchedCambio = candidate;
            }
          }
        }

        if (!matchedCambio && pedido.tipo_pedido === 'P22E') {
          const compositeKey = buildCompositeKey(
            pedido.clienteid,
            pedido.sujetodomicilioid_destino,
            pedido.fecha_carga,
          );
          if (compositeKey && !compositeKey.includes('||')) {
            matchedCambio = getLatestCambio(cambiosByCompositeP22E, compositeKey);
            if (matchedCambio && matchedCambio.tipo_pedido !== 'P22E') {
              matchedCambio = null;
            }
          }
        }

        if (matchedCambio) {
          matchByPedidoId.set(pedido.id, matchedCambio);
        }
      });

      return matchByPedidoId;
    },
    [tipoPedido, withTimeout],
  );

  const fetchPedidosData = useCallback(async (): Promise<PedidosQueryData> => {
    const rpcParams = {
      p_tipo_pedido: tipoPedido,
      p_page: Math.max(1, page),
      p_page_size: Math.max(1, pageSize),
      p_order: filters.order,
      p_referencia: filters.referencia?.trim() || null,
      p_cliente_id: filters.clienteId ?? null,
      p_domicilio_destino_id: filters.domicilioDestinoId ?? null,
      p_fecha_pedido_from: filters.fechaPedidoRango.from || null,
      p_fecha_pedido_to: filters.fechaPedidoRango.to || null,
      p_fecha_carga_from: filters.fechaCargaRango.from || filters.fechaCargaDesde || null,
      p_fecha_carga_to: filters.fechaCargaRango.to || filters.fechaCargaHasta || null,
      p_ceox_status: filters.ceoxStatus,
      p_en_orizon: filters.ceoxStatus === 'in_ceox' || filters.ceoxStatus === 'in_ceox_outdated',
      p_tiene_matricula: Boolean(filters.tieneMatricula),
      p_tiene_cambio: Boolean(filters.tieneCambio),
      p_tiene_prevision: tipoPedido === 'P220' ? Boolean(filters.tienePrevision) : false,
    };
    const shouldSortByEmail = filters.sortBy === 'email_arrival';
    let rpcData: unknown = null;
    let rpcError: RpcResponse['error'] = null;

    if (shouldSortByEmail) {
      const withSortBy = await withTimeout(
        rpcClient.rpc('get_pedidos_group_page', {
          ...rpcParams,
          p_sort_by: 'email_arrival',
        }),
        'pedidos paginados',
      );
      rpcData = withSortBy.data;
      rpcError = withSortBy.error;

      const missingSortByParam =
        rpcError?.code === 'PGRST202' &&
        [rpcError.message, rpcError.details, rpcError.hint].some((value) =>
          String(value ?? '').includes('p_sort_by'),
        );

      if (missingSortByParam) {
        const fallback = await withTimeout(
          rpcClient.rpc('get_pedidos_group_page', rpcParams),
          'pedidos paginados',
        );
        rpcData = fallback.data;
        rpcError = fallback.error;

        if (!rpcSortByNoticeShownRef.current) {
          rpcSortByNoticeShownRef.current = true;
          toastRef.current({
            title: 'Orden por llegada pendiente de migración',
            description:
              'El servidor actual no admite ordenar por llegada al correo. Ejecuta la migración y vuelve a intentar.',
          });
        }
      }
    } else {
      const withoutSortBy = await withTimeout(
        rpcClient.rpc('get_pedidos_group_page', rpcParams),
        'pedidos paginados',
      );
      rpcData = withoutSortBy.data;
      rpcError = withoutSortBy.error;
    }

    if (rpcError) throw rpcError;

    const rows = ((rpcData as PedidosRpcRow[] | null) ?? []) as PedidosRpcRow[];
    const metaRow = rows.find((row) => row.row_type === 'meta');

    const totalGroups = Number(metaRow?.total_groups ?? 0);
    const totalPedidos = Number(metaRow?.total_items ?? 0);

    const pedidosBase = rows
      .filter((row) => row.row_type === 'item' && row.row_json)
      .map((row) => row.row_json as Pedido);

    let pedidosWithMatch: PedidoWithMatch[] = pedidosBase;

    if (tipoPedido === 'P220' && pedidosBase.length > 0) {
      type PrevisionMatchRecord = Pick<
        Pedido,
        'id' | 'clienteid' | 'sujetodomicilioid_destino' | 'fecha_carga' | 'idpedido_orizon'
      >;

      const clienteIds = Array.from(
        new Set(
          pedidosBase
            .map((p) => p.clienteid)
            .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
        ),
      );
      const domicilioIds = Array.from(
        new Set(
          pedidosBase
            .map((p) => p.sujetodomicilioid_destino)
            .filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
        ),
      );
      const fechasCarga = Array.from(
        new Set(
          pedidosBase
            .map((p) => p.fecha_carga)
            .filter((fecha): fecha is string => Boolean(fecha)),
        ),
      );

      if (clienteIds.length > 0 && domicilioIds.length > 0 && fechasCarga.length > 0) {
        const { data: previsionesData, error: previsionesError } = await withTimeout(
          supabase
            .from('pedidos')
            .select('id, clienteid, sujetodomicilioid_destino, fecha_carga, idpedido_orizon')
            .eq('tipo_pedido', 'P22E')
            .in('clienteid', clienteIds)
            .in('sujetodomicilioid_destino', domicilioIds)
            .in('fecha_carga', fechasCarga),
          'previsiones',
        );

        if (previsionesError) {
          throw previsionesError;
        }

        const previsionMap = ((previsionesData as PrevisionMatchRecord[]) || []).reduce<
          Record<string, { id: number; uploaded: boolean }>
        >((acc, prev) => {
          const key = buildCompositeKey(prev.clienteid, prev.sujetodomicilioid_destino, prev.fecha_carga);
          if (key && !key.includes('||')) {
            acc[key] = { id: prev.id as number, uploaded: Boolean(prev.idpedido_orizon) };
          }
          return acc;
        }, {});

        pedidosWithMatch = pedidosBase.map((p) => {
          const key = buildCompositeKey(p.clienteid, p.sujetodomicilioid_destino, p.fecha_carga);
          const matching = key && previsionMap[key] ? previsionMap[key] : null;
          return matching
            ? { ...p, matching_prevision_id: matching.id, matching_prevision_uploaded: matching.uploaded }
            : p;
        });
      }
    }

    const cambiosByPedido = await fetchCambiosMatch(pedidosWithMatch);
    const pedidosWithCambios: PedidoWithMatch[] = pedidosWithMatch.map((pedido) => {
      const matchedCambio = cambiosByPedido.get(pedido.id);
      if (!matchedCambio) return pedido;
      return {
        ...pedido,
        matching_cambio_id: matchedCambio.id,
        matching_cambio_archivo_pdf_id: matchedCambio.archivo_pdf_id,
        matching_cambio_reference: matchedCambio.referencia_cliente,
        matching_cambio_created_at: matchedCambio.created_at,
        matching_cambio_revisado: matchedCambio.revisado ?? null,
      };
    });

    const lineCountsByPedidoId = new Map<number, number>();
    const pedidoIdsForLineCounts = pedidosWithCambios
      .map((pedido) => pedido.id)
      .filter((id): id is number => typeof id === 'number' && Number.isFinite(id));

    if (pedidoIdsForLineCounts.length > 0) {
      const { data: lineasCountData, error: lineasCountError } = await withTimeout(
        supabase
          .from('pedido_linea')
          .select('pedidoid')
          .in('pedidoid', pedidoIdsForLineCounts),
        'contador de líneas',
      );

      if (lineasCountError) {
        console.error('Error loading line counts:', lineasCountError);
      } else {
        (lineasCountData ?? []).forEach((linea) => {
          const pedidoId = linea.pedidoid;
          if (typeof pedidoId !== 'number') return;
          lineCountsByPedidoId.set(pedidoId, (lineCountsByPedidoId.get(pedidoId) ?? 0) + 1);
        });
      }
    }

    const pedidosWithLineCounts: PedidoWithMatch[] = pedidosWithCambios.map((pedido) => ({
      ...pedido,
      lineas_count: lineCountsByPedidoId.get(pedido.id) ?? 0,
    }));

    const pdfCounts: Record<number, number> = {};
    const incompletePedidos: number[] = [];

    pedidosWithLineCounts.forEach((pedido) => {
      if (pedido.archivo_pdf_id) {
        pdfCounts[pedido.archivo_pdf_id] = (pdfCounts[pedido.archivo_pdf_id] || 0) + 1;
      }
      if (!pedido.clienteid || !pedido.fecha_pedido || !pedido.fecha_carga) {
        incompletePedidos.push(pedido.id);
      }
    });

    const domicilioIds = [...new Set(pedidosWithLineCounts.map((p) => p.sujetodomicilioid_destino).filter(Boolean))];
    const domiciliosMap: Record<number, string> = {};
    const plataformasMap: Record<number, string> = {};

    for (const domicilioId of domicilioIds) {
      try {
        const domicilio = await agroirisDomicilios.getDomicilioById(domicilioId);
        if (domicilio) {
          const nombre =
            domicilio.nombre_identificador_domicilio_sujeto ||
            domicilio.domicilio_sujeto ||
            `Domicilio #${domicilioId}`;
          domiciliosMap[domicilioId] = nombre;

          const plataformaId = domicilio.clienteplataformaid;
          if (plataformaId && plataformaId > 0) {
            let plataformaDisplay = `Plataforma #${plataformaId}`;
            try {
              const plataforma = await agroirisClientePlataformas.getPlataformaById(plataformaId);
              const nombrePlataforma = plataforma?.nombre_plataforma?.trim();
              if (nombrePlataforma) plataformaDisplay = nombrePlataforma;
            } catch (error) {
              console.error(`Error loading plataforma ${plataformaId}:`, error);
            }
            plataformasMap[domicilioId] = plataformaDisplay;
          }
        }
      } catch (error) {
        console.error(`Error loading domicilio ${domicilioId}:`, error);
        domiciliosMap[domicilioId] = `Domicilio #${domicilioId}`;
      }
    }

    const clienteIds = [...new Set(pedidosWithLineCounts.map((p) => p.clienteid).filter(Boolean))];
    const clientesMap: Record<number, string> = {};

    for (const clienteId of clienteIds) {
      try {
        const cliente = await agroirisClients.getClientById(clienteId);
        if (cliente) {
          const nombre = cliente.nombre_sujeto || `Cliente #${clienteId}`;
          clientesMap[clienteId] = nombre;
        }
      } catch (error) {
        console.error(`Error loading cliente ${clienteId}:`, error);
        clientesMap[clienteId] = `Cliente #${clienteId}`;
      }
    }

    return {
      pedidos: pedidosWithLineCounts,
      totalGroups,
      totalPedidos,
      pdfSharedCounts: pdfCounts,
      incompleteDataPedidos: incompletePedidos,
      domicilioNombres: domiciliosMap,
      domicilioPlataformas: plataformasMap,
      clienteNombres: clientesMap,
    };
  }, [
    tipoPedido,
    page,
    pageSize,
    filters,
    withTimeout,
    fetchCambiosMatch,
    rpcClient,
  ]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['pedidos', tipoPedido, filters, page, pageSize],
    queryFn: fetchPedidosData,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
    placeholderData: (prev) => prev,
  });

  useEffect(() => {
    if (error) {
      console.error('Error fetching pedidos:', error);
      toastRef.current({
        title: 'Error',
        description: `No se pudieron cargar los ${tipoPedido === 'P220' ? 'pedidos' : 'previsiones'}: ${(error as Error).message}`,
        variant: 'destructive',
      });
    }
  }, [error, tipoPedido]);

  const deletePedido = async (pedido: Pedido, options: DeletePedidoOptions = {}) => {
    const { silent = false, skipInvalidate = false, throwOnError = false } = options;
    try {
      const pedidoAny = pedido as Record<string, unknown>;
      const orizonId = parseOrizonId(pedidoAny.idpedido_orizon);
      const archivoPdfId = (pedido as { archivo_pdf_id?: number | null }).archivo_pdf_id ?? null;

      if (orizonId) {
        if (!silent) {
          toastRef.current({
            title: 'Eliminando también en Orizon',
            description: `Se enviará la eliminación a Orizon (ID ${orizonId}).`,
          });
        }

        try {
          await agroirisAuth.authenticatedFetch(`/pedidocliente/${orizonId}`, {
            method: 'DELETE',
          });
        } catch (err: unknown) {
          console.error('Error eliminando en Orizon:', err);
          if (!silent) {
            toastRef.current({
              title: 'Aviso',
              description:
                err instanceof Error
                  ? `No se pudo eliminar en Orizon: ${err.message}`
                  : 'No se pudo eliminar en Orizon.',
              variant: 'destructive',
            });
          }
        }
      }

      const { data: lineas } = await supabase
        .from('pedido_linea')
        .select('pedidodetid')
        .eq('pedidoid', pedido.id);

      if (lineas && lineas.length > 0) {
        const lineaIds = lineas.map((l) => l.pedidodetid);

        await supabase
          .from('pedido_linea_centro')
          .delete()
          .in('pedidodetid', lineaIds);

        await supabase
          .from('pedido_linea')
          .delete()
          .eq('pedidoid', pedido.id);
      }

      const { error: deleteError } = await supabase
        .from('pedidos')
        .delete()
        .eq('id', pedido.id);

      if (deleteError) throw deleteError;

      if (archivoPdfId) {
        try {
          const { count, error: countError } = await supabase
            .from('pedidos')
            .select('*', { count: 'exact', head: true })
            .eq('archivo_pdf_id', archivoPdfId);

          if (!countError && (count ?? 0) === 0) {
            await supabase.from('archivos_pdf').delete().eq('id', archivoPdfId);
          }
        } catch (pdfCleanupError) {
          console.error('No se pudo limpiar el PDF asociado', pdfCleanupError);
        }
      }

      if (!silent) {
        toastRef.current({
          title: 'Éxito',
          description: `${tipoPedido === 'P220' ? 'Pedido' : 'Previsión'} eliminado correctamente`,
        });
      }

      if (!skipInvalidate) {
        queryClient.invalidateQueries({ queryKey: ['pedidos', tipoPedido] });
      }
    } catch (deleteErr) {
      console.error('Error deleting pedido:', deleteErr);
      if (!silent) {
        toastRef.current({
          title: 'Error',
          description: `No se pudo eliminar: ${deleteErr instanceof Error ? deleteErr.message : 'Error desconocido'}`,
          variant: 'destructive',
        });
      }
      if (throwOnError) {
        throw deleteErr;
      }
    }
  };

  const safePageSize = Math.max(1, pageSize || 1);
  const totalGroups = data?.totalGroups ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalGroups / safePageSize));

  return {
    pedidos: data?.pedidos || [],
    totalGroups,
    totalPedidos: data?.totalPedidos ?? 0,
    totalPages,
    loading: isLoading,
    refreshing: isFetching && !isLoading,
    error: (error as Error) ?? null,
    pdfSharedCounts: new Map(Object.entries(data?.pdfSharedCounts || {}).map(([k, v]) => [Number(k), v])),
    incompleteDataPedidos: new Set(data?.incompleteDataPedidos || []),
    domicilioNombres: data?.domicilioNombres || {},
    domicilioPlataformas: data?.domicilioPlataformas || {},
    clienteNombres: data?.clienteNombres || {},
    fetchPedidos: () => refetch(),
    deletePedido,
  };
};
