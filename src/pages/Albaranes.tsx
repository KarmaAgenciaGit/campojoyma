import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileBox,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { FilterSelect } from '@/components/FilterSelect';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  fetchAlbaranEntradaById,
  fetchAlbaranEntradaLineas,
  fetchAlbaranesEntradaPage,
  type AlbaranEntrada,
} from '@/services/facturas';
import type { AlbaranEntradaLineaERP } from '@/services/apiContracts';
import { buildAlbaranEntradaDetailPath, ROUTE_BASES } from '@/utils/entityRoutes';

type AlbaranFilters = {
  agricultor: string;
  serie: string;
  numero: string;
  fechaDesde: string;
  fechaHasta: string;
};

const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = ['25', '50', '100'].map((value) => ({
  value,
  label: `${value} por página`,
}));

const EMPTY_FILTERS: AlbaranFilters = {
  agricultor: '',
  serie: '',
  numero: '',
  fechaDesde: '',
  fechaHasta: '',
};

const inputClass =
  'h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-border dark:bg-background dark:text-foreground dark:placeholder:text-muted-foreground dark:focus:border-primary dark:focus:ring-primary/20 dark:disabled:bg-slate-900/60';

const toolbarButtonBaseClass =
  'inline-flex h-10 w-[176px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const toolbarOutlineButtonClass =
  `${toolbarButtonBaseClass} border-border bg-background text-foreground hover:bg-muted/70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900`;

const toolbarPrimaryButtonClass =
  `${toolbarButtonBaseClass} border-primary bg-primary text-primary-foreground hover:bg-primary/90`;

const toolbarFilterButtonClass = (active: boolean) =>
  active
    ? `${toolbarButtonBaseClass} border-transparent bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-blue-500 dark:text-slate-50 dark:hover:bg-blue-500/90`
    : `${toolbarButtonBaseClass} border-primary/50 bg-background text-primary hover:bg-primary/10 hover:text-primary dark:border-blue-400/70 dark:bg-slate-950 dark:text-blue-200 dark:hover:bg-blue-400/10`;

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
};

const formatInteger = (value: number) =>
  Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const formatDecimal = (value?: number | null, decimals = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

const formatMoney = (value?: number | null) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '-'
    : new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: 'EUR',
      }).format(value);

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(parsed);
};

