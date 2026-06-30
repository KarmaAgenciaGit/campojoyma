import { format, isToday, isPast, parseISO } from 'date-fns';

/**
 * Determina si una previsión puede ser completada basándose en su fecha de entrega
 * Solo se pueden completar previsiones de hoy o del pasado
 */
export const canCompletePrevision = (fechaentrega: string): boolean => {
  const entregaDate = parseISO(fechaentrega);
  return isToday(entregaDate) || isPast(entregaDate);
};

/**
 * Obtiene el motivo por el cual una previsión no se puede completar
 */
export const getCompletionBlockReason = (fechaentrega: string): string | null => {
  if (canCompletePrevision(fechaentrega)) {
    return null;
  }
  
  const entregaDate = parseISO(fechaentrega);
  const fechaFormatted = format(entregaDate, 'dd/MM/yyyy');
  return `Solo se pueden completar previsiones de hoy o anteriores. Esta previsión es para el ${fechaFormatted}`;
};

/**
 * Determina si una fecha de entrega es futura
 */
export const isFutureDelivery = (fechaentrega: string): boolean => {
  const entregaDate = parseISO(fechaentrega);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  entregaDate.setHours(0, 0, 0, 0);
  
  return entregaDate > today;
};

/**
 * Obtiene el estado visual apropiado para una previsión
 */
export const getPrevisionVisualState = (prevision: { fechaentrega: string; estado: 'pendiente' | 'completada' }) => {
  const canComplete = canCompletePrevision(prevision.fechaentrega);
  const isFuture = isFutureDelivery(prevision.fechaentrega);
  
  return {
    canComplete,
    isFuture,
    showCompletionButton: prevision.estado === 'pendiente' && canComplete,
    visualState: isFuture ? 'future-pending' : prevision.estado
  };
};