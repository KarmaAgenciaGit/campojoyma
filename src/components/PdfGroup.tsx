import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown, 
  ChevronRight, 
  ExternalLink,
  FileText, 
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PedidoWithMatch, TipoPedido } from '@/types/pedidos';
import { formatDateSafe } from '@/utils/dateSafe';
import { resolveOrizonId } from '@/utils/orizon';

interface PdfGroupProps {
  archivoPdfId: number | null;
  pedidos: PedidoWithMatch[];
  totalPedidos: number;
  fechaMasReciente: string | null;
  clientesUnicos: Set<number>;
  tipoPedido: TipoPedido;
  incompleteDataPedidos: Set<number>;
  domicilioNombres: Record<number, string>;
  domicilioPlataformas: Record<number, string>;
  clienteNombres: Record<number, string>;
  loadingPedidoId: number | null;
  sendingPedidoId?: number | null;
  onViewDetails: (pedido: PedidoWithMatch) => void;
  onDelete: (pedido: PedidoWithMatch) => void;
  onDeleteGroup?: (pedidos: PedidoWithMatch[], archivoPdfId: number | null) => void;
  onSend?: (pedido: PedidoWithMatch, options?: { ignorePrevision?: boolean }) => void;
  onOpenPrevision?: (previsionId: number, pedido: PedidoWithMatch) => void;
  openingPrevisionPedidoId?: number | null;
  pickingBlockedIds?: Set<number>;
  isAdmin?: boolean;
  senderLabelsById?: Record<string, string>;
}

const getEffectiveArrivalDate = (
  pedido: Pick<PedidoWithMatch, 'llegada_correo' | 'created_at'>,
) => pedido.llegada_correo ?? pedido.created_at ?? null;

const getOrizonStatusLabel = (hasOrizonId: boolean, needsSync: boolean) => {
  if (!hasOrizonId) return 'No';
  return needsSync ? 'Sí, pendiente de actualizar' : 'Sí';
};

