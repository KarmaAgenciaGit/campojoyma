import React, { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { format, isSameDay, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Package, User, AlertCircle, CheckCircle, Brain, TrendingUp, Calendar as CalendarIcon, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { canCompletePrevision, getCompletionBlockReason, getPrevisionVisualState } from '@/utils/previsionUtils';

interface Prevision {
  id: string;
  agricultor_id: string;
  fechaentrega: string;
  cantidad: number;
  genero: string;
  estado: 'pendiente' | 'completada';
  cantidad_traida?: number;
  fecha_revision?: string;
  created_at: string;
  agricultores?: {
    nombre: string;
    telefono: string;
  };
}

interface AgricultorPrediction {
  agricultor_id: string;
  genero: string;
  historico_cumplimiento: number;
  cantidad_promedio_traida: number;
  total_entregas: number;
  prediccion: number;
  confianza: 'alta' | 'media' | 'baja';
  observaciones: string;
}

interface PrevisionesCalendarProps {
  previsiones: Prevision[];
  predicciones: Map<string, AgricultorPrediction>;
  onUpdateEstado: (previsionId: string, newEstado: 'completada') => void;
  onEditQuantity: (previsionId: string, currentQuantity?: number) => void;
  onOpenCompletarModal: (previsionId: string) => void;
  getPredictionForPrevision: (prevision: Prevision) => AgricultorPrediction | null;
}

// Colores usando el sistema de diseño
const getProductColorClass = (genero: string): string => {
  const colorClasses: Record<string, string> = {
    'tomate': 'bg-red-500',
    'pimiento': 'bg-green-500', 
    'calabacín': 'bg-blue-500',
    'pepino': 'bg-emerald-500',
    'berenjena': 'bg-purple-500',
    'lechuga': 'bg-lime-500',
    'cebolla': 'bg-amber-500',
    'zanahoria': 'bg-orange-500',
    'default': 'bg-muted-foreground'
  };
  
  return colorClasses[genero.toLowerCase()] || colorClasses.default;
};

const getProductBorderClass = (genero: string): string => {
  const borderClasses: Record<string, string> = {
    'tomate': 'border-red-200 bg-red-50',
    'pimiento': 'border-green-200 bg-green-50', 
    'calabacín': 'border-blue-200 bg-blue-50',
    'pepino': 'border-emerald-200 bg-emerald-50',
    'berenjena': 'border-purple-200 bg-purple-50',
    'lechuga': 'border-lime-200 bg-lime-50',
    'cebolla': 'border-amber-200 bg-amber-50',
    'zanahoria': 'border-orange-200 bg-orange-50',
    'default': 'border-muted bg-muted/20'
  };
  
  return borderClasses[genero.toLowerCase()] || borderClasses.default;
};

const getConfianzaBadge = (confianza: 'alta' | 'media' | 'baja') => {
  switch (confianza) {
    case 'alta':
      return <Badge variant="success" className="text-xs font-medium">Alta</Badge>;
    case 'media':
      return <Badge variant="secondary" className="text-xs font-medium">Media</Badge>;
    case 'baja':
      return <Badge variant="destructive" className="text-xs font-medium">Baja</Badge>;
  }
};

const getEstadoBadge = (estado: string) => {
  switch (estado) {
    case 'pendiente':
      return <Badge variant="destructive" className="flex items-center justify-center w-6 h-6 p-0 rounded-full" title="Pendiente">
        <AlertCircle className="w-3 h-3" />
      </Badge>;
    case 'completada':
      return <Badge variant="default" className="flex items-center justify-center w-6 h-6 p-0 rounded-full" title="Completada">
        <CheckCircle className="w-3 h-3" />
      </Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{estado}</Badge>;
  }
};

export function PrevisionesCalendar({ 
  previsiones, 
  predicciones, 
  onUpdateEstado, 
  onEditQuantity,
  onOpenCompletarModal,
  getPredictionForPrevision 
}: PrevisionesCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());

  // Agrupar previsiones por fecha
  const previsionesByDate = previsiones.reduce((acc, prevision) => {
    const date = prevision.fechaentrega;
    if (!acc[date]) {
      acc[date] = [];
    }
    acc[date].push(prevision);
    return acc;
  }, {} as Record<string, Prevision[]>);

  // Obtener previsiones para una fecha específica
  const getPrevisionesForDate = (date: Date): Prevision[] => {
    const dateStr = format(date, 'yyyy-MM-dd');
    return previsionesByDate[dateStr] || [];
  };

  // Verificar si una fecha tiene previsiones
  const hasPrevisiones = (date: Date): boolean => {
    return getPrevisionesForDate(date).length > 0;
  };

  // Obtener resumen de productos para una fecha
  const getDateSummary = (date: Date) => {
    const dayPrevisiones = getPrevisionesForDate(date);
    if (dayPrevisiones.length === 0) return null;

    const productos = [...new Set(dayPrevisiones.map(p => p.genero))];
    const pendientes = dayPrevisiones.filter(p => p.estado === 'pendiente').length;
    const completadas = dayPrevisiones.filter(p => p.estado === 'completada').length;
    
    // Calcular confianza promedio de las predicciones
    const prediccionesConConfianza = dayPrevisiones
      .map(p => getPredictionForPrevision(p))
      .filter(pred => pred !== null);
    
    let confianzaPromedio = 'sin-datos';
    if (prediccionesConConfianza.length > 0) {
      const confianzaScores = prediccionesConConfianza.map(pred => {
        switch (pred!.confianza) {
          case 'alta': return 3;
          case 'media': return 2;
          case 'baja': return 1;
          default: return 0;
        }
      });
      const promedio = confianzaScores.reduce((sum, score) => sum + score, 0) / confianzaScores.length;
      
      if (promedio >= 2.5) confianzaPromedio = 'alta';
      else if (promedio >= 1.5) confianzaPromedio = 'media';
      else confianzaPromedio = 'baja';
    }

    return {
      total: dayPrevisiones.length,
      productos: productos.slice(0, 3), // Mostrar máximo 3 productos
      pendientes,
      completadas,
      confianzaPromedio
    };
  };

  const modifiers = {
    hasPrevisiones: (date: Date) => hasPrevisiones(date),
  };

  const modifiersStyles = {
    hasPrevisiones: {
      fontWeight: 'bold',
      position: 'relative' as const,
    }
  };

  // Renderizar contenido personalizado del día
  const renderDayContents = (date: Date) => {
    const summary = getDateSummary(date);
    if (!summary) return <span className="text-sm">{date.getDate()}</span>;

    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center gap-1 p-1">
        <span className="text-sm font-semibold">{date.getDate()}</span>
        
        {/* Indicadores de productos */}
        <div className="flex flex-wrap gap-0.5 justify-center max-w-full">
          {summary.productos.slice(0, 3).map((producto, idx) => (
            <div
              key={idx}
              className={cn(
                "w-2 h-2 rounded-full shadow-sm",
                getProductColorClass(producto)
              )}
              title={`${producto} (${summary.total} previsión${summary.total > 1 ? 'es' : ''})`}
            />
          ))}
          {summary.productos.length > 3 && (
            <div className="w-2 h-2 rounded-full bg-muted-foreground opacity-60" 
                 title={`+${summary.productos.length - 3} más`} />
          )}
        </div>
        
        {/* Contador y estado */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-muted-foreground">
            {summary.total}
          </span>
          {summary.pendientes > 0 && (
            <div className="w-1 h-1 rounded-full bg-destructive animate-pulse" 
                 title={`${summary.pendientes} pendiente${summary.pendientes > 1 ? 's' : ''}`} />
          )}
        </div>
      </div>
    );
  };

  const selectedDatePrevisiones = selectedDate ? getPrevisionesForDate(selectedDate) : [];

  return (
    <div className="space-y-6">
      {/* Header con navegación y estadísticas */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">
              {format(currentMonth, 'MMMM yyyy', { locale: es }).replace(/^\w/, (c) => c.toUpperCase())}
            </h2>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const prevMonth = new Date(currentMonth);
                prevMonth.setMonth(prevMonth.getMonth() - 1);
                setCurrentMonth(prevMonth);
              }}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const nextMonth = new Date(currentMonth);
                nextMonth.setMonth(nextMonth.getMonth() + 1);
                setCurrentMonth(nextMonth);
              }}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Estadísticas rápidas del mes */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-destructive" />
            <span>{previsiones.filter(p => p.estado === 'pendiente').length} pendientes</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>{previsiones.filter(p => p.estado === 'completada').length} completadas</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Calendario Principal */}
        <div className="xl:col-span-3">
          <Card className="overflow-hidden">
            <CardContent className="p-6">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                month={currentMonth}
                onMonthChange={setCurrentMonth}
                locale={es}
                weekStartsOn={1}
                modifiers={modifiers}
                modifiersStyles={modifiersStyles}
                className="w-full [&_table]:w-full"
                components={{
                  DayContent: ({ date }) => renderDayContents(date)
                }}
                classNames={{
                  months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
                  month: "space-y-4 w-full",
                  caption: "flex justify-center pt-1 relative items-center mb-4",
                  caption_label: "text-sm font-medium",
                  nav: "space-x-1 flex items-center",
                  nav_button: "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 border border-border rounded-md hover:bg-accent",
                  nav_button_previous: "absolute left-1",
                  nav_button_next: "absolute right-1",
                  table: "w-full border-collapse space-y-1",
                  head_row: "flex w-full",
                  head_cell: "text-muted-foreground rounded-md w-full font-medium text-sm py-2 text-center",
                  row: "flex w-full mt-2",
                  cell: cn(
                    "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
                    "w-full h-16",
                    "[&:has([aria-selected])]:bg-accent/50 [&:has([aria-selected].day-outside)]:bg-accent/20",
                    "first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
                  ),
                  day: cn(
                    "w-full h-full p-0 font-normal aria-selected:opacity-100 rounded-lg",
                    "hover:bg-accent hover:text-accent-foreground transition-colors",
                    "focus:bg-accent focus:text-accent-foreground focus:outline-none",
                    "border border-transparent hover:border-border/50"
                  ),
                  day_selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground border-primary shadow-sm",
                  day_today: "bg-accent/80 text-accent-foreground font-semibold border-border",
                  day_outside: "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/20 aria-selected:text-muted-foreground aria-selected:opacity-30",
                  day_disabled: "text-muted-foreground opacity-50 cursor-not-allowed",
                  day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
                  day_hidden: "invisible",
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Panel de detalles del día seleccionado */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <Package className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="font-semibold">
                    {selectedDate ? format(selectedDate, 'dd MMMM', { locale: es }).replace(/^\w/, (c) => c.toUpperCase()) : 'Día'}
                  </div>
                  {selectedDate && (
                    <div className="text-sm text-muted-foreground font-normal">
                      {format(selectedDate, 'yyyy')}
                    </div>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedDatePrevisiones.length === 0 ? (
                <div className="text-center py-8">
                  <div className="w-12 h-12 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Package className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground text-sm">
                    No hay previsiones para este día
                  </p>
                </div>
              ) : (
                <>
                  {/* Resumen del día */}
                  <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
                    <div className="text-center">
                      <div className="text-lg font-semibold text-foreground">
                        {selectedDatePrevisiones.length}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        previsión{selectedDatePrevisiones.length > 1 ? 'es' : ''} programada{selectedDatePrevisiones.length > 1 ? 's' : ''}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-center gap-3">
                      {selectedDatePrevisiones.filter(p => p.estado === 'pendiente').length > 0 && (
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-destructive" />
                          <span className="text-xs text-muted-foreground">
                            {selectedDatePrevisiones.filter(p => p.estado === 'pendiente').length} pendiente{selectedDatePrevisiones.filter(p => p.estado === 'pendiente').length > 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                      {selectedDatePrevisiones.filter(p => p.estado === 'completada').length > 0 && (
                        <div className="flex items-center gap-1">
                          <div className="w-2 h-2 rounded-full bg-green-500" />
                          <span className="text-xs text-muted-foreground">
                            {selectedDatePrevisiones.filter(p => p.estado === 'completada').length} completada{selectedDatePrevisiones.filter(p => p.estado === 'completada').length > 1 ? 's' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <Separator />
                  
                  {/* Lista de previsiones */}
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                    {selectedDatePrevisiones.map((prevision, index) => {
                      const prediction = getPredictionForPrevision(prevision);
                      
                      return (
                        <div key={prevision.id} 
                             className={cn(
                               "rounded-lg p-4 space-y-3 border transition-all duration-200",
                               "bg-card border-border hover:shadow-sm",
                               prevision.estado === 'pendiente' 
                                 ? "border-l-4 border-l-red-400 bg-red-50/30 dark:bg-red-950/20 dark:border-red-500" 
                                 : "border-l-4 border-l-green-400 bg-green-50/30 dark:bg-green-950/20 dark:border-green-500"
                             )}>
                          
                          {/* Header de la previsión */}
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-3 h-3 rounded-full shadow-sm",
                                getProductColorClass(prevision.genero)
                              )} />
                              <div>
                                <div className="font-semibold text-sm capitalize">
                                  {prevision.genero}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {prevision.cantidad}kg solicitados
                                </div>
                              </div>
                            </div>
                            {getEstadoBadge(prevision.estado)}
                          </div>
                          
                          {/* Información del agricultor */}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <User className="w-3 h-3" />
                            <span className="font-medium">
                              {prevision.agricultores?.nombre || prevision.agricultor_id}
                            </span>
                          </div>
                          
                          {/* Cantidad traída (solo completadas) */}
                          {prevision.cantidad_traida && (
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">Cantidad traída:</span>
                              <span className="font-semibold">{prevision.cantidad_traida}kg</span>
                            </div>
                          )}

                          {/* Predicción de Inteligencia Artificial para pendientes */}
                          {prevision.estado === 'pendiente' && prediction && (
                            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2 dark:bg-primary/10 dark:border-primary/30">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Brain className="w-3 h-3 text-primary" />
                                  <span className="text-xs font-semibold text-primary">Predicción de Inteligencia Artificial</span>
                                </div>
                                {getConfianzaBadge(prediction.confianza)}
                              </div>
                              
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Esperado:</span>
                                  <div className="font-semibold text-foreground">{prediction.prediccion}kg</div>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Cumplimiento:</span>
                                  <div className="font-semibold text-foreground">{prediction.historico_cumplimiento}%</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Botones de acción */}
                          {prevision.estado === 'pendiente' && (() => {
                            const visualState = getPrevisionVisualState(prevision);
                            const blockReason = getCompletionBlockReason(prevision.fechaentrega);
                            
                            return (
                              <div className="pt-2">
                                {visualState.showCompletionButton ? (
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => onOpenCompletarModal(prevision.id)}
                                    className="w-full text-xs h-8 bg-green-600 hover:bg-green-700 text-white"
                                  >
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                    Completar
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    disabled
                                    title={blockReason || 'No se puede completar'}
                                    className="w-full text-xs h-8 bg-muted text-muted-foreground cursor-not-allowed"
                                  >
                                    <Ban className="w-3 h-3 mr-1" />
                                    Entrega futura
                                  </Button>
                                )}
                              </div>
                            );
                          })()}
                          
                          {index < selectedDatePrevisiones.length - 1 && (
                            <Separator className="mt-3" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Leyenda de productos y estadísticas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Productos del mes
            </CardTitle>
          </CardHeader>
          <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[...new Set(previsiones.map(p => p.genero))].slice(0, 8).map((genero) => {
                  const count = previsiones.filter(p => p.genero === genero).length;
                  return (
                    <div key={genero} 
                         className="flex items-center gap-2 p-2 rounded-lg border transition-colors bg-card border-border hover:bg-accent/50">
                      <div className={cn(
                        "w-3 h-3 rounded-full shadow-sm",
                        getProductColorClass(genero)
                      )} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium capitalize truncate text-foreground">{genero}</div>
                        <div className="text-[10px] text-muted-foreground">{count} previsión{count > 1 ? 'es' : ''}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="w-4 h-4 text-primary" />
              Resumen del período
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-primary">
                    {previsiones.length}
                  </div>
                  <div className="text-xs text-muted-foreground">Total previsiones</div>
                </div>
                <div className="text-center p-3 bg-muted/30 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {Math.round((previsiones.filter(p => p.estado === 'completada').length / Math.max(previsiones.length, 1)) * 100)}%
                  </div>
                  <div className="text-xs text-muted-foreground">Completadas</div>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Agricultores únicos:</span>
                  <span className="font-medium">
                    {new Set(previsiones.map(p => p.agricultor_id)).size}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Productos únicos:</span>
                  <span className="font-medium">
                    {new Set(previsiones.map(p => p.genero)).size}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
