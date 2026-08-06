import { AlertCircle, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';

import { isFacturaERPDuplicateIssue } from '@/lib/facturasDuplicate';
import { sanitizeUserFacingErrorMessage } from '@/lib/userFacingErrors';
import type { FacturaValidationIssue } from '@/services/apiContracts';

export type FacturaIssuesOverlayProps = {
  actionError?: string | null;
  erpError?: string | null;
  errors: FacturaValidationIssue[];
  warnings: FacturaValidationIssue[];
  catalogError?: string | null;
  catalogErrorTitle?: string;
  catalogLoading?: boolean;
  onRetryCatalog?: () => void;
};

const cardBaseClass =
  'pointer-events-auto animate-in fade-in-0 slide-in-from-right-full rounded-md border px-4 py-3 text-sm shadow-[0_18px_45px_-18px_rgba(15,23,42,0.45)] duration-300 motion-reduce:animate-none';

const validationIssueMessage = (issue: FacturaValidationIssue): string =>
  sanitizeUserFacingErrorMessage(issue.message);

export function FacturaIssuesOverlay({
  actionError = null,
  erpError = null,
  errors,
  warnings,
  catalogError = null,
  catalogErrorTitle = 'Catálogos ERP no disponibles',
  catalogLoading = false,
  onRetryCatalog,
}: FacturaIssuesOverlayProps) {
  const displayedErrors = errors.filter(
    (issue) => !isFacturaERPDuplicateIssue(issue),
  );
  const displayedWarnings = warnings.filter(
    (issue) => !isFacturaERPDuplicateIssue(issue),
  );

  if (!actionError && !erpError && displayedErrors.length === 0 && displayedWarnings.length === 0 && !catalogError) {
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

      {displayedErrors.length > 0 ? (
        <section
          role="alert"
          className={`${cardBaseClass} border-red-200 bg-red-50/95 text-red-800 backdrop-blur-sm dark:border-red-900/60 dark:bg-red-950/90 dark:text-red-100`}
        >
          <div className="flex items-start gap-3">
            <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">Error</p>
              {displayedErrors.length === 1 ? (
                <p className="mt-1 break-words">
                  {validationIssueMessage(displayedErrors[0])}
                </p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {displayedErrors.map((issue) => (
                    <li key={issue.code ?? `${issue.field}:${issue.message}`} className="break-words">
                      {validationIssueMessage(issue)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {displayedWarnings.length > 0 ? (
        <section
          role="status"
          className={`${cardBaseClass} border-amber-200 bg-amber-50/95 text-amber-950 backdrop-blur-sm dark:border-amber-900/60 dark:bg-amber-950/90 dark:text-amber-100`}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-bold">Avisos de revisión</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {displayedWarnings.map((issue) => (
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
