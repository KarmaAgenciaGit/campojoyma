/**
 * =====================================================
 * Componente: PdfSharedInfo
 * =====================================================
 *
 * Propósito: Mostrar información de PDFs compartidos entre múltiples pedidos
 * Features:
 * - Lista de pedidos relacionados
 * - Navegación directa a pedidos relacionados
 * - Estadísticas de tamaño del archivo
 *
 * @author AgroIris Team
 * @date 2025-01-05
 */

import { useState, useEffect } from 'react';
import { ExternalLink, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { agroirisPdfFiles, type PedidoPdfInfo } from '@/services/agroirisPdfFiles';
import { agroirisDomicilios } from '@/services/agroirisDomicilios';
import { agroirisClientePlataformas } from '@/services/agroirisClientePlataformas';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface PdfSharedInfoProps {
  archivoPdfId: number;
  currentPedidoId: number;
  currentClienteId: number | null;
  onPedidoClick?: (pedidoId: number) => void;
  className?: string;
}

export function PdfSharedInfo({
  archivoPdfId,
  currentPedidoId,
  currentClienteId,
  onPedidoClick,
  className,
}: PdfSharedInfoProps) {
  const [pedidosRelacionados, setPedidosRelacionados] = useState<PedidoPdfInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [tamanioKB, setTamanioKB] = useState<number | null>(null);
  const [destinosByDomicilioId, setDestinosByDomicilioId] = useState<
    Record<number, { domicilio: string; plataforma: string }>
  >({});

  useEffect(() => {
    let cancelled = false;

    const cargarPedidosRelacionados = async () => {
      try {
        setLoading(true);

        const pedidos = await agroirisPdfFiles.getPedidosByPdfId(archivoPdfId, currentClienteId);
        const otrosPedidos = pedidos.filter((p) => p.pedido_id !== currentPedidoId);

        if (!cancelled) {
          setPedidosRelacionados(otrosPedidos);
        }

        const archivo = await agroirisPdfFiles.getPdfById(archivoPdfId);
        if (!cancelled && archivo) {
          setTamanioKB(Math.round(archivo.tamanio_bytes / 1024));
        }
      } catch (error) {
        console.error('Error cargando pedidos relacionados:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void cargarPedidosRelacionados();

    return () => {
      cancelled = true;
    };
  }, [archivoPdfId, currentClienteId, currentPedidoId]);

  useEffect(() => {
    const domicilioIds = Array.from(
      new Set(
        pedidosRelacionados
          .map((pedido) => pedido.sujetodomicilioid_destino)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    );

    const missingIds = domicilioIds.filter((id) => !destinosByDomicilioId[id]);
    if (missingIds.length === 0) return;

    let cancelled = false;

    const cargarDestinos = async () => {
      const entries = await Promise.all(
        missingIds.map(async (domicilioId) => {
          try {
            const domicilio = await agroirisDomicilios.getDomicilioById(domicilioId);
            const nombreDomicilio = domicilio
              ? domicilio.nombre_identificador_domicilio_sujeto?.trim() ||
                domicilio.domicilio_sujeto?.trim() ||
                `Domicilio #${domicilioId}`
              : `Domicilio #${domicilioId}`;

            let nombrePlataforma = 'Sin plataforma';
            const plataformaId = domicilio?.clienteplataformaid ?? 0;
            if (plataformaId > 0) {
              nombrePlataforma = `Plataforma #${plataformaId}`;
              const plataforma = await agroirisClientePlataformas.getPlataformaById(plataformaId);
              const resolvedNombre = plataforma?.nombre_plataforma?.trim() || plataforma?.descripcion?.trim();
              if (resolvedNombre) nombrePlataforma = resolvedNombre;
            }

            return [domicilioId, { domicilio: nombreDomicilio, plataforma: nombrePlataforma }] as const;
          } catch (error) {
            console.error(`Error cargando destino para domicilio ${domicilioId}:`, error);
            return [domicilioId, { domicilio: `Domicilio #${domicilioId}`, plataforma: 'Sin plataforma' }] as const;
          }
        }),
      );

      if (!cancelled) {
        setDestinosByDomicilioId((prev) => ({
          ...prev,
          ...Object.fromEntries(entries),
        }));
      }
    };

    void cargarDestinos();

    return () => {
      cancelled = true;
    };
  }, [pedidosRelacionados, destinosByDomicilioId]);

  const totalPedidos = pedidosRelacionados.length + 1;

  if (totalPedidos === 1) {
    return null;
  }

  return (
    <Card className={cn('flex flex-col overflow-hidden border-primary/20 bg-background', className)}>
      <CardHeader className="shrink-0 pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">PDF Compartido</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Este PDF está vinculado a {totalPedidos} pedidos.
          {tamanioKB !== null && ` Tamaño: ${tamanioKB} KB`}
        </CardDescription>
      </CardHeader>

      {!loading && pedidosRelacionados.length > 0 && (
        <>
          <Separator className="shrink-0" />
          <CardContent className="mx-1 mb-1 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-b-md px-5 pb-5 pt-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Otros pedidos con este PDF:
              </p>
              <div className="space-y-2">
                {pedidosRelacionados.map((pedido) => {
                  const isPrevision = pedido.tipo_pedido === 'P22E';
                  const fallbackDate = pedido.fecha_carga || pedido.fecha;
                  const fallbackLabel = isPrevision
                    ? `Previsión para el ${format(new Date(fallbackDate || new Date()), "dd 'de' MMMM, yyyy", { locale: es })}`
                    : `Pedido #${pedido.pedido_id}`;
                  const domicilioId = pedido.sujetodomicilioid_destino;
                  const destinoInfo = domicilioId ? destinosByDomicilioId[domicilioId] : null;
                  const domicilioLabel = domicilioId
                    ? destinoInfo?.domicilio ?? `Domicilio #${domicilioId}`
                    : 'Sin domicilio';
                  const plataformaLabel = destinoInfo?.plataforma || 'Sin plataforma';

                  return (
                    <div
                      key={pedido.pedido_id}
                      className="flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {pedido.referencia_cliente || pedido.referencia2_cliente || fallbackLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(pedido.fecha), "dd 'de' MMMM, yyyy", { locale: es })}
                        </p>
                        <p className="text-xs text-muted-foreground truncate" title={domicilioLabel}>
                          Domicilio: {domicilioLabel}
                        </p>
                        <p className="text-xs text-muted-foreground truncate" title={plataformaLabel}>
                          Plataforma: {plataformaLabel}
                        </p>
                      </div>
                      {onPedidoClick && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onPedidoClick(pedido.pedido_id)}
                          className="ml-2"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </>
      )}

      {loading && (
        <CardContent className="pt-4">
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
