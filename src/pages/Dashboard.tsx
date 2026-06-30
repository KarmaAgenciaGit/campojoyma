import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  Line,
  LineChart,
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LegendProps } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { addDays, eachDayOfInterval, format, startOfDay, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  ArrowUpRight,
  Clock,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import type { Database } from '@/integrations/supabase/types';
import { agroirisDomicilios } from '@/services/agroirisDomicilios';
import { agroirisClientePlataformas } from '@/services/agroirisClientePlataformas';
import { agroirisGeneros } from '@/services/agroirisGeneros';
import { parseDateSafe, toIsoStringSafe } from '@/utils/dateSafe';

type PedidoRow = Database['public']['Tables']['pedidos']['Row'] & { enviado?: boolean | null };
type PrevisionRow = Database['public']['Tables']['pedidos']['Row'] & { enviado?: boolean | null };
type CambioRow = Database['public']['Tables']['cambios']['Row'];
type PedidoLineaGeneroRow = {
  generoid: number | null;
  created_at: string | null;
  bultos: number | null;
  pedidodetid: number;
  pedidoid: number;
  descripcion_salida: string | null;
};
type PedidoLineaCentroRow = Database['public']['Tables']['pedido_linea_centro']['Row'];
type SalesAccountRow = {
  id: number;
  fechavaloracion: string | null;
  created_at: string | null;
  idcuentaventa_orizon: number | null;
  enviado: boolean | null;
  enviado_en: string | null;
  enviado_por: string | null;
  needs_sync: boolean | null;
};

type TimelinePoint = {
  key: string;
  label: string;
  pedidos: number;
  previsiones: number;
  cambios: number;
  cuentas: number;
};

type LatencyTrendPoint = {
  key: string;
  label: string;
  averageMinutes: number | null;
  medianMinutes: number | null;
  pedidos: number;
};

type LatencyBucketPoint = {
  label: string;
  total: number;
  share: number;
  intensity: number;
  color: string;
};

type DestinationHighlight = {
  domicilioId: number | null;
  label: string;
  platform?: string;
  total: number;
  share: number;
  intensity: number;
  rank: number;
};

type VolumenLineaTopItem = {
  lineaId: number;
  pedidoId: number | null;
  label: string;
  palets: number;
};

type VolumenSeriesPoint = {
  key: string;
  label: string;
  palets: number;
  topLineas: VolumenLineaTopItem[];
};

type OperationalStatusItem = {
  label: string;
  value: string;
  detail: string;
  footer: string;
  valueClassName?: string;
  footerValue?: string;
  footerValueClassName?: string;
  progress?: number;
  progressClassName?: string;
};

const generoColors = [
  '#2563eb',
  '#f97316',
  '#10b981',
  '#a855f7',
  '#ef4444',
  '#14b8a6',
  '#f59e0b',
  '#0ea5e9',
  '#ec4899',
  '#94a3b8',
];

const generoOthersColor = '#cbd5f5';

const timelineRanges = [7, 14, 30] as const;
type TimelineRange = (typeof timelineRanges)[number];

const summaryMetricBorderClasses = [
  'border-b border-white/20 sm:border-r xl:border-b-0',
  'border-b border-white/20 sm:border-r-0 xl:border-r xl:border-b-0',
  'border-b border-white/20 sm:border-b-0 sm:border-r xl:border-r',
  '',
] as const;

const statusCellBorderClasses = [
  'border-b border-border/60 sm:border-r',
  'border-b border-border/60',
  'border-b border-border/60 sm:border-b-0 sm:border-r',
  '',
] as const;

const clampPercentage = (value: number) => Math.min(Math.max(value, 0), 100);

const generoRangeOptions = [7, 14, 30] as const;
type GeneroRange = (typeof generoRangeOptions)[number];

const destinosRangeOptions = [7, 14, 30] as const;
type DestinosRange = (typeof destinosRangeOptions)[number];

const VOLUMEN_RANGE_DAYS = 30;

const chartConfig = {
  pedidos: { label: 'Pedidos', color: '#2563eb' },       // azul sólido para pedidos confirmados
  previsiones: { label: 'Previsiones', color: '#0ea5e9' }, // azul cielo para previsiones
  cambios: { label: 'Cambios', color: '#f97316' },        // naranja cálido para distinguir cambios
  cuentas: { label: 'Cuentas de venta', color: '#dc2626' }, // rojo solicitado para cuentas
} as const;

const volumenChartConfig = {
  palets: { label: 'Palets', color: '#10b981' },
} as const;

const latencyChartConfig = {
  averageMinutes: { label: 'Media diaria', color: '#0f766e' },
  medianMinutes: { label: 'Mediana diaria', color: '#14b8a6' },
} as const;

const DASHBOARD_PAGE_SIZE = 1000;
const LATENCY_RANGE_DAYS = 30;
const VOLUMEN_TOP_LINEAS_LIMIT = 5;
const latencyBucketDefinitions = [
  { label: '< 1 min', min: 0, max: 1, color: '#0f766e' },
  { label: '1 · 5 min', min: 1, max: 5, color: '#14b8a6' },
  { label: '5 · 15 min', min: 5, max: 15, color: '#38bdf8' },
  { label: '15 · 60 min', min: 15, max: 60, color: '#f59e0b' },
  { label: '> 60 min', min: 60, max: null, color: '#ef4444' },
] as const;

const fetchAllPages = async <T,>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>,
): Promise<T[]> => {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    const to = from + DASHBOARD_PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;

    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < DASHBOARD_PAGE_SIZE) break;
    from += DASHBOARD_PAGE_SIZE;
  }

  return rows;
};

const previsionReferenceDate = (prevision: PrevisionRow) =>
  toIsoStringSafe(
    prevision.fecha_pedido ??
    prevision.fecha_carga ??
    prevision.fecha ??
    prevision.created_at,
  );

const pedidoReferenceDate = (pedido: PedidoRow) =>
  toIsoStringSafe(pedido.fecha_pedido ?? pedido.fecha ?? pedido.created_at);

const pedidoArrivalDate = (pedido: PedidoRow) =>
  toIsoStringSafe(pedido.llegada_correo ?? null);

// Para evitar desajustes, usamos siempre created_at como referencia de fecha de cambio
const cambioReferenceDate = (cambio: CambioRow) => toIsoStringSafe(cambio.created_at ?? cambio.fecha);
// La actividad operativa debe reflejar la llegada/importacion real de la cuenta.
const cuentaVentaReferenceDate = (cuenta: SalesAccountRow) =>
  toIsoStringSafe(cuenta.created_at);

const resolvePedidoReference = (pedido: Pick<PedidoRow, 'id' | 'referencia_cliente' | 'pedidoclienteid'>) =>
  pedido.referencia_cliente?.trim() ||
  pedido.pedidoclienteid?.trim() ||
  `Pedido #${pedido.id}`;

const resolveLineaVolumenLabel = (
  lineaId: number,
  pedidoReference: string | null | undefined,
  descripcionSalida: string | null | undefined,
) => {
  const cleanPedidoReference = pedidoReference?.trim() || 'Pedido sin referencia';
  const cleanDescription = descripcionSalida?.trim() || '';

  return cleanDescription
    ? `${cleanPedidoReference} · ${cleanDescription}`
    : `${cleanPedidoReference} · Línea #${lineaId}`;
};

const averageOf = (values: number[]) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const medianOf = (values: number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const percentileOf = (values: number[], percentile: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clampedPercentile = Math.min(Math.max(percentile, 0), 1);
  const index = Math.ceil(sorted.length * clampedPercentile) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] ?? 0;
};

const isPedidoEnviado = (pedido: PedidoRow | PrevisionRow) =>
  Boolean(pedido.enviado) || Boolean(pedido.enviado_en) || Boolean(pedido.enviado_por);

