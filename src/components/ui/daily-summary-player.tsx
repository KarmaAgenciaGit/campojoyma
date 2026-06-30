// Force cache refresh
import React, { useState, useEffect } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { AudioPlayer } from '@/components/ui/audio-player';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Play } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import { useSidebar } from '@/components/ui/sidebar';

interface DailySummary {
  id: string;
  date: string;
  audio_base64: string;
  title?: string;
  duration?: number;
}

export function DailySummaryPlayer() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [currentSummary, setCurrentSummary] = useState<DailySummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const { toast } = useToast();
  const { state, isMobile } = useSidebar();

  // Calculate left offset based on sidebar state and mobile
  const getLeftOffset = () => {
    if (isMobile) {
      return 0; // In mobile, sidebar is overlay, so no offset needed
    }
    return state === "collapsed" ? 48 : 256; // 3rem = 48px, 16rem = 256px
  };

  // Load available dates on mount
  useEffect(() => {
    loadAvailableDates();
  }, []);

  // Load summary for selected date
  useEffect(() => {
    loadSummaryForDate(selectedDate);
  }, [selectedDate]);

  const loadAvailableDates = async () => {
    try {
      const { data, error } = await supabase
        .from('daily_summaries')
        .select('date')
        .not('audio_base64', 'is', null)
        .neq('audio_base64', '');

      if (error) {
        console.error('Error loading available dates:', error);
        return;
      }

      const dates = data?.map(item => new Date(item.date)) || [];
      setAvailableDates(dates);
    } catch (error) {
      console.error('Error loading available dates:', error);
    }
  };

  const loadSummaryForDate = async (date: Date) => {
    setIsLoading(true);
    try {
      const dateString = format(date, 'yyyy-MM-dd');
      
      const { data, error } = await supabase
        .from('daily_summaries')
        .select('*')
        .eq('date', dateString)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error loading summary:', error);
        throw error;
      }

      setCurrentSummary(data || null);
    } catch (error) {
      console.error('Error loading daily summary:', error);
      toast({
        title: "Error",
        description: "No se pudo cargar el resumen del día seleccionado",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };


  // Always render the component, regardless of currentSummary status
  return (
    <Card 
      className="fixed bottom-0 right-0 bg-card/95 backdrop-blur-sm border-t border-border/50 shadow-lg rounded-none border-l-0 border-r-0 border-b-0 transition-all duration-200 z-50"
      style={{
        left: `${getLeftOffset()}px`,
      }}
    >
      {/* Content when no summary available */}
      {(!currentSummary && !isLoading) && (
        <div className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
              <Play className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm font-medium text-foreground truncate">Resumen del día</p>
              <p className="text-xs text-muted-foreground truncate hidden sm:block">No hay resumen disponible</p>
            </div>
          </div>
          
          <div className="flex-shrink-0">
            {/* Calendar Button */}
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 h-auto">
                  <CalendarIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="hidden xs:inline">{format(selectedDate, 'dd/MM', { locale: es })}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (date) {
                      setSelectedDate(date);
                      setIsCalendarOpen(false);
                    }
                  }}
                  disabled={(date) => {
                    return !availableDates.some(availableDate => 
                      availableDate.toDateString() === date.toDateString()
                    );
                  }}
                  initialFocus
                  locale={es}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      {/* Content when summary is available or loading */}
      {(currentSummary || isLoading) && (
        <div className="px-3 py-2 sm:px-4 sm:py-3">
          <div className="flex items-center justify-between mb-2 sm:mb-3 gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="text-xs sm:text-sm font-medium text-foreground truncate">
                {currentSummary?.title || 'Resumen del día'}
              </h3>
              <p className="text-xs text-muted-foreground truncate hidden sm:block">
                {format(selectedDate, 'EEEE, dd MMMM yyyy', { locale: es })}
              </p>
              <p className="text-xs text-muted-foreground truncate sm:hidden">
                {format(selectedDate, 'dd/MM/yyyy', { locale: es })}
              </p>
            </div>
            
            <div className="flex-shrink-0">
              {/* Calendar Button */}
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-2 h-auto">
                    <CalendarIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="hidden xs:inline">{format(selectedDate, 'dd/MM', { locale: es })}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (date) {
                        setSelectedDate(date);
                        setIsCalendarOpen(false);
                      }
                    }}
                    disabled={(date) => {
                      return !availableDates.some(availableDate => 
                        availableDate.toDateString() === date.toDateString()
                      );
                    }}
                    initialFocus
                    locale={es}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-2 sm:py-4">
              <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-b-2 border-primary"></div>
            </div>
          ) : currentSummary ? (
            <AudioPlayer
              audioBase64={currentSummary.audio_base64}
              className="w-full"
            />
          ) : null}
        </div>
      )}
    </Card>
  );
}