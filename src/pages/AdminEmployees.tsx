import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { legacySupabase as supabase } from '@/integrations/supabase/legacyClient';
import { agroirisClients, type AgroIrisClient } from '@/services/agroirisClients';
import { RefreshCw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import { eachDayOfInterval, format, startOfDay, subDays } from 'date-fns';

type AppUser = { id: string; email: string | null; created_at: string | null };
type UserRoleRow = { user_id: string; user_email: string | null; role: 'admin' | 'user' };

type DailySeries = {
  date: string;
  label: string;
  revisados: number;
  enviados: number;
  cuentasCeox: number;
  avgReviewHours: number | null;
};

type UserStat = {
  userId: string;
  label: string;
  kind: 'employee' | 'external' | 'unassigned';
  revisados: number;
  enviados: number;
  cuentasCeox: number;
  avgReviewHours: number | null;
};

type OperationalEvent = {
  id: string;
  timestamp: string;
  module: 'Cambios' | 'Pedidos' | 'Cuentas';
  action: string;
  record: string;
  clienteLabel: string;
  userLabel: string;
};

type PendingCounts = {
  reviews: number;
  sends: number;
  accounts: number;
};

type CambioActivityRow = {
  created_at: string | null;
  revisado_en: string | null;
  revisado_por: string | null;
};

type PedidoActivityRow = {
  enviado_en: string | null;
  enviado_por: string | null;
};

type CuentaActivityRow = {
  enviado_en: string | null;
  enviado_por: string | null;
};

type RpcError = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

type RpcResponse = {
  data: unknown;
  error: RpcError | null;
};

type OperationalActivityRpcItem = {
  event_key?: string;
  timestamp?: string;
  module?: string;
  action?: string;
  record?: string;
  clienteid?: number | null;
  user_id?: string | null;
};

type OperationalActivityRpcRow = {
  row_type: 'meta' | 'item';
  total_items: number | null;
  row_sort_date: string | null;
  row_json: OperationalActivityRpcItem | null;
};

const DEFAULT_RANGE_DAYS = 30;
const RANGE_OPTIONS = [7, 14, 30] as const;
type RangeOption = (typeof RANGE_OPTIONS)[number];
const UNASSIGNED_ID = 'unassigned';
const OPERATIONAL_PAGE_SIZE = 10;

const AdminEmployees = () => {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [rangeDays, setRangeDays] = useState<RangeOption>(DEFAULT_RANGE_DAYS);
  const [loading, setLoading] = useState(true);
  const [operationalLoading, setOperationalLoading] = useState(true);
  const [dailySeries, setDailySeries] = useState<DailySeries[]>([]);
  const [userStats, setUserStats] = useState<UserStat[]>([]);
  const [operationalEvents, setOperationalEvents] = useState<OperationalEvent[]>([]);
  const [operationalTotalEvents, setOperationalTotalEvents] = useState(0);
  const [operationalPage, setOperationalPage] = useState(1);
  const [userLabelsById, setUserLabelsById] = useState<Record<string, string>>({});
  const [clientNamesById, setClientNamesById] = useState<Record<number, string>>({});
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [overallAvgReviewHours, setOverallAvgReviewHours] = useState<number | null>(null);
  const [employeesCount, setEmployeesCount] = useState(0);
  const [pendingCounts, setPendingCounts] = useState<PendingCounts>({ reviews: 0, sends: 0, accounts: 0 });
  const [reviewMeta, setReviewMeta] = useState<{
    count: number;
    within24: number;
    within48: number;
    median: number | null;
    p90: number | null;
  }>({
    count: 0,
    within24: 0,
    within48: 0,
    median: null,
    p90: null,
  });

  const rpcClient = supabase as unknown as {
    rpc: (fn: string, params?: Record<string, unknown>) => Promise<RpcResponse>;
  };

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const startDate = subDays(startOfDay(new Date()), rangeDays - 1);
      const startIso = startDate.toISOString();

      const [
        rolesRes,
        usersRes,
        cambiosRes,
        pedidosRes,
        cuentasRes,
        clientsRes,
        pendingReviewsRes,
        pendingSendsRes,
        pendingAccountSendsRes,
      ] = await Promise.all([
        supabase.from('user_roles').select('user_id, user_email, role'),
        supabase.rpc('get_app_users'),
        supabase
          .from('cambios_pedidos')
          .select('created_at, revisado_en, revisado_por')
          .not('revisado_en', 'is', null)
          .gte('revisado_en', startIso),
        supabase
          .from('pedidos')
          .select('enviado_en, enviado_por')
          .not('enviado_en', 'is', null)
          .gte('enviado_en', startIso),
        supabase
          .from('cuentaventas')
          .select('enviado_en, enviado_por')
          .not('enviado_en', 'is', null)
          .gte('enviado_en', startIso),
        agroirisClients.getClients().catch((error) => {
          console.warn('No se pudieron cargar clientes para actividad operativa:', error);
          return [] as AgroIrisClient[];
        }),
        supabase
          .from('cambios_pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('revisado', false),
        supabase
          .from('pedidos')
          .select('id', { count: 'exact', head: true })
          .eq('enviado', false),
        supabase
          .from('cuentaventas')
          .select('id', { count: 'exact', head: true })
          .eq('enviado', false),
      ]);

      if (rolesRes.error) throw rolesRes.error;
      if (usersRes.error) throw usersRes.error;
      if (cambiosRes.error) throw cambiosRes.error;
      if (pedidosRes.error) throw pedidosRes.error;
      if (cuentasRes.error) throw cuentasRes.error;
      if (pendingReviewsRes.error) throw pendingReviewsRes.error;
      if (pendingSendsRes.error) throw pendingSendsRes.error;
      if (pendingAccountSendsRes.error) throw pendingAccountSendsRes.error;

      const roles = (rolesRes.data ?? []) as UserRoleRow[];
      const users = (usersRes.data ?? []) as AppUser[];
      const cambiosRows = (cambiosRes.data ?? []) as CambioActivityRow[];
      const pedidosRows = (pedidosRes.data ?? []) as PedidoActivityRow[];
      const cuentasRows = (cuentasRes.data ?? []) as CuentaActivityRow[];
      const clients = clientsRes ?? [];
      const authEmailsById = new Map(users.map((user) => [user.id, user.email]));
      const hasRoleData = roles.length > 0;
      const employeeIds = new Set(
        (hasRoleData ? roles.map((role) => role.user_id) : users.map((user) => user.id)) || [],
      );

      const employeeEmailsById = new Map<string, string | null>();
      if (hasRoleData) {
        roles.forEach((role) => {
          employeeEmailsById.set(role.user_id, role.user_email ?? authEmailsById.get(role.user_id) ?? null);
        });
      } else {
        users.forEach((user) => {
          employeeEmailsById.set(user.id, user.email);
        });
      }

      setEmployeesCount(employeeIds.size);
      setPendingCounts({
        reviews: pendingReviewsRes.count ?? 0,
        sends: pendingSendsRes.count ?? 0,
        accounts: pendingAccountSendsRes.count ?? 0,
      });

      const nextUserLabelsById: Record<string, string> = {};
      const knownUserIds = new Set<string>([
        ...Array.from(employeeEmailsById.keys()),
        ...Array.from(authEmailsById.keys()),
      ]);
      knownUserIds.forEach((userId) => {
        const email = employeeEmailsById.get(userId) ?? authEmailsById.get(userId);
        nextUserLabelsById[userId] = email || `Usuario ${userId.slice(0, 6)}`;
      });
      setUserLabelsById(nextUserLabelsById);

      const nextClientNamesById: Record<number, string> = {};
      clients.forEach((client) => {
        const primaryName = client.nombre_sujeto?.trim();
        const fallbackName = client.nombre_comercial?.trim();
        const clientName = primaryName || fallbackName;
        if (clientName) {
          nextClientNamesById[client.clienteid] = clientName;
        }
      });
      setClientNamesById(nextClientNamesById);

      const labelForUser = (userId?: string | null) => {
        if (!userId) return 'No asignado';
        const email = employeeEmailsById.get(userId) ?? authEmailsById.get(userId);
        return email || `Usuario ${userId.slice(0, 6)}`;
      };

      const kindForUser = (userId?: string | null): UserStat['kind'] => {
        if (!userId) return 'unassigned';
        if (employeeIds.has(userId)) return 'employee';
        return 'external';
      };

      const days = eachDayOfInterval({ start: startDate, end: new Date() });
      const dailyMap = new Map<string, DailySeries>();
      const reviewHoursByDay = new Map<string, { total: number; count: number }>();

      days.forEach((day) => {
        const dateKey = format(day, 'yyyy-MM-dd');
        dailyMap.set(dateKey, {
          date: dateKey,
          label: format(day, 'dd/MM'),
          revisados: 0,
          enviados: 0,
          cuentasCeox: 0,
          avgReviewHours: null,
        });
        reviewHoursByDay.set(dateKey, { total: 0, count: 0 });
      });

      const statsByUser = new Map<
        string,
        {
          revisados: number;
          enviados: number;
          cuentasCeox: number;
          totalReviewHours: number;
          reviewCount: number;
        }
      >();

      employeeIds.forEach((userId) => {
        statsByUser.set(userId, {
          revisados: 0,
          enviados: 0,
          cuentasCeox: 0,
          totalReviewHours: 0,
          reviewCount: 0,
        });
      });

      const ensureUser = (userId?: string | null) => {
        const key = userId ?? UNASSIGNED_ID;
        if (!statsByUser.has(key)) {
          statsByUser.set(key, {
            revisados: 0,
            enviados: 0,
            cuentasCeox: 0,
            totalReviewHours: 0,
            reviewCount: 0,
          });
        }
        return key;
      };

      let overallReviewTotal = 0;
      let overallReviewCount = 0;
      let within24 = 0;
      let within48 = 0;
      const leadTimes: number[] = [];

      cambiosRows.forEach((row) => {
        const actorId =
          typeof row.revisado_por === 'string' && row.revisado_por.trim() !== ''
            ? row.revisado_por
            : null;
        if (!actorId) return;

        const revisadoEn = row.revisado_en ? new Date(row.revisado_en) : null;
        if (!revisadoEn || Number.isNaN(revisadoEn.getTime())) return;

        const dateKey = format(revisadoEn, 'yyyy-MM-dd');
        const daily = dailyMap.get(dateKey);
        if (daily) {
          daily.revisados += 1;
        }

        const userKey = ensureUser(actorId);
        const stats = statsByUser.get(userKey);
        if (stats) {
          stats.revisados += 1;
        }

        if (row.created_at) {
          const createdAt = new Date(row.created_at);
          if (!Number.isNaN(createdAt.getTime())) {
            const diffHours = Math.max(0, (revisadoEn.getTime() - createdAt.getTime()) / 36e5);
            const reviewBucket = reviewHoursByDay.get(dateKey);
            if (reviewBucket) {
              reviewBucket.total += diffHours;
              reviewBucket.count += 1;
            }
            if (stats) {
              stats.totalReviewHours += diffHours;
              stats.reviewCount += 1;
            }
            leadTimes.push(diffHours);
            if (diffHours <= 24) within24 += 1;
            if (diffHours <= 48) within48 += 1;
            overallReviewTotal += diffHours;
            overallReviewCount += 1;
          }
        }
      });

      pedidosRows.forEach((row) => {
        const actorId =
          typeof row.enviado_por === 'string' && row.enviado_por.trim() !== ''
            ? row.enviado_por
            : null;
        if (!actorId) return;

        const enviadoEn = row.enviado_en ? new Date(row.enviado_en) : null;
        if (!enviadoEn || Number.isNaN(enviadoEn.getTime())) return;

        const dateKey = format(enviadoEn, 'yyyy-MM-dd');
        const daily = dailyMap.get(dateKey);
        if (daily) {
          daily.enviados += 1;
        }

        const userKey = ensureUser(actorId);
        const stats = statsByUser.get(userKey);
        if (stats) {
          stats.enviados += 1;
        }
      });

      cuentasRows.forEach((row) => {
        const actorId =
          typeof row.enviado_por === 'string' && row.enviado_por.trim() !== ''
            ? row.enviado_por
            : null;
        if (!actorId) return;

        const enviadoEn = row.enviado_en ? new Date(row.enviado_en) : null;
        if (!enviadoEn || Number.isNaN(enviadoEn.getTime())) return;

        const dateKey = format(enviadoEn, 'yyyy-MM-dd');
        const daily = dailyMap.get(dateKey);
        if (daily) {
          daily.cuentasCeox += 1;
        }

        const userKey = ensureUser(actorId);
        const stats = statsByUser.get(userKey);
        if (stats) {
          stats.cuentasCeox += 1;
        }
      });

      const computedDailySeries = Array.from(dailyMap.values()).map((entry) => {
        const reviewBucket = reviewHoursByDay.get(entry.date);
        const avgReview =
          reviewBucket && reviewBucket.count > 0 ? reviewBucket.total / reviewBucket.count : null;
        return {
          ...entry,
          avgReviewHours: avgReview,
        };
      });

      const computedUserStats: UserStat[] = Array.from(statsByUser.entries()).map(([userId, stats]) => {
        const avgReview = stats.reviewCount > 0 ? stats.totalReviewHours / stats.reviewCount : null;
        return {
          userId,
          label: labelForUser(userId === UNASSIGNED_ID ? null : userId),
          kind: kindForUser(userId === UNASSIGNED_ID ? null : userId),
          revisados: stats.revisados,
          enviados: stats.enviados,
          cuentasCeox: stats.cuentasCeox,
          avgReviewHours: avgReview,
        };
      });

      const sortedLeadTimes = [...leadTimes].sort((a, b) => a - b);
      const medianLeadTime = sortedLeadTimes.length
        ? sortedLeadTimes.length % 2 === 0
          ? (sortedLeadTimes[sortedLeadTimes.length / 2 - 1] +
              sortedLeadTimes[sortedLeadTimes.length / 2]) /
            2
          : sortedLeadTimes[Math.floor(sortedLeadTimes.length / 2)]
        : null;
      const p90LeadTime = sortedLeadTimes.length
        ? sortedLeadTimes[Math.floor((sortedLeadTimes.length - 1) * 0.9)]
        : null;

      setDailySeries(computedDailySeries);
      setUserStats(computedUserStats);
      setOverallAvgReviewHours(overallReviewCount > 0 ? overallReviewTotal / overallReviewCount : null);
      setReviewMeta({
        count: overallReviewCount,
        within24,
        within48,
        median: medianLeadTime,
        p90: p90LeadTime,
      });
      setLastUpdated(new Date().toISOString());
    } catch (err: unknown) {
      console.error('Error cargando analítica de empleados:', err);
      toast({
        title: 'No se pudo cargar el panel',
        description: err instanceof Error ? err.message : 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, rangeDays, toast]);

  const loadOperationalActivityPage = useCallback(async () => {
    if (!isAdmin) return;

    setOperationalLoading(true);
    try {
      const startDate = subDays(startOfDay(new Date()), rangeDays - 1);
      const startIso = startDate.toISOString();
      const endIso = new Date().toISOString();

      const { data, error } = await rpcClient.rpc('get_operational_activity_page', {
        p_start: startIso,
        p_end: endIso,
        p_page: Math.max(1, operationalPage),
        p_page_size: OPERATIONAL_PAGE_SIZE,
      });

      if (error) throw error;

      const rows = ((data as OperationalActivityRpcRow[] | null) ?? []) as OperationalActivityRpcRow[];
      const metaRow = rows.find((row) => row.row_type === 'meta');
      const totalItems = Number(metaRow?.total_items ?? 0);

      const events: OperationalEvent[] = rows
        .filter((row): row is OperationalActivityRpcRow => row.row_type === 'item' && Boolean(row.row_json))
        .map((row) => {
          const payload = row.row_json as OperationalActivityRpcItem;
          const timestamp =
            typeof payload.timestamp === 'string' && payload.timestamp.trim() !== ''
              ? payload.timestamp
              : row.row_sort_date;
          const module = payload.module;
          const action = payload.action;
          const record = payload.record;
          const userId = payload.user_id;
          const clienteid = payload.clienteid;
          const eventKey = payload.event_key;

          if (
            !timestamp ||
            !module ||
            !action ||
            !record ||
            !userId ||
            !eventKey ||
            !['Cambios', 'Pedidos', 'Cuentas'].includes(module)
          ) {
            return null;
          }

          const userLabel = userLabelsById[userId] ?? `Usuario ${userId.slice(0, 6)}`;
          const clienteLabel =
            typeof clienteid === 'number' && Number.isFinite(clienteid)
              ? clientNamesById[clienteid] ?? 'No disponible'
              : '—';

          return {
            id: eventKey,
            timestamp,
            module: module as OperationalEvent['module'],
            action,
            record,
            clienteLabel,
            userLabel,
          };
        })
        .filter((event): event is OperationalEvent => Boolean(event));

      setOperationalTotalEvents(totalItems);
      setOperationalEvents(events);
    } catch (err: unknown) {
      console.error('Error cargando actividad operativa:', err);
      toast({
        title: 'No se pudo cargar la actividad operativa',
        description: err instanceof Error ? err.message : 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
      setOperationalTotalEvents(0);
      setOperationalEvents([]);
    } finally {
      setOperationalLoading(false);
    }
  }, [clientNamesById, isAdmin, operationalPage, rangeDays, rpcClient, toast, userLabelsById]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadOperationalActivityPage();
  }, [loadOperationalActivityPage]);

  const employeeStats = useMemo(
    () => userStats.filter((item) => item.kind === 'employee'),
    [userStats],
  );

  const unassignedStat = useMemo(
    () => userStats.find((item) => item.kind === 'unassigned'),
    [userStats],
  );

  const externalStats = useMemo(
    () => userStats.filter((item) => item.kind === 'external'),
    [userStats],
  );

  const employeeRanking = useMemo(() => {
    return [...employeeStats].sort((a, b) => {
      const aTotal = a.revisados + a.enviados + a.cuentasCeox;
      const bTotal = b.revisados + b.enviados + b.cuentasCeox;
      return bTotal - aTotal;
    });
  }, [employeeStats]);

  const summary = useMemo(() => {
    const totalRevisados = userStats.reduce((sum, item) => sum + item.revisados, 0);
    const totalEnviados = userStats.reduce((sum, item) => sum + item.enviados, 0);
    const totalCuentasCeox = userStats.reduce((sum, item) => sum + item.cuentasCeox, 0);
    const totalActivity = totalRevisados + totalEnviados + totalCuentasCeox;

    const assignedActivity = employeeStats.reduce(
      (sum, item) => sum + item.revisados + item.enviados + item.cuentasCeox,
      0,
    );

    const avgReviewHours = overallAvgReviewHours ?? null;
    const topUserStat = employeeRanking[0];
    const topUser = topUserStat?.label ?? '—';
    const topUserTotal = topUserStat
      ? topUserStat.revisados + topUserStat.enviados + topUserStat.cuentasCeox
      : 0;

    const topUserShare =
      topUserStat && totalActivity > 0
        ? ((topUserStat.revisados + topUserStat.enviados + topUserStat.cuentasCeox) / totalActivity) * 100
        : null;

    const activeUsers = employeeStats.filter(
      (item) => item.revisados + item.enviados + item.cuentasCeox > 0,
    ).length;

    const unassignedTotal = unassignedStat
      ? unassignedStat.revisados + unassignedStat.enviados + unassignedStat.cuentasCeox
      : 0;

    const externalTotal = externalStats.reduce(
      (sum, item) => sum + item.revisados + item.enviados + item.cuentasCeox,
      0,
    );

    const unassignedShare = totalActivity > 0 ? (unassignedTotal / totalActivity) * 100 : null;
    const externalShare = totalActivity > 0 ? (externalTotal / totalActivity) * 100 : null;

    const sla24 = reviewMeta.count > 0 ? (reviewMeta.within24 / reviewMeta.count) * 100 : null;
    const sla48 = reviewMeta.count > 0 ? (reviewMeta.within48 / reviewMeta.count) * 100 : null;

    return {
      totalRevisados,
      totalEnviados,
      totalCuentasCeox,
      totalActivity,
      assignedActivity,
      avgReviewHours,
      topUser,
      topUserTotal,
      topUserShare,
      activeUsers,
      totalUsers: employeesCount,
      unassignedTotal,
      unassignedShare,
      externalTotal,
      externalShare,
      sla24,
      sla48,
      p90: reviewMeta.p90,
      median: reviewMeta.median,
      reviewCount: reviewMeta.count,
    };
  }, [
    employeeRanking,
    employeeStats,
    employeesCount,
    externalStats,
    overallAvgReviewHours,
    reviewMeta,
    unassignedStat,
    userStats,
  ]);

  const hasActivity = summary.totalActivity > 0;
  const hasAssignedActivity = summary.assignedActivity > 0;

  const operationalPagination = useMemo(() => {
    const total = operationalTotalEvents;
    const totalPages = Math.max(1, Math.ceil(total / OPERATIONAL_PAGE_SIZE));
    const currentPage = Math.min(Math.max(operationalPage, 1), totalPages);
    const start = total > 0 ? (currentPage - 1) * OPERATIONAL_PAGE_SIZE + 1 : 0;
    const end = total > 0 ? Math.min(total, start + operationalEvents.length - 1) : 0;

    return {
      total,
      totalPages,
      currentPage,
      start,
      end,
    };
  }, [operationalEvents.length, operationalPage, operationalTotalEvents]);

  useEffect(() => {
    if (operationalPage > operationalPagination.totalPages) {
      setOperationalPage(operationalPagination.totalPages);
    }
  }, [operationalPage, operationalPagination.totalPages]);

  const topUsers = useMemo(
    () =>
      employeeRanking
        .filter((item) => item.revisados + item.enviados + item.cuentasCeox > 0)
        .slice(0, 8),
    [employeeRanking],
  );

  const tableRows = useMemo(() => {
    const total = summary.totalActivity;

    const nonEmployeeRows = userStats
      .filter((item) => item.kind !== 'employee')
      .filter((item) => item.revisados + item.enviados + item.cuentasCeox > 0)
      .sort(
        (a, b) =>
          b.revisados + b.enviados + b.cuentasCeox - (a.revisados + a.enviados + a.cuentasCeox),
      );

    const employeeRows = employeeRanking.map((item) => ({
      ...item,
      total: item.revisados + item.enviados + item.cuentasCeox,
      share:
        total > 0
          ? ((item.revisados + item.enviados + item.cuentasCeox) / total) * 100
          : 0,
    }));

    const extraRows = nonEmployeeRows.map((item) => ({
      ...item,
      total: item.revisados + item.enviados + item.cuentasCeox,
      share:
        total > 0
          ? ((item.revisados + item.enviados + item.cuentasCeox) / total) * 100
          : 0,
    }));

    const rows = [...extraRows, ...employeeRows];
    if (!total) {
      return rows.map((item) => ({
        ...item,
        total: item.revisados + item.enviados + item.cuentasCeox,
        share: 0,
      }));
    }

    return rows;
  }, [employeeRanking, summary.totalActivity, userStats]);

  const distributionData = useMemo(() => {
    const active = employeeRanking.filter(
      (item) => item.revisados + item.enviados + item.cuentasCeox > 0,
    );

    const total = active.reduce(
      (sum, item) => sum + item.revisados + item.enviados + item.cuentasCeox,
      0,
    );

    const top = active.slice(0, 5);
    const rest = active.slice(5);
    const restTotal = rest.reduce(
      (sum, item) => sum + item.revisados + item.enviados + item.cuentasCeox,
      0,
    );

    const items = top.map((item) => ({
      name: item.label,
      value: item.revisados + item.enviados + item.cuentasCeox,
      share:
        total > 0
          ? ((item.revisados + item.enviados + item.cuentasCeox) / total) * 100
          : 0,
    }));

    if (restTotal > 0) {
      items.push({
        name: 'Otros',
        value: restTotal,
        share: total > 0 ? (restTotal / total) * 100 : 0,
      });
    }

    return { total, items };
  }, [employeeRanking]);

  const chartConfig = {
    revisados: {
      label: 'Cambios revisados',
      color: 'hsl(var(--chart-1))',
    },
    enviados: {
      label: 'Pedidos/previsiones enviados',
      color: 'hsl(var(--chart-2))',
    },
    cuentasCeox: {
      label: 'Cuentas de venta enviadas',
      color: 'hsl(var(--chart-4))',
    },
    avgReviewHours: {
      label: 'Horas medias de revisión',
      color: 'hsl(var(--chart-3))',
    },
  } as const;

  const handleRefresh = useCallback(() => {
    void loadData();
    void loadOperationalActivityPage();
  }, [loadData, loadOperationalActivityPage]);

  const renderEmptyState = (height: number, title: string, description: string) => (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/30 text-center text-sm text-muted-foreground"
      style={{ height }}
    >
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
  );

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-3 py-8">
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
          <CardHeader className="relative space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Administración</p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Empleados</h1>
                <p className="text-sm text-white/80">
                  Seguimiento operativo de revisiones y envíos en cambios, pedidos y cuentas de venta.
                </p>
              </div>
              <div />
            </div>
          </CardHeader>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Periodo:</span>
            <div className="flex flex-wrap items-center gap-2">
              {RANGE_OPTIONS.map((option) => {
                const isActive = option === rangeDays;
                return (
                  <Button
                    key={option}
                    size="sm"
                    variant={isActive ? 'default' : 'outline'}
                    className="h-7 rounded-full px-3 text-xs"
                    onClick={() => {
                      setOperationalPage(1);
                      setRangeDays(option);
                    }}
                    disabled={loading}
                  >
                    {option} días
                  </Button>
                );
              })}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={handleRefresh}
            disabled={loading || operationalLoading}
          >
            <RefreshCw className={`h-4 w-4 ${loading || operationalLoading ? 'animate-spin' : ''}`} />
            Refrescar
          </Button>
        </div>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Detalle por empleado</CardTitle>
            <CardDescription>Ranking completo con volumen y tiempos medios.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[240px] w-full" />
            ) : tableRows.length === 0 ? (
              renderEmptyState(240, 'Sin empleados activos', 'Aún no hay actividad registrada.')
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>Empleado</TableHead>
                      <TableHead className="text-right">Revisados</TableHead>
                      <TableHead className="text-right">Enviados</TableHead>
                      <TableHead className="text-right">Cuentas de venta</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Media revisión</TableHead>
                      <TableHead className="text-right">Participación</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableRows.map((row, index) => (
                      <TableRow
                        key={row.userId}
                        className={`${index === 0 ? 'bg-muted/20' : ''} ${
                          row.total === 0 ? 'text-muted-foreground' : ''
                        }`}
                      >
                        <TableCell className="font-medium">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{row.label}</span>
                            {row.kind !== 'employee' && (
                              <Badge variant="outline" className="text-[10px]">
                                {row.kind === 'unassigned' ? 'No asignado' : 'Fuera de plantilla'}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{row.revisados}</TableCell>
                        <TableCell className="text-right">{row.enviados}</TableCell>
                        <TableCell className="text-right">{row.cuentasCeox}</TableCell>
                        <TableCell className="text-right">{row.total}</TableCell>
                        <TableCell className="text-right">
                          {row.avgReviewHours != null ? `${row.avgReviewHours.toFixed(1)}h` : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.share > 0 ? `${row.share.toFixed(1)}%` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Actividad operativa reciente</CardTitle>
            <CardDescription>
              Quién hizo qué en cambios, pedidos/previsiones y cuentas de venta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading || operationalLoading ? (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Módulo</TableHead>
                      <TableHead>Registro</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Usuario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Array.from({ length: OPERATIONAL_PAGE_SIZE }).map((_, index) => (
                      <TableRow key={`operational-loading-${index}`} className="h-14">
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-muted-foreground">Cargando actividad operativa...</span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 px-2" disabled>
                      Anterior
                    </Button>
                    <span className="text-muted-foreground">Página — / —</span>
                    <Button size="sm" variant="outline" className="h-7 px-2" disabled>
                      Siguiente
                    </Button>
                  </div>
                </div>
              </div>
            ) : operationalPagination.total === 0 ? (
              renderEmptyState(300, 'Sin eventos', 'No hay acciones operativas en este periodo.')
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Módulo</TableHead>
                      <TableHead>Registro</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Usuario</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {operationalEvents.map((event) => (
                      <TableRow key={event.id} className="h-14">
                        <TableCell className="text-xs text-muted-foreground">
                          {format(new Date(event.timestamp), 'dd/MM HH:mm')}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {event.module}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm font-medium">{event.record}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{event.clienteLabel}</TableCell>
                        <TableCell className="text-sm">{event.userLabel}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex flex-col gap-2 border-t bg-muted/20 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-muted-foreground">
                    Mostrando {operationalPagination.start}-{operationalPagination.end} de {operationalPagination.total} eventos
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      disabled={operationalPagination.currentPage <= 1}
                      onClick={() => setOperationalPage((prev) => Math.max(1, prev - 1))}
                    >
                      Anterior
                    </Button>
                    <span className="text-muted-foreground">
                      Página {operationalPagination.currentPage} / {operationalPagination.totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      disabled={operationalPagination.currentPage >= operationalPagination.totalPages}
                      onClick={() =>
                        setOperationalPage((prev) =>
                          Math.min(operationalPagination.totalPages, prev + 1),
                        )
                      }
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Actividad diaria</CardTitle>
              <CardDescription>
                Comparativa de cambios revisados, pedidos/previsiones enviados y cuentas de venta enviadas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : !hasActivity ? (
                renderEmptyState(300, 'Sin actividad', 'No hay registros operativos en este rango.')
              ) : (
                <ChartContainer config={chartConfig} className="h-[300px] w-full">
                  <LineChart data={dailySeries} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
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
                    <ChartLegend verticalAlign="top" align="center" content={<ChartLegendContent />} />
                    <Line type="monotone" dataKey="revisados" stroke="var(--color-revisados)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="enviados" stroke="var(--color-enviados)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="cuentasCeox" stroke="var(--color-cuentasCeox)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Insights ejecutivos</CardTitle>
              <CardDescription>Resumen de desempeño y nivel de servicio.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : !hasActivity ? (
                renderEmptyState(260, 'Sin datos', 'Aún no hay actividad en este periodo.')
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Top empleado</div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <div className="text-base font-semibold text-foreground">{summary.topUser}</div>
                      {summary.topUserShare != null && (
                        <Badge variant="secondary" className="text-xs">
                          {summary.topUserShare.toFixed(0)}% actividad
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{summary.topUserTotal} acciones registradas</div>
                  </div>

                  {(summary.unassignedTotal > 0 || summary.externalTotal > 0) && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <div className="text-xs text-amber-700">Alertas de asignación</div>
                      {summary.unassignedTotal > 0 && (
                        <div className="mt-1 flex items-center justify-between text-sm text-amber-900">
                          <span>No asignado</span>
                          <span className="font-semibold">
                            {summary.unassignedTotal}
                            {summary.unassignedShare != null ? ` (${summary.unassignedShare.toFixed(0)}%)` : ''}
                          </span>
                        </div>
                      )}
                      {summary.externalTotal > 0 && (
                        <div className="mt-1 flex items-center justify-between text-sm text-amber-900">
                          <span>Fuera de plantilla</span>
                          <span className="font-semibold">
                            {summary.externalTotal}
                            {summary.externalShare != null ? ` (${summary.externalShare.toFixed(0)}%)` : ''}
                          </span>
                        </div>
                      )}
                      <div className="text-xs text-amber-700 mt-1">
                        Revisa `revisado_por` y `enviado_por` para trazabilidad.
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Trabajo pendiente</div>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>Revisiones pendientes</span>
                        <span className="font-semibold text-foreground">{pendingCounts.reviews}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Envíos pedidos pendientes</span>
                        <span className="font-semibold text-foreground">{pendingCounts.sends}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Envíos cuentas pendientes</span>
                        <span className="font-semibold text-foreground">{pendingCounts.accounts}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
                    <div className="text-xs text-muted-foreground">Totales del periodo</div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span>Cambios revisados</span>
                        <span className="font-semibold text-foreground">{summary.totalRevisados}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Pedidos/previsiones enviados</span>
                        <span className="font-semibold text-foreground">{summary.totalEnviados}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Cuentas de venta enviadas</span>
                        <span className="font-semibold text-foreground">{summary.totalCuentasCeox}</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Nivel de servicio 48h</span>
                      <span className="font-semibold text-foreground">
                        {summary.sla48 != null ? `${summary.sla48.toFixed(0)}%` : '—'}
                      </span>
                    </div>
                    <Progress value={summary.sla48 ?? 0} className="h-2" />
                    <div className="text-[11px] text-muted-foreground">n={summary.reviewCount}</div>
                  </div>

                  <div className="grid gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Mediana revisión</span>
                      <span className="font-semibold text-foreground">
                        {summary.median != null ? `${summary.median.toFixed(1)}h` : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>P90 revisión</span>
                      <span className="font-semibold text-foreground">
                        {summary.p90 != null ? `${summary.p90.toFixed(1)}h` : '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Media revisión</span>
                      <span className="font-semibold text-foreground">
                        {summary.avgReviewHours != null ? `${summary.avgReviewHours.toFixed(1)}h` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Rendimiento por empleado</CardTitle>
              <CardDescription>Actividad total por persona.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[320px] w-full" />
              ) : !hasAssignedActivity ? (
                renderEmptyState(320, 'Sin actividad', 'No hay datos para mostrar ranking.')
              ) : (
                <ChartContainer config={chartConfig} className="h-[320px] w-full">
                  <BarChart data={topUsers} layout="vertical" margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={120}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(value) => {
                        if (typeof value !== 'string') return value;
                        if (value === 'No asignado') return value;
                        const [local] = value.split('@');
                        const base = local || value;
                        return base.length > 12 ? `${base.slice(0, 12)}...` : base;
                      }}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent className="bg-background/95 backdrop-blur border border-border/60 shadow-lg rounded-lg px-3 py-2" />
                      }
                    />
                    <ChartLegend verticalAlign="top" align="center" content={<ChartLegendContent />} />
                    <Bar dataKey="revisados" stackId="a" fill="var(--color-revisados)" radius={[4, 4, 4, 4]} />
                    <Bar dataKey="enviados" stackId="a" fill="var(--color-enviados)" radius={[4, 4, 4, 4]} />
                    <Bar dataKey="cuentasCeox" stackId="a" fill="var(--color-cuentasCeox)" radius={[4, 4, 4, 4]} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Distribución por empleado</CardTitle>
              <CardDescription>Participación relativa en el periodo.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[320px] w-full" />
              ) : !hasAssignedActivity ? (
                renderEmptyState(320, 'Sin actividad', 'No hay datos para distribuir.')
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-muted-foreground">
                    {summary.assignedActivity > 0
                      ? `Participación basada en ${summary.assignedActivity} acciones asignadas.`
                      : 'Sin acciones asignadas en este periodo.'}
                  </div>
                  {distributionData.items.length === 0 ? (
                    renderEmptyState(240, 'Sin asignaciones', 'No hay acciones asignadas a empleados.')
                  ) : (
                    <div className="space-y-3">
                      {distributionData.items.map((item, index) => {
                        const colors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#6b7280'];
                        const color = colors[index % colors.length];
                        return (
                          <div key={item.name} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                                <span className="font-medium text-foreground">{item.name}</span>
                              </div>
                              <span className="text-muted-foreground">
                                {item.share.toFixed(1)}% · {item.value}
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${item.share}%`, backgroundColor: color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

      </main>
    </div>
  );
};

export default AdminEmployees;