const Dashboard = () => {
  const { toast } = useToast();
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);
  const [previsiones, setPrevisiones] = useState<PrevisionRow[]>([]);
  const [cambios, setCambios] = useState<CambioRow[]>([]);
  const [salesAccounts, setSalesAccounts] = useState<SalesAccountRow[]>([]);
  const [pedidoLineas, setPedidoLineas] = useState<PedidoLineaGeneroRow[]>([]);
  const [pedidoLineasCentro, setPedidoLineasCentro] = useState<PedidoLineaCentroRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [timelineRange, setTimelineRange] = useState<TimelineRange>(14);
  const [domicilioNombres, setDomicilioNombres] = useState<Record<number, string>>({});
  const [domicilioNombresLoading, setDomicilioNombresLoading] = useState<Record<number, boolean>>({});
  const [domicilioPlataformas, setDomicilioPlataformas] = useState<Record<number, string>>({});
  const [generoNombres, setGeneroNombres] = useState<Record<number, string>>({});
  const domicilioCacheRef = useRef<Record<number, string>>({});
  const domicilioPlataformaCacheRef = useRef<Record<number, string>>({});
  const generoCacheRef = useRef<Record<number, string>>({});
  const [generoRange, setGeneroRange] = useState<GeneroRange>(30);
  const [destinosRange, setDestinosRange] = useState<DestinosRange>(30);
  const [activeLineSeries, setActiveLineSeries] = useState<Record<keyof typeof chartConfig, boolean>>({
    pedidos: true,
    previsiones: true,
    cambios: true,
    cuentas: true,
  });
  const rangeControlRef = useRef<HTMLDivElement | null>(null);
  const timelineRangeIndex = useMemo(() => {
    const idx = timelineRanges.indexOf(timelineRange);
    return idx === -1 ? 0 : idx;
  }, [timelineRange]);

  const setRangeByIndex = useCallback((index: number) => {
    const clampedIndex = Math.min(timelineRanges.length - 1, Math.max(0, index));
    const nextRange = timelineRanges[clampedIndex] ?? timelineRanges[0];
    setTimelineRange(nextRange);
  }, []);

  const getNearestRangeIndex = useCallback((clientX: number) => {
    const container = rangeControlRef.current;
    if (!container) return null;
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-range-index]'),
    );
    if (buttons.length === 0) return null;

    let closestIndex = 0;
    let minDistance = Number.POSITIVE_INFINITY;

    buttons.forEach((button, idx) => {
      const rect = button.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(clientX - center);
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = idx;
      }
    });

    return closestIndex;
  }, []);

  const handlePointerMove = useCallback(
    (clientX: number) => {
      const nearest = getNearestRangeIndex(clientX);
      if (nearest === null) return;
      setRangeByIndex(nearest);
    },
    [getNearestRangeIndex, setRangeByIndex],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      handlePointerMove(event.clientX);

      const onMove = (moveEvent: PointerEvent) => handlePointerMove(moveEvent.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [handlePointerMove],
  );

  const handleKeyNavigation = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        setRangeByIndex(index + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        setRangeByIndex(index - 1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setRangeByIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setRangeByIndex(timelineRanges.length - 1);
      }
    },
    [setRangeByIndex],
  );

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);

      const [pedidosPrevisionesData, cambiosData, salesAccountsData, lineasData, lineasCentroData] = await Promise.all([
        fetchAllPages<PedidoRow>((from, to) =>
          supabase
            .from('pedidos')
            .select('id, fecha, fecha_pedido, fecha_carga, tipo_pedido, clienteid, comercialid, sujetodomicilioid_destino, created_at, llegada_correo, enviado, enviado_en, enviado_por, referencia_cliente, pedidoclienteid')
            .in('tipo_pedido', ['P220', 'P22E'])
            .order('fecha_pedido', { ascending: false, nullsFirst: false })
            .order('fecha', { ascending: false, nullsFirst: false })
            .range(from, to),
        ),
        fetchAllPages<CambioRow>((from, to) =>
          supabase
            .from('cambios_pedidos')
            .select('id, fecha, created_at')
            .order('fecha', { ascending: false })
            .range(from, to),
        ),
        fetchAllPages<SalesAccountRow>((from, to) =>
          supabase
            .from('cuentaventas')
            .select('id, fechavaloracion, created_at, idcuentaventa_orizon, enviado, enviado_en, enviado_por, needs_sync')
            .order('fechavaloracion', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false, nullsFirst: false })
            .range(from, to),
        ),
        fetchAllPages<PedidoLineaGeneroRow>((from, to) =>
          supabase
            .from('pedido_linea')
            .select('generoid, created_at, bultos, pedidodetid, pedidoid, descripcion_salida')
            .order('pedidodetid', { ascending: false })
            .range(from, to),
        ),
        fetchAllPages<PedidoLineaCentroRow>((from, to) =>
          supabase
            .from('pedido_linea_centro')
            .select('numero_palets, created_at, pedidodetid')
            .order('pedcentroid', { ascending: false })
            .range(from, to),
        ),
      ]);

      const pedidosData = (pedidosPrevisionesData ?? []).filter(
        (row) => row.tipo_pedido === 'P220',
      );
      const previsionesData = (pedidosPrevisionesData ?? []).filter(
        (row) => row.tipo_pedido === 'P22E',
      );

      const lineasFiltered = (lineasData ?? []).filter((linea) => {
        if (linea.generoid === undefined) return false;
        return true;
      });

      setPedidos(pedidosData);
      setPrevisiones(previsionesData);
      setCambios(cambiosData ?? []);
      setSalesAccounts(salesAccountsData ?? []);
      setPedidoLineas(lineasFiltered);
      setPedidoLineasCentro(lineasCentroData ?? []);
    } catch (error) {
      console.error('Error cargando datos del dashboard', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los datos principales.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);


  useEffect(() => {
    const loadDestinationNames = async () => {
      const rangeStart = subDays(startOfDay(new Date()), destinosRange - 1);
      const candidates = [...pedidos, ...previsiones]
        .filter((pedido) => {
          const reference =
            pedido.tipo_pedido === 'P22E'
              ? previsionReferenceDate(pedido as PrevisionRow)
              : pedidoReferenceDate(pedido as PedidoRow);
          const date = parseDateSafe(reference);
          if (!date) return false;
          return date >= rangeStart;
        })
        .map((pedido) => pedido.sujetodomicilioid_destino)
        .filter((id): id is number => !!id && (!(id in domicilioCacheRef.current) || !(id in domicilioPlataformaCacheRef.current)));

      const uniqueIds = Array.from(new Set(candidates));
      if (uniqueIds.length === 0) return;
      const missingNameIds = uniqueIds.filter((id) => !(id in domicilioCacheRef.current));

      const fetchedNames: Record<number, string> = {};
      const fetchedPlatforms: Record<number, string> = {};

      if (missingNameIds.length > 0) {
        setDomicilioNombresLoading((prev) => {
          const next = { ...prev };
          missingNameIds.forEach((id) => {
            next[id] = true;
          });
          return next;
        });
      }

      for (const domicilioId of uniqueIds) {
        try {
          const domicilio = await agroirisDomicilios.getDomicilioById(domicilioId);
          fetchedNames[domicilioId] =
            domicilio?.nombre_identificador_domicilio_sujeto ||
            domicilio?.domicilio_sujeto ||
            `Domicilio #${domicilioId}`;

          const plataformaId = domicilio?.clienteplataformaid;
          if (plataformaId && plataformaId > 0) {
            const plataforma = await agroirisClientePlataformas.getPlataformaById(plataformaId);
            if (plataforma?.nombre_plataforma) {
              fetchedPlatforms[domicilioId] = plataforma.nombre_plataforma;
            }
          }
        } catch (error) {
          console.error(`Error cargando domicilio ${domicilioId}:`, error);
          fetchedNames[domicilioId] = `Domicilio #${domicilioId}`;
        }
      }

      domicilioCacheRef.current = { ...domicilioCacheRef.current, ...fetchedNames };
      setDomicilioNombres((prev) => ({ ...prev, ...fetchedNames }));
      if (Object.keys(fetchedPlatforms).length > 0) {
        domicilioPlataformaCacheRef.current = { ...domicilioPlataformaCacheRef.current, ...fetchedPlatforms };
        setDomicilioPlataformas((prev) => ({ ...prev, ...fetchedPlatforms }));
      }
      if (missingNameIds.length > 0) {
        setDomicilioNombresLoading((prev) => {
          const next = { ...prev };
          missingNameIds.forEach((id) => {
            delete next[id];
          });
          return next;
        });
      }
    };

    if (pedidos.length > 0 || previsiones.length > 0) {
      loadDestinationNames();
    }
  }, [pedidos, previsiones, destinosRange]);

  const buildTimelineData = useCallback(
    (range: TimelineRange): TimelinePoint[] => {
      const today = startOfDay(new Date());
      const rangeEnd = addDays(today, 1);
      const rangeStart = subDays(today, range - 1);
      const days = eachDayOfInterval({ start: rangeStart, end: today });

      const countByDay = (values: Array<string | null | undefined>) => {
        return values.reduce<Record<string, number>>((acc, value) => {
          const date = parseDateSafe(value);
          if (!date) return acc;
          if (date < rangeStart || date >= rangeEnd) {
            return acc;
          }
          const key = format(date, 'yyyy-MM-dd');
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
      };

      const pedidosCount = countByDay(pedidos.map(pedidoReferenceDate));
      const previsionesCount = countByDay(previsiones.map(previsionReferenceDate));
      const cambiosCount = countByDay(cambios.map(cambioReferenceDate));
      const cuentasCount = countByDay(salesAccounts.map(cuentaVentaReferenceDate));

      return days.map((day) => {
        const key = format(day, 'yyyy-MM-dd');
        return {
          key,
          label: format(day, 'dd MMM', { locale: es }),
          pedidos: pedidosCount[key] || 0,
          previsiones: previsionesCount[key] || 0,
          cambios: cambiosCount[key] || 0,
          cuentas: cuentasCount[key] || 0,
        };
      });
    },
    [pedidos, previsiones, cambios, salesAccounts],
  );

  const timelineChartData = useMemo<TimelinePoint[]>(
    () => buildTimelineData(timelineRange),
    [buildTimelineData, timelineRange],
  );

  const timelineBaseData = useMemo<TimelinePoint[]>(
    () => buildTimelineData(30),
    [buildTimelineData],
  );

  const summary = useMemo(() => {
    const today = startOfDay(new Date());
    const todayKey = format(today, 'yyyy-MM-dd');
    const todayPoint = timelineBaseData.find((p) => p.key === todayKey);

    const validatedPrevisionsCount = previsiones.filter(isPedidoEnviado).length;
    const pendingPrevisionsCount = previsiones.length - validatedPrevisionsCount;
    const upcomingPrevisiones = previsiones.filter((prevision) => {
      const reference = previsionReferenceDate(prevision);
      const date = parseDateSafe(reference);
      return date ? date >= today : false;
    }).length;
    const next7Previsiones = previsiones.filter((prevision) => {
      const reference = previsionReferenceDate(prevision);
      const date = parseDateSafe(reference);
      if (!date) return false;
      return date >= today && date <= addDays(today, 6);
    }).length;

    const pedidosConEnvio = pedidos.filter(isPedidoEnviado).length;

    return {
      pedidosTotal: pedidos.length,
      pedidosToday: todayPoint?.pedidos ?? 0,
      pedidosConEnvio,
      pedidosSinEnvio: Math.max(pedidos.length - pedidosConEnvio, 0),
      previsionesToday: todayPoint?.previsiones ?? 0,
      previsionesTotal: previsiones.length,
      previsionesUpcoming: upcomingPrevisiones,
      previsionesNext7Days: next7Previsiones,
      previsionesPending: pendingPrevisionsCount,
      previsionesValidated: validatedPrevisionsCount,
      validationRate:
        previsiones.length > 0 ? Math.round((validatedPrevisionsCount / previsiones.length) * 100) : 0,
      cambiosTotal: cambios.length,
      cambiosToday: todayPoint?.cambios ?? 0,
      cuentasTotal: salesAccounts.length,
      cuentasToday: todayPoint?.cuentas ?? 0,
    };
  }, [pedidos, previsiones, cambios, salesAccounts, timelineBaseData]);

  const destinosHighlights = useMemo(() => {
    const cutoff = subDays(startOfDay(new Date()), destinosRange - 1);
    type DestinoKey = number | 'sin-destino';
    const counts = new Map<DestinoKey, number>();

    const allRows = [...pedidos, ...previsiones];

    allRows.forEach((row) => {
      const reference =
        row.tipo_pedido === 'P22E'
          ? previsionReferenceDate(row as PrevisionRow)
          : pedidoReferenceDate(row as PedidoRow);
      const date = parseDateSafe(reference);
      if (!date || date < cutoff) return;
      const key: DestinoKey = row.sujetodomicilioid_destino ?? 'sin-destino';
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const rows = Array.from(counts.entries()).map(([key, total]) => {
      if (typeof key === 'number') {
        return {
          domicilioId: key,
          label: domicilioNombres[key] || (domicilioNombresLoading[key] ? 'Cargando...' : `Domicilio #${key}`),
          platform: domicilioPlataformas[key],
          total,
        };
      }
      return {
        domicilioId: null,
        label: 'Sin domicilio asignado',
        platform: undefined,
        total,
      };
    });

    rows.sort((a, b) => b.total - a.total);
    const totalRecords = rows.reduce((sum, row) => sum + row.total, 0);
    const topEntries = rows.slice(0, 10);
    const leaderTotal = topEntries[0]?.total ?? 0;

    const entries: DestinationHighlight[] = topEntries.map((entry, index) => ({
      ...entry,
      rank: index + 1,
      share: totalRecords > 0 ? (entry.total / totalRecords) * 100 : 0,
      intensity: leaderTotal > 0 ? (entry.total / leaderTotal) * 100 : 0,
    }));

    return {
      entries,
      leader: entries[0] ?? null,
    };
  }, [pedidos, previsiones, domicilioNombres, domicilioNombresLoading, domicilioPlataformas, destinosRange]);

  const volumenSeries = useMemo(() => {
    const today = startOfDay(new Date());
    const rangeStart = subDays(today, VOLUMEN_RANGE_DAYS - 1);
    const days = eachDayOfInterval({ start: rangeStart, end: today });
    const pedidoReferenceById = [...pedidos, ...previsiones].reduce<Map<number, string>>((acc, pedido) => {
      acc.set(pedido.id, resolvePedidoReference(pedido));
      return acc;
    }, new Map());
    const lineaMetaById = pedidoLineas.reduce<Map<number, { pedidoId: number | null; label: string }>>((acc, linea) => {
      const pedidoReference = pedidoReferenceById.get(linea.pedidoid) ?? `Pedido #${linea.pedidoid}`;
      acc.set(linea.pedidodetid, {
        pedidoId: linea.pedidoid,
        label: resolveLineaVolumenLabel(linea.pedidodetid, pedidoReference, linea.descripcion_salida),
      });
      return acc;
    }, new Map());

    const totals = pedidoLineasCentro.reduce<Record<string, number>>((acc, linea) => {
      const date = parseDateSafe(linea.created_at);
      if (!date || date < rangeStart || date > today) return acc;
      const key = format(date, 'yyyy-MM-dd');
      const palets = typeof linea.numero_palets === 'number' ? linea.numero_palets : 0;
      acc[key] = (acc[key] || 0) + palets;
      return acc;
    }, {});

    const topLineasByDay = pedidoLineasCentro.reduce<Map<string, Map<number, VolumenLineaTopItem>>>((acc, linea) => {
      const date = parseDateSafe(linea.created_at);
      if (!date || date < rangeStart || date > today) return acc;

      const key = format(date, 'yyyy-MM-dd');
      const palets = typeof linea.numero_palets === 'number' ? linea.numero_palets : 0;
      const lineaId = linea.pedidodetid;
      const lineaMeta = lineaMetaById.get(lineaId);
      const currentDay = acc.get(key) ?? new Map<number, VolumenLineaTopItem>();
      const currentItem = currentDay.get(lineaId) ?? {
        lineaId,
        pedidoId: lineaMeta?.pedidoId ?? null,
        label: lineaMeta?.label ?? `Línea #${lineaId}`,
        palets: 0,
      };
      currentItem.palets += palets;
      currentDay.set(lineaId, currentItem);
      acc.set(key, currentDay);

      return acc;
    }, new Map());

    return days.map((day) => {
      const key = format(day, 'yyyy-MM-dd');
      const topLineas = Array.from(topLineasByDay.get(key)?.values() ?? [])
        .sort((a, b) => b.palets - a.palets)
        .slice(0, VOLUMEN_TOP_LINEAS_LIMIT);

      return {
        key,
        label: format(day, 'dd MMM', { locale: es }),
        palets: totals[key] || 0,
        topLineas,
      };
    });
  }, [pedidoLineasCentro, pedidoLineas, pedidos, previsiones]);

  const volumenSummary = useMemo(() => {
    if (volumenSeries.length === 0) {
      return { total: 0, average: 0, peak: 0, peakLabel: '—', peakShare: 0, activeDays: 0 };
    }

    let peak = 0;
    let peakLabel = '—';
    const total = volumenSeries.reduce((sum, entry) => {
      if (entry.palets > peak) {
        peak = entry.palets;
        peakLabel = entry.label;
      }
      return sum + entry.palets;
    }, 0);

    return {
      total,
      average: total / volumenSeries.length,
      peak,
      peakLabel,
      peakShare: total > 0 ? (peak / total) * 100 : 0,
      activeDays: volumenSeries.filter((entry) => entry.palets > 0).length,
    };
  }, [volumenSeries]);

  const volumenHasData = volumenSeries.some((entry) => entry.palets > 0);

  const latencyAnalysis = useMemo(() => {
    const today = startOfDay(new Date());
    const rangeEnd = addDays(today, 1);
    const rangeStart = subDays(today, LATENCY_RANGE_DAYS - 1);
    const days = eachDayOfInterval({ start: rangeStart, end: today });

    const grouped = new Map<string, number[]>();
    let eligiblePedidos = 0;

    pedidos.forEach((pedido) => {
      const referenceDate = parseDateSafe(pedido.llegada_correo ?? pedido.created_at);
      if (!referenceDate || referenceDate < rangeStart || referenceDate >= rangeEnd) return;
      eligiblePedidos += 1;

      const arrivalDate = parseDateSafe(pedidoArrivalDate(pedido));
      const createdAtDate = parseDateSafe(pedido.created_at);
      if (!arrivalDate || !createdAtDate) return;

      const delayMinutes = Math.max((createdAtDate.getTime() - arrivalDate.getTime()) / 60000, 0);
      const key = format(arrivalDate, 'yyyy-MM-dd');
      const currentValues = grouped.get(key) ?? [];
      currentValues.push(delayMinutes);
      grouped.set(key, currentValues);
    });

    const trend: LatencyTrendPoint[] = days.map((day) => {
      const key = format(day, 'yyyy-MM-dd');
      const values = grouped.get(key) ?? [];
      return {
        key,
        label: format(day, 'dd MMM', { locale: es }),
        averageMinutes: values.length > 0 ? averageOf(values) : null,
        medianMinutes: values.length > 0 ? medianOf(values) : null,
        pedidos: values.length,
      };
    });

    const allDelays = Array.from(grouped.values()).flat();
    const maxBucketTotal = latencyBucketDefinitions.reduce((max, bucket) => {
      const total = allDelays.filter((value) =>
        bucket.max === null ? value >= bucket.min : value >= bucket.min && value < bucket.max,
      ).length;
      return Math.max(max, total);
    }, 0);

    const buckets: LatencyBucketPoint[] = latencyBucketDefinitions.map((bucket) => {
      const total = allDelays.filter((value) =>
        bucket.max === null ? value >= bucket.min : value >= bucket.min && value < bucket.max,
      ).length;
      return {
        label: bucket.label,
        total,
        share: allDelays.length > 0 ? (total / allDelays.length) * 100 : 0,
        intensity: maxBucketTotal > 0 ? (total / maxBucketTotal) * 100 : 0,
        color: bucket.color,
      };
    });

    return {
      trend,
      buckets,
      hasData: allDelays.length > 0,
      averageMinutes: averageOf(allDelays),
      medianMinutes: medianOf(allDelays),
      p90Minutes: percentileOf(allDelays, 0.9),
      within5Rate: allDelays.length > 0 ? (allDelays.filter((value) => value <= 5).length / allDelays.length) * 100 : 0,
      analyzedPedidos: allDelays.length,
      eligiblePedidos,
      coverageRate: eligiblePedidos > 0 ? (allDelays.length / eligiblePedidos) * 100 : 0,
    };
  }, [pedidos]);

  const generoChartData = useMemo(() => {
    if (pedidoLineas.length === 0) return [];

    const cutoff = subDays(startOfDay(new Date()), generoRange - 1);

    const filteredLineas = pedidoLineas.filter((linea) => {
      const createdAt = parseDateSafe(linea.created_at);
      if (!createdAt) return false;
      return createdAt >= cutoff;
    });

    if (filteredLineas.length === 0) return [];

    const counts = new Map<number | 'sin-genero', number>();
    filteredLineas.forEach(({ generoid }) => {
      const key = generoid ?? 'sin-genero';
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const totalGlobal = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
    if (totalGlobal === 0) return [];

    const sorted = Array.from(counts.entries())
      .map(([key, total]) => {
        const generoId = key === 'sin-genero' ? null : key;
        const fallbackLabel = generoId ? `Género #${generoId}` : 'Sin género asignado';
        const label = generoId ? generoNombres[generoId] || fallbackLabel : fallbackLabel;
        return { generoId, label, total };
      })
      .sort((a, b) => b.total - a.total);

    const MIN_PERCENT = 6;
    let othersTotal = 0;
    const visibleEntries: Array<{
      generoId: number | null;
      label: string;
      total: number;
      percent: number;
      isOthers?: boolean;
    }> = [];

    sorted.forEach((entry) => {
      const percent = (entry.total / totalGlobal) * 100;
      if (percent > MIN_PERCENT) {
        visibleEntries.push({ ...entry, percent });
      } else {
        othersTotal += entry.total;
      }
    });

    if (othersTotal > 0) {
      visibleEntries.push({
        generoId: null,
        label: 'Otros',
        total: othersTotal,
        percent: (othersTotal / totalGlobal) * 100,
        isOthers: true,
      });
    }

    return visibleEntries.map((entry, index) => ({
      ...entry,
      color: entry.isOthers ? generoOthersColor : generoColors[index % generoColors.length],
    }));
  }, [pedidoLineas, generoNombres, generoRange]);

  const generoSummary = useMemo(() => {
    if (generoChartData.length === 0) {
      return {
        total: 0,
        leader: null as (typeof generoChartData)[number] | null,
        visibleCount: 0,
      };
    }

    return {
      total: generoChartData.reduce((sum, entry) => sum + entry.total, 0),
      leader: generoChartData[0],
      visibleCount: generoChartData.length,
    };
  }, [generoChartData]);

  useEffect(() => {
    const loadGeneroNames = async () => {
      const missingIds = generoChartData
        .map((entry) => entry.generoId)
        .filter((id): id is number => typeof id === 'number' && !(id in generoCacheRef.current));

      if (missingIds.length === 0) return;

      const fetched: Record<number, string> = {};

      for (const generoId of missingIds) {
        try {
          const genero = await agroirisGeneros.getGeneroById(generoId);
          fetched[generoId] = genero?.nombre_genero || `Género #${generoId}`;
        } catch (error) {
          console.error(`Error cargando género ${generoId}:`, error);
          fetched[generoId] = `Género #${generoId}`;
        }
      }

      generoCacheRef.current = { ...generoCacheRef.current, ...fetched };
      setGeneroNombres((prev) => ({ ...prev, ...fetched }));
    };

    if (generoChartData.length > 0) {
      loadGeneroNames();
    }
  }, [generoChartData]);

  const lineStyles: Record<
    keyof typeof chartConfig,
    {
      strokeWidth: number;
      strokeDasharray?: string;
      dot: Record<string, unknown>;
      activeDot: Record<string, unknown>;
    }
  > = {
    pedidos: {
      strokeWidth: 3,
      dot: { r: 4, strokeWidth: 2, stroke: 'var(--color-pedidos)', fill: '#ffffff' },
      activeDot: { r: 7, strokeWidth: 2, stroke: 'var(--color-pedidos)', fill: 'var(--color-pedidos)' },
    },
    previsiones: {
      strokeWidth: 3,
      strokeDasharray: '10 6',
      dot: { r: 4, strokeWidth: 2, stroke: 'var(--color-previsiones)', fill: '#ffffff' },
      activeDot: { r: 7, strokeWidth: 2, stroke: 'var(--color-previsiones)', fill: 'var(--color-previsiones)' },
    },
    cambios: {
      strokeWidth: 3,
      strokeDasharray: '3 4',
      dot: { r: 4, strokeWidth: 2, stroke: 'var(--color-cambios)', fill: '#ffffff' },
      activeDot: { r: 7, strokeWidth: 2, stroke: 'var(--color-cambios)', fill: 'var(--color-cambios)' },
    },
    cuentas: {
      strokeWidth: 3,
      strokeDasharray: '8 5',
      dot: { r: 4, strokeWidth: 2, stroke: 'var(--color-cuentas)', fill: '#ffffff' },
      activeDot: { r: 7, strokeWidth: 2, stroke: 'var(--color-cuentas)', fill: 'var(--color-cuentas)' },
    },
  };

  const numberFormatter = useMemo(() => new Intl.NumberFormat('es-ES'), []);
  const integerFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }),
    []
  );
  const decimalFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    []
  );
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
    []
  );

  const formatLatencyValue = useCallback(
    (value: number | null | undefined) => {
      if (value === null || value === undefined || Number.isNaN(value)) return 'No disponible';
      if (value < 1) return '< 1 min';
      if (value >= 1440) return `${decimalFormatter.format(value / 1440)} d`;
      if (value >= 60) return `${decimalFormatter.format(value / 60)} h`;
      return `${decimalFormatter.format(value)} min`;
    },
    [decimalFormatter],
  );

  const todayLabel = useMemo(
    () => format(new Date(), "EEEE, d 'de' MMMM", { locale: es }),
    []
  );
  const headerTimestampLabel = `${todayLabel} · ${format(new Date(), 'HH:mm:ss')}`;

  const lastActivityLabel = useMemo(() => {
    const sources = [
      ...pedidos.map(pedidoReferenceDate),
      ...previsiones.map(previsionReferenceDate),
      ...cambios.map(cambioReferenceDate),
      ...salesAccounts.map(cuentaVentaReferenceDate),
    ].filter(Boolean) as string[];

    const parsed = sources
      .map((value) => parseDateSafe(value))
      .filter((date): date is Date => !!date);

    if (parsed.length === 0) {
      return 'Sin actividad reciente';
    }

    parsed.sort((a, b) => b.getTime() - a.getTime());
    const latestDataDate = parsed[0];
    const now = new Date();
    const safeUpdatedAt = latestDataDate > now ? now : latestDataDate;
    return format(safeUpdatedAt, "dd MMM yyyy · HH:mm'h'", { locale: es });
  }, [pedidos, previsiones, cambios, salesAccounts]);

  const activityAverages = useMemo(() => {
    if (timelineBaseData.length === 0) {
      return { pedidos: 0, previsiones: 0, cambios: 0, cuentas: 0 };
    }

    const totals = timelineBaseData.reduce(
      (acc, point) => ({
        pedidos: acc.pedidos + point.pedidos,
        previsiones: acc.previsiones + point.previsiones,
        cambios: acc.cambios + point.cambios,
        cuentas: acc.cuentas + point.cuentas,
      }),
      { pedidos: 0, previsiones: 0, cambios: 0, cuentas: 0 }
    );

    const divisor = timelineBaseData.length;

    return {
      pedidos: totals.pedidos / divisor,
      previsiones: totals.previsiones / divisor,
      cambios: totals.cambios / divisor,
      cuentas: totals.cuentas / divisor,
    };
  }, [timelineBaseData]);

  const operationalSummaryCards = [
    {
      key: 'pedidos',
      to: '/pedidos',
      label: 'Pedidos totales',
      total: summary.pedidosTotal,
      today: summary.pedidosToday,
      average: activityAverages.pedidos,
    },
    {
      key: 'previsiones',
      to: '/previsiones',
      label: 'Previsiones totales',
      total: summary.previsionesTotal,
      today: summary.previsionesToday,
      average: activityAverages.previsiones,
    },
    {
      key: 'cambios',
      to: '/cambios',
      label: 'Cambios totales',
      total: summary.cambiosTotal,
      today: summary.cambiosToday,
      average: activityAverages.cambios,
    },
    {
      key: 'cuentas',
      to: '/cuentas',
      label: 'Cuentas de venta',
      total: summary.cuentasTotal,
      today: summary.cuentasToday,
      average: activityAverages.cuentas,
    },
  ] as const;

  const timelineIsEmpty =
    !loading &&
    timelineChartData.every(
      (point) => !point.pedidos && !point.previsiones && !point.cambios && !point.cuentas,
    );

  const statusRates = useMemo(() => {
    const previsionesTotal = summary.previsionesTotal || 0;
    return {
      pedidosEnvioRate: summary.pedidosTotal > 0
        ? Math.round((summary.pedidosConEnvio / summary.pedidosTotal) * 100)
        : 0,
      previsionesNextRate: previsionesTotal > 0 ? Math.round((summary.previsionesNext7Days / previsionesTotal) * 100) : 0,
    };
  }, [summary]);

  const cambiosTrend = useMemo(() => {
    const average = activityAverages.cambios;
    if (!average || average <= 0) {
      return {
        label: 'Sin media',
        className: 'text-muted-foreground',
      };
    }

    const diff = summary.cambiosToday - average;
    if (Math.abs(diff) < 0.01) {
      return {
        label: 'En línea',
        className: 'text-muted-foreground',
      };
    }

    const percent = (diff / average) * 100;
    return {
      label: `${diff > 0 ? '+' : ''}${percentFormatter.format(percent)}% vs media`,
      className: diff > 0 ? 'text-emerald-700' : 'text-rose-600',
    };
  }, [activityAverages.cambios, percentFormatter, summary.cambiosToday]);

  const operationalStatusItems = useMemo<OperationalStatusItem[]>(
    () => [
      {
        label: 'Previsiones en firme',
        value: `${summary.validationRate}%`,
        detail: `${numberFormatter.format(summary.previsionesValidated)} de ${numberFormatter.format(summary.previsionesTotal)}`,
        footer: `Pendientes: ${numberFormatter.format(summary.previsionesPending)}`,
        progress: summary.validationRate,
        progressClassName: 'bg-emerald-500',
      },
      {
        label: 'Pedidos enviados',
        value: `${statusRates.pedidosEnvioRate}%`,
        detail: `${numberFormatter.format(summary.pedidosConEnvio)} de ${numberFormatter.format(summary.pedidosTotal)}`,
        footer: `Pendientes de envío: ${numberFormatter.format(summary.pedidosSinEnvio)}`,
      },
      {
        label: 'Cambios de hoy',
        value: numberFormatter.format(summary.cambiosToday),
        detail: `Media 30 días: ${decimalFormatter.format(activityAverages.cambios)}`,
        footer: 'Hoy vs media',
        footerValue: cambiosTrend.label,
        footerValueClassName: cambiosTrend.className,
      },
      {
        label: 'Carga próxima',
        value: `${statusRates.previsionesNextRate}%`,
        detail: `${numberFormatter.format(summary.previsionesNext7Days)} previsiones próximas · ${numberFormatter.format(summary.previsionesUpcoming)} en cola`,
        footer: 'Último registro',
        footerValue: lastActivityLabel,
      },
    ],
    [
      activityAverages.cambios,
      cambiosTrend,
      decimalFormatter,
      lastActivityLabel,
      numberFormatter,
      statusRates,
      summary,
    ],
  );

  const toggleLineVisibility = (seriesKey: keyof typeof chartConfig) => {
    setActiveLineSeries((prev) => {
      const currentlyActive = prev[seriesKey];
      const activeCount = Object.values(prev).filter(Boolean).length;
      if (currentlyActive && activeCount === 1) {
        return prev;
      }
      return { ...prev, [seriesKey]: !currentlyActive };
    });
  };

  // Renderizar siempre todas las series (aunque estén ocultas) para que el botón no desaparezca
  const renderTimelineLegend = useCallback(
    () => (
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {Object.entries(chartConfig).map(([key, config]) => {
          const typedKey = key as keyof typeof chartConfig;
          const isActive = activeLineSeries[typedKey];
          return (
            <button
              type="button"
              key={`${typedKey}-${config.label}`}
              className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                isActive
                  ? 'border-border/80 bg-muted/60 text-foreground'
                  : 'border-dashed border-border/60 bg-transparent text-muted-foreground'
              }`}
              onClick={() => toggleLineVisibility(typedKey)}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: config.color }} />
              {config.label}
            </button>
          );
        })}
      </div>
    ),
    [activeLineSeries],
  );

  return (
    <div className="bg-muted/40 min-h-screen">
      <main className="container mx-auto flex flex-col gap-10 px-3 py-10">
        <header className="grid gap-6 lg:grid-cols-[1.62fr,1fr]">
          <Card className="relative overflow-hidden rounded-lg border-none bg-primary text-primary-foreground shadow-lg">
            <CardHeader className="relative px-6 pb-0 pt-8 sm:px-8 sm:pt-9">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">Resumen operativo</p>
                  <h1 className="text-3xl font-semibold tracking-tight text-white">Estado operativo</h1>
                  <p className="text-sm font-medium text-white/85">{headerTimestampLabel}</p>
                </div>
                <Button
                  size="sm"
                  className="w-fit border border-white/70 bg-transparent text-white shadow-none hover:bg-white/10 hover:text-white"
                  onClick={fetchDashboardData}
                  disabled={loading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  <span>Actualizar datos</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="relative px-6 pb-8 pt-12 sm:px-8">
              <div className="grid overflow-hidden rounded-lg border border-white/20 sm:grid-cols-2 xl:grid-cols-4">
                {operationalSummaryCards.map((card, index) => (
                  <Link
                    key={card.key}
                    to={card.to}
                    className={`relative flex min-h-[116px] flex-col justify-between p-4 text-white transition hover:bg-white/10 sm:p-5 ${summaryMetricBorderClasses[index] ?? ''}`}
                  >
                    <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 text-white/45" />
                    <div>
                      <p className="pr-7 text-xs font-semibold uppercase tracking-[0.12em] text-white/75">{card.label}</p>
                      <p className="mt-3 text-3xl font-semibold leading-none tracking-tight">
                        {numberFormatter.format(card.total)}
                      </p>
                    </div>
                    <p className="mt-4 text-xs font-medium text-white/85">
                      Hoy: {numberFormatter.format(card.today)} · Media: {decimalFormatter.format(card.average)}
                    </p>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="flex h-full flex-col overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
            <CardHeader className="px-6 py-6">
              <CardTitle className="text-base font-semibold">Estado operativo</CardTitle>
              <p className="text-xs text-muted-foreground">Cobertura, comparativas y actividad reciente.</p>
            </CardHeader>
            <CardContent className="grid flex-1 border-t border-border/60 p-0 sm:grid-cols-2">
              {operationalStatusItems.map((item, index) => (
                <div
                  key={item.label}
                  className={`flex min-h-[112px] flex-col gap-4 p-4 ${statusCellBorderClasses[index] ?? ''}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
                    </div>
                    <span className={`shrink-0 text-xl font-semibold leading-none tracking-tight ${item.valueClassName ?? 'text-foreground'}`}>
                      {item.value}
                    </span>
                  </div>
                  {typeof item.progress === 'number' && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${item.progressClassName ?? 'bg-primary'}`}
                        style={{ width: `${clampPercentage(item.progress)}%` }}
                      />
                    </div>
                  )}
                  <div className="mt-auto flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>{item.footer}</span>
                    {item.footerValue && (
                      <span className={`shrink-0 font-semibold ${item.footerValueClassName ?? 'text-foreground'}`}>
                        {item.footerValue}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </header>

        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-lg font-semibold">Actividad operacional</CardTitle>
              <p className="text-sm text-muted-foreground">
                Comparativa diaria de pedidos, previsiones, cambios y cuentas de venta dentro del intervalo seleccionado.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <div className="w-full max-w-xs">
                <div
                  ref={rangeControlRef}
                  role="radiogroup"
                  aria-label="Seleccionar intervalo de días"
                  className="relative mt-2 flex w-full items-center overflow-hidden rounded-full border border-border/60 bg-white/10 p-1 shadow-sm backdrop-blur-md dark:bg-white/5"
                  onPointerDown={handlePointerDown}
                >
                  <div
                    aria-hidden="true"
                    className="absolute inset-y-1 left-1 rounded-full bg-primary/80 shadow-sm transition-transform duration-200 ease-out"
                    style={{
                      width: `calc((100% - 0.5rem) / ${timelineRanges.length})`,
                      transform: `translateX(${timelineRangeIndex * 100}%)`,
                    }}
                  />
                  {timelineRanges.map((range, index) => {
                    const isActive = timelineRange === range;
                    return (
                      <button
                        key={range}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        data-range-index={index}
                        className={`relative z-10 flex-1 select-none rounded-full px-3 py-2 text-sm font-semibold whitespace-nowrap transition ${
                          isActive ? 'text-white' : 'text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setTimelineRange(range)}
                        onKeyDown={(event) => handleKeyNavigation(event, index)}
                      >
                      {range} días
                    </button>
                  );
                })}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <Skeleton className="h-[320px] w-full" />
            ) : timelineIsEmpty ? (
              <div className="flex h-[320px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/40">
                <TrendingUp className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">Sin actividad en este periodo</p>
                  <p className="text-xs text-muted-foreground">
                    Ajusta el rango (hasta 30 días) para revisar actividad reciente.
                  </p>
                </div>
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[320px] w-full">
                <LineChart data={timelineChartData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        sortByValueDesc
                        className="bg-background/95 backdrop-blur border border-border/60 shadow-lg rounded-lg px-3 py-2"
                      />
                    }
                  />
                  {activeLineSeries.pedidos && (
                    <Line
                      type="monotone"
                      dataKey="pedidos"
                      stroke="var(--color-pedidos)"
                      strokeWidth={lineStyles.pedidos.strokeWidth}
                      strokeDasharray={lineStyles.pedidos.strokeDasharray}
                      strokeOpacity={0.95}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={lineStyles.pedidos.dot}
                      activeDot={lineStyles.pedidos.activeDot}
                    />
                  )}
                  {activeLineSeries.previsiones && (
                    <Line
                      type="monotone"
                      dataKey="previsiones"
                      stroke="var(--color-previsiones)"
                      strokeWidth={lineStyles.previsiones.strokeWidth}
                      strokeDasharray={lineStyles.previsiones.strokeDasharray}
                      strokeOpacity={0.9}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={lineStyles.previsiones.dot}
                      activeDot={lineStyles.previsiones.activeDot}
                    />
                  )}
                  {activeLineSeries.cambios && (
                    <Line
                      type="monotone"
                      dataKey="cambios"
                      stroke="var(--color-cambios)"
                      strokeWidth={lineStyles.cambios.strokeWidth}
                      strokeDasharray={lineStyles.cambios.strokeDasharray}
                      strokeOpacity={0.9}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={lineStyles.cambios.dot}
                      activeDot={lineStyles.cambios.activeDot}
                    />
                  )}
                  {activeLineSeries.cuentas && (
                    <Line
                      type="monotone"
                      dataKey="cuentas"
                      stroke="var(--color-cuentas)"
                      strokeWidth={lineStyles.cuentas.strokeWidth}
                      strokeDasharray={lineStyles.cuentas.strokeDasharray}
                      strokeOpacity={0.9}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={lineStyles.cuentas.dot}
                      activeDot={lineStyles.cuentas.activeDot}
                    />
                  )}
                  <ChartLegend verticalAlign="top" align="center" content={renderTimelineLegend} />
                </LineChart>
              </ChartContainer>
            )}

            {!loading && !timelineIsEmpty && (
              <>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">Media de pedidos/día</p>
                    <p className="text-lg font-semibold text-foreground">
                      {decimalFormatter.format(activityAverages.pedidos)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">Media de previsiones/día</p>
                    <p className="text-lg font-semibold text-foreground">
                      {decimalFormatter.format(activityAverages.previsiones)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">Media de cambios/día</p>
                    <p className="text-lg font-semibold text-foreground">
                      {decimalFormatter.format(activityAverages.cambios)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/40 p-4">
                    <p className="text-xs text-muted-foreground">Media de cuentas de venta/día</p>
                    <p className="text-lg font-semibold text-foreground">
                      {decimalFormatter.format(activityAverages.cuentas)}
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <section className="order-last grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Card
            className="flex h-full flex-col border border-border/60 shadow-sm"
          >
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">Latencia correo → sistema</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Tiempo entre la llegada del pedido al correo y su registro en el sistema en los últimos {LATENCY_RANGE_DAYS} días.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-4 lg:min-w-[210px]">
                <p className="text-xs text-muted-foreground">
                  Pedidos analizados
                </p>
                <p className="mt-2 text-xl font-semibold text-foreground">
                  {numberFormatter.format(latencyAnalysis.analyzedPedidos)}
                  <span className="ml-1 text-sm font-medium text-muted-foreground">pedidos</span>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Registros con latencia disponible en el periodo.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {loading ? (
                <Skeleton className="h-[360px] w-full rounded-lg" />
              ) : !latencyAnalysis.hasData ? (
                <div className="flex h-[360px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/40">
                  <Clock className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">Sin datos suficientes de llegada al correo</p>
                    <p className="text-xs text-muted-foreground">
                      Cuando entren pedidos con `llegada_correo`, aquí verás su tiempo medio de registro en sistema.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                      <p className="text-xs text-muted-foreground">Latencia media</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">
                        {formatLatencyValue(latencyAnalysis.averageMinutes)}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Media global del periodo.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                      <p className="text-xs text-muted-foreground">Mediana</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">
                        {formatLatencyValue(latencyAnalysis.medianMinutes)}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Punto central de la distribución.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                      <p className="text-xs text-muted-foreground">Percentil 90</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">
                        {formatLatencyValue(latencyAnalysis.p90Minutes)}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        9 de cada 10 pedidos entran antes de este tiempo.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                      <p className="text-xs text-muted-foreground">Dentro de 5 min</p>
                      <p className="mt-2 text-xl font-semibold text-foreground">
                        {percentFormatter.format(latencyAnalysis.within5Rate)}%
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Pedidos registrados con latencia muy baja.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          Evolución diaria
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Seguimiento de la latencia media y mediana por día de llegada.
                        </p>
                        </div>
                      <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] font-semibold">
                        Últimos {LATENCY_RANGE_DAYS} días
                      </Badge>
                    </div>

                    <ChartContainer config={latencyChartConfig} className="h-[260px] w-full">
                      <LineChart data={latencyAnalysis.trend} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted/35" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={16} />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          width={56}
                          tickFormatter={(value) => `${Math.round(Number(value))}m`}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              className="bg-background/95 backdrop-blur border border-border/60 shadow-lg rounded-lg px-3 py-2"
                              formatter={(value, name) => {
                                const seriesLabel =
                                  latencyChartConfig[name as keyof typeof latencyChartConfig]?.label ?? name;
                                return `${seriesLabel}: ${formatLatencyValue(
                                  typeof value === 'number' ? value : Number(value ?? 0),
                                )}`;
                              }}
                            />
                          }
                        />
                        <Line
                          type="monotone"
                          dataKey="averageMinutes"
                          name="Media diaria"
                          stroke="var(--color-averageMinutes)"
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dot={{ r: 3, strokeWidth: 2, stroke: 'var(--color-averageMinutes)', fill: '#ffffff' }}
                          activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--color-averageMinutes)', fill: 'var(--color-averageMinutes)' }}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="medianMinutes"
                          name="Mediana diaria"
                          stroke="var(--color-medianMinutes)"
                          strokeWidth={2.5}
                          strokeDasharray="7 5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dot={{ r: 3, strokeWidth: 2, stroke: 'var(--color-medianMinutes)', fill: '#ffffff' }}
                          activeDot={{ r: 6, strokeWidth: 2, stroke: 'var(--color-medianMinutes)', fill: 'var(--color-medianMinutes)' }}
                          connectNulls={false}
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                      </LineChart>
                    </ChartContainer>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border border-border/60 shadow-sm">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base font-semibold">Cobertura y distribución</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Calidad del dato y reparto por tramos de latencia.
                </p>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Ventana: últimos {LATENCY_RANGE_DAYS} días
              </div>
            </CardHeader>
            <CardContent className="space-y-5 border-t border-border/60 pt-4">
              {loading ? (
                <Skeleton className="h-[320px] w-full rounded-lg" />
              ) : !latencyAnalysis.hasData ? (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 p-6 text-sm text-muted-foreground">
                  Aún no hay suficientes pedidos con `llegada_correo` para construir esta vista.
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                      <p className="text-xs text-muted-foreground">Pedidos recientes</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {numberFormatter.format(latencyAnalysis.eligiblePedidos)}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Con llegada al correo o registro en sistema dentro de la ventana.
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
                      <p className="text-xs text-muted-foreground">Cobertura de llegada al correo</p>
                      <p className="mt-2 text-2xl font-semibold text-foreground">
                        {percentFormatter.format(latencyAnalysis.coverageRate)}%
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Pedidos recientes con ambas fechas disponibles para el análisis.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {latencyAnalysis.buckets.map((bucket) => (
                      <div
                        key={bucket.label}
                        className="rounded-xl border border-border/60 bg-muted/20 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{bucket.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {numberFormatter.format(bucket.total)} pedidos · {decimalFormatter.format(bucket.share)}%
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-foreground">
                              {numberFormatter.format(bucket.total)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(bucket.intensity, bucket.total > 0 ? 8 : 0)}%`,
                              backgroundColor: bucket.color,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Card className="flex h-full flex-col border border-border/60 shadow-sm">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">
                  Destinos principales
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Top destinos de envío para pedidos y previsiones.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {destinosRangeOptions.map((option) => {
                  const isActive = destinosRange === option;
                  return (
                    <Button
                      key={option}
                      size="sm"
                      variant="ghost"
                      className={`h-9 rounded-full border px-4 text-xs font-semibold ${
                        isActive
                          ? 'border-primary/30 bg-primary/10 text-primary shadow-sm'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setDestinosRange(option)}
                    >
                      Últimos {option} días
                    </Button>
                  );
                })}
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              {loading ? (
                <Skeleton className="h-[360px] w-full rounded-lg" />
              ) : destinosHighlights.entries.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 p-6 text-sm text-muted-foreground">
                  No hay pedidos con destino asignado en este periodo.
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">Destino líder</p>
                      <p className="mt-1 truncate text-base font-semibold text-foreground" title={destinosHighlights.leader?.label}>
                        {destinosHighlights.leader?.label}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {destinosHighlights.leader?.platform || 'Sin plataforma asociada'}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">Registros</p>
                      <p className="mt-1 text-2xl font-semibold leading-none text-foreground">
                        {integerFormatter.format(destinosHighlights.leader?.total ?? 0)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {decimalFormatter.format(destinosHighlights.leader?.share ?? 0)}% del periodo
                      </p>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 rounded-lg border border-border/60">
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3 border-b border-border/60 bg-muted/20 px-4 py-2.5 text-xs font-medium text-muted-foreground">
                      <span>Destino</span>
                      <span className="text-right">Registros</span>
                    </div>

                    <div className="max-h-[390px] divide-y divide-border/50 overflow-y-auto">
                      {destinosHighlights.entries.map((entry) => (
                        <div key={`${entry.domicilioId ?? 'sin-destino'}-${entry.rank}`} className="px-4 py-3">
                          <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-xs font-semibold text-muted-foreground">
                              {entry.rank}
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-foreground" title={entry.label}>
                                    {entry.label}
                                  </p>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {entry.platform || 'Sin plataforma asociada'}
                                  </p>
                                </div>

                                <div className="shrink-0 text-right leading-tight">
                                  <p className="text-sm font-semibold text-foreground">
                                    {integerFormatter.format(entry.total)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {decimalFormatter.format(entry.share)}%
                                  </p>
                                </div>
                              </div>

                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary"
                                  style={{ width: `${Math.max(entry.intensity, entry.total > 0 ? 6 : 0)}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="flex h-full flex-col border border-border/60 shadow-sm">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">
                  Volumen de palets
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Palets registrados en líneas de centro (últimos {VOLUMEN_RANGE_DAYS} días).
                </p>
              </div>
              {!loading && volumenHasData ? (
                <div className="shrink-0 lg:text-right">
                  <p className="text-xs font-medium text-muted-foreground">Total periodo</p>
                  <p className="mt-1 text-2xl font-semibold leading-none text-foreground">
                    {integerFormatter.format(volumenSummary.total)}
                  </p>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              {loading ? (
                <Skeleton className="h-[360px] w-full rounded-lg" />
              ) : !volumenHasData ? (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 p-6 text-sm text-muted-foreground">
                  Todavía no hay líneas de centro con palets en este periodo.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">Media diaria</p>
                      <p className="mt-1 text-2xl font-semibold leading-none text-foreground">
                        {decimalFormatter.format(volumenSummary.average)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">palets/día</p>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">Pico del periodo</p>
                      <p className="mt-1 text-2xl font-semibold leading-none text-foreground">
                        {integerFormatter.format(volumenSummary.peak)}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground" title={volumenSummary.peakLabel}>
                        {volumenSummary.peakLabel}
                      </p>
                    </div>

                    <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">Días activos</p>
                      <p className="mt-1 text-2xl font-semibold leading-none text-foreground">
                        {integerFormatter.format(volumenSummary.activeDays)}/{VOLUMEN_RANGE_DAYS}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {decimalFormatter.format(volumenSummary.peakShare)}% en el pico
                      </p>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 p-4">
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Ritmo diario</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Evolución de palets registrados por día.
                        </p>
                      </div>
                      <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px] font-semibold">
                        {integerFormatter.format(volumenSummary.activeDays)}/{VOLUMEN_RANGE_DAYS} días activos
                      </Badge>
                    </div>

                    <ChartContainer config={volumenChartConfig} className="h-[300px] w-full">
                      <BarChart data={volumenSeries} margin={{ top: 12, right: 8, left: 0, bottom: 8 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-muted/35" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={16} />
                        <YAxis hide />
                        <ChartTooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;

                            const point = payload[0]?.payload as VolumenSeriesPoint | undefined;
                            if (!point) return null;

                            return (
                              <div className="min-w-[220px] rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                                <div className="font-medium">{point.label}</div>
                                <div className="mt-1 flex items-center gap-2">
                                  <div className="h-2.5 w-2.5 rounded-[2px] bg-emerald-500" />
                                  <span className="font-semibold text-foreground">
                                    Palets:
                                  </span>
                                  <span className="font-mono font-medium text-foreground">
                                    {integerFormatter.format(point.palets)}
                                  </span>
                                </div>

                                <div className="mt-3 border-t border-border/60 pt-2">
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                    Top líneas
                                  </p>
                                  {point.topLineas.length > 0 ? (
                                    <div className="mt-2 space-y-1.5">
                                      {point.topLineas.map((linea, index) => (
                                        <div
                                          key={`${point.key}-${linea.lineaId}-${index}`}
                                          className="flex items-start justify-between gap-3"
                                        >
                                          <span className="min-w-0 flex-1 truncate text-foreground">
                                            {linea.label}
                                          </span>
                                          <span className="shrink-0 font-mono text-muted-foreground">
                                            {numberFormatter.format(linea.palets)} palets
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="mt-2 text-muted-foreground">Sin líneas con palets ese día.</p>
                                  )}
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="palets" fill="var(--color-palets)" radius={[4, 4, 0, 0]} barSize={10} />
                      </BarChart>
                    </ChartContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="w-full">
          <Card className="border border-border/60 shadow-sm">
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-lg font-semibold">
                  Distribución de géneros (últimos {generoRange} días)
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Participación de géneros en los últimos {generoRange} días.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {generoRangeOptions.map((option) => {
                  const isActive = generoRange === option;
                  return (
                    <Button
                      key={option}
                      size="sm"
                      variant="ghost"
                      className={`h-9 rounded-full border px-4 text-xs font-semibold ${
                        isActive
                          ? 'border-primary/30 bg-primary/10 text-primary shadow-sm'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setGeneroRange(option)}
                    >
                      Últimos {option} días
                    </Button>
                  );
                })}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[420px] w-full rounded-lg" />
              ) : generoChartData.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 p-6 text-sm text-muted-foreground">
                  Todavía no hay líneas de pedido registradas para calcular el reparto por género.
                </div>
              ) : (
                <div className="grid min-h-[408px] gap-6 xl:grid-cols-[300px,minmax(0,1fr)] xl:gap-0">
                  <div className="min-w-0 xl:pr-6">
                    <div className="space-y-1 px-1">
                      <h3 className="text-sm font-semibold text-foreground">Distribución por género</h3>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Reparto de líneas con género dentro del periodo seleccionado.
                      </p>
                    </div>

                    <div className="relative mx-auto mt-4 h-[240px] w-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={generoChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={70}
                            outerRadius={104}
                            paddingAngle={2}
                            dataKey="total"
                            nameKey="label"
                            stroke="hsl(var(--background))"
                            strokeWidth={3}
                          >
                            {generoChartData.map((entry, index) => (
                              <Cell
                                key={entry.generoId ?? `genero-donut-${index}`}
                                fill={entry.color}
                              />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            cursor={false}
                            wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                            content={({ active, payload }) => {
                              const item = payload?.[0]?.payload as (typeof generoChartData)[number] | undefined;
                              if (!active || !item) return null;

                              return (
                                <div className="rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                                  <p className="font-semibold text-foreground">{item.label}</p>
                                  <p className="mt-1 text-muted-foreground">
                                    {numberFormatter.format(item.total)} registros
                                  </p>
                                  <p className="text-muted-foreground">
                                    {decimalFormatter.format(item.percent)}% del periodo
                                  </p>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>

                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full border border-border/70 bg-background/95 text-center shadow-sm">
                          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                            Mix
                          </span>
                          <span className="mt-1 text-sm font-semibold text-foreground">{generoRange} días</span>
                          <span className="mt-0.5 text-[10px] text-muted-foreground">
                            {integerFormatter.format(generoSummary.visibleCount)} grupos
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">Género líder</p>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-semibold text-foreground" title={generoSummary.leader?.label}>
                          {generoSummary.leader?.label}
                        </p>
                        <span className="shrink-0 text-sm font-semibold text-foreground">
                          {decimalFormatter.format(generoSummary.leader?.percent ?? 0)}%
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground">Registros analizados</p>
                      <p className="mt-1 text-3xl font-semibold leading-none text-foreground">
                        {numberFormatter.format(generoSummary.total)}
                      </p>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-4 xl:border-l xl:border-border/50 xl:pl-6">
                    <div className="space-y-1">
                      <h3 className="text-sm font-semibold text-foreground">Ranking de géneros</h3>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Registros y peso relativo en el periodo seleccionado.
                      </p>
                    </div>

                    <div className="divide-y divide-border/50">
                      {generoChartData.map((entry, index) => {
                        const barWidth = Math.min(100, Math.max(entry.percent > 0 ? 8 : 0, entry.percent));

                        return (
                          <div key={entry.generoId ?? `genero-row-${index}`} className="py-3.5 first:pt-0 last:pb-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: entry.color }}
                                />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-foreground" title={entry.label}>
                                    {entry.label}
                                  </p>
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {numberFormatter.format(entry.total)} registros
                                  </p>
                                </div>
                              </div>

                              <div className="shrink-0 text-right leading-tight">
                                <p className="text-sm font-semibold text-foreground">
                                  {decimalFormatter.format(entry.percent)}%
                                </p>
                                <p className="text-xs text-muted-foreground">#{index + 1}</p>
                              </div>
                            </div>

                            <div className="mt-3">
                              <div className="relative h-2 rounded-full bg-muted/80">
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full"
                                  style={{ width: '100%', backgroundColor: entry.color, opacity: 0.1 }}
                                />
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                                  style={{ width: `${barWidth}%`, backgroundColor: entry.color, opacity: 0.88 }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

        </section>
      </main>
    </div>
  );
};

export default Dashboard;
