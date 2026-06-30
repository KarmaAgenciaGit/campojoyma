export const normalizeApiNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const noSpaces = trimmed.replace(/\s+/g, '');
    const sanitized = noSpaces.includes(',')
      ? noSpaces.replace(/\./g, '').replace(',', '.')
      : noSpaces;

    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};
