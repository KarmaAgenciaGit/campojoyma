export const parseOrizonId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed > 0 ? parsed : null;
    }
  }
  return null;
};

export const resolveOrizonId = (primary: unknown, fallback?: unknown): number | null =>
  parseOrizonId(primary) ?? parseOrizonId(fallback);
