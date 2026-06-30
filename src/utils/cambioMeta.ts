import type { CambioLinea, ChangeMeta } from '@/types/cambios';

const OBS_SEPARATOR = '\u00b7';

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

export const getChange = (linea?: Pick<CambioLinea, '_change' | 'change_meta'> | null): ChangeMeta | null => {
  if (!linea) return null;
  return linea._change ?? linea.change_meta?._change ?? null;
};

export const parseObs = (s?: string | null) => {
  if (!s) return {};
  const parts = s.split(OBS_SEPARATOR).map((x) => x.trim());
  const out: Record<string, string> = {};
  for (const p of parts) {
    const [k, ...rest] = p.split('=');
    if (!k || rest.length === 0) continue;
    out[k.trim()] = rest.join('=').trim();
  }
  return out;
};

export const getNuevaMatricula = (s?: string | null) => {
  if (!s) return null;
  const m = s.match(/CAMBIO_MATRICULA=([^\u00b7]+)/);
  return m ? m[1].trim() : null;
};

export const getChangeNote = (
  linea?: Pick<CambioLinea, 'observaciones' | 'change_meta'> | null,
): string | null => {
  if (!linea) return null;
  const obs = asString(linea.observaciones);
  if (obs) return obs;

  const meta = linea.change_meta;
  if (!meta) return null;
  if (typeof meta === 'string') return asString(meta);

  const metaRecord = meta as Record<string, unknown>;
  const candidates = [
    metaRecord.raw,
    metaRecord.note,
    metaRecord.observaciones,
    (metaRecord._change as Record<string, unknown> | undefined)?.raw,
    (metaRecord._change as Record<string, unknown> | undefined)?.note,
  ];

  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) return value;
  }
  return null;
};

export const hasNonEmptyMeta = (meta: unknown): boolean => {
  if (!meta) return false;
  if (typeof meta !== 'object') return true;
  return Object.keys(meta as Record<string, unknown>).length > 0;
};

export const parseNumericId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const extractAcreedorIdFromMeta = (meta: unknown): number | null => {
  if (!meta || typeof meta !== 'object') return null;
  const record = meta as Record<string, unknown>;
  const candidates = [
    record.acreedorid_porte,
    record.acreedor_porte_id,
    record.acreedorid,
    record.transportista_id,
    record.transportistaId,
    (record.transportista as Record<string, unknown> | undefined)?.id,
    (record.transportista as Record<string, unknown> | undefined)?.acreedorid,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumericId(candidate);
    if (parsed !== null) return parsed;
  }
  const nestedCandidates = [
    record.new,
    record.after,
    record.value,
    record.valores,
    record.payload,
  ];
  for (const nested of nestedCandidates) {
    if (!nested || typeof nested !== 'object') continue;
    const nestedRecord = nested as Record<string, unknown>;
    const nestedMatches = [
      nestedRecord.acreedorid_porte,
      nestedRecord.acreedor_porte_id,
      nestedRecord.acreedorid,
      nestedRecord.transportista_id,
      nestedRecord.transportistaId,
      (nestedRecord.transportista as Record<string, unknown> | undefined)?.id,
      (nestedRecord.transportista as Record<string, unknown> | undefined)?.acreedorid,
    ];
    for (const candidate of nestedMatches) {
      const parsed = parseNumericId(candidate);
      if (parsed !== null) return parsed;
    }
  }
  return null;
};

export const resolveAcreedorId = (meta: unknown, fallback?: unknown): number | null => {
  return extractAcreedorIdFromMeta(meta) ?? parseNumericId(fallback);
};

