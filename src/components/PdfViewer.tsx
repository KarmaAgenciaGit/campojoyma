import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface PdfViewerProps {
  url: string;
  className?: string;
  fileName?: string;
  initialPage?: number | null;
  onError?: (error: Error) => void;
  showControls?: boolean;
  appearance?: 'default' | 'purchase-invoice';
}

type PdfZoomMode = 'fit-width' | 'fit-page' | 'custom';
type PdfPageSize = { width: number; height: number };
type PdfJsLib = typeof import('pdfjs-dist');
type PdfDocument = Awaited<ReturnType<PdfJsLib['getDocument']>['promise']>;
type PdfLoadingTask = ReturnType<PdfJsLib['getDocument']>;

const MIN_ZOOM = 50;
const DEFAULT_MAX_ZOOM = 200;
const PURCHASE_INVOICE_MAX_ZOOM = 220;
const ZOOM_STEP = 10;
const PAGE_GAP = 16;
const STAGE_PADDING = 24;

const defaultToolbarButtonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const purchaseInvoiceToolbarButtonClass =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition-colors hover:border-primary/35 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-blue-400/40 dark:hover:bg-blue-400/10 dark:hover:text-blue-200';
const defaultToolbarActiveButtonClass =
  'border-primary/30 bg-primary/10 text-primary hover:bg-primary/15';
const purchaseInvoiceToolbarActiveButtonClass =
  'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 dark:border-blue-400/45 dark:bg-blue-400/10 dark:text-blue-200';

function clampZoom(value: number, maxZoom: number): number {
  return Math.min(maxZoom, Math.max(MIN_ZOOM, value));
}

function pdfDownloadName(fileName?: string, fallbackName = 'documento.pdf'): string {
  const cleaned = fileName?.trim() || fallbackName;
  return /\.pdf$/i.test(cleaned) ? cleaned : `${cleaned}.pdf`;
}

function fitScale(stage: PdfPageSize, page: PdfPageSize | null, mode: 'width' | 'page'): number {
  if (!page || stage.width <= 0 || stage.height <= 0) return 1;
  const availableWidth = Math.max(200, stage.width - STAGE_PADDING * 2);
  const widthScale = availableWidth / page.width;
  if (mode === 'width') return widthScale;
  const availableHeight = Math.max(200, stage.height - STAGE_PADDING * 2);
  return Math.min(widthScale, availableHeight / page.height);
}

