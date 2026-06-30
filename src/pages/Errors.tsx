import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, Clock, Loader2, Mail, RefreshCcw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { formatDateSafe, parseDateSafe } from '@/utils/dateSafe';
import { addDays, startOfDay, subDays } from 'date-fns';

 type AppError = {
  id: string;
  created_at: string | null;
  email: string | null;
  subject: string;
  error: string;
  revisado: boolean;
};

const STATUS_FILTERS = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'resolved', label: 'Revisados' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

const DATE_FILTERS = [
  { value: 7, label: '7 días' },
  { value: 14, label: '14 días' },
  { value: 30, label: '30 días' },
  { value: 'all', label: 'Siempre' },
] as const;

type DateFilter = (typeof DATE_FILTERS)[number]['value'];

const formatTimestamp = (value: string | null) =>
  formatDateSafe(value, "dd MMM yyyy · HH:mm'h'", 'Sin registro');

const useErroresApp = () => {
  const [errors, setErrors] = useState<AppError[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchErrors = useCallback(async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const { data, error } = await supabase
        .from('errores_app')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setErrors((data ?? []).map((item) => ({
        id: item.id as string,
        created_at: item.created_at ?? null,
        email: item.email ?? null,
        subject: item.subject ?? 'Sin asunto',
        error: item.error ?? 'Sin descripción',
        revisado: Boolean(item.revisado),
      })));
    } catch (error) {
      console.error('Error cargando errores:', error);
      const message = error instanceof Error ? error.message : 'No se pudo obtener el listado de errores.';
      setFetchError(message);
      setErrors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  const stats = useMemo(() => {
    const total = errors.length;
    const pending = errors.filter((err) => !err.revisado).length;
    const resolved = total - pending;
    const today = (() => {
      const start = startOfDay(new Date());
      const end = addDays(start, 1);
      return errors.filter((err) => {
        const created = parseDateSafe(err.created_at);
        if (!created) return false;
        return created >= start && created < end;
      }).length;
    })();
    return { total, pending, resolved, today };
  }, [errors]);

  return { errors, loading, fetchError, fetchErrors, stats, setErrors };
};

const DEFAULT_DATE_FILTER: DateFilter = 7;

const Errors = () => {
  const { toast } = useToast();
  const { errors, loading, fetchError, fetchErrors, stats, setErrors } = useErroresApp();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>(DEFAULT_DATE_FILTER);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const filteredErrors = useMemo(() => {
    const term = search.trim().toLowerCase();
    const cutoff = typeof dateFilter === 'number' ? subDays(startOfDay(new Date()), dateFilter - 1) : null;
    return errors.filter((entry) => {
      if (statusFilter === 'pending' && entry.revisado) return false;
      if (statusFilter === 'resolved' && !entry.revisado) return false;
      if (cutoff) {
        const created = parseDateSafe(entry.created_at);
        if (!created || created < cutoff) return false;
      }
      if (!term) return true;
      const haystack = [entry.subject, entry.email ?? '', entry.error]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [errors, search, statusFilter, dateFilter]);

  const hasActiveFilters = Boolean(search.trim()) || statusFilter !== 'all' || dateFilter !== DEFAULT_DATE_FILTER;

  const totalPages = Math.max(1, Math.ceil(filteredErrors.length / itemsPerPage));
  const paginatedErrors = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredErrors.slice(start, start + itemsPerPage);
  }, [filteredErrors, currentPage, itemsPerPage]);

  const handleMarkReviewed = async (error: AppError) => {
    try {
      setReviewingId(error.id);
      const { error: updateError } = await supabase
        .from('errores_app')
        .update({ revisado: true })
        .eq('id', error.id);

      if (updateError) throw updateError;
      setErrors((prev) => prev.map((item) => (item.id === error.id ? { ...item, revisado: true } : item)));
      toast({
        title: 'Error revisado',
        description: 'Se marcó como revisado correctamente.',
      });
    } catch (error) {
      toast({
        title: 'Aviso',
        description: error instanceof Error ? error.message : 'Intenta nuevamente.',
      });
    } finally {
      setReviewingId(null);
    }
  };

  const handleDelete = async (error: AppError) => {
    try {
      setDeletingId(error.id);
      const { error: deleteError } = await supabase.from('errores_app').delete().eq('id', error.id);
      if (deleteError) throw deleteError;
      setErrors((prev) => prev.filter((item) => item.id !== error.id));
      toast({
        title: 'Registro eliminado',
        description: 'El error se eliminó correctamente.',
      });
    } catch (error) {
      toast({
        title: 'Aviso',
        description: error instanceof Error ? error.message : 'Intenta nuevamente.',
      });
    } finally {
      setDeletingId(null);
    }
  };

  const showEmptyState = !loading && filteredErrors.length === 0 && !fetchError;

  const handleUndoReviewed = async (error: AppError) => {
    try {
      setUndoId(error.id);
      const { error: undoError } = await supabase
        .from('errores_app')
        .update({ revisado: false })
        .eq('id', error.id);
      if (undoError) throw undoError;
      setErrors((prev) => prev.map((item) => (item.id === error.id ? { ...item, revisado: false } : item)));
      toast({
        title: 'Revisión revertida',
        description: 'El error volvió a estado pendiente.',
      });
    } catch (undoErr) {
      toast({
        title: 'Aviso',
        description: undoErr instanceof Error ? undoErr.message : 'Inténtalo nuevamente.',
      });
    } finally {
      setUndoId(null);
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, dateFilter, errors.length]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col space-y-6 px-3 pb-10">
      <Card className="relative mt-4 overflow-hidden border-none bg-gradient-to-br from-amber-500 via-amber-600 to-orange-600 text-amber-50 shadow">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_60%)]" />
        <CardHeader className="relative space-y-8">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-white/80">Centro de incidencias</p>
              <h1 className="text-3xl font-semibold tracking-tight text-white">Avisos y notificaciones</h1>
              <p className="text-sm text-white/80">{formatDateSafe(new Date().toISOString(), "EEEE, dd 'de' MMMM", '')}</p>
            </div>
            <Button onClick={fetchErrors} variant="secondary" className="gap-2 bg-white/20 text-white hover:bg-white/30 border-white/40">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Actualizar listado
            </Button>
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-white/80">
            <span>Pendientes: <strong className="text-white">{stats.pending}</strong></span>
            <span>Revisados: <strong className="text-white">{stats.resolved}</strong></span>
            <span>Reportados hoy: <strong className="text-white">{stats.today}</strong></span>
            <span>Total histórico: <strong className="text-white">{stats.total}</strong></span>
          </div>
        </CardHeader>
      </Card>

      {fetchError && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-200" />
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="border border-border/60">
          <CardHeader className="space-y-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative flex-1 lg:max-w-md">
                <Search className="absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por asunto, correo o detalle"
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="flex rounded-lg border bg-muted/60 p-1 text-xs font-medium">
                  {STATUS_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      onClick={() => setStatusFilter(filter.value)}
                      className={`rounded-md px-3 py-1 transition ${
                        statusFilter === filter.value
                          ? 'bg-background text-foreground shadow'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-lg border bg-muted/60 p-1 text-xs font-medium">
                  {DATE_FILTERS.map((filter) => (
                    <button
                      key={filter.label}
                      onClick={() => setDateFilter(filter.value)}
                      className={`rounded-md px-3 py-1 transition ${
                        dateFilter === filter.value
                          ? 'bg-background text-foreground shadow'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, index) => (
                  <Skeleton key={index} className="h-28 w-full rounded-xl" />
                ))}
              </div>
            ) : showEmptyState ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <CheckCircle2 className="h-10 w-10" />
                <p className="font-medium">No hay incidencias dentro de los filtros seleccionados.</p>
                <p className="text-sm">Ajusta la búsqueda o espera nuevos reportes.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {paginatedErrors.map((entry) => (
                  <article
                    key={entry.id}
                    className={`rounded-2xl border p-4 transition-colors ${
                      entry.revisado
                        ? 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-800/50 dark:bg-emerald-900/20'
                        : 'border-amber-200/80 bg-amber-50/70 dark:border-amber-800/50 dark:bg-amber-900/20'
                    }`}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-1 inline-flex h-10 w-10 items-center justify-center rounded-full ${
                            entry.revisado
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'
                          }`}
                        >
                          <AlertTriangle className="h-5 w-5" />
                        </span>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-foreground">{entry.subject}</h3>
                            <Badge
                              className={`px-2 py-0.5 text-xs ${
                                entry.revisado
                                  ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                                  : 'border-amber-300 text-amber-800 bg-amber-100'
                              }`}
                            >
                              {entry.revisado ? 'Revisado' : 'Pendiente'}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground line-clamp-3">{entry.error}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" /> {formatTimestamp(entry.created_at)}
                        </span>
                        {entry.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="h-3.5 w-3.5" /> {entry.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!entry.revisado ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={reviewingId === entry.id}
                          onClick={() => handleMarkReviewed(entry)}
                          className="bg-amber-500 text-white hover:bg-amber-600"
                        >
                          {reviewingId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Marcar revisado'}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={undoId === entry.id}
                          onClick={() => handleUndoReviewed(entry)}
                          className="border-emerald-200 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50"
                        >
                          {undoId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deshacer revisión'}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className={`${
                          entry.revisado
                            ? 'text-emerald-700 hover:text-emerald-900 dark:text-emerald-100 dark:hover:text-emerald-50'
                            : 'text-amber-800 hover:text-amber-900 dark:text-amber-100 dark:hover:text-amber-50'
                        }`}
                        disabled={deletingId === entry.id}
                        onClick={() => handleDelete(entry)}
                      >
                        {deletingId === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Trash2 className="mr-1 h-4 w-4" />Eliminar</>}
                      </Button>
                    </div>
                  </article>
                ))}

                <div className="flex flex-col gap-3 pt-4 border-t">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      Página {currentPage} de {totalPages}
                    </span>
                    <select
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                    >
                      {[10, 25, 50, 100].map((size) => (
                        <option key={size} value={size}>
                          {size} por página
                        </option>
                      ))}
                    </select>
                    <span className="text-xs">{filteredErrors.length} resultados</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                    >
                      « Primera
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      ‹ Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      Siguiente ›
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(totalPages)}
                      disabled={currentPage === totalPages}
                    >
                      Última »
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Actividad reciente</CardTitle>
              <p className="text-sm text-muted-foreground">Últimos reportes recibidos</p>
            </CardHeader>
            <CardContent>
              {errors.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aún no se han registrado incidencias.</p>
              ) : (
                <div className="space-y-4">
                  {errors.slice(0, 6).map((entry) => (
                    <div key={`timeline-${entry.id}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <span className={`h-2 w-2 rounded-full ${entry.revisado ? 'bg-emerald-400' : 'bg-amber-500'}`} />
                        <span className="flex-1 w-px bg-border" />
                      </div>
                      <div className="flex-1 text-sm">
                        <p className="font-medium text-foreground">{entry.subject}</p>
                        <p className="text-xs text-muted-foreground">{formatTimestamp(entry.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="border border-border/60">
            <CardHeader>
              <CardTitle className="text-base font-semibold">Estado general</CardTitle>
              <p className="text-sm text-muted-foreground">Distribución de incidencias</p>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="flex items-center justify-between rounded-lg border bg-amber-50 text-amber-900 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-100 p-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Pendientes</p>
                  <p className="text-lg font-semibold">{stats.pending}</p>
                </div>
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:border-amber-800">
                  <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Atención
                </Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-100 p-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Revisados</p>
                  <p className="text-lg font-semibold">{stats.resolved}</p>
                </div>
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-100 dark:border-emerald-800">
                  <ShieldCheck className="h-3.5 w-3.5" /> Listo
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};


export default Errors;
