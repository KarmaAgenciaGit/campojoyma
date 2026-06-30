import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { es } from 'date-fns/locale';

interface DataPoint {
  created_at: string;
  is_processed: boolean;
}

interface AnalyticsChartProps {
  data: DataPoint[];
  title: string;
  color: string;
}

export function AnalyticsChart({ data, title, color }: AnalyticsChartProps) {
  const chartData = useMemo(() => {
    // Obtener los últimos 30 días
    const endDate = new Date();
    const startDate = subDays(endDate, 29);
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    return days.map(day => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const dayData = data.filter(item => 
        format(new Date(item.created_at), 'yyyy-MM-dd') === dayStr
      );
      
      return {
        date: format(day, 'dd/MM', { locale: es }),
        fullDate: dayStr,
        procesados: dayData.filter(item => item.is_processed).length,
        pendientes: dayData.filter(item => !item.is_processed).length,
        total: dayData.length
      };
    });
  }, [data]);

  const chartConfig = {
    procesados: {
      label: "Procesados",
      color: color,
    },
    total: {
      label: "Total",
      color: "hsl(var(--muted-foreground))",
    }
  };

  return (
    <div className="w-full group animate-fade-in">
      {/* Enhanced Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors duration-300">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">Evolución temporal de procesamiento</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-muted-foreground bg-gradient-to-r from-muted/80 to-muted/60 px-3 py-2 rounded-full border border-muted-foreground/20 backdrop-blur-sm">
            📊 Últimos 30 días
          </div>
        </div>
      </div>

      {/* Chart Legend */}
      <div className="flex items-center justify-center gap-6 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm font-medium text-foreground">Procesados</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-1 bg-muted-foreground opacity-60 rounded-full" />
          <span className="text-sm font-medium text-muted-foreground">Total</span>
        </div>
      </div>
      
      {/* Enhanced Chart Container */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20 rounded-2xl blur-xl" />
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
              dataKey="procesados" 
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
            
            {/* Enhanced Secondary Line */}
            <Line 
              type="monotone" 
              dataKey="total" 
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={3}
              strokeDasharray="8 6"
              dot={{ 
                fill: "hsl(var(--muted-foreground))", 
                strokeWidth: 2, 
                r: 3,
                stroke: "white"
              }}
              className="opacity-70"
            />
          </LineChart>
        </ChartContainer>
      </div>
      
      {/* Data Summary */}
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="text-center p-3 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/30 dark:to-blue-900/30 rounded-xl">
          <div className="text-lg font-bold text-blue-700 dark:text-blue-400">
            {chartData.reduce((sum, item) => sum + item.procesados, 0)}
          </div>
          <div className="text-xs text-blue-600 dark:text-blue-500">Total Procesados</div>
        </div>
        <div className="text-center p-3 bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/30 dark:to-green-900/30 rounded-xl">
          <div className="text-lg font-bold text-green-700 dark:text-green-400">
            {Math.max(...chartData.map(item => item.procesados))}
          </div>
          <div className="text-xs text-green-600 dark:text-green-500">Máximo Diario</div>
        </div>
        <div className="text-center p-3 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/30 dark:to-purple-900/30 rounded-xl">
          <div className="text-lg font-bold text-purple-700 dark:text-purple-400">
            {(chartData.reduce((sum, item) => sum + item.procesados, 0) / chartData.length).toFixed(1)}
          </div>
          <div className="text-xs text-purple-600 dark:text-purple-500">Promedio</div>
        </div>
      </div>
    </div>
  );
}
