import { Fragment, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';

import type {
  AlbaranEntradaLineaERP,
  FacturaRecibidaPunteo,
  FacturaRecibidaPunteoLinea,
} from '@/services/apiContracts';

type LinesState<T> =
  | { status: 'loading'; items: T[] }
  | { status: 'success'; items: T[] }
  | { status: 'error'; items: T[] };

type EntryLinesState = LinesState<AlbaranEntradaLineaERP>;
type MaterialLinesState = LinesState<FacturaRecibidaPunteoLinea>;

export type FacturaPunteosTableProps = {
  punteos: FacturaRecibidaPunteo[];
  readOnly: boolean;
  selectedCount: number;
  selectedTotal: number;
  baseDifference: number;
  expensesDifference: number;
  onSelectionChange: (punteo: FacturaRecibidaPunteo, selected: boolean) => void;
  loadEntryLines: (albaranId: number) => Promise<AlbaranEntradaLineaERP[]>;
  loadMaterialLines: (sourceId: number) => Promise<FacturaRecibidaPunteoLinea[]>;
  formatMoney?: (value?: number | null) => string;
  formatDate?: (value?: string | null) => string;
};

const defaultFormatMoney = (value?: number | null) =>
  new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(Number(value ?? 0));

const defaultFormatDate = (value?: string | null) => {
  if (!value) return '-';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
};

const formatNumber = (
  value: number | null | undefined,
  minimumFractionDigits = 0,
  maximumFractionDigits = 2,
) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '-';
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(Number(value));
};

const punteoKey = (punteo: FacturaRecibidaPunteo, index: number) =>
  punteo.id ??
  `${punteo.source_table ?? 'punteo'}:${punteo.source_id ?? punteo.remote_id ?? index}`;

