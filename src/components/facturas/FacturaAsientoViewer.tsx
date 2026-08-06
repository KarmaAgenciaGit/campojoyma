import { useEffect, useMemo, useState } from 'react';
import { Eye, LoaderCircle } from 'lucide-react';

import {
  buildFacturaAsientoPreview,
  facturaIvaPercentageKey,
  getFacturaAsientoPreviewIvaPercentages,
} from '@/lib/facturasAsientoPreview';
import { sanitizeUserFacingErrorMessage } from '@/lib/userFacingErrors';
import { fetchFacturaCuentaIvaHistorica } from '@/services/facturas';
import type {
  FacturaRecibida,
  FacturaRecibidaLinea,
} from '@/services/apiContracts';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import { AsientoContableTable } from './AsientoContableTable';

type FacturaAsientoViewerProps = {
  factura: Partial<FacturaRecibida>;
  gastos: FacturaRecibidaLinea[];
};

const positiveInteger = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const cleanText = (value: unknown): string | null => {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
};

export const FacturaAsientoViewer = ({
  factura,
  gastos,
}: FacturaAsientoViewerProps) => {
  const [open, setOpen] = useState(false);
  const [loadingIvaAccounts, setLoadingIvaAccounts] = useState(false);
  const [ivaAccountsByPercentage, setIvaAccountsByPercentage] = useState<
    Record<string, string>
  >({});
  const realLines = factura.asiento_lineas ?? factura.accounting?.lines ?? [];
  const hasRealAsiento =
    realLines.length > 0 ||
    factura.accounting?.created === true ||
    factura.asiento_estado === 'created';
  const ivaAccountRequest = useMemo(() => {
    if (hasRealAsiento) return null;
    const empresaId = positiveInteger(factura.fr_alm);
    const ejercicio = positiveInteger(factura.ejercicio);
    const regimenId = positiveInteger(factura.tipo_iva_codigo);
    const tipoFactura = cleanText(factura.fr_sufa)?.toUpperCase() ?? null;
    const porcentajes = getFacturaAsientoPreviewIvaPercentages(factura);
    if (
      empresaId === null ||
      ejercicio === null ||
      regimenId === null ||
      tipoFactura === null ||
      porcentajes.length === 0
    ) {
      return null;
    }
    return { empresaId, ejercicio, regimenId, tipoFactura, porcentajes };
  }, [factura, hasRealAsiento]);

  useEffect(() => {
    if (!open || ivaAccountRequest === null) {
      setLoadingIvaAccounts(false);
      setIvaAccountsByPercentage((current) =>
        Object.keys(current).length > 0 ? {} : current,
      );
      return;
    }

    let cancelled = false;
    setLoadingIvaAccounts(true);
    setIvaAccountsByPercentage({});

    void Promise.all(
      ivaAccountRequest.porcentajes.map(async (porcentaje) => {
        try {
          const result = await fetchFacturaCuentaIvaHistorica({
            empresaId: ivaAccountRequest.empresaId,
            ejercicio: ivaAccountRequest.ejercicio,
            regimenId: ivaAccountRequest.regimenId,
            tipoFactura: ivaAccountRequest.tipoFactura,
            porcentaje,
          });
          return result.estado === 'resuelta' && result.cuenta
            ? { porcentaje, cuenta: result.cuenta }
            : null;
        } catch {
          // La vista previa sigue siendo util sin cuenta. Los fallos de lectura
          // nunca deben bloquear el modal ni inventar una resolucion local.
          return null;
        }
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const resolvedAccounts: Record<string, string> = {};
        results.forEach((result) => {
          if (result) {
            resolvedAccounts[facturaIvaPercentageKey(result.porcentaje)] =
              result.cuenta;
          }
        });
        setIvaAccountsByPercentage(resolvedAccounts);
      })
      .finally(() => {
        if (!cancelled) setLoadingIvaAccounts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ivaAccountRequest, open]);

  const preview = useMemo(
    () =>
      buildFacturaAsientoPreview(factura, gastos, {
        ivaAccountsByPercentage,
      }),
    [factura, gastos, ivaAccountsByPercentage],
  );
  const lines = hasRealAsiento ? realLines : preview.lines;
  const title = hasRealAsiento
    ? 'Asiento contable'
    : 'Vista previa del asiento';
  const description = hasRealAsiento
    ? 'Asiento registrado en Netagro.'
    : 'Calculado con los datos actuales de la factura. Aún no se ha registrado.';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-50"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          Ver asiento
        </button>
      </DialogTrigger>

      <DialogContent
        className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-[1240px] flex-col gap-0 overflow-hidden p-0"
        overlayClassName="bg-slate-950/55"
      >
        <DialogHeader className="shrink-0 border-b border-slate-200 px-5 py-4 text-left dark:border-slate-800 sm:px-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {!hasRealAsiento ? (
            <div
              role="status"
              aria-busy={loadingIvaAccounts}
              className="mb-4 flex min-h-10 items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/35 dark:text-blue-200"
            >
              <span>Vista previa calculada con los datos actuales.</span>
              {loadingIvaAccounts ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-normal text-blue-700 dark:text-blue-300">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Consultando cuentas de IVA…
                </span>
              ) : null}
            </div>
          ) : null}

          <AsientoContableTable
            lines={lines}
            status={hasRealAsiento ? factura.asiento_estado : 'preview'}
            preview={!hasRealAsiento}
            asientoNumero={hasRealAsiento ? factura.asiento_numero : null}
            asientoFecha={
              hasRealAsiento
                ? factura.asiento_fecha
                : factura.fecha_ctb ?? factura.fecha_factura
            }
            ejercicio={factura.ejercicio}
            centro={factura.centro}
            documento={factura.numero_factura}
            totalDebe={
              hasRealAsiento ? factura.asiento_total_debe : preview.totalDebe
            }
            totalHaber={
              hasRealAsiento ? factura.asiento_total_haber : preview.totalHaber
            }
            balanced={
              hasRealAsiento ? factura.asiento_cuadrado : preview.balanced
            }
            error={
              factura.accounting?.error
                ? sanitizeUserFacingErrorMessage(factura.accounting.error)
                : null
            }
          />
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-200 px-5 py-3 dark:border-slate-800 sm:px-6">
          <DialogClose asChild>
            <button
              type="button"
              className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              Cerrar
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