const parsePositiveInteger = (value: string, label: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} debe ser un número entero positivo.`);
  }
  return parsed;
};

const albaranCode = (albaran: AlbaranEntrada) => {
  const parts = [albaran.serie, albaran.numero].filter(
    (value) => value !== null && value !== undefined && String(value).trim() !== '',
  );
  return parts.length > 0 ? parts.join('-') : String(albaran.id);
};

function DateRangeFilter({
  desde,
  hasta,
  onChange,
}: {
  desde: string;
  hasta: string;
  onChange: (field: 'fechaDesde' | 'fechaHasta', value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input
        type="date"
        className={inputClass}
        value={desde}
        max={hasta || undefined}
        aria-label="Fecha desde"
        onChange={(event) => onChange('fechaDesde', event.target.value)}
      />
      <Input
        type="date"
        className={inputClass}
        value={hasta}
        min={desde || undefined}
        aria-label="Fecha hasta"
        onChange={(event) => onChange('fechaHasta', event.target.value)}
      />
    </div>
  );
}

function AlbaranListItem({
  albaran,
  onOpen,
}: {
  albaran: AlbaranEntrada;
  onOpen: (albaran: AlbaranEntrada) => void;
}) {
  const agricultorLabel = albaran.agricultorNombre
    ? [albaran.agricultorId, albaran.agricultorNombre].filter(Boolean).join(' · ')
    : albaran.agricultorId
      ? `Agricultor ${albaran.agricultorId}`
      : 'Agricultor sin indicar';

  return (
    <article className="min-w-0 rounded-md border border-primary/25 bg-primary/[0.07] transition-colors hover:border-primary/40 dark:border-primary/35 dark:bg-primary/10 dark:hover:border-primary/50">
      <button
        type="button"
        className="grid w-full min-w-0 grid-cols-1 gap-4 rounded-md px-4 py-4 text-left outline-none transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:hover:bg-primary/15 md:grid-cols-[minmax(0,1fr)_minmax(7.5rem,auto)] md:items-center"
        onClick={() => onOpen(albaran)}
        aria-label={`Abrir albarán ${albaranCode(albaran)}`}
      >
        <div className="min-w-0">
          <h3 className="min-w-0 truncate text-sm font-bold text-slate-950 dark:text-slate-50">
            Albarán {albaranCode(albaran)}
          </h3>
          <p className="mt-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
            {agricultorLabel}
          </p>
          <div className="mt-2 grid gap-x-5 gap-y-1 text-xs font-semibold text-slate-500 dark:text-slate-400 sm:grid-cols-2 lg:flex lg:flex-wrap">
            <span>
              Fecha{' '}
              <span className="ml-1 text-slate-700 dark:text-slate-200">
                {formatDate(albaran.fecha)}
              </span>
            </span>
            <span>
              Referencia{' '}
              <span className="ml-1 text-slate-700 dark:text-slate-200">
                {albaran.referencia || '-'}
              </span>
            </span>
            <span>
              Centro{' '}
              <span className="ml-1 text-slate-700 dark:text-slate-200">
                {albaran.centroId ?? '-'}
              </span>
            </span>
            {albaran.syncStatus === 'sent' ? (
              <span className="text-emerald-700 dark:text-emerald-300">Enviado al ERP</span>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 md:border-l md:border-primary/20 md:pl-5 md:text-right dark:md:border-primary/30">
          <span className="block text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Campaña
          </span>
          <span className="mt-1 block whitespace-nowrap text-lg font-bold tabular-nums text-slate-950 dark:text-slate-50">
            {albaran.campa ?? '-'}
          </span>
        </div>
      </button>
    </article>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="purchase-invoice-detail-section border-b border-slate-200 py-5 last:border-b-0 dark:border-border">
      <h2 className="mb-4 text-lg font-bold text-slate-950 dark:text-slate-50">{title}</h2>
      {children}
    </section>
  );
}

function ReadonlyField({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string | number | null | undefined;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>
      <Input className={inputClass} value={value ?? ''} disabled />
    </div>
  );
}

const categoriaLinea = (linea: AlbaranEntradaLineaERP) =>
  linea.categoria_calibre_nombre ??
  ([linea.categoria_nombre, linea.categoria_calibre].filter(Boolean).join(' · ') || '-');

function AlbaranDetail({
  albaranId,
  onBack,
}: {
  albaranId: number;
  onBack: () => void;
}) {
  const [albaran, setAlbaran] = useState<AlbaranEntrada | null>(null);
  const [lineas, setLineas] = useState<AlbaranEntradaLineaERP[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lineasLoading, setLineasLoading] = useState(true);
  const [lineasError, setLineasError] = useState<string | null>(null);

  const loadLineas = useCallback(async () => {
    setLineasLoading(true);
    setLineasError(null);
    try {
      setLineas(await fetchAlbaranEntradaLineas(albaranId));
    } catch (error) {
      setLineas([]);
      setLineasError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudieron cargar las líneas del albarán.',
      );
    } finally {
      setLineasLoading(false);
    }
  }, [albaranId]);

  useEffect(() => {
    let active = true;

    const loadDetail = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const loaded = await fetchAlbaranEntradaById(albaranId);
        if (!loaded) throw new Error('No se encontró el albarán solicitado.');
        if (active) setAlbaran(loaded);
      } catch (error) {
        if (!active) return;
        setAlbaran(null);
        setLoadError(
          error instanceof Error && error.message.trim()
            ? error.message
            : 'No se pudo abrir el albarán.',
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadDetail();
    void loadLineas();

    return () => {
      active = false;
    };
  }, [albaranId, loadLineas]);

  useEffect(() => {
    document.body.classList.add('facturas-iberica-shell');
    return () => document.body.classList.remove('facturas-iberica-shell');
  }, []);

  const totals = useMemo(
    () =>
      lineas.reduce(
        (acc, linea) => ({
          bultos: acc.bultos + (linea.bultos ?? 0),
          kilosNetos: acc.kilosNetos + (linea.kilos_netos ?? 0),
          kilosBrutos: acc.kilosBrutos + (linea.kilos_brutos ?? 0),
          importe: acc.importe + (linea.importe ?? 0),
        }),
        { bultos: 0, kilosNetos: 0, kilosBrutos: 0, importe: 0 },
      ),
    [lineas],
  );

  if (loading) {
    return (
      <div className="grid min-h-[calc(100dvh-109px)] place-items-center bg-white text-sm font-semibold text-slate-500 dark:bg-background dark:text-slate-400">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
          Abriendo albarán...
        </div>
      </div>
    );
  }

  if (!albaran || loadError) {
    return (
      <div className="min-h-[calc(100dvh-109px)] bg-white px-5 py-6 dark:bg-background md:px-6">
        <button
          type="button"
          className="-ml-2 inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          Volver
        </button>
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
          {loadError ?? 'No se pudo abrir el albarán.'}
        </div>
      </div>
    );
  }

  const agricultor = albaran.agricultorNombre
    ? `${albaran.agricultorId ?? '-'} · ${albaran.agricultorNombre}`
    : String(albaran.agricultorId ?? '-');
  const estado = albaran.syncStatus === 'sent' ? 'Enviado al ERP' : 'Pendiente de envío';

  return (
    <div className="purchase-invoice-detail flex min-h-[calc(100dvh-109px)] w-full flex-col bg-white text-slate-950 dark:bg-background dark:text-slate-50">
      <header className="purchase-invoice-detail-header shrink-0 border-b border-slate-200 bg-slate-50 px-5 py-5 shadow-[0_1px_0_rgba(15,23,42,0.03)] dark:border-border dark:bg-card md:px-6">
        <div className="mb-3">
          <button
            type="button"
            className="-ml-2 inline-flex h-8 items-center justify-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-white hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50"
            onClick={onBack}
          >
            <ArrowLeft size={16} />
            Volver
          </button>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <h1 className="text-2xl font-bold leading-tight text-slate-950 dark:text-slate-50">
            Albarán de entrada
          </h1>
          <button
            type="button"
            className="inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-primary bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm disabled:opacity-100"
            disabled
          >
            <CheckCircle2 size={15} />
            {estado}
          </button>
        </div>

        <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium text-slate-500 dark:text-slate-400">
            <span>
              Proveedor:{' '}
              <strong className="font-bold text-slate-950 dark:text-slate-100">{agricultor}</strong>
            </span>
            <span>
              Albarán:{' '}
              <strong className="font-bold text-slate-950 dark:text-slate-100">
                {albaranCode(albaran)}
              </strong>
            </span>
          </p>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium text-slate-500 dark:text-slate-400 lg:justify-end">
            <div className="flex gap-1">
              <dt>Campaña:</dt>
              <dd className="font-bold text-slate-950 dark:text-slate-100">
                {albaran.campa ?? '-'}
              </dd>
            </div>
            <div className="flex gap-1">
              <dt>Fecha:</dt>
              <dd className="font-bold text-slate-950 dark:text-slate-100">
                {formatDate(albaran.fecha)}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="purchase-invoice-detail-main grid flex-1 items-start gap-6 px-5 py-6 md:px-6 xl:grid-cols-[minmax(360px,0.72fr)_minmax(0,1.28fr)]">
        <section className="purchase-invoice-detail-pdf-panel flex min-w-0 flex-col bg-white dark:bg-transparent xl:sticky xl:top-4">
          <DetailSection title="Documento PDF">
            <div className="grid min-h-[420px] place-items-center rounded-sm bg-slate-100 px-6 text-center text-sm font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
              <div>
                <FileBox className="mx-auto mb-3 h-9 w-9" />
                {albaran.sourcePdfName ? (
                  <>
                    <p className="text-slate-700 dark:text-slate-200">{albaran.sourcePdfName}</p>
                    <p className="mt-2 font-medium">El visor se habilitará cuando el PDF esté guardado.</p>
                  </>
                ) : (
                  <>
                    <p>No hay un PDF guardado para este albarán.</p>
                    <p className="mt-2 font-medium">
                      La prueba conserva la referencia y la lectura confirmada del ERP.
                    </p>
                  </>
                )}
              </div>
            </div>
          </DetailSection>
        </section>

        <section className="purchase-invoice-detail-info min-w-0 bg-white dark:bg-transparent xl:pl-2">
          <DetailSection title="Información general">
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 text-sm font-bold text-slate-950 dark:text-slate-100">Proveedor</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReadonlyField label="Proveedor" value={albaran.agricultorNombre} />
                  <ReadonlyField label="Código agricultor ERP" value={albaran.agricultorId} />
                </div>
              </div>
              <div>
                <h3 className="mb-3 text-sm font-bold text-slate-950 dark:text-slate-100">Albarán</h3>
                <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
                  <ReadonlyField label="Entrada ERP" value={albaran.id} />
                  <ReadonlyField label="Campaña" value={albaran.campa} />
                  <ReadonlyField label="Serie" value={albaran.serie} />
                  <ReadonlyField label="Número" value={albaran.numero} />
                  <ReadonlyField label="Fecha" value={formatDate(albaran.fecha)} />
                  <ReadonlyField label="Punto de venta" value={albaran.puntoVentaId} />
                  <ReadonlyField label="Centro" value={albaran.centroId} />
                  <ReadonlyField label="Referencia" value={albaran.referencia || '-'} />
                </div>
              </div>
            </div>
          </DetailSection>

          <DetailSection title="Líneas del albarán">
            <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-5">
              {[
                ['Líneas', String(lineas.length)],
                ['Bultos', formatDecimal(totals.bultos, 0)],
                ['Kilos netos', formatDecimal(totals.kilosNetos)],
                ['Kilos brutos', formatDecimal(totals.kilosBrutos)],
                ['Importe', formatMoney(totals.importe)],
              ].map(([label, value]) => (
                <div key={label} className="border-l-2 border-primary/35 pl-3">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</p>
                  <p className="mt-1 font-bold text-slate-950 dark:text-slate-100">{value}</p>
                </div>
              ))}
            </div>

            {lineasLoading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 rounded-md border border-slate-200 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                Consultando líneas del ERP...
              </div>
            ) : lineasError ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
                <span>{lineasError}</span>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-white px-3 text-xs font-bold text-amber-800 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                  onClick={() => void loadLineas()}
                >
                  <RefreshCw className="h-4 w-4" />
                  Reintentar
                </button>
              </div>
            ) : lineas.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 px-4 py-10 text-center text-sm font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Este albarán no tiene líneas.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                <table className="w-full min-w-[1180px] text-left text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                      <th className="px-3 py-3">Línea</th>
                      <th className="px-3 py-3">Partida</th>
                      <th className="px-3 py-3">Género</th>
                      <th className="px-3 py-3">Categoría</th>
                      <th className="px-3 py-3">TCUL / PCAL</th>
                      <th className="px-3 py-3">Envase</th>
                      <th className="px-3 py-3 text-right">Bultos</th>
                      <th className="px-3 py-3 text-right">Kg netos</th>
                      <th className="px-3 py-3 text-right">Kg brutos</th>
                      <th className="px-3 py-3 text-right">Precio</th>
                      <th className="px-3 py-3 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {lineas.map((linea) => (
                      <tr key={linea.id} className="bg-white dark:bg-slate-950">
                        <td className="px-3 py-3 font-semibold">{linea.linea ?? '-'}</td>
                        <td className="px-3 py-3 font-semibold">{linea.partida ?? '-'}</td>
                        <td className="px-3 py-3">
                          <span className="font-semibold">{linea.genero_id ?? '-'}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {linea.genero_nombre ?? '-'}
                          </span>
                        </td>
                        <td className="px-3 py-3">{categoriaLinea(linea)}</td>
                        <td className="px-3 py-3">
                          {linea.tipo_cultivo_abreviatura ?? '-'}
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {linea.tipo_cultivo_nombre ?? '-'}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {linea.envase_nombre ?? linea.envase_id ?? '-'}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatDecimal(linea.bultos, 0)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatDecimal(linea.kilos_netos)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatDecimal(linea.kilos_brutos)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {formatMoney(linea.precio)}
                        </td>
                        <td className="px-3 py-3 text-right font-bold tabular-nums">
                          {formatMoney(linea.importe)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DetailSection>

          <DetailSection title="Trazabilidad">
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              <ReadonlyField
                label="Origen"
                value={albaran.sourceKind === 'front_draft' ? 'Subido desde la aplicación' : albaran.sourceKind}
              />
              <ReadonlyField label="Estado" value={estado} />
              <ReadonlyField label="Enviado al ERP" value={formatDateTime(albaran.erpSentAt)} />
              <ReadonlyField label="Última lectura ERP" value={formatDateTime(albaran.erpLastReadAt)} />
            </div>
          </DetailSection>
        </section>
      </div>
    </div>
  );
}

function AlbaranesList() {
  const navigate = useNavigate();
  const [albaranes, setAlbaranes] = useState<AlbaranEntrada[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState<AlbaranFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showUploadNotice, setShowUploadNotice] = useState(false);

  const activeFiltersCount = useMemo(
    () => Object.values(filters).filter((value) => value.trim() !== '').length,
    [filters],
  );

  const loadAlbaranes = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const loaded = await fetchAlbaranesEntradaPage({
        page,
        pageSize,
        agricultorId: parsePositiveInteger(filters.agricultor, 'El código de agricultor'),
        serie: filters.serie,
        numero: parsePositiveInteger(filters.numero, 'El número de albarán'),
        fechaDesde: filters.fechaDesde,
        fechaHasta: filters.fechaHasta,
      });
      setAlbaranes(loaded.items);
      setTotal(loaded.total);
      setHasMore(loaded.hasMore);
    } catch (error) {
      setAlbaranes([]);
      setTotal(null);
      setHasMore(false);
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'No se pudieron cargar los albaranes.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize]);

  useEffect(() => {
    void loadAlbaranes();
  }, [loadAlbaranes]);

  useEffect(() => {
    document.body.classList.add('facturas-iberica-shell');
    return () => document.body.classList.remove('facturas-iberica-shell');
  }, []);

  const updateFilter = (field: keyof AlbaranFilters, value: string) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const openAlbaran = (albaran: AlbaranEntrada) => {
    navigate(buildAlbaranEntradaDetailPath(albaran.id));
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const visibleStart = albaranes.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const visibleEnd = albaranes.length === 0 ? 0 : visibleStart + albaranes.length - 1;
  const totalPages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  const headerLabel =
    total === null
      ? 'Albaranes recibidos'
      : activeFiltersCount > 0
        ? total === 1
          ? '1 albarán filtrado'
          : `${formatInteger(total)} albaranes filtrados`
        : total === 1
          ? '1 albarán de entrada'
          : `${formatInteger(total)} albaranes de entrada`;

  return (
    <div className="xfuego-module" style={{ display: 'flex', minHeight: '100%', width: '100%' }}>
      <div className="main-area" style={{ marginLeft: 0, flex: 1, minHeight: '100%' }}>
        <div className="main-content dashboard-shell">
          <div className="purchase-invoices-page flex min-h-[calc(100vh-9rem)] flex-col gap-5">
            <header className="docs-page-header" style={{ marginBottom: 0 }}>
              <div className="docs-page-copy">
                <div className="docs-page-copy-body">
                  <p className="docs-page-eyebrow">Compras</p>
                  <h2 className="docs-page-title">Albaranes</h2>
                  <p className="docs-page-subtitle">{headerLabel}</p>
                </div>
              </div>
              <div className="mt-5 h-px bg-slate-200 dark:bg-border" aria-hidden="true" />
            </header>

            <div className="purchase-invoices-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={toolbarOutlineButtonClass}
                  disabled={loading}
                  onClick={() => void loadAlbaranes()}
                  title="Refrescar datos"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {loading ? 'Actualizando...' : 'Refrescar'}
                </button>
                <button
                  type="button"
                  className={toolbarFilterButtonClass(showFilters)}
                  onClick={() => setShowFilters((visible) => !visible)}
                >
                  <Filter className="h-4 w-4" />
                  Filtros
                  {activeFiltersCount > 0 ? (
                    <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {activeFiltersCount}
                    </span>
                  ) : null}
                </button>
              </div>
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  className={toolbarPrimaryButtonClass}
                  onClick={() => setShowUploadNotice(true)}
                >
                  <Plus className="h-4 w-4" />
                  Subir albarán
                </button>
              </div>
            </div>

            {showUploadNotice ? (
              <div className="flex items-start justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/35 dark:text-blue-200">
                <p>
                  La lectura de albaranes existentes está preparada para el próximo despliegue.
                  La subida y el análisis de nuevos PDFs todavía no están conectados.
                </p>
                <button
                  type="button"
                  className="shrink-0 rounded-md p-1 transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/50"
                  onClick={() => setShowUploadNotice(false)}
                  aria-label="Cerrar aviso"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            {showFilters ? (
              <section className="purchase-invoices-filter-panel relative z-20 overflow-visible rounded-lg border border-border bg-card shadow-sm">
                <div className="flex flex-row items-center justify-between border-b border-border px-5 py-4">
                  <h2 className="text-base font-semibold text-foreground">
                    Filtros de búsqueda
                  </h2>
                  {activeFiltersCount > 0 ? (
                    <button
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      onClick={resetFilters}
                    >
                      <X className="h-4 w-4" />
                      Limpiar filtros
                    </button>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-[minmax(14rem,0.85fr)_minmax(11rem,0.65fr)_minmax(11rem,0.65fr)_minmax(18rem,1.2fr)]">
                  <div className="space-y-2">
                    <Label>Código de agricultor</Label>
                    <Input
                      className={inputClass}
                      inputMode="numeric"
                      value={filters.agricultor}
                      onChange={(event) => updateFilter('agricultor', event.target.value)}
                      placeholder="Ej. 1680"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Serie</Label>
                    <Input
                      className={inputClass}
                      value={filters.serie}
                      onChange={(event) => updateFilter('serie', event.target.value)}
                      placeholder="Ej. A26"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Número</Label>
                    <Input
                      className={inputClass}
                      inputMode="numeric"
                      value={filters.numero}
                      onChange={(event) => updateFilter('numero', event.target.value)}
                      placeholder="Ej. 8436"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Fecha</Label>
                    <DateRangeFilter
                      desde={filters.fechaDesde}
                      hasta={filters.fechaHasta}
                      onChange={updateFilter}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {loadError ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span>{loadError}</span>
                  <button
                    type="button"
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-amber-200 bg-white px-3 text-xs font-bold text-amber-800 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                    onClick={() => void loadAlbaranes()}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Reintentar
                  </button>
                </div>
              </div>
            ) : null}

            <section className="purchase-invoices-list-panel flex min-h-[420px] flex-1 flex-col rounded-xl border border-border bg-background p-3 dark:border-slate-700 dark:bg-slate-950/60">
              <header className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1 text-sm font-semibold text-muted-foreground">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                    Bandeja de entrada
                  </p>
                  <span>
                    Mostrando {visibleStart}-{visibleEnd}
                    {total === null ? '' : ` de ${formatInteger(total)}`}
                  </span>
                </div>
              </header>

              {loading ? (
                <div className="grid min-h-[360px] flex-1 place-items-center rounded-xl border border-dashed border-border bg-muted/20 text-center text-sm font-semibold text-muted-foreground dark:border-slate-700">
                  <div>
                    <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
                    Cargando albaranes...
                  </div>
                </div>
              ) : albaranes.length === 0 ? (
                <div className="grid min-h-[360px] flex-1 place-items-center rounded-xl border border-dashed border-border bg-muted/20 px-4 text-center dark:border-slate-700">
                  <div className="max-w-sm">
                    <FileBox className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                    <h3 className="text-base font-bold text-foreground">
                      {activeFiltersCount > 0
                        ? 'No hay albaranes con estos filtros'
                        : 'No hay albaranes de entrada.'}
                    </h3>
                    <p className="mt-2 text-sm font-medium text-muted-foreground">
                      {activeFiltersCount > 0
                        ? 'Ajusta los filtros activos para ampliar el resultado.'
                        : 'Cuando se reciban o suban nuevos albaranes, aparecerán aquí.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {albaranes.map((albaran) => (
                    <AlbaranListItem
                      key={albaran.id}
                      albaran={albaran}
                      onOpen={openAlbaran}
                    />
                  ))}
                </div>
              )}
            </section>

            <footer className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-muted-foreground">
              <span>
                Página {page}
                {totalPages === null ? '' : ` de ${totalPages}`}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="w-40">
                  <FilterSelect
                    value={String(pageSize)}
                    options={PAGE_SIZE_OPTIONS}
                    onChange={(value) => {
                      setPageSize(Number(value));
                      setPage(1);
                    }}
                    ariaLabel="Albaranes por página"
                  />
                </div>
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-bold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                  disabled={!hasMore || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Albaranes() {
  const navigate = useNavigate();
  const { albaranId } = useParams<{ albaranId?: string }>();
  const parsedAlbaranId = albaranId ? Number(albaranId) : null;

  if (albaranId) {
    if (!Number.isInteger(parsedAlbaranId) || (parsedAlbaranId ?? 0) < 1) {
      return (
        <div className="min-h-[calc(100dvh-109px)] bg-white px-5 py-6 dark:bg-background md:px-6">
          <button
            type="button"
            className="-ml-2 inline-flex h-8 items-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-50"
            onClick={() => navigate(ROUTE_BASES.albaranes)}
          >
            <ArrowLeft size={16} />
            Volver
          </button>
          <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
            El identificador del albarán no es válido.
          </div>
        </div>
      );
    }

    return (
      <AlbaranDetail
        albaranId={parsedAlbaranId as number}
        onBack={() => navigate(ROUTE_BASES.albaranes)}
      />
    );
  }

  return <AlbaranesList />;
}