const validAlbaranId = (punteo: FacturaRecibidaPunteo) => {
  const sourceTable = punteo.source_table?.trim().toLowerCase();
  if (!['albentrada', 'albentrada_his', 'albentrada_hisgastos'].includes(sourceTable ?? '')) {
    return null;
  }
  const parsed = Number(punteo.albaran_id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const validMaterialSourceId = (punteo: FacturaRecibidaPunteo) => {
  if (punteo.source_table?.trim().toLowerCase() !== 'albmaterial') return null;
  const parsed = Number(punteo.source_id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const selectablePunteoSources = new Set([
  'albsalida_gastos',
  'albentrada_hisgastos',
  'albaranescompra_gastos',
  'facturas_gastos',
  'albarancoste',
  'albmaterial',
]);

const isSelectablePunteo = (punteo: FacturaRecibidaPunteo) =>
  selectablePunteoSources.has(punteo.source_table?.trim().toLowerCase() ?? '');

const categoriaLabel = (line: AlbaranEntradaLineaERP) =>
  line.categoria_calibre_nombre ??
  ([line.categoria_nombre, line.categoria_calibre].filter(Boolean).join(' · ') || '-');

const generoCode = (line: AlbaranEntradaLineaERP) =>
  line.genero_id === null || line.genero_id === undefined ? '-' : String(line.genero_id);

const envaseLabel = (line: AlbaranEntradaLineaERP) =>
  line.envase_nombre ??
  (line.envase_id === null || line.envase_id === undefined ? '-' : String(line.envase_id));

const LineValue = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {label}
    </dt>
    <dd className="mt-0.5 break-words text-xs font-medium leading-4 text-slate-900 dark:text-slate-100">
      {value}
    </dd>
  </div>
);

const EntryLinesGrid = ({
  albaranId,
  state,
  onRetry,
  formatMoney,
}: {
  albaranId: number;
  state: EntryLinesState | undefined;
  onRetry: () => void;
  formatMoney: NonNullable<FacturaPunteosTableProps['formatMoney']>;
}) => {
  if (!state || state.status === 'loading') {
    return (
      <div
        className="flex items-center gap-2 px-4 py-4 text-sm font-semibold text-slate-600 dark:text-slate-300"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Consultando líneas del albarán…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300" role="alert">
          No se pudieron cargar las líneas del albarán.
        </p>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/30 dark:border-rose-400/30 dark:bg-slate-950 dark:text-rose-300 dark:hover:bg-rose-500/10"
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Reintentar
        </button>
      </div>
    );
  }

  if (state.items.length === 0) {
    return (
      <p className="px-4 py-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
        Este albarán no tiene líneas.
      </p>
    );
  }

  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-800" role="list">
      {state.items.map((line, index) => (
        <dl
          key={line.id ?? `${albaranId}-${line.linea ?? index}`}
          className="grid gap-x-4 gap-y-2.5 px-4 py-3 sm:grid-cols-4 xl:grid-cols-7"
          role="listitem"
        >
          <LineValue label="Línea" value={formatNumber(line.linea)} />
          <LineValue label="Partida" value={formatNumber(line.partida)} />
          <LineValue label="Género" value={generoCode(line)} />
          <LineValue label="Nombre género" value={line.genero_nombre ?? '-'} />
          <LineValue label="Categoría / calibre" value={categoriaLabel(line)} />
          <LineValue label="Envase" value={envaseLabel(line)} />
          <LineValue label="TCUL" value={line.tipo_cultivo_abreviatura ?? '-'} />
          <LineValue label="PCAL" value={line.tipo_cultivo_nombre ?? '-'} />
          <LineValue label="Calidad" value={line.calidad_codigo ?? '-'} />
          <LineValue label="Bultos" value={formatNumber(line.bultos)} />
          <LineValue label="Kilos netos" value={formatNumber(line.kilos_netos, 2)} />
          <LineValue label="Kilos brutos" value={formatNumber(line.kilos_brutos, 2)} />
          <LineValue label="Precio" value={formatMoney(line.precio)} />
          <LineValue label="Importe" value={formatMoney(line.importe)} />
        </dl>
      ))}
    </div>
  );
};

const MaterialLinesGrid = ({
  lines,
  formatMoney,
}: {
  lines: FacturaRecibidaPunteoLinea[];
  formatMoney: NonNullable<FacturaPunteosTableProps['formatMoney']>;
}) => {
  if (lines.length === 0) {
    return (
      <p className="px-4 py-4 text-sm font-semibold text-slate-500 dark:text-slate-400">
        Este albarán no tiene líneas.
      </p>
    );
  }

  return (
    <div className="divide-y divide-slate-200 dark:divide-slate-800" role="list">
      {lines.map((line, index) => (
        <dl
          key={line.id ?? `${line.posicion ?? index}-${line.articulo_id ?? 'linea'}`}
          className="grid grid-cols-[40px_55px_minmax(110px,1.5fr)_minmax(80px,1fr)_65px_55px_65px_minmax(75px,1fr)] gap-x-2 px-4 py-2.5"
          role="listitem"
        >
          <LineValue label="Línea" value={formatNumber(line.posicion ?? index + 1)} />
          <LineValue
            label="Artículo"
            value={line.articulo_id === null || line.articulo_id === undefined ? '-' : String(line.articulo_id)}
          />
          <LineValue label="Descripción" value={line.descripcion ?? '-'} />
          <LineValue label="Referencia" value={line.referencia ?? '-'} />
          <LineValue label="Cantidad" value={formatNumber(line.cantidad, 2, 4)} />
          <LineValue label="Precio" value={formatMoney(line.precio)} />
          <LineValue label="Importe" value={formatMoney(line.importe)} />
          {line.observaciones ? <LineValue label="Observaciones" value={line.observaciones} /> : null}
        </dl>
      ))}
    </div>
  );
};

const MaterialLinesDetail = ({
  state,
  onRetry,
  formatMoney,
}: {
  state: MaterialLinesState | undefined;
  onRetry: () => void;
  formatMoney: NonNullable<FacturaPunteosTableProps['formatMoney']>;
}) => {
  if (!state || state.status === 'loading') {
    return (
      <div
        className="flex items-center gap-2 px-4 py-4 text-sm font-semibold text-slate-600 dark:text-slate-300"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Consultando líneas del albarán…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300" role="alert">
          No se pudieron cargar las líneas del albarán.
        </p>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/30 dark:border-rose-400/30 dark:bg-slate-950 dark:text-rose-300 dark:hover:bg-rose-500/10"
          onClick={onRetry}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Reintentar
        </button>
      </div>
    );
  }

  return <MaterialLinesGrid lines={state.items} formatMoney={formatMoney} />;
};

export const FacturaPunteosTable = ({
  punteos,
  readOnly,
  selectedCount,
  selectedTotal,
  baseDifference,
  expensesDifference,
  onSelectionChange,
  loadEntryLines,
  loadMaterialLines,
  formatMoney = defaultFormatMoney,
  formatDate = defaultFormatDate,
}: FacturaPunteosTableProps) => {
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [linesByAlbaranId, setLinesByAlbaranId] = useState<
    Record<number, EntryLinesState>
  >({});
  const [materialLinesBySourceId, setMaterialLinesBySourceId] = useState<
    Record<number, MaterialLinesState>
  >({});
  const entryRequestRunsRef = useRef(new Map<number, number>());
  const materialRequestRunsRef = useRef(new Map<number, number>());
  const mountedRef = useRef(true);

  useEffect(() => {
    const entryRequestRuns = entryRequestRunsRef.current;
    const materialRequestRuns = materialRequestRunsRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      entryRequestRuns.clear();
      materialRequestRuns.clear();
    };
  }, []);

  const requestEntryLines = async (albaranId: number) => {
    const runId = (entryRequestRunsRef.current.get(albaranId) ?? 0) + 1;
    entryRequestRunsRef.current.set(albaranId, runId);
    setLinesByAlbaranId((current) => ({
      ...current,
      [albaranId]: {
        status: 'loading',
        items: current[albaranId]?.items ?? [],
      },
    }));

    try {
      const items = await loadEntryLines(albaranId);
      if (!mountedRef.current || entryRequestRunsRef.current.get(albaranId) !== runId) return;
      setLinesByAlbaranId((current) => ({
        ...current,
        [albaranId]: {
          status: 'success',
          items: Array.isArray(items) ? items : [],
        },
      }));
    } catch {
      if (!mountedRef.current || entryRequestRunsRef.current.get(albaranId) !== runId) return;
      setLinesByAlbaranId((current) => ({
        ...current,
        [albaranId]: {
          status: 'error',
          items: current[albaranId]?.items ?? [],
        },
      }));
    }
  };

  const requestMaterialLines = async (sourceId: number) => {
    const runId = (materialRequestRunsRef.current.get(sourceId) ?? 0) + 1;
    materialRequestRunsRef.current.set(sourceId, runId);
    setMaterialLinesBySourceId((current) => ({
      ...current,
      [sourceId]: {
        status: 'loading',
        items: current[sourceId]?.items ?? [],
      },
    }));

    try {
      const items = await loadMaterialLines(sourceId);
      if (!mountedRef.current || materialRequestRunsRef.current.get(sourceId) !== runId) return;
      setMaterialLinesBySourceId((current) => ({
        ...current,
        [sourceId]: {
          status: 'success',
          items: Array.isArray(items) ? items : [],
        },
      }));
    } catch {
      if (!mountedRef.current || materialRequestRunsRef.current.get(sourceId) !== runId) return;
      setMaterialLinesBySourceId((current) => ({
        ...current,
        [sourceId]: {
          status: 'error',
          items: current[sourceId]?.items ?? [],
        },
      }));
    }
  };

  const toggleLines = (
    rowKey: string,
    albaranId: number | null,
    materialSourceId: number | null,
  ) => {
    if (expandedRowKey === rowKey) {
      setExpandedRowKey(null);
      return;
    }

    setExpandedRowKey(rowKey);
    if (albaranId !== null && !linesByAlbaranId[albaranId]) {
      void requestEntryLines(albaranId);
    } else if (
      materialSourceId !== null &&
      !materialLinesBySourceId[materialSourceId]
    ) {
      void requestMaterialLines(materialSourceId);
    }
  };

  if (punteos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        Sin albaranes/gastos para puntear recibidos desde API.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <th className="px-3 py-3">Origen</th>
            <th className="px-3 py-3">Serie</th>
            <th className="px-3 py-3">Albarán</th>
            <th className="px-3 py-3">Ref.</th>
            <th className="px-3 py-3">Fecha</th>
            <th className="px-3 py-3 text-right">Importe P</th>
            <th className="px-3 py-3 text-right">Importe</th>
            <th className="px-3 py-3 text-center">S</th>
            <th className="px-3 py-3 text-center">Ver</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {punteos.map((punteo, index) => {
            const rowKey = punteoKey(punteo, index);
            const albaranId = validAlbaranId(punteo);
            const materialSourceId = validMaterialSourceId(punteo);
            const detailsAvailable = albaranId !== null || materialSourceId !== null;
            const selectable = isSelectablePunteo(punteo);
            const expanded = detailsAvailable && expandedRowKey === rowKey;
            const detailsId =
              `punteo-lineas-${index}-${albaranId ?? `material-${materialSourceId ?? 'none'}`}`;

            return (
              <Fragment key={rowKey}>
                <tr className="bg-white dark:bg-slate-950">
                  <td className="px-3 py-3">{punteo.origen ?? '-'}</td>
                  <td className="px-3 py-3">{punteo.serie ?? '-'}</td>
                  <td className="px-3 py-3">{punteo.albaran ?? '-'}</td>
                  <td className="px-3 py-3">{punteo.ref ?? '-'}</td>
                  <td className="px-3 py-3">{formatDate(punteo.fecha)}</td>
                  <td className="px-3 py-3 text-right">{formatMoney(punteo.importe_punteado)}</td>
                  <td className="px-3 py-3 text-right">{formatMoney(punteo.importe)}</td>
                  <td className="px-3 py-3 text-center">
                    {readOnly || !selectable ? (
                      <span
                        title={
                          selectable
                            ? undefined
                            : 'Referencia de entrada de solo lectura; no se puede seleccionar para enviar al ERP.'
                        }
                      >
                        {punteo.seleccionado ? 'Sí' : 'No'}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                        checked={punteo.seleccionado}
                        onChange={(event) => onSelectionChange(punteo, event.target.checked)}
                        aria-label={`Seleccionar punteo ${punteo.albaran ?? punteo.source_id ?? index + 1}`}
                      />
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {!detailsAvailable ? (
                      <span className="text-slate-400" aria-label="Detalle no disponible">
                        -
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-bold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        aria-expanded={expanded}
                        aria-controls={detailsId}
                        onClick={() => toggleLines(rowKey, albaranId, materialSourceId)}
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                          aria-hidden
                        />
                        {expanded ? 'Ocultar' : 'Ver líneas'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded ? (
                  <tr className="bg-slate-50/80 dark:bg-slate-900/60">
                    <td className="p-0" colSpan={9}>
                      <div
                        id={detailsId}
                        role="region"
                        aria-label={`Líneas del albarán ${punteo.albaran ?? albaranId}`}
                      >
                        {albaranId !== null ? (
                          <EntryLinesGrid
                            albaranId={albaranId}
                            state={linesByAlbaranId[albaranId]}
                            onRetry={() => void requestEntryLines(albaranId)}
                            formatMoney={formatMoney}
                          />
                        ) : materialSourceId !== null ? (
                          <MaterialLinesDetail
                            state={materialLinesBySourceId[materialSourceId]}
                            onRetry={() => void requestMaterialLines(materialSourceId)}
                            formatMoney={formatMoney}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 bg-slate-50 text-sm font-bold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
            <td className="px-3 py-3" colSpan={5}>
              Total seleccionado: {selectedCount}
            </td>
            <td />
            <td className="px-3 py-3 text-right">{formatMoney(selectedTotal)}</td>
            <td colSpan={2} />
          </tr>
          <tr className="border-t border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <td className="px-3 pb-3" colSpan={9}>
              Diferencia frente a base: {formatMoney(baseDifference)} · Diferencia frente a gastos:{' '}
              {formatMoney(expensesDifference)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
