import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ExternalLink,
  FileCheck2,
  FileSearch,
  FileWarning,
  Loader2,
  MailSearch,
  Search,
  Upload,
} from 'lucide-react';

import { canAccessPath, getFirstAllowedPath } from '@/config/accessControl';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { legacySupabase as supabase } from '@/integrations/supabase/legacyClient';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buildCambioDetailPath, buildCuentaDetailPath, buildPedidoDetailPath } from '@/utils/entityRoutes';

type ArchivoPdfMatch = {
  id: number;
  hash_sha256: string;
  nombre_archivo: string | null;
  tamanio_bytes: number;
  created_at: string;
};

type PedidoLookupRow = {
  id: number;
  tipo_pedido: string;
  referencia_cliente: string | null;
  fecha_pedido: string | null;
  fecha_carga: string | null;
  created_at: string;
};

type CambioLookupRow = {
  id: number;
  tipo_pedido: string | null;
  referencia_cliente: string | null;
  fecha_pedido: string | null;
  fecha_carga: string | null;
  created_at: string;
  revisado: boolean | null;
};

type CuentaVentaLookupRow = {
  id: number;
  numero_cuentaventa: string | null;
  fechavaloracion: string | null;
  created_at: string;
  idcuentaventa_orizon: number | null;
  total_cuentaventa: number;
};

type LookupResult = {
  archivo: ArchivoPdfMatch | null;
  pedidos: PedidoLookupRow[];
  cambios: CambioLookupRow[];
  cuentas: CuentaVentaLookupRow[];
};

type PendingReviewItem = {
  filename: string | null;
  subject: string | null;
  from: string | null;
  sender_email: string | null;
  clienteid: number | null;
  cliente_nombre: string | null;
  email_date: string | null;
  message_id: string | null;
  uid: string | null;
  mime_type: string | null;
  hash_sha256: string;
  exists_in_db: boolean;
  archivo_pdf_id: number | null;
  archivo_pdf_nombre: string | null;
  archivo_pdf_created_at: string | null;
};

type PendingReviewResult = {
  success: boolean;
  checked_at: string;
  timeframe: {
    since_imap: string;
    since_iso: string;
    timezone: string;
    mailbox: string;
    only_seen: boolean;
  };
  totals: {
    received_items: number;
    pdf_candidates: number;
    skipped_non_pdf: number;
    skipped_without_hash: number;
    eligible_after_cliente_filter: number;
    excluded_no_cliente: number;
    excluded_cliente_no_visible: number;
    compared: number;
    found_in_db: number;
    missing_in_db: number;
    processed_messages: number;
    remaining_messages: number;
  };
  pagination?: {
    has_more: boolean;
    next_cursor_uid: number | null;
  };
  pending: PendingReviewItem[];
  found: PendingReviewItem[];
};

const PENDING_LOOKBACK_DAYS = 2;
type FixedPendingSince = { since_imap: string; since_iso: string };

const buildFixedPendingSince = (): FixedPendingSince => {
  const fixedDate = new Date(Date.now() - PENDING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const year = fixedDate.getFullYear();
  const month = fixedDate.getMonth();
  const day = fixedDate.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return {
    since_imap: `${day}-${months[month]}-${year}`,
    since_iso: new Date(Date.UTC(year, month, day, 0, 0, 0, 0)).toISOString(),
  };
};

const toBase64 = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const sha256FromString = async (value: string): Promise<string> => {
  const encoded = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((item) => item.toString(16).padStart(2, '0')).join('');
};

const isPdfFile = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'dd/MM/yyyy HH:mm');
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, 'dd/MM/yyyy');
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value ?? 0);

const buildPendingPayload = (fixedSince: FixedPendingSince, cursorUid: number | null) => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    since_imap: fixedSince.since_imap,
    since_iso: fixedSince.since_iso,
    timezone,
    only_seen: true,
    ...(typeof cursorUid === 'number' && cursorUid > 0 ? { cursor_uid: cursorUid } : {}),
  };
};

const resolveTipoPedidoLabel = (tipoPedido: string | null | undefined) =>
  tipoPedido === 'P22E' ? 'Previsión' : 'Pedido';

