import { AlertCircle, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

import { sanitizeUserFacingErrorMessage } from '@/lib/userFacingErrors';
import type { FacturaValidationIssue } from '@/services/apiContracts';
import type { FacturaERPDuplicateCandidate } from '@/services/facturas';

export type FacturaIssuesOverlayProps = {
  actionError?: string | null;
  erpError?: string | null;
  errors: FacturaValidationIssue[];
  warnings: FacturaValidationIssue[];
  duplicateCandidate?: FacturaERPDuplicateCandidate | null;
  catalogError?: string | null;
  catalogErrorTitle?: string;
  catalogLoading?: boolean;
  onRetryCatalog?: () => void;
};

const cardBaseClass =
  'pointer-events-auto animate-in fade-in-0 slide-in-from-right-full rounded-md border px-4 py-3 text-sm shadow-[0_18px_45px_-18px_rgba(15,23,42,0.45)] duration-300 motion-reduce:animate-none';

const positiveInteger = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const duplicateInvoiceNumber = (
  issue: FacturaValidationIssue,
  duplicateCandidate: FacturaERPDuplicateCandidate | null,
): number | null => {
  const candidates = Array.isArray(issue.details?.candidates) ? issue.details.candidates : [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const record = candidate as Record<string, unknown>;
    const number = positiveInteger(record.FRR_numero ?? record.frr_numero ?? record.numero);
    if (number) return number;
  }

  const numberFromMessage = issue.message.match(/n[uú]mero\s+ERP\s+(\d+)/i)?.[1];
  const parsedMessageNumber = positiveInteger(numberFromMessage);
  if (parsedMessageNumber) return parsedMessageNumber;

  return positiveInteger(duplicateCandidate?.numero);
};

const validationIssueMessage = (
  issue: FacturaValidationIssue,
  duplicateCandidate: FacturaERPDuplicateCandidate | null,
): string => {
  const normalizedMessage = issue.message.trim().toLocaleLowerCase('es');
  const isDuplicateInvoice =
    issue.code?.trim().toLowerCase() === 'duplicate_invoice' ||
    normalizedMessage.includes('la factura ya existe en erp');

  if (isDuplicateInvoice) {
    const number = duplicateInvoiceNumber(issue, duplicateCandidate);
    return number ? `Factura ya registrada (${number})` : 'Factura ya registrada';
  }

  return sanitizeUserFacingErrorMessage(issue.message);
};

export function FacturaIssuesOverlay({
  actionError = null,
  erpError = null,
  errors,
  warnings,
  duplicateCandidate = null,
  catalogError = null,
  catalogErrorTitle = 'Catálogos ERP no disponibles',
  catalogLoading = false,
  onRetryCatalog,
}: FacturaIssuesOverlayProps) {
  if (!actionError && !erpError && errors.length === 0 && warnings.length === 0 && !catalogError) {
    return null;
  }

  return (
    <aside
      aria-label="Incidencias de la factura"
      className="pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] right-[max(0.75rem,env(safe-area-inset-right))] z-30 flex max-h-[min(44dvh,30rem)] flex-col gap-2 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 sm:bottom-[max(1.25rem,env(safe-area-inset-bottom))] sm:left-auto sm:right-[max(1.25rem,env(safe-area-inset-right))] sm:w-[min(48rem,calc(100vw-2.5rem))]"
      data-testid="factura-issues-overlay"
      tabIndex={0}
    >
      {actionError ? (
        <section
          role="alert"
          className={`${cardBaseClass} border-red-200 bg-red-50/95 text-red-800 backdrop-blur-sm dark:border-red-900/60 dark:bg-red-950/90 dark:text-red-100`}
        >
          <div className="flex items-start gap-3">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-bold">No se pudo completar la acción</p>
              <p className="mt-1 break-words">{sanitizeUserFacingErrorMessage(actionError)}</p>
            </div>
          </div>
        </section>
      ) : null}

      {erpError ? (
        <section
          role="alert"
          className={`${cardBaseClass} border-red-200 bg-red-50/95 text-red-800 backdrop-blur-sm dark:border-red-900/60 dark:bg-red-950/90 dark:text-red-100`}
        >
          <div className="flex items-start gap-3">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-bold">Error ERP</p>
              <p className="mt-1 break-words">{sanitizeUserFacingErrorMessage(erpError)}</p>
            </div>
          </div>
        </section>
      ) : null}

      {errors.length > 0 ? (
        <section
          role="alert"
          className={`${cardBaseClass} border-red-200 bg-red-50/95 text-red-800 backdrop-blur-sm dark:border-red-900/60 dark:bg-red-950/90 dark:text-red-100`}
        >
          <div className="flex items-start gap-3">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">Error</p>
              {errors.length === 1 ? (
                <p className="mt-1 break-words">
                  {validationIssueMessage(errors[0], duplicateCandidate)}
                </p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {errors.map((issue) => (
                    <li key={issue.code ?? `${issue.field}:${issue.message}`} className="break-words">
                      {validationIssueMessage(issue, duplicateCandidate)}
                    </li>
                  ))}
                </ul>
              )}
              {duplicateCandidate ? (
                <div className="mt-3 border-t border-red-200/80 pt-2 dark:border-red-900/70">
                  <p className="font-bold">Candidato encontrado en ERP</p>
                  <p className="mt-1 break-words">
                    Empresa {duplicateCandidate.empresaId ?? '-'} · Ejercicio {duplicateCandidate.ejercicio ?? '-'} · Proveedor{' '}
                    {duplicateCandidate.proveedorId ?? '-'}
                    {duplicateCandidate.proveedor ? ` (${duplicateCandidate.proveedor})` : ''} · Factura{' '}
                    {duplicateCandidate.numeroFactura ?? '-'} · FRR_id {duplicateCandidate.frrId}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section
          role="status"
          className={`${cardBaseClass} border-amber-200 bg-amber-50/95 text-amber-950 backdrop-blur-sm dark:border-amber-900/60 dark:bg-amber-950/90 dark:text-amber-100`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-bold">Avisos de revisión</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {warnings.map((issue) => (
                  <li key={issue.code ?? `${issue.field}:${issue.message}`} className="break-words">
                    {sanitizeUserFacingErrorMessage(issue.message)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {catalogError ? (
        <section
          role="status"
          className={`${cardBaseClass} border-amber-200 bg-amber-50/95 text-amber-950 backdrop-blur-sm dark:border-amber-900/60 dark:bg-amber-950/90 dark:text-amber-100`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold">{catalogErrorTitle}</p>
                <p className="mt-1 break-words">{catalogError}</p>
              </div>
            </div>
            {onRetryCatalog ? (
              <button
                type="button"
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-amber-300 bg-white px-3 text-xs font-bold text-amber-950 shadow-sm transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/60"
                disabled={catalogLoading}
                onClick={onRetryCatalog}
              >
                {catalogLoading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
                {catalogLoading ? 'Reintentando...' : 'Reintentar'}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
