import { legacySupabase as supabase } from '@/integrations/supabase/legacyClient';
import type { Database } from '@/integrations/supabase/types';

export type ClienteBehaviorRuleRow = Database['public']['Tables']['cliente_behavior_rules']['Row'];
export type ClienteBehaviorScope = 'pedidos' | 'cuentaventa';

export type ClienteBehaviorRule = Pick<
  ClienteBehaviorRuleRow,
  | 'allow_duplicate_reference'
  | 'allow_create_new_order_from_unmatched_change'
  | 'match_reference_by_digits_fallback'
  | 'block_duplicate_reference_same_pdf'
  | 'use_lot_labels'
  | 'clear_reference_in_orizon_payload'
  | 'map_reference_to_nlote_in_orizon'
  | 'clear_references_in_picking'
  | 'skip_name_includes'
  | 'require_name_prefixes'
>;

export const DEFAULT_CLIENT_BEHAVIOR_RULE: ClienteBehaviorRule = {
  allow_duplicate_reference: false,
  allow_create_new_order_from_unmatched_change: false,
  match_reference_by_digits_fallback: false,
  block_duplicate_reference_same_pdf: false,
  use_lot_labels: false,
  clear_reference_in_orizon_payload: false,
  map_reference_to_nlote_in_orizon: false,
  clear_references_in_picking: false,
  skip_name_includes: [],
  require_name_prefixes: [],
};

const CLIENT_BEHAVIOR_BOOLEAN_FIELDS = [
  'allow_duplicate_reference',
  'allow_create_new_order_from_unmatched_change',
  'match_reference_by_digits_fallback',
  'block_duplicate_reference_same_pdf',
  'use_lot_labels',
  'clear_reference_in_orizon_payload',
  'map_reference_to_nlote_in_orizon',
  'clear_references_in_picking',
] as const;

const CLIENT_BEHAVIOR_LIST_FIELDS = [
  'skip_name_includes',
  'require_name_prefixes',
] as const;

const CLIENT_BEHAVIOR_FIELDS = [...CLIENT_BEHAVIOR_BOOLEAN_FIELDS, ...CLIENT_BEHAVIOR_LIST_FIELDS] as const;

const CLIENT_BEHAVIOR_SELECT = [
  'clienteid',
  ...CLIENT_BEHAVIOR_FIELDS,
  'skip_name_includes_pedidos',
  'require_name_prefixes_pedidos',
  'skip_name_includes_cuentaventa',
  'require_name_prefixes_cuentaventa',
].join(', ');

const getRuleCacheKey = (clienteid: number, scope: ClienteBehaviorScope) => `${scope}:${clienteid}`;

const ruleCache = new Map<string, ClienteBehaviorRule>();
const pendingRuleFetches = new Map<string, Promise<ClienteBehaviorRule>>();

const normalizeClienteId = (clienteid: number | null | undefined): number | null => {
  if (typeof clienteid !== 'number' || !Number.isFinite(clienteid)) return null;
  return Math.trunc(clienteid);
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(trimmed);
  }
  return normalized;
};

const mapRule = (
  rule: (Partial<ClienteBehaviorRule> & {
    skip_name_includes_pedidos?: unknown;
    require_name_prefixes_pedidos?: unknown;
    skip_name_includes_cuentaventa?: unknown;
    require_name_prefixes_cuentaventa?: unknown;
  }) | null | undefined,
  scope: ClienteBehaviorScope,
): ClienteBehaviorRule => {
  if (!rule) return { ...DEFAULT_CLIENT_BEHAVIOR_RULE };
  const scopedSkipNameIncludes = normalizeStringList(
    scope === 'cuentaventa'
      ? rule.skip_name_includes_cuentaventa ?? rule.skip_name_includes
      : rule.skip_name_includes_pedidos ?? rule.skip_name_includes,
  );
  const scopedRequireNamePrefixes = normalizeStringList(
    scope === 'cuentaventa'
      ? rule.require_name_prefixes_cuentaventa ?? rule.require_name_prefixes
      : rule.require_name_prefixes_pedidos ?? rule.require_name_prefixes,
  );

  return {
    allow_duplicate_reference: Boolean(rule.allow_duplicate_reference),
    allow_create_new_order_from_unmatched_change: Boolean(rule.allow_create_new_order_from_unmatched_change),
    match_reference_by_digits_fallback: Boolean(rule.match_reference_by_digits_fallback),
    block_duplicate_reference_same_pdf: Boolean(rule.block_duplicate_reference_same_pdf),
    use_lot_labels: Boolean(rule.use_lot_labels),
    clear_reference_in_orizon_payload: Boolean(rule.clear_reference_in_orizon_payload),
    map_reference_to_nlote_in_orizon: Boolean(rule.map_reference_to_nlote_in_orizon),
    clear_references_in_picking: Boolean(rule.clear_references_in_picking),
    skip_name_includes: scopedSkipNameIncludes,
    require_name_prefixes: scopedRequireNamePrefixes,
  };
};

