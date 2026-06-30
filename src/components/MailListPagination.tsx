import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type MailListPaginationProps = {
  currentPage: number;
  totalPages: number;
  totalMessages: number;
  currentCount: number;
  pageSize: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
};

const clampPage = (value: number, totalPages: number) => {
  const safeTotalPages = Math.max(1, totalPages);
  return Math.min(Math.max(1, Math.trunc(value)), safeTotalPages);
};

const MailListPagination = ({
  currentPage,
  totalPages,
  totalMessages,
  currentCount,
  pageSize,
  disabled = false,
  onPageChange,
}: MailListPaginationProps) => {
  const safeTotalPages = Math.max(1, totalPages);
  const safeCurrentPage = clampPage(currentPage, safeTotalPages);
  const start = totalMessages > 0 ? (safeCurrentPage - 1) * pageSize + 1 : 0;
  const end = totalMessages > 0 ? Math.min(totalMessages, start + Math.max(0, currentCount) - 1) : 0;
  const [pageInput, setPageInput] = useState(String(safeCurrentPage));

  useEffect(() => {
    setPageInput(String(safeCurrentPage));
  }, [safeCurrentPage]);

  const submitPage = () => {
    if (!pageInput.trim()) {
      setPageInput(String(safeCurrentPage));
      return;
    }

    const parsedPage = Number(pageInput);
    if (!Number.isFinite(parsedPage)) {
      setPageInput(String(safeCurrentPage));
      return;
    }

    const nextPage = clampPage(parsedPage, safeTotalPages);
    setPageInput(String(nextPage));
    if (nextPage !== safeCurrentPage) {
      onPageChange(nextPage);
    }
  };

  return (
    <div className="border-t pt-3">
      <div className="rounded-lg border bg-muted/20 p-2">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap sm:justify-between">
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-background"
              onClick={() => onPageChange(1)}
              disabled={disabled || safeCurrentPage <= 1}
              aria-label="Primera página"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-background"
              onClick={() => onPageChange(safeCurrentPage - 1)}
              disabled={disabled || safeCurrentPage <= 1}
              aria-label="Página anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>

          <span className="hidden min-w-0 flex-1 text-center text-xs font-medium text-muted-foreground sm:block">
            {totalMessages > 0 ? `${start}-${end} de ${totalMessages}` : 'Sin mensajes'}
          </span>

          <div className="flex items-center gap-1">
            <div className="flex h-8 items-center gap-1 rounded-md border bg-background px-1.5 text-xs">
              <span className="shrink-0 text-muted-foreground">Pág.</span>
              <Input
                value={pageInput}
                onChange={(event) => {
                  const nextValue = event.target.value.replace(/\D+/g, '');
                  setPageInput(nextValue);
                }}
                onBlur={submitPage}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitPage();
                  }
                  if (event.key === 'Escape') {
                    setPageInput(String(safeCurrentPage));
                  }
                }}
                inputMode="numeric"
                disabled={disabled || safeTotalPages <= 1}
                className="h-6 w-10 border-0 bg-transparent px-0 text-center text-xs shadow-none focus-visible:ring-0"
                aria-label="Número de página"
              />
              <span className="shrink-0 text-muted-foreground">/ {safeTotalPages}</span>
            </div>

            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-background"
              onClick={() => onPageChange(safeCurrentPage + 1)}
              disabled={disabled || safeCurrentPage >= safeTotalPages}
              aria-label="Página siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 bg-background"
              onClick={() => onPageChange(safeTotalPages)}
              disabled={disabled || safeCurrentPage >= safeTotalPages}
              aria-label="Última página"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="mt-2 text-center text-[11px] text-muted-foreground sm:hidden">
          {totalMessages > 0 ? `Mensajes ${start} a ${end} de ${totalMessages}` : 'Sin mensajes'}
        </div>
      </div>
    </div>
  );
};

export default MailListPagination;
