import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type RuleRow = Database['public']['Tables']['facturas_recibidas_erp_rules']['Row'];
type RuleInsert = Database['public']['Tables']['facturas_recibidas_erp_rules']['Insert'];

export type FacturaFechaCtbPolicy = 'manual' | 'invoice_date';
export type FacturaContabilizarDefault = 'S' | 'N';
export type FacturaPunteoDifferencePolicy = 'warning' | 'block';

export type FacturaRecibidaErpRule = Omit<RuleRow, 'fecha_ctb_policy' | 'contabilizar_default'> & {
  fecha_ctb_policy: FacturaFechaCtbPolicy | null;
  contabilizar_default: FacturaContabilizarDefault | null;
  punteo_difference_policy: FacturaPunteoDifferencePolicy | null;
};

export type FacturaRecibidaErpRuleInput = {
  id?: string | null;
  empresa_id: number;
  proveedor_id?: number | null;
  ejercicio_erp?: number | null;
  tipo_factura?: string | null;
  regimen_id?: number | null;
  fecha_ctb_policy?: FacturaFechaCtbPolicy | null;
  cuenta_gasto_default?: string | null;
  concepto_template?: string | null;
  contabilizar_default?: FacturaContabilizarDefault | null;
  punteo_difference_policy?: FacturaPunteoDifferencePolicy | null;
  activo?: boolean;
  approval_note?: string | null;
};

export type FacturaRecibidaErpRuleValues = {
  ejercicio_erp: number | null;
  tipo_factura: string | null;
  regimen_id: number | null;
  fecha_ctb_policy: FacturaFechaCtbPolicy;
  cuenta_gasto_default: string | null;
  concepto_template: string | null;
  contabilizar_default: FacturaContabilizarDefault | null;
  punteo_difference_policy: FacturaPunteoDifferencePolicy;
};

export type FacturaRecibidaErpRuleResolution = FacturaRecibidaErpRuleValues & {
  empresa_rule_id: string | null;
  proveedor_rule_id: string | null;
};

const isFechaCtbPolicy = (value: unknown): value is FacturaFechaCtbPolicy =>
  value === 'manual' || value === 'invoice_date';

const isContabilizarDefault = (value: unknown): value is FacturaContabilizarDefault =>
  value === 'S' || value === 'N';

const isPunteoDifferencePolicy = (
  value: unknown,
): value is FacturaPunteoDifferencePolicy =>
  value === 'warning' || value === 'block';

const normalizeRule = (row: RuleRow): FacturaRecibidaErpRule => ({
  ...row,
  fecha_ctb_policy: isFechaCtbPolicy(row.fecha_ctb_policy) ? row.fecha_ctb_policy : null,
  contabilizar_default: isContabilizarDefault(row.contabilizar_default) ? row.contabilizar_default : null,
  punteo_difference_policy: isPunteoDifferencePolicy(
    (row as unknown as Record<string, unknown>).punteo_difference_policy,
  )
    ? (row as unknown as Record<string, unknown>)
        .punteo_difference_policy as FacturaPunteoDifferencePolicy
    : null,
});

const normalizePositiveInteger = (value: number | null | undefined, field: string): number | null => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || Math.trunc(value) !== value || value <= 0) {
    throw new Error(`${field} debe ser un entero positivo.`);
  }
  return value;
};

const normalizeTipoFactura = (value: string | null | undefined): string | null => {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (!normalized) return null;
  if (normalized.length > 2) throw new Error('El tipo de factura debe tener como m\u00e1ximo 2 caracteres.');
  return normalized;
};

const normalizeCuentaGastoDefault = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (!/^\d{11}$/.test(normalized)) {
    throw new Error('La cuenta de gasto debe tener exactamente 11 d\u00edgitos.');
  }
  return normalized;
};

const normalizeConceptoTemplate = (value: string | null | undefined): string | null => {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (normalized.length > 50) {
    throw new Error('La plantilla de concepto debe tener como m\u00e1ximo 50 caracteres.');
  }
  if (!normalized.includes('{proveedor}')) {
    throw new Error('La plantilla de concepto debe incluir {proveedor}.');
  }
  return normalized;
};

const normalizeContabilizarDefault = (
  value: FacturaContabilizarDefault | string | null | undefined,
): FacturaContabilizarDefault | null => {
  const normalized = value?.trim().toUpperCase() ?? '';
  if (!normalized) return null;
  if (!isContabilizarDefault(normalized)) {
    throw new Error('El valor por defecto de contabilizar debe ser S o N.');
  }
  return normalized;
};

