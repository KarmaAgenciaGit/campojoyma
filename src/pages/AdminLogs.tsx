import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { eachDayOfInterval, format, subDays } from 'date-fns';

type AppUser = { id: string; email: string | null; created_at: string | null };

type AccessLog = {
  id: number;
  created_at: string;
  user_id: string;
  email: string | null;
  action: 'login' | 'logout' | string;
  label: string;
};

type DailyAccess = {
  date: string;
  label: string;
  logins: number;
  logouts: number;
};

type OnlineUser = { userId: string; connections: number; connectedAt?: string | null; email?: string | null };
type PresenceMeta = { user_id?: string; connected_at?: string };

const DEFAULT_RANGE_DAYS = 30;
const PAGE_SIZE = 10;
const ANALYTICS_LIMIT = 2000;

const AdminLogs = () => {
  const { isAdmin, user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [dailySeries, setDailySeries] = useState<DailyAccess[]>([]);
  const [recentLogs, setRecentLogs] = useState<AccessLog[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(true);
  const [userEmailMap, setUserEmailMap] = useState<Record<string, string | null>>({});
  const [hasLogs, setHasLogs] = useState(false);
  const [page, setPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);

  const presenceTrackedRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const startDate = subDays(new Date(), DEFAULT_RANGE_DAYS - 1);
      const startIso = startDate.toISOString();
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const [usersRes, logsRes, logsPageRes] = await Promise.all([
        supabase.rpc('get_app_users'),
        supabase
          .from('user_access_logs')
          .select('id, created_at, user_id, email, action')
          .gte('created_at', startIso)
          .order('created_at', { ascending: false })
          .limit(ANALYTICS_LIMIT),
        supabase
          .from('user_access_logs')
          .select('id, created_at, user_id, email, action', { count: 'exact' })
          .gte('created_at', startIso)
          .order('created_at', { ascending: false })
          .range(from, to),
      ]);

      if (usersRes.error) throw usersRes.error;
      if (logsRes.error) throw logsRes.error;
      if (logsPageRes.error) throw logsPageRes.error;

      const users = (usersRes.data ?? []) as AppUser[];
      const usersById = new Map(users.map((appUser) => [appUser.id, appUser.email]));
      setUserEmailMap(Object.fromEntries(usersById));
      const labelForUser = (userId: string, email?: string | null) =>
        email || usersById.get(userId) || `Usuario ${userId.slice(0, 6)}`;

      const days = eachDayOfInterval({ start: startDate, end: new Date() });
      const dailyMap = new Map<string, DailyAccess>();
      days.forEach((day) => {
        const dateKey = format(day, 'yyyy-MM-dd');
        dailyMap.set(dateKey, {
          date: dateKey,
          label: format(day, 'dd/MM'),
          logins: 0,
          logouts: 0,
        });
      });

      const userTotals = new Map<string, { logins: number; logouts: number }>();
      (logsRes.data ?? []).forEach((row: any) => {
        const label = labelForUser(row.user_id, row.email);
        const dateKey = format(new Date(row.created_at), 'yyyy-MM-dd');
        const daily = dailyMap.get(dateKey);
        if (daily) {
          if (row.action === 'login') daily.logins += 1;
          if (row.action === 'logout') daily.logouts += 1;
        }
        if (!userTotals.has(label)) {
          userTotals.set(label, { logins: 0, logouts: 0 });
        }
        const totals = userTotals.get(label);
        if (totals) {
          if (row.action === 'login') totals.logins += 1;
          if (row.action === 'logout') totals.logouts += 1;
        }
      });

      const computedDaily = Array.from(dailyMap.values());
      const totalsArray = Array.from(userTotals.entries()).map(([label, totals]) => ({
        label,
        logins: totals.logins,
        logouts: totals.logouts,
        total: totals.logins + totals.logouts,
      }));

      setDailySeries(computedDaily);
      setHasLogs(totalsArray.some((item) => item.total > 0));

      const pageLogs: AccessLog[] = (logsPageRes.data ?? []).map((row: any) => {
        const label = labelForUser(row.user_id, row.email);
        return {
          id: row.id,
          created_at: row.created_at,
          user_id: row.user_id,
          email: row.email,
          action: row.action,
          label,
        } as AccessLog;
      });
      const count = logsPageRes.count ?? 0;
      setRecentLogs(pageLogs);
      setTotalLogs(count);
      setLastUpdated(new Date().toISOString());

      const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
      if (page > totalPages) {
        setPage(totalPages);
      }
    } catch (err: any) {
      console.error('Error cargando logs de acceso:', err);
      toast({
        title: 'No se pudo cargar los logs',
        description: err?.message ?? 'Inténtalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [isAdmin, page, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isAdmin || !user) return;
    presenceTrackedRef.current = false;
    setOnlineLoading(true);
    const channel = supabase.channel('online-users', {
      config: { presence: { key: user.id } },
    });

    const syncPresence = () => {
      const state = channel.presenceState() as Record<string, PresenceMeta[]>;
      const next = Object.entries(state)
        .map(([key, metas]): OnlineUser | null => {
          const meta = metas[0];
          const userId = meta?.user_id ?? key;
          if (!userId) return null;
          return {
            userId,
            connections: metas.length,
            connectedAt: meta?.connected_at ?? null,
          };
        })
        .filter((item): item is OnlineUser => Boolean(item))
        .sort((a, b) => a.userId.localeCompare(b.userId));

      setOnlineUsers(next);
      setOnlineLoading(false);

      if (!presenceTrackedRef.current && user?.id) {
        const hasSelf = Object.entries(state).some(([key, metas]) => {
          if (key === user.id) return true;
          return metas.some((meta) => meta.user_id === user.id);
        });
        if (!hasSelf) {
          channel.track({
            user_id: user.id,
            connected_at: new Date().toISOString(),
          });
          presenceTrackedRef.current = true;
        }
      }
    };

    channel.on('presence', { event: 'sync' }, syncPresence);
    channel.on('presence', { event: 'join' }, syncPresence);
    channel.on('presence', { event: 'leave' }, syncPresence);

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        syncPresence();
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, user?.id]);

  const chartConfig = {
    logins: {
      label: 'Entradas',
      color: 'hsl(var(--chart-2))',
    },
    logouts: {
      label: 'Salidas',
      color: 'hsl(var(--chart-3))',
    },
  } as const;

  const onlineUsersResolved = useMemo(
    () =>
      onlineUsers.map((entry) => ({
        ...entry,
        email: userEmailMap[entry.userId] ?? null,
      })),
    [onlineUsers, userEmailMap],
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
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                  Actividad de usuarios
                </h1>
                <p className="text-sm text-white/80">
                  Registro de accesos y sesiones activas en la plataforma.
                </p>
              </div>
              <div />
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-white/70">
              <Badge variant="secondary" className="bg-white/15 text-white border-white/20">
                Sesiones activas: {onlineLoading ? '—' : onlineUsersResolved.length}
              </Badge>
              <span>
                Última actualización: {lastUpdated ? format(new Date(lastUpdated), 'dd/MM HH:mm') : '—'}
              </span>
            </div>
          </CardHeader>
        </Card>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">
            Periodo: últimos <span className="font-semibold text-foreground">{DEFAULT_RANGE_DAYS} días</span>
          </div>
          <Button size="sm" variant="outline" className="gap-2" onClick={loadData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Entradas y salidas diarias</CardTitle>
              <CardDescription>Visión rápida del flujo de accesos.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : !hasLogs ? (
                <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                  No hay registros en este periodo.
                </div>
              ) : (
                <ChartContainer config={chartConfig} className="h-[300px] w-full">
                  <BarChart data={dailySeries} margin={{ top: 16, right: 16, left: 0, bottom: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted/40" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                    <ChartTooltip
                      content={<ChartTooltipContent className="bg-background/95 backdrop-blur border border-border/60 shadow-lg rounded-lg px-3 py-2" />}
                    />
                    <Bar dataKey="logins" stackId="a" fill="var(--color-logins)" radius={[4, 4, 0, 0]} barSize={12} />
                    <Bar dataKey="logouts" stackId="a" fill="var(--color-logouts)" radius={[0, 0, 4, 4]} barSize={12} />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card className="border border-border/60">
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base">Usuarios en línea</CardTitle>
                <CardDescription>Conexiones activas.</CardDescription>
              </div>
              <span className="text-xs text-muted-foreground">
                {onlineLoading ? '—' : onlineUsersResolved.length} activos
              </span>
            </CardHeader>
            <CardContent className="space-y-2">
              {onlineLoading ? (
                <p className="text-sm text-muted-foreground">Cargando...</p>
              ) : onlineUsersResolved.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay usuarios en línea ahora mismo.</p>
              ) : (
                <div className="space-y-2">
                  {onlineUsersResolved.map((onlineUser) => (
                    <div
                      key={onlineUser.userId}
                      className="flex flex-col gap-2 rounded-md border bg-background px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
                        <div>
                          <p className="text-sm font-medium">{onlineUser.email ?? 'Usuario sin email'}</p>
                          <p className="text-xs text-muted-foreground break-all">{onlineUser.userId}</p>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {onlineUser.connections} sesión{onlineUser.connections !== 1 ? 'es' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6">
          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base">Últimos accesos</CardTitle>
              <CardDescription>Entradas y salidas más recientes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <Skeleton className="h-[260px] w-full" />
              ) : recentLogs.length === 0 ? (
                <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                  No hay registros recientes.
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead>Usuario</TableHead>
                        <TableHead className="text-right">Fecha</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentLogs.map((log) => (
                        <TableRow
                          key={log.id}
                          className={
                            log.action === 'login'
                              ? 'bg-emerald-50/60 hover:bg-emerald-50 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15'
                              : log.action === 'logout'
                                ? 'bg-amber-50/60 hover:bg-amber-50 dark:bg-amber-500/10 dark:hover:bg-amber-500/15'
                                : ''
                          }
                        >
                          <TableCell className="font-medium">{log.label}</TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {format(new Date(log.created_at), 'dd/MM HH:mm')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {totalLogs > 0 && (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
                  <span>
                    Mostrando {Math.min((page - 1) * PAGE_SIZE + 1, totalLogs)}-
                    {Math.min(page * PAGE_SIZE, totalLogs)} de {totalLogs}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                      disabled={page <= 1 || loading}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Anterior
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Página {page} de {Math.max(1, Math.ceil(totalLogs / PAGE_SIZE))}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1"
                      onClick={() => setPage((prev) => Math.min(Math.max(1, Math.ceil(totalLogs / PAGE_SIZE)), prev + 1))}
                      disabled={page >= Math.max(1, Math.ceil(totalLogs / PAGE_SIZE)) || loading}
                    >
                      Siguiente
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </main>
    </div>
  );
};

export default AdminLogs;