const loadRuleByClienteId = async (
  clienteid: number,
  scope: ClienteBehaviorScope,
): Promise<ClienteBehaviorRule> => {
  const { data, error } = await supabase
    .from('cliente_behavior_rules')
    .select(CLIENT_BEHAVIOR_SELECT as '*')
    .eq('clienteid', clienteid)
    .maybeSingle();

  if (error) throw error;

  const mapped = mapRule(data, scope);
  ruleCache.set(getRuleCacheKey(clienteid, scope), mapped);
  return mapped;
};

export const clearClienteBehaviorRuleCache = () => {
  ruleCache.clear();
  pendingRuleFetches.clear();
};

export const isClienteBehaviorRuleActive = (rule: ClienteBehaviorRule) =>
  CLIENT_BEHAVIOR_BOOLEAN_FIELDS.some((field) => Boolean(rule[field])) ||
  CLIENT_BEHAVIOR_LIST_FIELDS.some((field) => (rule[field] ?? []).length > 0);

export const getClienteBehaviorRule = async (
  clienteid: number | null | undefined,
  scope: ClienteBehaviorScope = 'pedidos',
): Promise<ClienteBehaviorRule> => {
  const normalized = normalizeClienteId(clienteid);
  if (normalized === null) {
    return { ...DEFAULT_CLIENT_BEHAVIOR_RULE };
  }

  const cacheKey = getRuleCacheKey(normalized, scope);
  const cached = ruleCache.get(cacheKey);
  if (cached) return cached;

  const existingPending = pendingRuleFetches.get(cacheKey);
  if (existingPending) return existingPending;

  const pending = loadRuleByClienteId(normalized, scope)
    .catch((error) => {
      console.error(`Error loading cliente behavior rule for clienteid ${normalized}:`, error);
      const fallback = { ...DEFAULT_CLIENT_BEHAVIOR_RULE };
      ruleCache.set(cacheKey, fallback);
      return fallback;
    })
    .finally(() => {
      pendingRuleFetches.delete(cacheKey);
    });

  pendingRuleFetches.set(cacheKey, pending);
  return pending;
};

export const getClienteBehaviorRulesMap = async (
  clienteids: Array<number | null | undefined>,
  scope: ClienteBehaviorScope = 'pedidos',
): Promise<Record<number, ClienteBehaviorRule>> => {
  const uniqueIds = Array.from(
    new Set(
      clienteids
        .map((id) => normalizeClienteId(id))
        .filter((id): id is number => id !== null),
    ),
  );

  if (uniqueIds.length === 0) return {};

  const result: Record<number, ClienteBehaviorRule> = {};
  const missingIds: number[] = [];

  for (const clienteid of uniqueIds) {
    const cached = ruleCache.get(getRuleCacheKey(clienteid, scope));
    if (cached) {
      result[clienteid] = cached;
    } else {
      missingIds.push(clienteid);
    }
  }

  if (missingIds.length > 0) {
    try {
      const { data, error } = await supabase
        .from('cliente_behavior_rules')
        .select(CLIENT_BEHAVIOR_SELECT as '*')
        .in('clienteid', missingIds);

      if (error) throw error;

      const rowsByClienteId = new Map<number, Partial<ClienteBehaviorRule>>();
      for (const row of data ?? []) {
        if (typeof row.clienteid === 'number') {
          rowsByClienteId.set(
            row.clienteid,
            row as Partial<ClienteBehaviorRule> & {
              skip_name_includes_pedidos?: unknown;
              require_name_prefixes_pedidos?: unknown;
              skip_name_includes_cuentaventa?: unknown;
              require_name_prefixes_cuentaventa?: unknown;
            },
          );
        }
      }

      for (const clienteid of missingIds) {
        const mapped = mapRule(
          rowsByClienteId.get(clienteid) as
            | (Partial<ClienteBehaviorRule> & {
              skip_name_includes_pedidos?: unknown;
              require_name_prefixes_pedidos?: unknown;
              skip_name_includes_cuentaventa?: unknown;
              require_name_prefixes_cuentaventa?: unknown;
            })
            | undefined,
          scope,
        );
        ruleCache.set(getRuleCacheKey(clienteid, scope), mapped);
        result[clienteid] = mapped;
      }
    } catch (error) {
      console.error('Error loading cliente behavior rules map:', error);
      for (const clienteid of missingIds) {
        const fallback = { ...DEFAULT_CLIENT_BEHAVIOR_RULE };
        ruleCache.set(getRuleCacheKey(clienteid, scope), fallback);
        result[clienteid] = fallback;
      }
    }
  }

  return result;
};
