import type { FacturaRecibidaAsientoLinea } from '@/services/apiContracts';

type AsientoContableTableProps = {
  lines: FacturaRecibidaAsientoLinea[];
  status?: string | null;
  error?: string | null;
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);

export const AsientoContableTable = ({ lines, status, error }: AsientoContableTableProps) => {
  if (lines.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
        {status === 'unavailable'
          ? 'El ERP no expone todavía el detalle oficial del asiento.'
          : status === 'reference_only'
            ? 'El ERP solo devuelve el identificador técnico; no se puede acreditar el asiento visible ni sus apuntes.'
          : status === 'error'
            ? error ?? 'No se pudo leer el asiento desde el ERP.'
            : 'El asiento real se mostrará aquí después de leerlo del ERP.'}
      </div>
    );
  }

  const totalDebe = lines.reduce((sum, line) => sum + Number(line.debe ?? 0), 0);
  const totalHaber = lines.reduce((sum, line) => sum + Number(line.haber ?? 0), 0);
  const balanced = Math.abs(totalDebe - totalHaber) <= 0.01;

  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs font-bold uppercase text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <th className="w-12 px-3 py-3">#</th>
            <th className="px-3 py-3">Cuenta</th>
            <th className="px-3 py-3">Concepto</th>
            <th className="px-3 py-3 text-right">Debe</th>
            <th className="px-3 py-3 text-right">Haber</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {lines.map((line, index) => (
            <tr key={line.id ?? index} className="bg-white dark:bg-slate-950">
              <td className="px-3 py-3">{line.posicion}</td>
              <td className="px-3 py-3 font-semibold">{line.cuenta ?? '-'}</td>
              <td className="px-3 py-3">{line.descripcion ?? '-'}</td>
              <td className="px-3 py-3 text-right">{formatMoney(line.debe)}</td>
              <td className="px-3 py-3 text-right">{formatMoney(line.haber)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-200 bg-slate-50 font-bold dark:border-slate-800 dark:bg-slate-900">
            <td className="px-3 py-3" colSpan={3}>
              {balanced ? 'Asiento cuadrado' : `Descuadre: ${formatMoney(Math.abs(totalDebe - totalHaber))}`}
            </td>
            <td className="px-3 py-3 text-right">{formatMoney(totalDebe)}</td>
            <td className="px-3 py-3 text-right">{formatMoney(totalHaber)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