export const extractMatchedPedidoId = (meta: unknown): number | null => {
  let record: Record<string, unknown> | null = null;
  if (!meta) return null;
  if (typeof meta === 'string') {
    try {
      record = JSON.parse(meta) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof meta === 'object') {
    record = meta as Record<string, unknown>;
  }
  if (!record) return null;
  const candidates = [
    record.matched_pedido_id,
    record.matched_pedidoid,
    record.pedido_match_id,
    record.match_pedido_id,
  ];
  for (const candidate of candidates) {
    const parsed = parseNumericId(candidate);
    if (parsed !== null) return parsed;
  }
  const nested = record.match;
  if (nested && typeof nested === 'object') {
    const nestedRecord = nested as Record<string, unknown>;
    const nestedCandidates = [nestedRecord.pedido_id, nestedRecord.pedidoid];
    for (const candidate of nestedCandidates) {
      const parsed = parseNumericId(candidate);
      if (parsed !== null) return parsed;
    }
  }
  return null;
};

export const extractMatchedPedidoIds = (meta: unknown): number[] => {
  let record: Record<string, unknown> | null = null;
  if (!meta) return [];
  if (typeof meta === 'string') {
    try {
      record = JSON.parse(meta) as Record<string, unknown>;
    } catch {
      return [];
    }
  } else if (typeof meta === 'object') {
    record = meta as Record<string, unknown>;
  }
  if (!record) return [];
  const candidates = [
    record.matched_pedido_ids,
    record.matched_pedidos,
    record.pedidos_match_ids,
    record.match_pedido_ids,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const parsed = candidate
        .map((value) => parseNumericId(value))
        .filter((value): value is number => value !== null);
      if (parsed.length > 0) return parsed;
    }
  }
  return [];
};

export const updateCambioMetaMatch = (
  meta: unknown,
  pedidoId: number | null,
): Record<string, unknown> | null => {
  const record =
    meta && typeof meta === 'object'
      ? { ...(meta as Record<string, unknown>) }
      : typeof meta === 'string' && meta.trim()
        ? { raw: meta }
        : {};
  if (pedidoId === null) {
    delete record.matched_pedido_id;
  } else {
    record.matched_pedido_id = pedidoId;
  }
  return record;
};

export const updateCambioMetaMatchList = (
  meta: unknown,
  pedidoIds: number[],
): Record<string, unknown> | null => {
  const record =
    meta && typeof meta === 'object'
      ? { ...(meta as Record<string, unknown>) }
      : typeof meta === 'string' && meta.trim()
        ? { raw: meta }
        : {};
  if (!pedidoIds.length) {
    delete record.matched_pedido_ids;
  } else {
    record.matched_pedido_ids = pedidoIds;
  }
  return record;
};

export const updateCambioMetaAcreedor = (
  meta: unknown,
  acreedorId: number | null,
): Record<string, unknown> | null => {
  if (!meta || typeof meta !== 'object') {
    if (acreedorId === null) {
      if (typeof meta === 'string' && meta.trim()) {
        return { raw: meta };
      }
      return null;
    }
    const next: Record<string, unknown> = {};
    if (typeof meta === 'string' && meta.trim()) {
      next.raw = meta;
    }
    next.acreedorid_porte = acreedorId;
    return next;
  }

  const record = { ...(meta as Record<string, unknown>) };
  if (acreedorId === null) {
    delete record.acreedorid_porte;
  } else {
    record.acreedorid_porte = acreedorId;
  }
  return record;
};

type AppliedFlags = {
  transportista?: boolean;
  lineas?: boolean;
};

export const getAppliedFlags = (meta: unknown): AppliedFlags => {
  if (!meta || typeof meta !== 'object') return {};
  const record = meta as Record<string, unknown>;
  const applied = record.applied;
  if (!applied || typeof applied !== 'object') return {};
  const appliedRecord = applied as Record<string, unknown>;
  return {
    transportista: appliedRecord.transportista === true,
    lineas: appliedRecord.lineas === true,
  };
};

export const updateAppliedFlags = (meta: unknown, updates: AppliedFlags): Record<string, unknown> => {
  const record =
    meta && typeof meta === 'object'
      ? { ...(meta as Record<string, unknown>) }
      : typeof meta === 'string' && meta.trim()
        ? { raw: meta }
        : {};
  const currentApplied = record.applied;
  const applied: Record<string, unknown> =
    currentApplied && typeof currentApplied === 'object' ? { ...(currentApplied as Record<string, unknown>) } : {};
  if (updates.transportista !== undefined) {
    applied.transportista = updates.transportista;
  }
  if (updates.lineas !== undefined) {
    applied.lineas = updates.lineas;
  }
  record.applied = applied;
  return record;
};