const AdminFileLookup = () => {
  const { role, allowedRoutes } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [reviewingSalesPending, setReviewingSalesPending] = useState(false);
  const [pendingSalesReviewResult, setPendingSalesReviewResult] = useState<PendingReviewResult | null>(null);
  const todayKey = new Date().toDateString();
  const pendingFixedSince = useMemo(() => buildFixedPendingSince(), [todayKey]);

  const totalMatches = useMemo(() => {
    if (!result?.archivo) return 0;
    return result.pedidos.length + result.cambios.length + result.cuentas.length;
  }, [result]);

  const pendingSalesMissingCount = pendingSalesReviewResult?.totals.missing_in_db ?? 0;

  const access = { role, allowedRoutes };
  if (!canAccessPath('/buscar-archivo', access)) {
    const fallback = getFirstAllowedPath(access) ?? '/';
    return <Navigate to={fallback} replace />;
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setResult(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!isPdfFile(file)) {
      toast({
        title: 'Archivo no válido',
        description: 'Solo se permiten archivos PDF.',
        variant: 'destructive',
      });
      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setSelectedFile(file);
  };

  const handleClear = () => {
    setSelectedFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleSearch = async () => {
    if (!selectedFile) {
      toast({
        title: 'Falta archivo',
        description: 'Selecciona un PDF antes de buscar.',
      });
      return;
    }

    try {
      setSearching(true);
      setResult(null);

      const base64 = await toBase64(selectedFile);
      const hash = await sha256FromString(base64);

      const { data: archivosData, error: archivoError } = await supabase
        .from('archivos_pdf')
        .select('id, hash_sha256, nombre_archivo, tamanio_bytes, created_at')
        .eq('hash_sha256', hash)
        .order('id', { ascending: false })
        .limit(1);

      if (archivoError) throw archivoError;

      const archivo = (archivosData?.[0] as ArchivoPdfMatch | undefined) ?? null;
      if (!archivo) {
        setResult({
          archivo: null,
          pedidos: [],
          cambios: [],
          cuentas: [],
        });
        return;
      }

      const [pedidosRes, cambiosRes, cuentasRes] = await Promise.all([
        supabase
          .from('pedidos')
          .select('id, tipo_pedido, referencia_cliente, fecha_pedido, fecha_carga, created_at')
          .eq('archivo_pdf_id', archivo.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('cambios_pedidos')
          .select('id, tipo_pedido, referencia_cliente, fecha_pedido, fecha_carga, created_at, revisado')
          .eq('archivo_pdf_id', archivo.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('cuentaventas')
          .select('id, numero_cuentaventa, fechavaloracion, created_at, idcuentaventa_orizon, total_cuentaventa')
          .eq('archivo_pdf_id', archivo.id)
          .order('created_at', { ascending: false }),
      ]);

      if (pedidosRes.error) throw pedidosRes.error;
      if (cambiosRes.error) throw cambiosRes.error;
      if (cuentasRes.error) throw cuentasRes.error;

      setResult({
        archivo,
        pedidos: (pedidosRes.data ?? []) as PedidoLookupRow[],
        cambios: (cambiosRes.data ?? []) as CambioLookupRow[],
        cuentas: ((cuentasRes.data ?? []) as CuentaVentaLookupRow[]).map((cuenta) => ({
          ...cuenta,
          total_cuentaventa:
            typeof cuenta.total_cuentaventa === 'number' ? cuenta.total_cuentaventa : Number(cuenta.total_cuentaventa) || 0,
        })),
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Inténtalo nuevamente.';
      console.error('Error buscando PDF en xFuego', error);
      toast({
        title: 'No se pudo buscar el archivo',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setSearching(false);
    }
  };

  const openPedido = (pedido: PedidoLookupRow) => {
    navigate(buildPedidoDetailPath(pedido.id, pedido.tipo_pedido === 'P22E' ? 'P22E' : 'P220'));
  };

  const openCambio = (cambio: CambioLookupRow) => {
    navigate(buildCambioDetailPath(cambio.id));
  };

  const openCuenta = (cuenta: CuentaVentaLookupRow) => {
    navigate(buildCuentaDetailPath(cuenta.id));
  };

  const dedupePendingItems = (items: PendingReviewItem[]) => {
    const map = new Map<string, PendingReviewItem>();
    items.forEach((item) => {
      const key = `${item.uid ?? 'no-uid'}|${item.hash_sha256}|${item.filename ?? 'no-name'}`;
      map.set(key, item);
    });
    return Array.from(map.values());
  };

  const resolveFunctionErrorMessage = async (error: unknown, fallback: string) => {
    let message = error instanceof Error ? error.message : fallback;
    const maybeContext = (error as { context?: unknown } | null)?.context;
    if (!(maybeContext instanceof Response)) return message;

    try {
      const payload = (await maybeContext.clone().json()) as { error?: unknown; details?: unknown };
      const apiError = typeof payload?.error === 'string' ? payload.error : '';
      const apiDetails = typeof payload?.details === 'string' ? payload.details : '';
      if (apiError || apiDetails) message = [apiError, apiDetails].filter(Boolean).join(' · ');
    } catch {
      try {
        const rawText = (await maybeContext.clone().text()).trim();
        if (rawText) message = rawText;
      } catch {
        // keep original message
      }
    }
    return message;
  };

  const runPendingReview = async (functionName: string): Promise<PendingReviewResult> => {
    const MAX_BATCH_CALLS = 20;
    let cursorUid: number | null = null;
    let batchCalls = 0;
    let aggregated: PendingReviewResult | null = null;

    while (batchCalls < MAX_BATCH_CALLS) {
      batchCalls += 1;
      const payload = buildPendingPayload(pendingFixedSince, cursorUid);
      const { data, error } = await supabase.functions.invoke(functionName, { body: payload });
      if (error) {
        const payloadError = data as { error?: unknown; details?: unknown } | null;
        const apiError = typeof payloadError?.error === 'string' ? payloadError.error : '';
        const apiDetails = typeof payloadError?.details === 'string' ? payloadError.details : '';
        if (apiError || apiDetails) throw new Error([apiError, apiDetails].filter(Boolean).join(' · '));
        throw error;
      }

      const parsed = data as PendingReviewResult | { error?: string; details?: string } | null;
      if (!parsed || typeof parsed !== 'object' || !('success' in parsed) || parsed.success !== true) {
        const message =
          parsed && typeof parsed === 'object' && 'error' in parsed && parsed.error
            ? String(parsed.error)
            : 'Respuesta inválida del servidor.';
        throw new Error(message);
      }

      const chunk = parsed as PendingReviewResult;
      if (!aggregated) {
        aggregated = chunk;
      } else {
        aggregated = {
          ...chunk,
          success: true,
          totals: {
            received_items: aggregated.totals.received_items + chunk.totals.received_items,
            pdf_candidates: aggregated.totals.pdf_candidates + chunk.totals.pdf_candidates,
            skipped_non_pdf: aggregated.totals.skipped_non_pdf + chunk.totals.skipped_non_pdf,
            skipped_without_hash: aggregated.totals.skipped_without_hash + chunk.totals.skipped_without_hash,
            eligible_after_cliente_filter:
              aggregated.totals.eligible_after_cliente_filter + chunk.totals.eligible_after_cliente_filter,
            excluded_no_cliente: aggregated.totals.excluded_no_cliente + chunk.totals.excluded_no_cliente,
            excluded_cliente_no_visible:
              aggregated.totals.excluded_cliente_no_visible + chunk.totals.excluded_cliente_no_visible,
            compared: aggregated.totals.compared + chunk.totals.compared,
            found_in_db: aggregated.totals.found_in_db + chunk.totals.found_in_db,
            missing_in_db: aggregated.totals.missing_in_db + chunk.totals.missing_in_db,
            processed_messages: aggregated.totals.processed_messages + chunk.totals.processed_messages,
            remaining_messages: chunk.totals.remaining_messages,
          },
          pending: dedupePendingItems([...aggregated.pending, ...chunk.pending]),
          found: dedupePendingItems([...aggregated.found, ...chunk.found]),
        };
      }

      const hasMore = Boolean(chunk.pagination?.has_more);
      const nextCursor = typeof chunk.pagination?.next_cursor_uid === 'number' ? chunk.pagination.next_cursor_uid : null;
      if (!hasMore || !nextCursor || nextCursor === cursorUid) break;
      cursorUid = nextCursor;
    }

    if (!aggregated) throw new Error('Respuesta vacía del servidor.');
    return aggregated;
  };

  const handleReviewSalesPending = async () => {
    try {
      setReviewingSalesPending(true);
      setPendingSalesReviewResult(null);

      const aggregated = await runPendingReview('review-imap-pending-sales-accounts');
      setPendingSalesReviewResult(aggregated);

      if (aggregated.pagination?.has_more) {
        toast({
          title: 'Revisión parcial',
          description: 'Se alcanzó el límite interno de lotes; vuelve a ejecutar para completar el resto.',
          variant: 'destructive',
        });
      }
      toast({
        title: 'Revisión completada',
        description: `PDF comparados: ${aggregated.totals.compared}. Cuentas de venta pendientes detectadas: ${aggregated.totals.missing_in_db}.`,
      });
    } catch (error: unknown) {
      const message = await resolveFunctionErrorMessage(error, 'No se pudo revisar cuentas de venta pendientes.');
      console.error('Error revisando cuentas de venta pendientes IMAP', error);
      toast({
        title: 'Error en revisión de cuentas de venta pendientes',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setReviewingSalesPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/20">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-3 py-8">
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
          <CardHeader className="relative space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Control de entrada</p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Buscar archivo PDF</h1>
                <p className="text-sm text-white/80">
                  Sube un PDF para comprobar si existe en xFuego y abrir su pedido, previsión, cambio o cuenta de venta.
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MailSearch className="h-4 w-4 text-primary" />
                Revisar cuentas de venta pendientes
              </CardTitle>
              <CardDescription>
                Consulta en modo solo lectura (sin marcar como leídos) y muestra los PDF de cuentas de venta pendientes.
              </CardDescription>
            </div>
            <div className="w-full lg:w-auto">
              <div className="grid w-full gap-3 md:grid-cols-[170px_220px_auto] md:items-end">
                <div className="space-y-1">
                  <Label htmlFor="pending-sales-fixed-since" className="text-xs font-medium text-muted-foreground">
                    Revisar desde
                  </Label>
                  <Input
                    id="pending-sales-fixed-since"
                    value={formatDate(pendingFixedSince.since_iso)}
                    readOnly
                    className="h-10 w-full bg-muted/30"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pending-sales-mailbox-fixed" className="text-xs font-medium text-muted-foreground">
                    Carpeta
                  </Label>
                  <Input id="pending-sales-mailbox-fixed" value="INBOX" readOnly className="h-10 w-full bg-muted/30" />
                </div>
                <div className="md:self-end">
                  <Button
                    onClick={handleReviewSalesPending}
                    disabled={reviewingSalesPending}
                    className="h-10 w-full gap-2 px-5 whitespace-nowrap sm:w-auto"
                  >
                    {reviewingSalesPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Revisar cuentas de venta pendientes
                  </Button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">Fijo: 2 días antes de hoy.</p>
            </div>
          </CardHeader>
          {reviewingSalesPending && !pendingSalesReviewResult && (
            <CardContent>
              <Alert aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertTitle>Revisando cuentas de venta pendientes</AlertTitle>
                <AlertDescription>Revisando correo y viendo archivos pendientes...</AlertDescription>
              </Alert>
            </CardContent>
          )}
          {pendingSalesReviewResult && (
            <CardContent className="space-y-4">
              <Alert className={pendingSalesMissingCount > 0 ? 'border-amber-300 bg-amber-50/60' : undefined}>
                {pendingSalesMissingCount > 0 ? <FileWarning className="h-4 w-4" /> : <FileCheck2 className="h-4 w-4" />}
                <AlertTitle>
                  {pendingSalesMissingCount > 0
                    ? `${pendingSalesMissingCount} cuentas de venta pendientes`
                    : 'No hay cuentas de venta pendientes'}
                </AlertTitle>
                <AlertDescription>
                  Revisión {formatDateTime(pendingSalesReviewResult.checked_at)} · Carpeta{' '}
                  <code>{pendingSalesReviewResult.timeframe.mailbox || 'INBOX'}</code> ·{' '}
                  {pendingSalesReviewResult.timeframe.only_seen ? 'Vistos desde ' : 'Correos desde '}
                  <code>{formatDate(pendingSalesReviewResult.timeframe.since_iso)}</code>.
                </AlertDescription>
              </Alert>

              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground">Elementos recibidos</p>
                  <p className="font-semibold">{pendingSalesReviewResult.totals.received_items}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground">PDF candidatos</p>
                  <p className="font-semibold">{pendingSalesReviewResult.totals.pdf_candidates}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground">Comparables visibles</p>
                  <p className="font-semibold">{pendingSalesReviewResult.totals.eligible_after_cliente_filter}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground">Excluidos sin cliente</p>
                  <p className="font-semibold">{pendingSalesReviewResult.totals.excluded_no_cliente}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground">Excluidos no visibles</p>
                  <p className="font-semibold">{pendingSalesReviewResult.totals.excluded_cliente_no_visible}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-muted-foreground">PDF comparados</p>
                  <p className="font-semibold">{pendingSalesReviewResult.totals.compared}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Encontrados en xFuego: <strong>{pendingSalesReviewResult.totals.found_in_db}</strong> · Cuentas de venta
                pendientes en xFuego: <strong>{pendingSalesReviewResult.totals.missing_in_db}</strong>
              </p>

              {pendingSalesReviewResult.pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay cuentas de venta pendientes desde{' '}
                  <code>{formatDate(pendingSalesReviewResult.timeframe.since_iso)}</code> para la carpeta{' '}
                  <code>{pendingSalesReviewResult.timeframe.mailbox || 'INBOX'}</code>.
                </p>
              ) : (
                <div className="rounded-md border max-h-[420px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Archivo</TableHead>
                        <TableHead>Asunto</TableHead>
                        <TableHead>Remitente</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Fecha correo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pendingSalesReviewResult.pending.map((item, index) => (
                        <TableRow key={`${item.hash_sha256}-${index}`}>
                          <TableCell className="font-medium">{item.filename || 'Sin nombre'}</TableCell>
                          <TableCell>{item.subject || '—'}</TableCell>
                          <TableCell>{item.from || '—'}</TableCell>
                          <TableCell>
                            {item.cliente_nombre?.trim() ||
                              (typeof item.clienteid === 'number' ? `Cliente #${item.clienteid}` : '—')}
                          </TableCell>
                          <TableCell>{formatDateTime(item.email_date)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Card className="border border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-4 w-4 text-primary" />
              Localizador de documentos
            </CardTitle>
            <CardDescription>
              La búsqueda compara el contenido del PDF para localizar coincidencias exactas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
                <div className="space-y-1">
                  <Label htmlFor="file-lookup-input" className="text-xs font-medium text-muted-foreground">
                    Archivo PDF
                  </Label>
                  <Input
                    id="file-lookup-input"
                    ref={inputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={handleFileChange}
                    disabled={searching}
                  />
                </div>
                <div className="lg:self-end">
                  <Button onClick={handleSearch} disabled={!selectedFile || searching} className="h-10 gap-2">
                    {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Buscar en xFuego
                  </Button>
                </div>
                <div className="lg:self-end">
                  <Button variant="outline" onClick={handleClear} disabled={searching} className="h-10">
                    Limpiar
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Se admite un único PDF. No se guarda nada nuevo, solo se comprueba existencia.
              </p>
            </div>

            {selectedFile && (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">{selectedFile.name}</span>
                <span className="ml-2 text-muted-foreground">({formatBytes(selectedFile.size)})</span>
              </div>
            )}
          </CardContent>
        </Card>

        {result && !result.archivo && (
          <Alert>
            <FileWarning className="h-4 w-4" />
            <AlertTitle>No se encontró en xFuego</AlertTitle>
            <AlertDescription>
              No existe ningún registro para este PDF en xFuego.
            </AlertDescription>
          </Alert>
        )}

        {result && result.archivo && (
          <div className="space-y-4">
            <Alert>
              <FileCheck2 className="h-4 w-4" />
              <AlertTitle>Archivo encontrado</AlertTitle>
              <AlertDescription>
                PDF ID <code>{result.archivo.id}</code> localizado en xFuego con {totalMatches} coincidencias
                operativas.
              </AlertDescription>
            </Alert>

            <Card className="border border-border/60">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileSearch className="h-4 w-4 text-primary" />
                  Metadatos del archivo
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-sm">
                <div>
                  <p className="text-muted-foreground">ID</p>
                  <p className="font-semibold">{result.archivo.id}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Nombre</p>
                  <p className="font-semibold">{result.archivo.nombre_archivo || 'Sin nombre'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Tamaño</p>
                  <p className="font-semibold">{formatBytes(result.archivo.tamanio_bytes)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Alta</p>
                  <p className="font-semibold">{formatDateTime(result.archivo.created_at)}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border/60">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Pedidos y previsiones</CardTitle>
                  <CardDescription>Registros de <code>pedidos</code> asociados a este PDF.</CardDescription>
                </div>
                <Badge variant="secondary">{result.pedidos.length}</Badge>
              </CardHeader>
              <CardContent>
                {result.pedidos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay pedidos/previsiones vinculados.</p>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Referencia</TableHead>
                          <TableHead>Fecha pedido</TableHead>
                          <TableHead>Fecha carga</TableHead>
                          <TableHead>Acción</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.pedidos.map((pedido) => (
                          <TableRow key={pedido.id}>
                            <TableCell className="font-medium">#{pedido.id}</TableCell>
                            <TableCell>{resolveTipoPedidoLabel(pedido.tipo_pedido)}</TableCell>
                            <TableCell>{pedido.referencia_cliente || '—'}</TableCell>
                            <TableCell>{formatDate(pedido.fecha_pedido)}</TableCell>
                            <TableCell>{formatDate(pedido.fecha_carga)}</TableCell>
                            <TableCell>
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => openPedido(pedido)}>
                                <ExternalLink className="h-3.5 w-3.5" />
                                Abrir
                              </Button>
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
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Cuentas de venta</CardTitle>
                  <CardDescription>Registros de <code>cuentaventas</code> asociados a este PDF.</CardDescription>
                </div>
                <Badge variant="secondary">{result.cuentas.length}</Badge>
              </CardHeader>
              <CardContent>
                {result.cuentas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay cuentas de venta vinculadas.</p>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Número</TableHead>
                          <TableHead>Fecha valoración</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Acción</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.cuentas.map((cuenta) => (
                          <TableRow key={cuenta.id}>
                            <TableCell className="font-medium">#{cuenta.id}</TableCell>
                            <TableCell>{cuenta.numero_cuentaventa || '—'}</TableCell>
                            <TableCell>{formatDate(cuenta.fechavaloracion)}</TableCell>
                            <TableCell>{formatCurrency(cuenta.total_cuentaventa)} €</TableCell>
                            <TableCell>
                              <Badge variant={cuenta.idcuentaventa_orizon ? 'default' : 'secondary'}>
                                {cuenta.idcuentaventa_orizon ? `Orizon ${cuenta.idcuentaventa_orizon}` : 'Pendiente'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => openCuenta(cuenta)}>
                                <ExternalLink className="h-3.5 w-3.5" />
                                Abrir
                              </Button>
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
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">Cambios</CardTitle>
                  <CardDescription>Registros de <code>cambios_pedidos</code> asociados a este PDF.</CardDescription>
                </div>
                <Badge variant="secondary">{result.cambios.length}</Badge>
              </CardHeader>
              <CardContent>
                {result.cambios.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No hay cambios vinculados.</p>
                ) : (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Referencia</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Fecha pedido</TableHead>
                          <TableHead>Fecha carga</TableHead>
                          <TableHead>Acción</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.cambios.map((cambio) => (
                          <TableRow key={cambio.id}>
                            <TableCell className="font-medium">#{cambio.id}</TableCell>
                            <TableCell>{resolveTipoPedidoLabel(cambio.tipo_pedido)}</TableCell>
                            <TableCell>{cambio.referencia_cliente || '—'}</TableCell>
                            <TableCell>
                              <Badge variant={cambio.revisado ? 'default' : 'secondary'}>
                                {cambio.revisado ? 'Revisado' : 'Pendiente'}
                              </Badge>
                            </TableCell>
                            <TableCell>{formatDate(cambio.fecha_pedido)}</TableCell>
                            <TableCell>{formatDate(cambio.fecha_carga)}</TableCell>
                            <TableCell>
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => openCambio(cambio)}>
                                <ExternalLink className="h-3.5 w-3.5" />
                                Abrir
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminFileLookup;