export const PdfGroup = ({
  archivoPdfId,
  pedidos,
  totalPedidos,
  fechaMasReciente,
  clientesUnicos,
  tipoPedido,
  incompleteDataPedidos,
  domicilioNombres,
  domicilioPlataformas,
  clienteNombres,
  loadingPedidoId,
  sendingPedidoId,
  onViewDetails,
  onDelete,
  onDeleteGroup,
  onSend,
  onOpenPrevision,
  openingPrevisionPedidoId,
  pickingBlockedIds,
  isAdmin = false,
  senderLabelsById = {},
}: PdfGroupProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const hasIncompleteData = pedidos.some(p => incompleteDataPedidos.has(p.id));
  const hasPendingSync = pedidos.some((p) => {
    const hasOrizonId = Boolean(resolveOrizonId((p as any)?.idpedido_orizon, (p as any)?.pedidoclienteid));
    return hasOrizonId && Boolean(p.needs_sync);
  });
  const allEnviados = pedidos.length > 0 && pedidos.every((p) => {
    const hasOrizonId = Boolean(resolveOrizonId((p as any)?.idpedido_orizon, (p as any)?.pedidoclienteid));
    return hasOrizonId && !p.needs_sync;
  });
  const hasMatriculasGroup = pedidos.some(p => p.matricula_tractora || p.matricula_remolque);
  const firstPedido = pedidos[0];

  // Obtener el nombre del cliente del primer pedido (todos son del mismo cliente)
  const clienteNombre = firstPedido?.clienteid
    ? clienteNombres[firstPedido.clienteid] || `Cliente #${firstPedido.clienteid}`
    : 'Sin cliente';

  const domiciliosGrupo = Array.from(
    new Set(
      pedidos
        .map((p) => p.sujetodomicilioid_destino)
        .filter((id): id is number => typeof id === 'number'),
    ),
  );

  const domicilioNombresGrupo = domiciliosGrupo.length > 0
    ? domiciliosGrupo.map((domicilioId) => domicilioNombres[domicilioId] || `Domicilio #${domicilioId}`)
    : ['Sin domicilio'];

  const plataformaNombresGrupo = Array.from(
    new Set(
      domiciliosGrupo
        .map((domicilioId) => domicilioPlataformas[domicilioId]?.trim())
        .filter((nombre): nombre is string => Boolean(nombre)),
    ),
  );

  const domiciliosCount = domiciliosGrupo.length;
  const plataformasCount = plataformaNombresGrupo.length;

  const destinoNombre = domicilioNombresGrupo.join(' / ');
  const destinoNombreResumen =
    domiciliosCount > 1 ? 'Varios domicilios' : (domicilioNombresGrupo[0] || 'Sin domicilio');
  const plataformaNombre = plataformaNombresGrupo.join(' / ');
  const plataformaNombreResumen =
    plataformasCount > 1 ? 'Varias plataformas' : (plataformaNombresGrupo[0] || '');
  const blockItemsLabel = tipoPedido === 'P220' ? 'pedidos' : 'previsiones';

  const fechaPedidoPrincipal = firstPedido?.fecha_pedido ?? fechaMasReciente;
  const fechaPedidoFormateada = formatDateSafe(fechaPedidoPrincipal, 'dd/MM/yyyy', '');
  const fechaLlegadaMasReciente = pedidos.reduce<string | null>((latest, pedido) => {
    const llegada = getEffectiveArrivalDate(pedido);
    if (!llegada) return latest;
    if (!latest) return llegada;
    return new Date(llegada).getTime() > new Date(latest).getTime() ? llegada : latest;
  }, null);
  const fechaLlegadaFormateada = formatDateSafe(fechaLlegadaMasReciente, 'dd/MM/yyyy · HH:mm', '');

  const grupoTitulo = [
    fechaPedidoFormateada,
    destinoNombre,
    plataformaNombre,
  ].filter(Boolean).join(' · ');
  const grupoTituloSegments = [
    fechaPedidoFormateada ? { key: 'fecha', value: fechaPedidoFormateada, className: 'text-sm' } : null,
    destinoNombreResumen ? { key: 'domicilio', value: destinoNombreResumen, className: 'text-sm' } : null,
    plataformaNombreResumen ? { key: 'plataforma', value: plataformaNombreResumen, className: 'text-xs font-medium' } : null,
  ].filter(Boolean) as Array<{ key: string; value: string; className: string }>;

  const openPdfInNewTab = async () => {
    if (!archivoPdfId) return;
    
    try {
      console.log(`[PdfGroup] Abriendo PDF desde UI. archivo_pdf_id=${archivoPdfId}`);
      // @ts-expect-error - Evitar error de tipo de Supabase
      const { data, error } = await supabase
        .from('archivos_pdf')
        .select('b64_contenido')
        .eq('id', archivoPdfId)
        .single();

      if (error) throw error;
      
      if (data?.b64_contenido) {
        const byteCharacters = atob(data.b64_contenido);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      }
    } catch (error) {
      console.error('Error opening PDF:', error);
    }
  };

  let groupHeaderClass = 'bg-card hover:bg-accent/30';
  let groupBorderClass = 'border-border';
  let groupDividerClass = 'border-border/60';

  if (hasIncompleteData) {
    groupHeaderClass =
      'bg-yellow-50/60 hover:bg-yellow-100/70 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/40';
    groupBorderClass = 'border-yellow-200/80 dark:border-yellow-800/40';
    groupDividerClass = 'border-yellow-200/80 dark:border-yellow-800/40';
  } else if (hasPendingSync) {
    groupHeaderClass =
      'bg-[#1e1fc9]/10 hover:bg-[#1e1fc9]/20 text-[#10138a] dark:bg-[#1e1fc9]/20 dark:hover:bg-[#1e1fc9]/30 dark:text-[#dfe1ff]';
    groupBorderClass = 'border-[#1e1fc9]/40 dark:border-[#1e1fc9]/50';
    groupDividerClass = 'border-[#1e1fc9]/40 dark:border-[#1e1fc9]/50';
  } else if (allEnviados) {
    groupHeaderClass =
      'bg-sky-100/70 hover:bg-sky-200 dark:bg-sky-900/40 dark:hover:bg-sky-900/60';
    groupBorderClass = 'border-sky-300 dark:border-sky-800/60';
    groupDividerClass = 'border-sky-300 dark:border-sky-800/60';
  } else if (hasMatriculasGroup) {
    groupHeaderClass =
      'bg-slate-100/70 hover:bg-slate-200 dark:bg-slate-900/40 dark:hover:bg-slate-900/60';
    groupBorderClass = 'border-slate-300 dark:border-slate-800/50';
    groupDividerClass = 'border-slate-300 dark:border-slate-800/50';
  }

  const handleKeyToggle = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsExpanded((prev) => !prev);
    }
  };

  return (
    <div className={`rounded-lg border transition-all overflow-hidden ${groupBorderClass}`}>
      {/* Header del grupo - Clickeable para expandir/colapsar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={handleKeyToggle}
        className={`w-full group relative transition-all cursor-pointer ${groupHeaderClass}`}
      >
        <div className="p-4">
          <div className="flex items-center gap-3">
            {/* Icono expandir/colapsar */}
            <div className="flex-shrink-0">
              {isExpanded ? (
                <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground transition-transform" />
              )}
            </div>

            {/* Titulo del bloque */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="font-semibold text-sm truncate" title={grupoTitulo}>
                {grupoTituloSegments.length > 0
                  ? grupoTituloSegments.map((segment, index) => (
                    <span key={segment.key} className={segment.className}>
                      {segment.value}
                      {index < grupoTituloSegments.length - 1 && (
                        <span className="mx-1 text-muted-foreground">&middot;</span>
                      )}
                    </span>
                  ))
                  : (archivoPdfId ? `PDF-${archivoPdfId}` : 'Sin documento PDF')}
              </span>
            </div>

            {/* Bloque resumen + acciones */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="hidden md:flex min-w-0 max-w-[560px] items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="whitespace-nowrap font-semibold text-foreground">
                  {totalPedidos} {totalPedidos === 1 ? 'pedido' : 'pedidos'}
                </span>
                <span className="text-muted-foreground">&middot;</span>
                <span className="min-w-0 truncate" title={clienteNombre}>
                  Cliente <span className="font-medium text-foreground">{clienteNombre}</span>
                </span>
                {fechaLlegadaFormateada && (
                  <>
                    <span aria-hidden="true" className="text-muted-foreground/70">&middot;</span>
                    <span className="whitespace-nowrap">
                      Llegada <span className="font-medium text-foreground">{fechaLlegadaFormateada}</span>
                    </span>
                  </>
                )}
              </div>

              <div className="sm:hidden text-xs font-semibold text-foreground whitespace-nowrap">
                {totalPedidos}
              </div>

              {/* Indicador de datos incompletos */}
              {hasIncompleteData && (
                <Badge variant="destructive" className="text-xs">
                  Incompleto
                </Badge>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={(e) => e.stopPropagation()}
                    title="Acciones del bloque"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                  {archivoPdfId && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.stopPropagation();
                          void openPdfInNewTab();
                        }}
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Abrir PDF en nueva pestaña
                      </DropdownMenuItem>
                    </>
                  )}
                  {onDeleteGroup && pedidos.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={(e) => {
                          e.stopPropagation();
                          onDeleteGroup(pedidos, archivoPdfId);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Eliminar todos los {blockItemsLabel} del bloque
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Lista de pedidos (visible cuando está expandido) */}
      {isExpanded && (
        <div className={`border-t ${groupDividerClass} bg-muted/20`}>
          <div className="space-y-2 p-4 animate-in slide-in-from-top-2">
            {pedidos.map((pedido) => {
              const isPrevision = (pedido as any)?.tipo_pedido === 'P22E';
              const referenciaPrincipal = pedido.referencia_cliente?.trim();
              const referenciaSecundaria = pedido.referencia2_cliente?.trim();
              const referenceText = referenciaPrincipal
                ? pedido.referencia_cliente
                : referenciaSecundaria
                ? pedido.referencia2_cliente
                : isPrevision
                ? `Previsión para el ${formatDateSafe(
                    pedido.fecha_carga || pedido.fecha_pedido || pedido.fecha || null,
                    'dd/MM/yyyy',
                    'sin fecha',
                  )}`
                : 'Sin referencia de cliente';
              const hasIncomplete = incompleteDataPedidos.has(pedido.id);
              const hasMatriculasPedido = pedido.matricula_tractora || pedido.matricula_remolque;
              const orizonId = resolveOrizonId(
                (pedido as any)?.idpedido_orizon,
                (pedido as any)?.pedidoclienteid,
              );
              const hasOrizonId = Boolean(orizonId);
              const needsSync = Boolean(hasOrizonId && pedido.needs_sync);
              const pedidoEnviado = hasOrizonId && !needsSync;
              const hasMatchingPrevision = Boolean(pedido.matching_prevision_id);
              const matchingPrevisionUploaded = Boolean(pedido.matching_prevision_uploaded);
              const canRunPicking = Boolean(hasMatchingPrevision && !hasOrizonId);
              const isPickingBlocked = Boolean(canRunPicking && (pickingBlockedIds?.has(pedido.id) ?? false));
              const cambioRevisado = Boolean((pedido as any)?.matching_cambio_revisado);
              const sentByUserId =
                typeof pedido.enviado_por === 'string' && pedido.enviado_por.trim().length > 0
                  ? pedido.enviado_por.trim()
                  : null;
              const sentByLabel = sentByUserId
                ? senderLabelsById[sentByUserId] ?? `Usuario ${sentByUserId.slice(0, 6)}`
                : null;
              const llegadaPedido = getEffectiveArrivalDate(pedido);
              const registeredAtLabel = formatDateSafe(
                pedido.created_at,
                'dd/MM/yy HH:mm',
                'No disponible',
              );
              const arrivalAtLabel = pedido.llegada_correo
                ? formatDateSafe(pedido.llegada_correo, 'dd/MM/yy HH:mm', 'No disponible')
                : 'No disponible';
              const orizonStatusLabel = getOrizonStatusLabel(hasOrizonId, needsSync);
              const domicilioDestinoId = pedido.sujetodomicilioid_destino;
              const domicilioDestinoLabel = domicilioDestinoId ? domicilioNombres[domicilioDestinoId] : '';
              const plataformaDestinoLabel = domicilioDestinoId ? domicilioPlataformas[domicilioDestinoId] : '';
              const rutaDestinoLabel = [
                domicilioDestinoLabel || null,
                plataformaDestinoLabel || null,
              ].filter(Boolean).join(' > ');
              const lineasCount =
                typeof pedido.lineas_count === 'number' && Number.isFinite(pedido.lineas_count)
                  ? pedido.lineas_count
                  : null;
              const lineasCountLabel =
                lineasCount === null
                  ? null
                  : lineasCount === 0
                  ? 'Sin líneas'
                  : `${lineasCount} ${lineasCount === 1 ? 'línea' : 'líneas'}`;

              const cardBase = 'rounded-lg border p-3 transition-colors';

              let cardStyle = 'bg-card hover:bg-accent/50 border-border';

              if (hasIncomplete) {
                cardStyle =
                  'bg-yellow-50 hover:bg-yellow-100 border-yellow-200 dark:bg-yellow-900/30 dark:hover:bg-yellow-900/50 dark:border-yellow-800/40';
              } else if (needsSync) {
                cardStyle =
                  'bg-[#1e1fc9]/15 hover:bg-[#1e1fc9]/25 border-[#1e1fc9]/40 text-[#10138a] dark:bg-[#1e1fc9]/20 dark:hover:bg-[#1e1fc9]/30 dark:border-[#1e1fc9]/50 dark:text-[#dfe1ff]';
              } else if (pedidoEnviado) {
                cardStyle =
                  'bg-sky-100/90 hover:bg-sky-200 border-sky-300 dark:bg-sky-900/50 dark:hover:bg-sky-900/70 dark:border-sky-800/60';
              } else if (hasMatriculasPedido) {
                cardStyle =
                  'bg-slate-100/90 hover:bg-slate-200 border-slate-300 dark:bg-slate-900/40 dark:hover:bg-slate-900/60 dark:border-slate-800/50';
              }

              const cardContent = (
                <div
                  key={pedido.id}
                  className={`${cardBase} ${cardStyle} cursor-pointer focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary ${loadingPedidoId === pedido.id ? 'opacity-60 pointer-events-none' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onViewDetails(pedido)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onViewDetails(pedido);
                    }
                  }}
                >
                  <div className="flex items-center justify-between gap-4">
                    {/* Info del pedido */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* Referencia y estados */}
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Referencia</span>
                        <span className="min-w-0 max-w-full truncate text-sm font-semibold text-foreground">
                          {referenceText}
                        </span>
                        {lineasCountLabel && (
                          <span className="text-xs text-muted-foreground">
                            <span aria-hidden="true" className="mr-2 text-muted-foreground/70">&middot;</span>
                            {lineasCountLabel}
                          </span>
                        )}
                        {hasMatchingPrevision && (
                          matchingPrevisionUploaded ? (
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 text-xs font-medium text-indigo-700 transition-colors dark:text-indigo-200 ${onOpenPrevision ? 'hover:text-indigo-900 dark:hover:text-indigo-100' : ''}`}
                              title="Abrir previsión vinculada"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (pedido.matching_prevision_id && onOpenPrevision) {
                                  onOpenPrevision(pedido.matching_prevision_id, pedido);
                                }
                              }}
                            >
                              {openingPrevisionPedidoId === pedido.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3 h-3" />
                              )}
                              {openingPrevisionPedidoId === pedido.id ? 'Abriendo...' : 'Previsión vinculada'}
                            </button>
                          ) : (
                            <Badge
                              variant="destructive"
                              className={`text-xs flex items-center gap-1 ${onOpenPrevision ? 'cursor-pointer hover:bg-destructive/80' : ''}`}
                              title="Abrir previsión vinculada"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (pedido.matching_prevision_id && onOpenPrevision) {
                                  onOpenPrevision(pedido.matching_prevision_id, pedido);
                                }
                              }}
                            >
                              {openingPrevisionPedidoId === pedido.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <AlertTriangle className="w-3 h-3" />
                              )}
                              {openingPrevisionPedidoId === pedido.id ? 'Abriendo...' : 'Previsión no registrada en Orizon'}
                            </Badge>
                          )
                        )}
                        {pedido.matching_cambio_id && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-medium ${
                              cambioRevisado
                                ? 'text-emerald-700 dark:text-emerald-200'
                                : 'text-amber-700 dark:text-amber-200'
                            }`}
                          >
                            {cambioRevisado ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <FileText className="w-3 h-3" />
                            )}
                            {cambioRevisado ? 'Cambio revisado' : 'Cambio disponible'}
                          </span>
                        )}
                        {needsSync && (
                          <Badge className="text-xs bg-[#1e1fc9]/20 text-[#11149b] border-[#1e1fc9]/40 dark:bg-[#1e1fc9]/25 dark:text-[#dfe1ff] dark:border-[#1e1fc9]/50 flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" />
                            Pendiente de actualizar
                          </Badge>
                        )}
                      </div>

                      {rutaDestinoLabel && (
                        <div className="min-w-0 truncate text-xs text-muted-foreground" title={rutaDestinoLabel}>
                          {domicilioDestinoLabel && (
                            <span className="font-medium text-foreground/80">{domicilioDestinoLabel}</span>
                          )}
                          {domicilioDestinoLabel && plataformaDestinoLabel && (
                            <span className="mx-1.5 text-muted-foreground/70">&gt;</span>
                          )}
                          {plataformaDestinoLabel && <span>{plataformaDestinoLabel}</span>}
                        </div>
                      )}

                      {/* Fechas */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {pedido.fecha_pedido && (
                          <span>Fecha pedido: {formatDateSafe(pedido.fecha_pedido, 'dd/MM/yy', 'Sin fecha')}</span>
                        )}
                        {pedido.fecha_carga && (
                          <span>Fecha carga: {formatDateSafe(pedido.fecha_carga, 'dd/MM/yy', 'Sin fecha')}</span>
                        )}
                        {llegadaPedido && (
                          <span>Llegada pedido: {formatDateSafe(llegadaPedido, 'dd/MM/yy HH:mm', 'Sin fecha')}</span>
                        )}
                      </div>

                      {/* Matrículas */}
                      {(pedido.matricula_tractora || pedido.matricula_remolque) && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-muted-foreground">
                          {pedido.matricula_tractora && (
                            <span>Matrícula tractora: {pedido.matricula_tractora}</span>
                          )}
                          {pedido.matricula_remolque && (
                            <span>Matrícula remolque: {pedido.matricula_remolque}</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center gap-1">
                      {onSend && (
                        <Button
                          variant={
                            canRunPicking
                              ? matchingPrevisionUploaded
                                ? "secondary"
                                : "outline"
                              : needsSync
                              ? "default"
                              : hasOrizonId
                              ? "secondary"
                              : "outline"
                          }
                          size="sm"
                          onClick={(e) => {
                          e.stopPropagation();
                          onSend(pedido);
                        }}
                          disabled={sendingPedidoId === pedido.id || loadingPedidoId === pedido.id}
                          className={`h-7 px-2 gap-1 ${
                            (canRunPicking && !matchingPrevisionUploaded) || isPickingBlocked
                              ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-100 dark:hover:bg-red-900/30'
                              : ''
                          }`}
                          title={
                            canRunPicking
                              ? matchingPrevisionUploaded
                                ? 'Comprobar picking con la previsión asociada'
                                : 'La previsión no está registrada en Orizon'
                              : hasOrizonId
                              ? 'Actualizar en Orizon'
                              : 'Enviar a Orizon'
                          }
                        >
                          {canRunPicking ? (
                            <>
                              <Send className="h-3 w-3" />
                              <span className="text-xs">Comprobar picking</span>
                            </>
                          ) : (
                            <>
                              {hasOrizonId ? <RefreshCw className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                              <span className="text-xs">{hasOrizonId ? 'Actualizar' : 'Enviar'}</span>
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(pedido);
                        }}
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={loadingPedidoId === pedido.id}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );

              if (!isAdmin) {
                return cardContent;
              }

              return (
                <TooltipProvider key={pedido.id} delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>{cardContent}</TooltipTrigger>
                    <TooltipContent side="top" align="start" className="max-w-xs">
                      <div className="space-y-1 text-xs">
                        <p>
                          <span className="font-semibold">Enviado por:</span>{' '}
                          {sentByLabel ?? 'No disponible'}
                        </p>
                        <p>
                          <span className="font-semibold">Enviado a Orizon:</span>{' '}
                          {orizonStatusLabel}
                        </p>
                        <p>
                          <span className="font-semibold">Registrado en sistema:</span>{' '}
                          {registeredAtLabel}
                        </p>
                        <p>
                          <span className="font-semibold">Llegada al correo:</span>{' '}
                          {arrivalAtLabel}
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