const normalizeFechaCtbPolicy = (
  value: FacturaFechaCtbPolicy | null | undefined,
): FacturaFechaCtbPolicy | null => {
  if (value === null || value === undefined) return null;
  if (!isFechaCtbPolicy(value)) {
    throw new Error('La pol\u00edtica de fecha CTB no es v\u00e1lida.');
  }
  return value;
};

const normalizePunteoDifferencePolicy = (
  value: FacturaPunteoDifferencePolicy | null | undefined,
): FacturaPunteoDifferencePolicy | null => {
  if (value === null || value === undefined) return null;
  if (!isPunteoDifferencePolicy(value)) {
    throw new Error('La política de diferencias de punteos no es válida.');
  }
  return value;
};

const hasConfiguredValue = (input: {
  ejercicio_erp: number | null;
  tipo_factura: string | null;
  regimen_id: number | null;
  fecha_ctb_policy: FacturaFechaCtbPolicy | null;
  cuenta_gasto_default: string | null;
  concepto_template: string | null;
  contabilizar_default: FacturaContabilizarDefault | null;
  punteo_difference_policy: FacturaPunteoDifferencePolicy | null;
}) =>
  input.ejercicio_erp !== null ||
  input.tipo_factura !== null ||
  input.regimen_id !== null ||
  input.fecha_ctb_policy === 'invoice_date' ||
  input.cuenta_gasto_default !== null ||
  input.concepto_template !== null ||
  input.contabilizar_default !== null ||
  input.punteo_difference_policy !== null;

export const normalizeFacturaRecibidaErpRuleInput = (
  input: FacturaRecibidaErpRuleInput,
): RuleInsert => {
  const empresaId = normalizePositiveInteger(input.empresa_id, 'La empresa ERP');
  if (empresaId === null) throw new Error('La empresa ERP es obligatoria.');

  const normalized = {
    empresa_id: empresaId,
    proveedor_id: normalizePositiveInteger(input.proveedor_id, 'El acreedor ERP'),
    ejercicio_erp: normalizePositiveInteger(input.ejercicio_erp, 'El ejercicio ERP'),
    tipo_factura: normalizeTipoFactura(input.tipo_factura),
    regimen_id: normalizePositiveInteger(input.regimen_id, 'El r\u00e9gimen IVA'),
    fecha_ctb_policy: normalizeFechaCtbPolicy(input.fecha_ctb_policy),
    cuenta_gasto_default: normalizeCuentaGastoDefault(input.cuenta_gasto_default),
    concepto_template: normalizeConceptoTemplate(input.concepto_template),
    contabilizar_default: normalizeContabilizarDefault(input.contabilizar_default),
    punteo_difference_policy: normalizePunteoDifferencePolicy(
      input.punteo_difference_policy,
    ),
    activo: input.activo ?? true,
    approval_note: input.approval_note?.trim() || null,
  } as RuleInsert & {
    punteo_difference_policy: FacturaPunteoDifferencePolicy | null;
  };

  if (hasConfiguredValue(normalized) && !normalized.approval_note) {
    throw new Error('A\u00f1ade una nota o evidencia de aprobaci\u00f3n para activar valores autom\u00e1ticos.');
  }

  return normalized;
};

const firstNumber = (...values: Array<number | null | undefined>): number | null => {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
};

const firstText = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
};

export const resolveFacturaRecibidaErpRuleValues = (
  rules: FacturaRecibidaErpRule[],
  scope: { empresa_id: number; proveedor_id?: number | null },
  current: Partial<FacturaRecibidaErpRuleValues> = {},
): FacturaRecibidaErpRuleResolution => {
  const activeRules = rules.filter((rule) => rule.activo && rule.empresa_id === scope.empresa_id);
  const empresaRule = activeRules.find((rule) => rule.proveedor_id === null) ?? null;
  const proveedorRule = scope.proveedor_id
    ? activeRules.find((rule) => rule.proveedor_id === scope.proveedor_id) ?? null
    : null;

  const currentPolicy = isFechaCtbPolicy(current.fecha_ctb_policy) ? current.fecha_ctb_policy : null;

  return {
    ejercicio_erp: firstNumber(current.ejercicio_erp, proveedorRule?.ejercicio_erp, empresaRule?.ejercicio_erp),
    tipo_factura: firstText(current.tipo_factura, proveedorRule?.tipo_factura, empresaRule?.tipo_factura),
    regimen_id: firstNumber(current.regimen_id, proveedorRule?.regimen_id, empresaRule?.regimen_id),
    fecha_ctb_policy:
      currentPolicy ?? proveedorRule?.fecha_ctb_policy ?? empresaRule?.fecha_ctb_policy ?? 'manual',
    cuenta_gasto_default: firstText(
      current.cuenta_gasto_default,
      proveedorRule?.cuenta_gasto_default,
      empresaRule?.cuenta_gasto_default,
    ),
    concepto_template: firstText(
      current.concepto_template,
      proveedorRule?.concepto_template,
      empresaRule?.concepto_template,
    ),
    contabilizar_default: normalizeContabilizarDefault(
      current.contabilizar_default ??
        proveedorRule?.contabilizar_default ??
        empresaRule?.contabilizar_default,
    ),
    punteo_difference_policy:
      (isPunteoDifferencePolicy(current.punteo_difference_policy)
        ? current.punteo_difference_policy
        : null) ??
      proveedorRule?.punteo_difference_policy ??
      empresaRule?.punteo_difference_policy ??
      'warning',
    empresa_rule_id: empresaRule?.id ?? null,
    proveedor_rule_id: proveedorRule?.id ?? null,
  };
};

