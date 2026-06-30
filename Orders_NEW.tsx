import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { format, isAfter, isBefore, parseISO, startOfDay, subDays, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { Loader2, Trash2, Eye, Package, Truck, Calendar, FileText, MapPin } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';
import { normalizeApiNumber } from '@/utils/number';

type Pedido = Database['public']['Tables']['pedidos']['Row'];
type PedidoLinea = Database['public']['Tables']['pedido_linea']['Row'];
type PedidoLineaCentro = Database['public']['Tables']['pedido_linea_centro']['Row'];

interface PedidoWithDetails extends Pedido {
  lineas?: (PedidoLinea & { centros?: PedidoLineaCentro[] })[];
}

const Orders = () => {
  const { toast } = useToast();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPedido, setSelectedPedido] = useState<PedidoWithDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchPedidos = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('pedidos')
        .select('*')
        .order('fecha_pedido', { ascending: false });

      if (error) throw error;
      setPedidos((data as Pedido[]) ?? []);
    } catch (error) {
      console.error('Error fetching pedidos', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los pedidos.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPedidos();
  }, []);

  const viewPedidoDetails = async (pedido: Pedido) => {
    try {
      setLoadingDetails(true);
      setDialogOpen(true);

      const { data: lineas, error: lineasError } = await supabase
        .from('pedido_linea')
        .select('*')
        .eq('pedidoid', pedido.id);

      if (lineasError) throw lineasError;

      const lineasWithCentros = await Promise.all(
        (lineas || []).map(async (linea) => {
          const { data: centros, error: centrosError } = await supabase
            .from('pedido_linea_centro')
            .select('*')
            .eq('pedidodetid', linea.pedidodetid);

          if (centrosError) {
            console.error('Error fetching centros', centrosError);
            return { ...linea, centros: [] };
          }

          return {
            ...linea,
            numero_palet: normalizeApiNumber(linea.numero_palet),
            centros: (centros || []).map((centro) => ({
              ...centro,
              numero_palets: normalizeApiNumber((centro as any)?.numero_palets),
            })),
          };
        })
      );

      setSelectedPedido({
        ...pedido,
        lineas: lineasWithCentros,
      });
    } catch (error) {
      console.error('Error fetching pedido details', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los detalles del pedido.',
        variant: 'destructive',
      });
    } finally {
      setLoadingDetails(false);
    }
  };

  const deletePedido = async (id: Pedido['id']) => {
    try {
      const { error } = await supabase.from('pedidos').delete().eq('id', id);
      if (error) throw error;
      toast({ title: 'Pedido eliminado', description: 'El pedido se ha eliminado correctamente.' });
      setPedidos((prev) => prev.filter((pedido) => pedido.id !== id));
    } catch (error) {
      console.error('Error deleting pedido', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el pedido.',
        variant: 'destructive',
      });
    }
  };

  const stats = useMemo(() => {
    const now = startOfDay(new Date());
    const last7DaysStart = subDays(now, 6);
    const last30DaysStart = subDays(now, 29);
    const lastMonthStart = subMonths(now, 1);

    const total = pedidos.length;
    const last7Days = pedidos.filter((pedido) => {
      if (!pedido.fecha_pedido) return false;
      const date = parseISO(pedido.fecha_pedido);
      return isAfter(date, last7DaysStart) || date.getTime() === last7DaysStart.getTime();
    }).length;
    const last30Days = pedidos.filter((pedido) => {
      if (!pedido.fecha_pedido) return false;
      const date = parseISO(pedido.fecha_pedido);
      return isAfter(date, last30DaysStart) || date.getTime() === last30DaysStart.getTime();
    }).length;
    const older = pedidos.filter((pedido) => {
      if (!pedido.fecha_pedido) return false;
      const date = parseISO(pedido.fecha_pedido);
      return isBefore(date, lastMonthStart);
    }).length;

    return {
      total,
      last7Days,
      last30Days,
      older,
    };
  }, [pedidos]);

  const getStatusBadge = (fecha: string | null) => {
    if (!fecha) return <Badge variant="secondary">Sin fecha</Badge>;
    const date = parseISO(fecha);
    const now = startOfDay(new Date());
    const last7DaysStart = subDays(now, 6);

    if (isAfter(date, last7DaysStart) || date.getTime() === last7DaysStart.getTime()) {
      return <Badge variant="default">Reciente</Badge>;
    }
    return <Badge variant="secondary">Histórico</Badge>;
  };

  return (
    <div className="container mx-auto px-2 py-8 space-y-8">
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Pedidos totales</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Registro histórico</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Últimos 7 días</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.last7Days}</p>
            <p className="text-xs text-muted-foreground">Pedidos recientes</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Últimos 30 días</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.last30Days}</p>
            <p className="text-xs text-muted-foreground">Actividad mensual</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">Más de 1 mes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{stats.older}</p>
            <p className="text-xs text-muted-foreground">Pedidos antiguos</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Historial de pedidos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Cargando pedidos...
            </div>
          ) : pedidos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              Aún no hay pedidos registrados.
            </div>
          ) : (
            pedidos.map((pedido) => {
              const displayId = String(pedido.id).slice(0, 8);

              return (
                <div
                  key={pedido.id}
                  className="flex flex-col gap-4 border border-border/60 rounded-lg p-4 bg-background shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-lg font-semibold text-foreground">
                          Pedido #{displayId}
                        </p>
                        {getStatusBadge(pedido.fecha_pedido)}
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
                        {pedido.referencia_cliente && (
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            <span className="font-medium">Ref:</span> {pedido.referencia_cliente}
                          </div>
                        )}
                        {pedido.fecha_pedido && (
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4" />
                            <span className="font-medium">Pedido:</span>{' '}
                            {format(parseISO(pedido.fecha_pedido), 'dd MMM yyyy', { locale: es })}
                          </div>
                        )}
                        {pedido.fecha_carga && (
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4" />
                            <span className="font-medium">Carga:</span>{' '}
                            {format(parseISO(pedido.fecha_carga), 'dd MMM yyyy', { locale: es })}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Package className="h-4 w-4" />
                          <span className="font-medium">Tipo:</span> {pedido.tipo_pedido}
                        </div>
                      </div>

                      {(pedido.matricula_tractora || pedido.matricula_remolque) && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Truck className="h-4 w-4" />
                          {pedido.matricula_tractora && (
                            <span>Tractora: <span className="font-mono">{pedido.matricula_tractora}</span></span>
                          )}
                          {pedido.matricula_remolque && (
                            <span className="ml-3">Remolque: <span className="font-mono">{pedido.matricula_remolque}</span></span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => viewPedidoDetails(pedido)}
                        className="flex-1 sm:flex-none"
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Ver detalles
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deletePedido(pedido.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Detalles del Pedido #{selectedPedido?.id.toString().slice(0, 8)}
            </DialogTitle>
            <DialogDescription>
              Información completa del pedido, líneas y centros de distribución
            </DialogDescription>
          </DialogHeader>

          {loadingDetails ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Cargando detalles...
            </div>
          ) : selectedPedido ? (
            <div className="space-y-6">
              <div className="space-y-3">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Información General
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-4 rounded-lg">
                  <div>
                    <span className="text-muted-foreground">Referencia cliente:</span>
                    <p className="font-medium">{selectedPedido.referencia_cliente || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Tipo pedido:</span>
                    <p className="font-medium">{selectedPedido.tipo_pedido}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fecha pedido:</span>
                    <p className="font-medium">
                      {selectedPedido.fecha_pedido
                        ? format(parseISO(selectedPedido.fecha_pedido), "dd 'de' MMMM, yyyy", {
                            locale: es,
                          })
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Fecha carga:</span>
                    <p className="font-medium">
                      {selectedPedido.fecha_carga
                        ? format(parseISO(selectedPedido.fecha_carga), "dd 'de' MMMM, yyyy", {
                            locale: es,
                          })
                        : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Cliente ID:</span>
                    <p className="font-medium">{selectedPedido.clienteid || 'N/A'}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Divisa:</span>
                    <p className="font-medium">{selectedPedido.divisa_cliente || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {(selectedPedido.matricula_tractora || selectedPedido.matricula_remolque) && (
                <div className="space-y-3">
                  <h3 className="font-semibold text-lg flex items-center gap-2">
                    <Truck className="h-5 w-5" />
                    Información de Transporte
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-4 rounded-lg">
                    {selectedPedido.matricula_tractora && (
                      <div>
                        <span className="text-muted-foreground">Matrícula tractora:</span>
                        <p className="font-medium font-mono">{selectedPedido.matricula_tractora}</p>
                      </div>
                    )}
                    {selectedPedido.matricula_remolque && (
                      <div>
                        <span className="text-muted-foreground">Matrícula remolque:</span>
                        <p className="font-medium font-mono">{selectedPedido.matricula_remolque}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Líneas del Pedido ({selectedPedido.lineas?.length || 0})
                </h3>
                {selectedPedido.lineas && selectedPedido.lineas.length > 0 ? (
                  <div className="space-y-3">
                    {selectedPedido.lineas.map((linea, index) => (
                      <div key={linea.pedidodetid} className="border rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">Línea #{index + 1}</h4>
                          <Badge variant="outline">ID: {linea.pedidodetid}</Badge>
                        </div>
                        
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          <div>
                            <span className="text-muted-foreground">Bultos:</span>
                            <p className="font-medium">{linea.bultos}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Bultos x Palet:</span>
                            <p className="font-medium">{linea.bultosxpalet}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Número palets:</span>
                            <p className="font-medium">{linea.numero_palet}</p>
                          </div>
                          {linea.piezasxbulto && (
                            <>
                              <div>
                                <span className="text-muted-foreground">Piezas x Bulto:</span>
                                <p className="font-medium">{linea.piezasxbulto}</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Total piezas:</span>
                                <p className="font-medium">{linea.total_piezas}</p>
                              </div>
                            </>
                          )}
                          {linea.kilosxbulto && (
                            <>
                              <div>
                                <span className="text-muted-foreground">Kilos x Bulto:</span>
                                <p className="font-medium">{linea.kilosxbulto}</p>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Kilos cliente:</span>
                                <p className="font-medium">{linea.kilos_cliente}</p>
                              </div>
                            </>
                          )}
                        </div>

                        {linea.descripcion_salida && (
                          <div>
                            <span className="text-muted-foreground text-sm">Descripción:</span>
                            <p className="text-sm">{linea.descripcion_salida}</p>
                          </div>
                        )}

                        {linea.centros && linea.centros.length > 0 && (
                          <div className="mt-3 pt-3 border-t space-y-2">
                            <h5 className="text-sm font-medium flex items-center gap-2">
                              <MapPin className="h-4 w-4" />
                              Centros de Distribución ({linea.centros.length})
                            </h5>
                            <div className="space-y-2">
                              {linea.centros.map((centro) => (
                                <div
                                  key={centro.pedcentroid}
                                  className="bg-muted/50 rounded p-3 text-sm grid grid-cols-3 gap-2"
                                >
                                  <div>
                                    <span className="text-muted-foreground">Asignación:</span>
                                    <p className="font-medium">{centro.asignacion}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Palets:</span>
                                    <p className="font-medium">{centro.numero_palets}</p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Subprov:</span>
                                    <p className="font-medium">{centro.subprov}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No hay líneas registradas para este pedido
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Orders;
