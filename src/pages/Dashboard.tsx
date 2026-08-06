import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Loader2,
  ReceiptText,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  buildFacturasSummary,
  facturaERPStatusLabels,
  isFacturaInERP,
  getFacturaActivityDate,
  type FacturaERPStatus,
  type FacturaERPSummary,
} from '../lib/facturasSummary';
import type { FacturaRecibida } from '../services/apiContracts';
import { fetchFacturasRecibidas } from '../services/facturas';
import { ROUTE_BASES } from '../utils/entityRoutes';

const FACTURAS_PATH = ROUTE_BASES.facturasRecibidas;

const formatNumber = (value: number) =>
  Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);

const formatLongDate = (date: Date) =>
  date.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

const formatSyncTime = (date: Date) =>
  date.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const formatActivityDate = (value?: string | null) => {
  if (!value) {
    return 'Sin actividad';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const cleanText = (value?: string | null) => (value ?? '').trim();

const invoiceNumber = (factura: FacturaRecibida) =>
  cleanText(factura.numero_factura) ||
  cleanText(factura.referencia) ||
  cleanText(factura.documento_codigo) ||
  factura.id.slice(0, 8);

const invoiceProvider = (factura: FacturaRecibida) =>
  cleanText(factura.proveedor_nombre) || cleanText(factura.proveedor_nif) || 'Proveedor sin identificar';

const erpStatusTone: Record<FacturaERPStatus, { bar: string; dot: string; text: string }> = {
  en_erp: {
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  fuera_erp: {
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-300',
  },
};

type SummaryMetric = {
  label: string;
  value: string;
  unit: string;
  description: string;
};

type ProgressItem = {
  label: string;
  value: number;
  target: number;
  helper: string;
  tone: string;
};

type DashboardPanelProps = {
  title: string;
  subtitle: string;
  totalValue: string;
  totalUnit: string;
  modulePath: string;
  progressLabel: string;
  statusRows: FacturaERPSummary[];
  progressRows: ProgressItem[];
  emptyLabel: string;
};

const DashboardPanel = ({
  title,
  subtitle,
  totalValue,
  totalUnit,
  modulePath,
  progressLabel,
  statusRows,
  progressRows,
  emptyLabel,
}: DashboardPanelProps) => {
  const hasStatusData = statusRows.some((row) => row.count > 0);

  return (
    <section className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          <Link
            to={modulePath}
            className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <Activity className="h-4 w-4" aria-hidden="true" />
            {progressLabel}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="shrink-0 text-left sm:text-right">
          <p className="text-xs font-semibold text-muted-foreground">Total</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            {totalValue}
            <span className="ml-1 text-xs font-semibold text-muted-foreground">{totalUnit}</span>
          </p>
        </div>
      </div>

      <div className="grid border-t border-border/60 bg-background md:grid-cols-2">
        <div className="min-h-[292px] border-b border-border/60 p-6 md:border-b-0 md:border-r">
          <h3 className="text-sm font-semibold text-foreground">Envio ERP</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Reparto operativo segun si la factura esta enviada a ERP o pendiente.
          </p>

          {hasStatusData ? (
            <div className="mt-6 space-y-4">
              {statusRows.map((row) => (
                <div key={row.status} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${erpStatusTone[row.status].dot}`} />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className={`shrink-0 text-xs font-semibold ${erpStatusTone[row.status].text}`}>
                      {formatNumber(row.count)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-border/60">
                    <div
                      className={`h-full rounded-full ${erpStatusTone[row.status].bar}`}
                      style={{ width: `${Math.max(row.percentage, row.count > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[190px] items-center justify-center">
              <div className="flex h-36 w-36 items-center justify-center rounded-full border border-dashed border-border/80 bg-muted/20 text-center text-xs font-medium text-muted-foreground">
                {emptyLabel}
              </div>
            </div>
          )}
        </div>

        <div className="min-h-[292px] p-6">
          <h3 className="text-sm font-semibold text-foreground">Movimientos pendientes</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Cola de trabajo para revision, envio a ERP y control de incidencias.
          </p>
          <div className="mt-6 space-y-4">
            {progressRows.map((item) => {
              const percentage = item.target > 0 ? Math.min((item.value / item.target) * 100, 100) : 0;

              return (
                <div key={item.label} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-foreground">{item.label}</span>
                    <span className="text-xs font-semibold text-muted-foreground">{item.helper}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-border/60">
                    <div
                      className={`h-full rounded-full ${item.tone}`}
                      style={{ width: `${Math.max(percentage, item.value > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>Actual {formatNumber(item.value)}</span>
                    <span>Base {formatNumber(item.target)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

const DashboardResumenModule = () => {
  const [facturas, setFacturas] = useState<FacturaRecibida[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const loaded = await fetchFacturasRecibidas();
      setFacturas(loaded);
      setLastSyncAt(new Date());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar las facturas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const summary = useMemo(() => buildFacturasSummary(facturas, { latestLimit: 5 }), [facturas]);
  const now = lastSyncAt ?? new Date();
  const formattedDate = formatLongDate(now);
  const syncTime = formatSyncTime(now);
  const statusRows = summary.erpBreakdown;
  const latestActivityDate = summary.latestFactura ? getFacturaActivityDate(summary.latestFactura) : null;

  const summaryMetricCards: SummaryMetric[] = [
    {
      label: 'Facturas',
      value: formatNumber(summary.totalCount),
      unit: 'docs',
      description:
        summary.totalCount > 0 ? `${formatMoney(summary.totalAmount)} acumulados.` : 'Sin facturas registradas todavia.',
    },
    {
      label: 'Base',
      value: formatMoney(summary.baseAmount),
      unit: '',
      description:
        summary.baseAmount > 0 ? `${formatMoney(summary.ivaAmount)} de IVA registrado.` : 'Sin importes registrados todavia.',
    },
    {
      label: 'Lineas',
      value: formatNumber(summary.lineCount),
      unit: 'registros',
      description:
        summary.lineCount > 0 ? 'Apuntes contables de facturas.' : 'Sin apuntes contables registrados todavia.',
    },
  ];

  const facturaProgressRows: ProgressItem[] = [
    {
      label: 'Pendiente de revision',
      value: summary.reviewQueueCount,
      target: Math.max(summary.totalCount, summary.reviewQueueCount),
      helper: `${formatNumber(summary.reviewQueueCount)} docs`,
      tone: 'bg-amber-500',
    },
    {
      label: 'Listas para ERP',
      value: summary.readyForERPCount,
      target: Math.max(summary.totalCount, summary.readyForERPCount),
      helper: `${formatNumber(summary.readyForERPCount)} docs`,
      tone: 'bg-blue-500',
    },
    {
      label: 'Con error ERP',
      value: summary.erpErrorCount,
      target: Math.max(summary.totalCount, summary.erpErrorCount),
      helper: `${formatNumber(summary.erpErrorCount)} docs`,
      tone: 'bg-rose-500',
    },
  ];

  const economicProgressRows: ProgressItem[] = [
    {
      label: 'Con proveedor ERP',
      value: summary.invoicesWithProviderCode,
      target: Math.max(summary.totalCount, summary.invoicesWithProviderCode),
      helper: `${formatNumber(summary.invoicesWithProviderCode)} docs`,
      tone: 'bg-emerald-500',
    },
    {
      label: 'Sin proveedor identificado',
      value: summary.missingProviderCount,
      target: Math.max(summary.totalCount, summary.missingProviderCount),
      helper: `${formatNumber(summary.missingProviderCount)} docs`,
      tone: 'bg-amber-500',
    },
    {
      label: 'Con validacion pendiente',
      value: summary.validationIssueCount,
      target: Math.max(summary.totalCount, summary.validationIssueCount),
      helper: `${formatNumber(summary.validationIssueCount)} docs`,
      tone: 'bg-rose-500',
    },
  ];

  return (
    <div className="xfuego-module">
      <div className="min-h-full bg-muted/40">
        <main className="container mx-auto flex flex-col gap-8 px-3 py-10">
          <header className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.6fr),minmax(360px,1fr)]">
            <section className="relative min-h-[320px] overflow-hidden rounded-lg bg-gradient-to-br from-primary via-primary/90 to-primary/80 text-primary-foreground shadow-lg">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.24),_transparent_44%)]" />
              <div className="relative flex h-full flex-col justify-between gap-7 p-6 md:p-8">
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr),360px]">
                  <div className="min-w-0 max-w-xl space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/70">
                      Resumen operativo
                    </p>
                    <h1 className="text-3xl font-semibold tracking-tight text-white">Actividad general</h1>
                    <p className="flex h-10 max-w-[36rem] items-start gap-3 text-sm leading-5 text-white/78">
                      <span>{formattedDate}</span>
                      <span className="text-white/42">·</span>
                      <span className="tabular-nums text-white/58">{syncTime}</span>
                    </p>
                  </div>

                  <div className="flex h-10 w-full justify-start self-start xl:justify-end">
                    <button
                      type="button"
                      aria-label="Actualizar dashboard"
                      disabled={loading}
                      onClick={() => void loadDashboard()}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-white/24 bg-white/14 px-4 text-sm font-semibold text-white shadow-sm outline-none transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-primary disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      <span>{loading ? 'Actualizando...' : 'Actualizar datos'}</span>
                    </button>
                  </div>
                </div>

                {loadError ? (
                  <div className="rounded-lg border border-white/25 bg-white/14 px-4 py-3 text-sm font-semibold text-white">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{loadError}</span>
                    </div>
                  </div>
                ) : null}

                <div className="grid min-h-[116px] overflow-hidden rounded-xl border border-white/20 bg-white/12 md:grid-cols-3">
                  {summaryMetricCards.map((item, index) => (
                    <div
                      key={item.label}
                      className={`block min-h-[116px] p-4 outline-none transition ${
                        index < summaryMetricCards.length - 1
                          ? 'border-b border-white/15 md:border-b-0 md:border-r'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/68">
                          {item.label}
                        </p>
                        <ArrowUpRight className="h-3.5 w-3.5 text-white/35" aria-hidden="true" />
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <p className="text-3xl font-semibold tracking-tight text-white">{item.value}</p>
                        <span className="text-xs font-semibold text-white/65">{item.unit}</span>
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-white/72">{item.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="flex min-h-[320px] flex-col overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
              <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1.5">
                  <h2 className="text-base font-semibold text-foreground">Estado operativo</h2>
                  <p className="text-xs text-muted-foreground">
                    Cobertura de modulos, contabilidad y actividad reciente.
                  </p>
                </div>
              </div>

              <div className="grid flex-1 border-t border-border/60 bg-background sm:grid-cols-2">
                <div className="border-b border-border/60 p-4 sm:border-r">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-foreground">Modulos disponibles</p>
                        <p className="text-xs text-muted-foreground">Base de navegacion</p>
                      </div>
                      <span className="shrink-0 text-lg font-semibold leading-none text-foreground">2</span>
                    </div>
                    <div className="space-y-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-border/60">
                        <div className="h-full w-full rounded-full bg-emerald-500" />
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">Dashboard conectado a facturas.</p>
                    </div>
                  </div>
                </div>

                <div className="border-b border-border/60 p-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-foreground">Documentos</p>
                        <p className="text-xs text-muted-foreground">Facturas</p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-semibold leading-tight text-foreground">
                        {formatNumber(summary.totalCount)}
                      </p>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {summary.reviewQueueCount > 0
                        ? `${formatNumber(summary.reviewQueueCount)} pendientes de revision.`
                        : 'Sin facturas pendientes de revision.'}
                    </p>
                  </div>
                </div>

                <div className="border-b border-border/60 p-4 sm:border-b-0 sm:border-r">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-foreground">ERP</p>
                        <p className="text-xs text-muted-foreground">Envio y validacion</p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-semibold leading-tight text-foreground">
                        {formatNumber(summary.sentToERPCount)}
                      </p>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {summary.readyForERPCount > 0
                        ? `${formatNumber(summary.readyForERPCount)} listas para enviar.`
                        : 'Sin envios pendientes a ERP.'}
                    </p>
                  </div>
                </div>

                <div className="p-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-foreground">Ultimo registro</p>
                        <p className="text-xs text-muted-foreground">Actividad reciente</p>
                      </div>
                      <p className="shrink-0 text-right text-sm font-semibold leading-tight text-foreground tabular-nums">
                        {summary.latestFactura ? invoiceNumber(summary.latestFactura) : 'Sin actividad'}
                      </p>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {summary.latestFactura ? formatActivityDate(latestActivityDate) : 'Todavia no hay movimientos guardados.'}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </header>

          <section className="grid gap-6 xl:grid-cols-2">
            <DashboardPanel
              title="Facturas"
              subtitle="Seguimiento operativo de facturas de compra y envio a ERP."
              progressLabel="Ver modulo"
              totalValue={formatNumber(summary.totalCount)}
              totalUnit="reg."
              modulePath={FACTURAS_PATH}
              statusRows={statusRows}
              progressRows={facturaProgressRows}
              emptyLabel="Sin datos"
            />

            <section className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
              <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2">
                  <h2 className="text-lg font-semibold text-foreground">Resumen de facturas</h2>
                  <p className="text-sm text-muted-foreground">
                    Totales economicos y calidad de datos para preparar el envio.
                  </p>
                  <Link
                    to={FACTURAS_PATH}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  >
                    <ReceiptText className="h-4 w-4" aria-hidden="true" />
                    Ver modulo
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>

                <div className="shrink-0 text-left sm:text-right">
                  <p className="text-xs font-semibold text-muted-foreground">Importe total</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
                    {formatMoney(summary.totalAmount)}
                  </p>
                </div>
              </div>

              <div className="grid border-t border-border/60 bg-background md:grid-cols-2">
                <div className="min-h-[292px] border-b border-border/60 p-6 md:border-b-0 md:border-r">
                  <h3 className="text-sm font-semibold text-foreground">Importes</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Lectura rapida de base, IVA y total de facturas.
                  </p>
                  <dl className="mt-6 grid gap-3">
                    {[
                      ['Base imponible', formatMoney(summary.baseAmount)],
                      ['IVA registrado', formatMoney(summary.ivaAmount)],
                      ['Total factura', formatMoney(summary.totalAmount)],
                      ['Lineas de detalle', formatNumber(summary.lineCount)],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card px-3 py-2"
                      >
                        <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
                        <dd className="text-sm font-semibold text-foreground">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="min-h-[292px] p-6">
                  <h3 className="text-sm font-semibold text-foreground">Calidad de datos</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Campos necesarios para automatizar revision y registro.
                  </p>
                  <div className="mt-6 space-y-4">
                    {economicProgressRows.map((item) => {
                      const percentage = item.target > 0 ? Math.min((item.value / item.target) * 100, 100) : 0;

                      return (
                        <div key={item.label} className="space-y-2">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="font-semibold text-foreground">{item.label}</span>
                            <span className="text-xs font-semibold text-muted-foreground">{item.helper}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-border/60">
                            <div
                              className={`h-full rounded-full ${item.tone}`}
                              style={{ width: `${Math.max(percentage, item.value > 0 ? 4 : 0)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span>Actual {formatNumber(item.value)}</span>
                            <span>Base {formatNumber(item.target)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>
          </section>

          <section className="overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm">
            <div className="flex flex-col gap-3 border-b border-border/60 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">Actividad reciente</h2>
                <p className="text-sm text-muted-foreground">
                  Ultimos movimientos detectados en facturas de compra.
                </p>
              </div>
              {summary.erpErrorCount > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatNumber(summary.erpErrorCount)} con error ERP
                </span>
              ) : summary.sentToERPCount > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatNumber(summary.sentToERPCount)} enviadas a ERP
                </span>
              ) : null}
            </div>

            <div className="bg-muted/15 p-4 sm:p-5">
              {summary.latestFacturas.length > 0 ? (
                <div className="divide-y divide-border/60 rounded-lg border border-border/60 bg-background">
                  {summary.latestFacturas.map((factura) => {
                    const activityDate = getFacturaActivityDate(factura);
                    const erpStatus: FacturaERPStatus = isFacturaInERP(factura) ? 'en_erp' : 'fuera_erp';

                    return (
                      <Link
                        key={factura.id}
                        to={`${FACTURAS_PATH}/${encodeURIComponent(factura.id)}`}
                        className="grid gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1fr),160px,132px] md:items-center"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">
                            {invoiceProvider(factura)} · {invoiceNumber(factura)}
                          </p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {formatActivityDate(activityDate)}
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-2 text-xs font-semibold ${erpStatusTone[erpStatus].text}`}>
                          <span className={`h-2 w-2 rounded-full ${erpStatusTone[erpStatus].dot}`} />
                          {facturaERPStatusLabels[erpStatus]}
                        </span>
                        <span className="text-left font-semibold text-foreground md:text-right">
                          {formatMoney(Number(factura.total ?? 0))}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-background px-6 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-muted/30 text-muted-foreground">
                    <Clock3 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">Sin actividad reciente</p>
                    <p className="text-sm text-muted-foreground">Todavia no hay movimientos para mostrar.</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {loading && summary.totalCount === 0 ? (
            <div className="fixed bottom-5 right-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-lg">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
              Cargando resumen de facturas
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default DashboardResumenModule;
