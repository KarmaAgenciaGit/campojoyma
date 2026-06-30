import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

type DateInput = string | Date | null | undefined;

export const parseDateSafe = (value: DateInput): Date | null => {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = trimmed.includes(' ') && !trimmed.includes('T')
    ? trimmed.replace(' ', 'T')
    : trimmed;

  try {
    const parsedIso = parseISO(normalized);
    if (!Number.isNaN(parsedIso.getTime())) {
      return parsedIso;
    }
  } catch (_) {
    // ignore parse errors, fallback to Date constructor
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

export const toIsoStringSafe = (value: DateInput): string | null => {
  const parsed = parseDateSafe(value);
  return parsed ? parsed.toISOString() : null;
};

export const formatDateSafe = (
  value: DateInput,
  dateFormat = 'dd/MM/yyyy',
  fallback = 'N/A',
) => {
  const parsed = parseDateSafe(value);
  if (!parsed) return fallback;
  try {
    return format(parsed, dateFormat, { locale: es });
  } catch (_) {
    return fallback;
  }
};

