import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';

interface OrderData {
  created_at: string;
  cliente: string;
}

interface OrdersAnalyticsChartProps {
  data: OrderData[];
  title: string;
  color: string;
}

export function OrdersAnalyticsChart({ data, title, color }: OrdersAnalyticsChartProps) {
  const { chartData, topClients, totalOrders } = useMemo(() => {
    // Obtener los últimos 30 días
    const endDate = new Date();
    const startDate = subDays(endDate, 29);
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    const chartData = days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const dayData = data.filter(item => 
        format(new Date(item.created_at), 'yyyy-MM-dd') === dayStr
      );
      
      return {
        date: format(day, 'dd/MM', { locale: es }),
        fullDate: dayStr,
        pedidos: dayData.length
      };
    });

    // Calcular top 5 clientes
    const clientCounts: Record<string, number> = {};
    data.forEach(order => {
      clientCounts[order.cliente] = (clientCounts[order.cliente] || 0) + 1;
    });

    const topClients = Object.entries(clientCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([cliente, count]) => ({ cliente, count }));

    return { 
      chartData, 
      topClients, 
      totalOrders: data.length 
    };
  }, [data]);

  const chartConfig = {
    pedidos: {
      label: "Pedidos",
      color: color,
    },
  };

  return (
    <div className="w-full group animate-fade-in">
      {/* Enhanced Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors duration-300">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">Evolución temporal de pedidos recibidos</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground bg-gradient-to-r from-muted/80 to-muted/60 px-3 py-2 rounded-full border border-muted-foreground/20 backdrop-blur-sm">
            📦 Últimos 30 días
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gráfico de líneas */}
        <div className="lg:col-span-2">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-50/50 to-red-50/50 dark:from-orange-950/20 dark:to-red-950/20 rounded-2xl blur-xl" />
            <ChartContainer config={chartConfig} className="relative h-[280px] w-full p-4 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border border-white/20 dark:border-gray-700/30 rounded-2xl shadow-xl">
              <LineChart 
                  data={chartData} 
                  margin={{ top: 30, right: 30, left: 10, bottom: 30 }}
                >
                  {/* Enhanced Grid */}
                  <CartesianGrid 
                    strokeDasharray="2 4" 
                    className="stroke-muted/20" 
                    horizontal={true}
                    vertical={false}
                  />
                  
                  {/* Enhanced X Axis */}
                  <XAxis 
                    dataKey="date" 
                    tick={{ 
                      fontSize: 11, 
                      fill: 'hsl(var(--muted-foreground))',
                      fontWeight: 500
                    }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    className="font-medium"
                  />
                  
                  {/* Enhanced Y Axis */}
                  <YAxis 
                    tick={{ 
                      fontSize: 11, 
                      fill: 'hsl(var(--muted-foreground))',
                      fontWeight: 500
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={35}
                    className="font-medium"
                  />
                  
                  {/* Enhanced Tooltip */}
                  <ChartTooltip 
                    content={<ChartTooltipContent 
                      className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-white/20 dark:border-gray-700/30 shadow-2xl rounded-xl p-4"
                      labelClassName="text-foreground font-semibold text-sm mb-2"
                      indicator="line"
                    />}
                    labelFormatter={(label, payload) => {
                      if (payload && payload.length > 0) {
                        return format(new Date(payload[0]?.payload?.fullDate), 'dd MMMM yyyy', { locale: es });
                      }
                      return label;
                    }}
                  />
                  
                  {/* Enhanced Primary Line */}
                  <Line 
                    type="monotone" 
                    dataKey="pedidos" 
                    stroke={color}
                    strokeWidth={4}
                    dot={{ 
                      fill: color, 
                      strokeWidth: 3, 
                      r: 5,
                      stroke: "white",
                      filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))"
                    }}
                    activeDot={{ 
                      r: 8, 
                      fill: color, 
                      stroke: "white", 
                      strokeWidth: 3,
                      filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.2))",
                      className: "animate-pulse"
                    }}
                    className="drop-shadow-lg"
                  />
                </LineChart>
            </ChartContainer>
          </div>

          {/* Data Summary for chart */}
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-950/30 dark:to-orange-900/30 rounded-xl">
              <div className="text-lg font-bold text-orange-700 dark:text-orange-400">
                {chartData.reduce((sum, item) => sum + item.pedidos, 0)}
              </div>
              <div className="text-xs text-orange-600 dark:text-orange-500">Total Pedidos</div>
            </div>
            <div className="text-center p-3 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/30 rounded-xl">
              <div className="text-lg font-bold text-green-700 dark:text-green-400">
                {Math.max(...chartData.map(item => item.pedidos))}
              </div>
              <div className="text-xs text-green-600 dark:text-green-500">Máximo Diario</div>
            </div>
            <div className="text-center p-3 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/30 rounded-xl">
              <div className="text-lg font-bold text-purple-700 dark:text-purple-400">
                {(chartData.reduce((sum, item) => sum + item.pedidos, 0) / chartData.length).toFixed(1)}
              </div>
              <div className="text-xs text-purple-600 dark:text-purple-500">Promedio</div>
            </div>
          </div>
        </div>

        {/* Top 5 Clientes */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-8 bg-gradient-to-b from-primary to-primary/50 rounded-full" />
            <h4 className="font-semibold text-foreground">Top 5 Clientes</h4>
          </div>
          
          <div className="space-y-3">
            {topClients.map((client, index) => (
              <div key={client.cliente} className="flex items-center justify-between p-3 bg-gradient-to-r from-muted/30 to-muted/10 rounded-lg hover:from-muted/50 hover:to-muted/20 transition-all duration-200">
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg ${
                    index === 0 ? 'bg-gradient-to-br from-yellow-400 to-yellow-600' :
                    index === 1 ? 'bg-gradient-to-br from-gray-400 to-gray-600' :
                    index === 2 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                    'bg-gradient-to-br from-primary to-primary/80'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{client.cliente}</p>
                  </div>
                </div>
                <div className="bg-primary/10 px-2 py-1 rounded-full">
                  <span className="text-sm font-bold text-primary">{client.count}</span>
                </div>
              </div>
            ))}
            
            {topClients.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <div className="w-16 h-16 mx-auto mb-3 bg-muted/20 rounded-full flex items-center justify-center">
                  <div className="text-2xl">📦</div>
                </div>
                <p className="text-sm font-medium">No hay pedidos registrados</p>
                <p className="text-xs mt-1">Los pedidos aparecerán aquí cuando se registren</p>
              </div>
            )}
          </div>

          {totalOrders > 0 && (
            <div className="mt-6 p-4 bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 rounded-xl">
              <div className="text-center">
                <p className="text-3xl font-bold text-primary mb-1">{totalOrders}</p>
                <p className="text-xs text-muted-foreground font-medium">Total de pedidos históricos</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