const findRuleForScope = async (empresaId: number, proveedorId: number | null) => {
  let query = supabase
    .from('facturas_recibidas_erp_rules')
    .select('*')
    .eq('empresa_id', empresaId);

  query = proveedorId === null ? query.is('proveedor_id', null) : query.eq('proveedor_id', proveedorId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? normalizeRule(data) : null;
};

export const listFacturaRecibidaErpRules = async (): Promise<FacturaRecibidaErpRule[]> => {
  const { data, error } = await supabase
    .from('facturas_recibidas_erp_rules')
    .select('*')
    .order('empresa_id', { ascending: true })
    .order('proveedor_id', { ascending: true, nullsFirst: true });

  if (error) throw error;
  return (data ?? []).map(normalizeRule);
};

export const getFacturaRecibidaErpRulesForScope = async (
  empresaId: number,
  proveedorId?: number | null,
): Promise<FacturaRecibidaErpRule[]> => {
  const normalizedEmpresaId = normalizePositiveInteger(empresaId, 'La empresa ERP');
  if (normalizedEmpresaId === null) throw new Error('La empresa ERP es obligatoria.');
  const normalizedProveedorId = normalizePositiveInteger(proveedorId, 'El acreedor ERP');

  let query = supabase
    .from('facturas_recibidas_erp_rules')
    .select('*')
    .eq('empresa_id', normalizedEmpresaId)
    .eq('activo', true);

  query = normalizedProveedorId === null
    ? query.is('proveedor_id', null)
    : query.or(`proveedor_id.is.null,proveedor_id.eq.${normalizedProveedorId}`);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(normalizeRule);
};

export const resolveFacturaRecibidaErpRules = async (
  scope: { empresa_id: number; proveedor_id?: number | null },
  current: Partial<FacturaRecibidaErpRuleValues> = {},
): Promise<FacturaRecibidaErpRuleResolution> => {
  const rules = await getFacturaRecibidaErpRulesForScope(scope.empresa_id, scope.proveedor_id);
  return resolveFacturaRecibidaErpRuleValues(rules, scope, current);
};

export const saveFacturaRecibidaErpRule = async (
  input: FacturaRecibidaErpRuleInput,
): Promise<FacturaRecibidaErpRule> => {
  const payload = normalizeFacturaRecibidaErpRuleInput(input);

  if (input.id) {
    const { data, error } = await supabase
      .from('facturas_recibidas_erp_rules')
      .update(payload)
      .eq('id', input.id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeRule(data);
  }

  const existing = await findRuleForScope(payload.empresa_id, payload.proveedor_id ?? null);
  if (existing) {
    const { data, error } = await supabase
      .from('facturas_recibidas_erp_rules')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return normalizeRule(data);
  }

  const { data, error } = await supabase
    .from('facturas_recibidas_erp_rules')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return normalizeRule(data);
};

export const deleteFacturaRecibidaErpRule = async (id: string): Promise<void> => {
  const normalizedId = id.trim();
  if (!normalizedId) throw new Error('Falta el identificador de la regla.');
  const { error } = await supabase.from('facturas_recibidas_erp_rules').delete().eq('id', normalizedId);
  if (error) throw error;
};

export const facturasRecibidasErpRules = {
  list: listFacturaRecibidaErpRules,
  getForScope: getFacturaRecibidaErpRulesForScope,
  resolve: resolveFacturaRecibidaErpRules,
  save: saveFacturaRecibidaErpRule,
  remove: deleteFacturaRecibidaErpRule,
};