function ensurePromiseWithResolvers() {
  type PromiseWithResolvers = typeof Promise & {
    withResolvers?: <T>() => {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    };
  };

  const promiseCtor = Promise as PromiseWithResolvers;
  if (promiseCtor.withResolvers) return;

  Object.defineProperty(promiseCtor, 'withResolvers', {
    configurable: true,
    value: <T,>() => {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

function PdfCanvasPage({
  pdf,
  pageNumber,
  scale,
  purchaseInvoiceAppearance,
}: {
  pdf: PdfDocument;
  pageNumber: number;
  scale: number;
  purchaseInvoiceAppearance: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    const render = async () => {
      setRenderError(false);
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;

        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && !(error instanceof Error && error.name === 'RenderingCancelledException')) {
          setRenderError(true);
        }
      }
    };

    void render();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdf, scale]);

  return (
    <div className="flex justify-center" data-pdf-page={pageNumber}>
      <div className={cn('bg-white shadow-sm ring-1 ring-black/10', purchaseInvoiceAppearance && 'dark:ring-white/10')}>
        {renderError ? (
          <div
            className={cn(
              'flex min-h-64 min-w-80 items-center justify-center px-6 text-center text-sm font-semibold',
              purchaseInvoiceAppearance ? 'text-slate-500' : 'text-muted-foreground',
            )}
          >
            No se pudo renderizar esta página.
          </div>
        ) : (
          <canvas ref={canvasRef} />
        )}
      </div>
    </div>
  );
}

export function PdfViewer({
  url,
  className,
  fileName,
  initialPage,
  onError,
  showControls = false,
  appearance = 'default',
}: PdfViewerProps) {
  const ownedBlobUrlRef = useRef<string | null>(null);
  const onErrorRef = useRef(onError);
  const initialScrollKeyRef = useRef<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [firstPageSize, setFirstPageSize] = useState<PdfPageSize | null>(null);
  const [stageSize, setStageSize] = useState<PdfPageSize>({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [zoomMode, setZoomMode] = useState<PdfZoomMode>('fit-width');
  const purchaseInvoiceAppearance = appearance === 'purchase-invoice';
  const maxZoom = purchaseInvoiceAppearance ? PURCHASE_INVOICE_MAX_ZOOM : DEFAULT_MAX_ZOOM;
  const toolbarButtonClass = purchaseInvoiceAppearance
    ? purchaseInvoiceToolbarButtonClass
    : defaultToolbarButtonClass;
  const toolbarActiveButtonClass = purchaseInvoiceAppearance
    ? purchaseInvoiceToolbarActiveButtonClass
    : defaultToolbarActiveButtonClass;

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    initialScrollKeyRef.current = null;
  }, [url, initialPage]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return undefined;

    const update = () => {
      setStageSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setZoom(100);
    setZoomMode('fit-width');
    setPdf(null);
    setPageCount(0);
    setFirstPageSize(null);

    if (!url) {
      setObjectUrl(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let loadingTask: PdfLoadingTask | null = null;
    setLoading(true);
    setLoadError(false);

    const revokeOwned = () => {
      const ownedUrl = ownedBlobUrlRef.current;
      if (ownedUrl) {
        URL.revokeObjectURL(ownedUrl);
        ownedBlobUrlRef.current = null;
      }
    };

    const destroyLoadingTask = () => {
      const task = loadingTask;
      loadingTask = null;
      if (task && !task.destroyed) {
        void task.destroy().catch(() => undefined);
      }
    };

    const load = async () => {
      try {
        const headers: Record<string, string> = {};
        if (!url.startsWith('blob:') && !url.startsWith('data:')) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const anonKey =
            (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
            (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ||
            '';
          if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
          if (anonKey) headers.apikey = anonKey;
        }

        const response = await fetch(url, { mode: 'cors', credentials: 'omit', headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        ensurePromiseWithResolvers();
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
        loadingTask = pdfjsLib.getDocument({ data: bytes });
        const nextPdf = await loadingTask.promise;
        const firstPage = await nextPdf.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });

        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          destroyLoadingTask();
          return;
        }

        revokeOwned();
        ownedBlobUrlRef.current = blobUrl;
        setObjectUrl(blobUrl);
        setPdf(nextPdf);
        setPageCount(nextPdf.numPages);
        setFirstPageSize({ width: firstViewport.width, height: firstViewport.height });
      } catch (error) {
        if (!cancelled) {
          onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
          setObjectUrl(null);
          setPdf(null);
          setLoadError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
      revokeOwned();
      setObjectUrl(null);
      destroyLoadingTask();
    };
  }, [url]);

  const widthScale = fitScale(stageSize, firstPageSize, 'width');
  const pageScale = fitScale(stageSize, firstPageSize, 'page');
  const renderScale = useMemo(() => {
    if (zoomMode === 'fit-page') return pageScale;
    if (zoomMode === 'custom') return widthScale * (zoom / 100);
    return widthScale;
  }, [pageScale, widthScale, zoom, zoomMode]);

  const controlsDisabled = !pdf || loading || loadError;
  const sourceControlsDisabled = !objectUrl || loading;
  const sourceActionDisabled = purchaseInvoiceAppearance ? sourceControlsDisabled : controlsDisabled;
  const safeRenderScale = Math.max(0.1, renderScale || 1);

  useEffect(() => {
    if (!pdf || !stageRef.current || !initialPage || initialPage < 1 || initialPage > pageCount) return undefined;

    const key = `${url}:${initialPage}:${pageCount}`;
    if (initialScrollKeyRef.current === key) return undefined;

    let cancelled = false;
    const scrollToInitialPage = () => {
      if (cancelled || !stageRef.current) return;
      const target = stageRef.current.querySelector<HTMLElement>(`[data-pdf-page="${initialPage}"]`);
      if (!target) return;
      stageRef.current.scrollTo({ top: Math.max(0, target.offsetTop - 12), behavior: 'auto' });
      initialScrollKeyRef.current = key;
    };

    const timers = [
      window.setTimeout(scrollToInitialPage, 50),
      window.setTimeout(scrollToInitialPage, 250),
      window.setTimeout(scrollToInitialPage, 700),
    ];

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [initialPage, pageCount, pdf, url]);

  const applyZoom = (nextZoom: number) => {
    setZoomMode('custom');
    setZoom(clampZoom(nextZoom, maxZoom));
  };

  const downloadPdf = () => {
    if (!objectUrl) return;
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = pdfDownloadName(fileName, purchaseInvoiceAppearance ? 'factura.pdf' : 'documento.pdf');
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const openPdf = () => {
    if (!objectUrl) return;
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      className={cn(
        'flex min-h-[360px] w-full flex-col',
        purchaseInvoiceAppearance &&
          'overflow-hidden rounded-sm border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950',
        className,
      )}
    >
      {showControls && (
        <div
          className={cn(
            'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2.5 py-2',
            purchaseInvoiceAppearance
              ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950'
              : 'border-border bg-background',
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => applyZoom(zoom - ZOOM_STEP)}
              disabled={controlsDisabled || (zoomMode === 'custom' && zoom <= MIN_ZOOM)}
              className={toolbarButtonClass}
              aria-label="Reducir zoom"
              title="Reducir zoom"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <span
              className={cn(
                'inline-flex h-8 min-w-16 items-center justify-center rounded-md border px-2 text-xs',
                purchaseInvoiceAppearance
                  ? 'border-slate-200 bg-slate-50 font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                  : 'border-border bg-muted/50 font-semibold text-muted-foreground',
              )}
            >
              {zoomMode === 'custom' ? `${zoom}%` : zoomMode === 'fit-width' ? 'Ancho' : 'Página'}
            </span>
            <button
              type="button"
              onClick={() => applyZoom(zoom + ZOOM_STEP)}
              disabled={controlsDisabled || (zoomMode === 'custom' && zoom >= maxZoom)}
              className={toolbarButtonClass}
              aria-label="Aumentar zoom"
              title="Aumentar zoom"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoomMode('fit-width')}
              disabled={controlsDisabled}
              className={cn(toolbarButtonClass, zoomMode === 'fit-width' && toolbarActiveButtonClass)}
              aria-label="Ajustar al ancho"
              title="Ajustar al ancho"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setZoomMode('fit-page')}
              disabled={controlsDisabled}
              className={cn(toolbarButtonClass, zoomMode === 'fit-page' && toolbarActiveButtonClass)}
              aria-label="Ajustar página completa"
              title="Ajustar página completa"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={openPdf}
              disabled={sourceActionDisabled}
              className={toolbarButtonClass}
              aria-label="Abrir PDF en pestaña nueva"
              title="Abrir PDF en pestaña nueva"
            >
              <ExternalLink className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={sourceActionDisabled}
              className={toolbarButtonClass}
              aria-label="Descargar PDF"
              title="Descargar PDF"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <div
        ref={stageRef}
        className={cn(
          'relative min-h-0 flex-1 overflow-auto',
          purchaseInvoiceAppearance ? 'bg-neutral-900' : 'bg-[#262626]',
        )}
      >
        {loading && (
          <div
            className={cn(
              'absolute inset-0 z-10 flex items-center justify-center',
              purchaseInvoiceAppearance ? 'bg-neutral-900' : 'bg-[#262626]',
            )}
          >
            <div
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold shadow-sm ring-1',
                purchaseInvoiceAppearance
                  ? 'bg-white/95 text-slate-600 ring-black/10 dark:bg-slate-950/95 dark:text-slate-200 dark:ring-white/10'
                  : 'bg-background/95 text-muted-foreground ring-border',
              )}
            >
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Cargando PDF...
            </div>
          </div>
        )}
        {!loading && loadError && (
          <div
            className={cn(
              'absolute inset-0 z-10 flex items-center justify-center px-6 text-center text-sm',
              purchaseInvoiceAppearance
                ? 'bg-slate-100 font-semibold text-slate-500 dark:bg-slate-950 dark:text-slate-400'
                : 'bg-muted/30 text-muted-foreground',
            )}
          >
            {purchaseInvoiceAppearance
              ? 'No se pudo cargar la vista previa. Usa el botón de abrir PDF para ver el documento original.'
              : 'No se pudo cargar la vista previa del PDF.'}
          </div>
        )}
        {pdf && !loadError && (
          <div className="mx-auto flex w-max min-w-full flex-col items-center px-3 py-3" style={{ gap: PAGE_GAP }}>
            {Array.from({ length: pageCount }, (_, index) => (
              <PdfCanvasPage
                key={`${index + 1}-${safeRenderScale}`}
                pdf={pdf}
                pageNumber={index + 1}
                scale={safeRenderScale}
                purchaseInvoiceAppearance={purchaseInvoiceAppearance}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
