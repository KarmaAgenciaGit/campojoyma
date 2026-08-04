import type { FacturaRecibidaAsientoLinea } from '@/services/apiContracts';

type AsientoContableTableProps = {
  lines: FacturaRecibidaAsientoLinea[];
  status?: string | null;
  error?: string | null;
  asientoNumero?: string | null;
  asientoFecha?: string | null;
  ejercicio?: number | null;
  centro?: number | null;
  documento?: string | null;
  totalDebe?: number | null;
  totalHaber?: number | null;
  balanced?: boolean | null;
  preview?: boolean;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('es-ES').format(parsed);
};

const hasValue = (value: unknown) =>
  value !== null && value !== undefined && String(value).trim() !== '';

export const AsientoContableTable = ({
  lines,
  status,
  error,
  asientoNumero,
  asientoFecha,
  ejercicio,
  centro,
  documento,
  totalDebe: suppliedTotalDebe,
  totalHaber: suppliedTotalHaber,
  balanced: suppliedBalanced,
  preview = false,
}: AsientoContableTableProps) => {
  if (lines.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        {preview
          ? 'No hay datos suficientes para previsualizar el asiento.'
          : status === 'unavailable'
          ? 'La contabilización no está disponible.'
          : status === 'reference_only'
            ? 'No se ha podido comprobar el detalle del asiento.'
            : status === 'error'
              ? error ?? 'No se ha podido comprobar el asiento.'
              : status === 'pending'
                ? 'Contabilización pendiente.'
                : status === 'created'
                  ? 'No se ha podido recuperar el detalle del asiento.'
                : 'Todavía no hay asiento contable.'}
      </div>
    );
  }

  const calculatedTotalDebe = lines.reduce((sum, line) => sum + Number(line.debe ?? 0), 0);
  const calculatedTotalHaber = lines.reduce((sum, line) => sum + Number(line.haber ?? 0), 0);
  const totalDebe =
    typeof suppliedTotalDebe === 'number' && Number.isFinite(suppliedTotalDebe)
      ? suppliedTotalDebe
      : calculatedTotalDebe;
  const totalHaber =
    typeof suppliedTotalHaber === 'number' && Number.isFinite(suppliedTotalHaber)
      ? suppliedTotalHaber
      : calculatedTotalHaber;
  const descuadre = Math.abs(totalDebe - totalHaber);
  const balanced = suppliedBalanced ?? descuadre <= 0.01;
  const formattedDate = formatDate(asientoFecha);
  const showTitle = lines.some((line) => hasValue(line.titulo));
  const showDocument = hasValue(documento) || lines.some((line) => hasValue(line.documento));
  const showActivity = lines.some((line) => hasValue(line.actividad_id));
  const showSection = lines.some((line) => hasValue(line.seccion_id));
  const tableLabel = asientoNumero
    ? `Detalle del asiento ${asientoNumero}`
    : 'Detalle del asiento contable';

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {asientoNumero
            ? `Asiento n.º ${asientoNumero}`
            : preview
              ? 'Vista previa del asiento'
              : 'Asiento contable'}
          {formattedDate ? (
            <span className="font-medium text-slate-500 dark:text-slate-400">
              {' '}con fecha {formattedDate}
            </span>
          ) : null}
        </p>
        {hasValue(ejercicio) || hasValue(centro) ? (
          <dl className="flex gap-5 text-xs text-slate-500 dark:text-slate-400">
            {hasValue(ejercicio) ? (
              <div className="flex gap-1">
                <dt>Ejercicio:</dt>
                <dd className="font-semibold text-slate-800 dark:text-slate-200">{ejercicio}</dd>
              </div>
            ) : null}
            {hasValue(centro) ? (
              <div className="flex gap-1">
                <dt>Centro:</dt>
                <dd className="font-semibold text-slate-800 dark:text-slate-200">{centro}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {status === 'error' ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {balanced
            ? 'El asiento está cuadrado, pero queda una comprobación contable pendiente.'
            : error ?? 'No se ha podido comprobar completamente el asiento.'}
        </div>
      ) : null}

      <div className="hidden overflow-x-auto md:block">
        <table aria-label={tableLabel} className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <th className="w-12 px-3 py-3">#</th>
              <th className="px-3 py-3">Cuenta</th>
              {showTitle ? <th className="px-3 py-3">Título</th> : null}
              <th className="px-3 py-3">Concepto</th>
              {showDocument ? <th className="px-3 py-3">Documento</th> : null}
              {showActivity ? <th className="w-16 px-3 py-3 text-center">Act.</th> : null}
              {showSection ? <th className="w-16 px-3 py-3 text-center">Secc.</th> : null}
              <th className="px-3 py-3 text-right">Debe</th>
              <th className="px-3 py-3 text-right">Haber</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {lines.map((line, index) => (
              <tr key={line.id ?? index} className="bg-white dark:bg-slate-950">
                <td className="px-3 py-3">{line.posicion}</td>
                <td className="whitespace-nowrap px-3 py-3 font-semibold">{line.cuenta ?? '—'}</td>
                {showTitle ? <td className="px-3 py-3">{line.titulo ?? '—'}</td> : null}
                <td className="px-3 py-3">{line.descripcion ?? '—'}</td>
                {showDocument ? (
                  <td className="whitespace-nowrap px-3 py-3">{line.documento ?? documento ?? '—'}</td>
                ) : null}
                {showActivity ? <td className="px-3 py-3 text-center">{line.actividad_id ?? '—'}</td> : null}
                {showSection ? <td className="px-3 py-3 text-center">{line.seccion_id ?? '—'}</td> : null}
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatMoney(line.debe)}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatMoney(line.haber)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-slate-200 md:hidden dark:divide-slate-800">
        {lines.map((line, index) => (
          <div key={line.id ?? index} className="px-4 py-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  <span className="mr-2 text-xs text-slate-400">{line.posicion}</span>
                  {line.cuenta ?? 'Cuenta sin indicar'}
                </p>
                {line.titulo ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{line.titulo}</p> : null}
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-4 text-right text-xs">
                <div>
                  <p className="text-slate-400">Debe</p>
                  <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{formatMoney(line.debe)}</p>
                </div>
                <div>
                  <p className="text-slate-400">Haber</p>
                  <p className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">{formatMoney(line.haber)}</p>
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              {line.descripcion ? <span>{line.descripcion}</span> : null}
              {showDocument ? <span>Documento: {line.documento ?? documento ?? '—'}</span> : null}
              {showActivity ? <span>Act.: {line.actividad_id ?? '—'}</span> : null}
              {showSection ? <span>Secc.: {line.seccion_id ?? '—'}</span> : null}
            </div>
          </div>
        ))}
      </div>

      <dl className="grid grid-cols-1 gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
          <dt className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Total debe</dt>
          <dd className="mt-1 font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatMoney(totalDebe)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
          <dt className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Total haber</dt>
          <dd className="mt-1 font-bold tabular-nums text-slate-900 dark:text-slate-100">{formatMoney(totalHaber)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 sm:block sm:text-right">
          <dt className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Descuadre</dt>
          <dd className={`mt-1 font-bold tabular-nums ${balanced ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
            {formatMoney(descuadre)}
          </dd>
        </div>
      </dl>
    </div>
  );
};
