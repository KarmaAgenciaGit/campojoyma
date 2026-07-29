import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { legacySupabase as supabase } from '@/integrations/supabase/legacyClient';
import { getFirstAllowedPath, type UserRole } from '@/config/accessControl';
import type { Database } from '@/integrations/supabase/types';
import { ClientCombobox } from '@/components/ClientCombobox';
import { AcreedorCombobox } from '@/components/AcreedorCombobox';
import { ShieldCheck, Users, RefreshCw, Save, Trash2, Edit2, Eye, SlidersHorizontal } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { agroirisClients } from '@/services/agroirisClients';
import {
  facturasRecibidasErpRules,
  type FacturaContabilizarDefault,
  type FacturaFechaCtbPolicy,
  type FacturaRecibidaErpRule,
} from '@/services/facturasRecibidasErpRules';
import {
  clearClienteBehaviorRuleCache,
  DEFAULT_CLIENT_BEHAVIOR_RULE,
  type ClienteBehaviorRule,
} from '@/services/clienteBehaviorRules';

type UserRoleRow = Database['public']['Tables']['user_roles']['Row'];
type AppUser = { id: string; email: string | null; created_at: string | null };
type UserDeleteTarget = { userId: string; email: string | null };
type ClienteVisibleRow = Database['public']['Tables']['clientes_visibles']['Row'];
type ClienteVisibleCuentaVentaRow = Database['public']['Tables']['clientes_visibles_cuentaventa']['Row'];
type ClientesVisibilityFilter = 'all' | 'visible' | 'hidden';
type ClientesBehaviorFilter = 'all' | 'active' | 'default';
type VisibilityScopeOption = 'pedidos' | 'cuentaventa';

type ClienteBehaviorToggleField =
  | 'allow_duplicate_reference'
  | 'allow_create_new_order_from_unmatched_change'
  | 'match_reference_by_digits_fallback'
  | 'block_duplicate_reference_same_pdf';
type ClienteBehaviorListScope = 'pedidos' | 'cuentaventa';
type ClienteBehaviorListField = 'skip_name_includes' | 'require_name_prefixes';
type ClienteBehaviorScopedListField = `${ClienteBehaviorListField}_${ClienteBehaviorListScope}`;
type ClienteBehaviorInputState = Record<number, Record<ClienteBehaviorScopedListField, string>>;

type ClienteBehaviorRuleConfig = ClienteBehaviorRule & {
  clienteid: number;
  skip_name_includes_pedidos: string[];
  require_name_prefixes_pedidos: string[];
  skip_name_includes_cuentaventa: string[];
  require_name_prefixes_cuentaventa: string[];
};

type FacturaErpRuleDraft = {
  id: string | null;
  empresaId: string;
  proveedorId: number | null;
  ejercicioErp: string;
  tipoFactura: string;
  regimenId: string;
  fechaCtbPolicy: FacturaFechaCtbPolicy | 'inherit';
  cuentaGastoDefault: string;
  conceptoTemplate: string;
  contabilizarDefault: FacturaContabilizarDefault | 'manual';
  activo: boolean;
  approvalNote: string;
};

const emptyFacturaErpRuleDraft = (): FacturaErpRuleDraft => ({
  id: null,
  empresaId: '1',
  proveedorId: null,
  ejercicioErp: '',
  tipoFactura: '',
  regimenId: '',
  fechaCtbPolicy: 'inherit',
  cuentaGastoDefault: '',
  conceptoTemplate: '',
  contabilizarDefault: 'N',
  activo: true,
  approvalNote: '',
});

const parseOptionalPositiveInteger = (value: string, label: string): number | null => {
  const normalized = value.trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} debe ser un entero positivo.`);
  return parsed;
};

const CLIENT_BEHAVIOR_TOGGLE_FIELDS: ClienteBehaviorToggleField[] = [
  'allow_duplicate_reference',
  'allow_create_new_order_from_unmatched_change',
  'match_reference_by_digits_fallback',
  'block_duplicate_reference_same_pdf',
];

const CLIENT_BEHAVIOR_SELECT = [
  'clienteid',
  'allow_duplicate_reference',
  'allow_create_new_order_from_unmatched_change',
  'match_reference_by_digits_fallback',
  'block_duplicate_reference_same_pdf',
  'use_lot_labels',
  'clear_reference_in_orizon_payload',
  'map_reference_to_nlote_in_orizon',
  'clear_references_in_picking',
  'skip_name_includes',
  'require_name_prefixes',
  'skip_name_includes_pedidos',
  'require_name_prefixes_pedidos',
  'skip_name_includes_cuentaventa',
  'require_name_prefixes_cuentaventa',
].join(', ');

const getScopedListFieldKey = (
  field: ClienteBehaviorListField,
  scope: ClienteBehaviorListScope,
): ClienteBehaviorScopedListField =>
  `${field}_${scope}` as ClienteBehaviorScopedListField;

const normalizeRuleStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(trimmed);
  }
  return result;
};

const parseRuleStringListInput = (value: string): string[] => {
  const parts = value
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return normalizeRuleStringList(parts);
};

const serializeRuleStringList = (value: string[]) => normalizeRuleStringList(value).join(', ');

const areStringListsEqual = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const hasVisibleClienteBehaviorRules = (rule: ClienteBehaviorRuleConfig) =>
  Boolean(
    rule.allow_duplicate_reference ||
      rule.allow_create_new_order_from_unmatched_change ||
      rule.match_reference_by_digits_fallback ||
      rule.block_duplicate_reference_same_pdf ||
      rule.use_lot_labels ||
      rule.clear_reference_in_orizon_payload ||
      rule.map_reference_to_nlote_in_orizon ||
      rule.clear_references_in_picking ||
      (rule.skip_name_includes_pedidos?.length ?? 0) > 0 ||
      (rule.require_name_prefixes_pedidos?.length ?? 0) > 0 ||
      (rule.skip_name_includes_cuentaventa?.length ?? 0) > 0 ||
      (rule.require_name_prefixes_cuentaventa?.length ?? 0) > 0,
  );

const DASHBOARD_GROUP_ROUTES = ['/dashboard'];
const FACTURAS_GROUP_ROUTES = ['/facturas-recibidas'];
const PEDIDOS_GROUP_ROUTES: string[] = [];
const CONTROL_ENTRADA_GROUP_ROUTES: string[] = [];
const CORREOS_GROUP_ROUTES: string[] = [];
const USER_ROUTE_OPTIONS = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/facturas-recibidas', label: 'Facturas' },
];
const DEFAULT_USER_ROUTES = [...DASHBOARD_GROUP_ROUTES, ...FACTURAS_GROUP_ROUTES];
const ACTIVE_ROUTE_PATHS = new Set(USER_ROUTE_OPTIONS.map((route) => route.path));

const LEGACY_ROUTE_ALIASES: Record<string, string> = {
  '/admin/buscar-archivo': '/buscar-archivo',
};

const normalizeAllowedRoutes = (routes: string[] | null | undefined): string[] => {
  const source = Array.isArray(routes) ? routes : DEFAULT_USER_ROUTES;
  const mapped = source.map((route) => LEGACY_ROUTE_ALIASES[route] ?? route);
  return Array.from(new Set(mapped.filter((route) => ACTIVE_ROUTE_PATHS.has(route))));
};

const getFunctionErrorMessage = (data: unknown): string | null => {
  if (!data || typeof data !== 'object') return null;
  const error = (data as { error?: unknown }).error;
  return typeof error === 'string' ? error : null;
};

const isMissingRpcFunctionError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'PGRST202' || code === '42883';
};

const buildClienteBehaviorRule = (
  clienteid: number,
  rule?: (Partial<ClienteBehaviorRule> & Partial<Record<ClienteBehaviorScopedListField, unknown>>) | null,
): ClienteBehaviorRuleConfig => {
  const legacySkipNameIncludes = normalizeRuleStringList(rule?.skip_name_includes);
  const legacyRequireNamePrefixes = normalizeRuleStringList(rule?.require_name_prefixes);
  const skipNameIncludesPedidos = normalizeRuleStringList(
    rule?.skip_name_includes_pedidos ?? legacySkipNameIncludes,
  );
  const requireNamePrefixesPedidos = normalizeRuleStringList(
    rule?.require_name_prefixes_pedidos ?? legacyRequireNamePrefixes,
  );
  const skipNameIncludesCuentaVenta = normalizeRuleStringList(
    rule?.skip_name_includes_cuentaventa ?? legacySkipNameIncludes,
  );
  const requireNamePrefixesCuentaVenta = normalizeRuleStringList(
    rule?.require_name_prefixes_cuentaventa ?? legacyRequireNamePrefixes,
  );

  return {
    clienteid,
    allow_duplicate_reference: Boolean(rule?.allow_duplicate_reference),
    allow_create_new_order_from_unmatched_change: Boolean(rule?.allow_create_new_order_from_unmatched_change),
    match_reference_by_digits_fallback: Boolean(rule?.match_reference_by_digits_fallback),
    block_duplicate_reference_same_pdf: Boolean(rule?.block_duplicate_reference_same_pdf),
    use_lot_labels: Boolean(rule?.use_lot_labels),
    clear_reference_in_orizon_payload: Boolean(rule?.clear_reference_in_orizon_payload),
    map_reference_to_nlote_in_orizon: Boolean(rule?.map_reference_to_nlote_in_orizon),
    clear_references_in_picking: Boolean(rule?.clear_references_in_picking),
    // Legacy aliases (pedidos)
    skip_name_includes: skipNameIncludesPedidos,
    require_name_prefixes: requireNamePrefixesPedidos,
    // Scoped lists
    skip_name_includes_pedidos: skipNameIncludesPedidos,
    require_name_prefixes_pedidos: requireNamePrefixesPedidos,
    skip_name_includes_cuentaventa: skipNameIncludesCuentaVenta,
    require_name_prefixes_cuentaventa: requireNamePrefixesCuentaVenta,
  };
};

const AdminSettings = () => {
  const { user: currentUser, isAdmin, role, allowedRoutes } = useAuth();
  const { toast } = useToast();

  const [entries, setEntries] = useState<UserRoleRow[]>([]);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfigTarget, setDeleteConfigTarget] = useState<UserDeleteTarget | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserDeleteTarget | null>(null);

  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('user');
  const [creating, setCreating] = useState(false);
  const [accessTab, setAccessTab] = useState<'create' | 'permissions'>('create');

  const [formUserId, setFormUserId] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('user');
  const [formRoutes, setFormRoutes] = useState<string[]>(DEFAULT_USER_ROUTES);

  const [clientesLoading, setClientesLoading] = useState(false);
  const [clienteIds, setClienteIds] = useState<number[]>([]);
  const [clientesVisibles, setClientesVisibles] = useState<Set<number>>(new Set());
  const [clienteIdsCuentaVenta, setClienteIdsCuentaVenta] = useState<number[]>([]);
  const [clientesVisiblesCuentaVenta, setClientesVisiblesCuentaVenta] = useState<Set<number>>(new Set());
  const [clienteNombres, setClienteNombres] = useState<Record<number, string>>({});
  const [clienteFilter, setClienteFilter] = useState('');
  const [clienteVisibilityFilter, setClienteVisibilityFilter] = useState<ClientesVisibilityFilter>('all');
  const [clienteCuentaVentaFilter, setClienteCuentaVentaFilter] = useState('');
  const [clienteCuentaVentaVisibilityFilter, setClienteCuentaVentaVisibilityFilter] =
    useState<ClientesVisibilityFilter>('all');
  const [clienteUpdating, setClienteUpdating] = useState<Set<number>>(new Set());
  const [clienteCuentaVentaUpdating, setClienteCuentaVentaUpdating] = useState<Set<number>>(new Set());
  const [clienteBehaviorRules, setClienteBehaviorRules] = useState<Record<number, ClienteBehaviorRuleConfig>>({});
  const [clienteBehaviorInputs, setClienteBehaviorInputs] = useState<ClienteBehaviorInputState>({});
  const [clienteBehaviorUpdating, setClienteBehaviorUpdating] = useState<Set<number>>(new Set());
  const [clienteBehaviorFilter, setClienteBehaviorFilter] = useState('');
  const [clienteBehaviorStateFilter, setClienteBehaviorStateFilter] = useState<ClientesBehaviorFilter>('all');
  const [clienteBehaviorListScope, setClienteBehaviorListScope] = useState<ClienteBehaviorListScope>('pedidos');
  const [clienteToAddId, setClienteToAddId] = useState<number | null>(null);
  const [clienteCuentaVentaToAddId, setClienteCuentaVentaToAddId] = useState<number | null>(null);
  const [addingClienteVisible, setAddingClienteVisible] = useState(false);
  const [addingClienteVisibleCuentaVenta, setAddingClienteVisibleCuentaVenta] = useState(false);
  const [visibilityScope, setVisibilityScope] = useState<VisibilityScopeOption>('pedidos');
  const [facturaErpRules, setFacturaErpRules] = useState<FacturaRecibidaErpRule[]>([]);
  const [facturaErpRulesLoading, setFacturaErpRulesLoading] = useState(false);
  const [facturaErpRuleSaving, setFacturaErpRuleSaving] = useState(false);
  const [facturaErpRuleDraft, setFacturaErpRuleDraft] = useState<FacturaErpRuleDraft>(emptyFacturaErpRuleDraft);

  const isEditing = useMemo(() => entries.some((e) => e.user_id === formUserId), [entries, formUserId]);
  const clientesOcultos = useMemo(
    () => Math.max(clienteIds.length - clientesVisibles.size, 0),
    [clienteIds, clientesVisibles],
  );
  const clientesCuentaVentaOcultos = useMemo(
    () => Math.max(clienteIdsCuentaVenta.length - clientesVisiblesCuentaVenta.size, 0),
    [clienteIdsCuentaVenta, clientesVisiblesCuentaVenta],
  );
  const adminCount = useMemo(
    () => entries.filter((entry) => entry.role === 'admin').length,
    [entries],
  );
  const configuredCount = useMemo(() => entries.length, [entries]);
  const clienteBehaviorIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...clienteIds,
          ...clienteIdsCuentaVenta,
          ...Object.keys(clienteBehaviorRules).map((id) => Number(id)).filter((id) => Number.isFinite(id)),
        ]),
      ).sort((a, b) => a - b),
    [clienteBehaviorRules, clienteIds, clienteIdsCuentaVenta],
  );
  const clientesConReglasActivas = useMemo(
    () =>
      clienteBehaviorIds.filter((clienteid) =>
        hasVisibleClienteBehaviorRules(
          clienteBehaviorRules[clienteid] ?? buildClienteBehaviorRule(clienteid, DEFAULT_CLIENT_BEHAVIOR_RULE),
        ),
      ).length,
    [clienteBehaviorIds, clienteBehaviorRules],
  );

  const resetForm = () => {
    setFormUserId('');
    setFormEmail('');
    setFormRole('user');
    setFormRoutes(DEFAULT_USER_ROUTES);
  };

  const setClienteUpdatingState = (clienteid: number, updating: boolean) => {
    setClienteUpdating((prev) => {
      const next = new Set(prev);
      if (updating) next.add(clienteid);
      else next.delete(clienteid);
      return next;
    });
  };

  const setClienteCuentaVentaUpdatingState = (clienteid: number, updating: boolean) => {
    setClienteCuentaVentaUpdating((prev) => {
      const next = new Set(prev);
      if (updating) next.add(clienteid);
      else next.delete(clienteid);
      return next;
    });
  };

  const setClienteBehaviorUpdatingState = (clienteid: number, updating: boolean) => {
    setClienteBehaviorUpdating((prev) => {
      const next = new Set(prev);
      if (updating) next.add(clienteid);
      else next.delete(clienteid);
      return next;
    });
  };

  const loadClienteNames = async (ids: number[]) => {
    const nombresEntries = await Promise.all(
      ids.map(async (clienteId) => {
        try {
          const cliente = await agroirisClients.getClientById(clienteId);
          return [clienteId, cliente?.nombre_sujeto || `Cliente #${clienteId}`] as const;
        } catch (error) {
          console.error(`Error loading cliente ${clienteId}:`, error);
          return [clienteId, `Cliente #${clienteId}`] as const;
        }
      }),
    );

    const nombres = Object.fromEntries(nombresEntries);
    setClienteNombres(nombres);
  };

  const loadSingleClienteName = async (clienteId: number) => {
    try {
      const cliente = await agroirisClients.getClientById(clienteId);
      const nombre = cliente?.nombre_sujeto || `Cliente #${clienteId}`;
      setClienteNombres((prev) => ({ ...prev, [clienteId]: nombre }));
    } catch (error) {
      console.error(`Error loading cliente ${clienteId}:`, error);
      setClienteNombres((prev) => ({ ...prev, [clienteId]: `Cliente #${clienteId}` }));
    }
  };

  const loadClientesConfig = async () => {
    try {
      setClientesLoading(true);
      const [
        clienteIdsPedidosRes,
        clienteIdsCuentaVentaRes,
        visiblesPedidosRes,
        visiblesCuentaVentaRes,
        behaviorRulesRes,
      ] = await Promise.all([
        supabase.rpc('list_clienteids'),
        supabase.rpc('list_clienteids_cuentaventa'),
        supabase.from('clientes_visibles').select('clienteid'),
        supabase.from('clientes_visibles_cuentaventa').select('clienteid'),
        supabase
          .from('cliente_behavior_rules')
          .select(CLIENT_BEHAVIOR_SELECT as '*'),
      ]);

      if (clienteIdsPedidosRes.error) throw clienteIdsPedidosRes.error;
      if (clienteIdsCuentaVentaRes.error) throw clienteIdsCuentaVentaRes.error;
      if (visiblesPedidosRes.error) throw visiblesPedidosRes.error;
      if (visiblesCuentaVentaRes.error) throw visiblesCuentaVentaRes.error;
      if (behaviorRulesRes.error) throw behaviorRulesRes.error;

      const pedidoIdsFromDb = (clienteIdsPedidosRes.data ?? [])
        .map((row: { clienteid: number | null }) => row.clienteid)
        .filter((id): id is number => typeof id === 'number');
      const cuentaVentaIdsFromDb = (clienteIdsCuentaVentaRes.data ?? [])
        .map((row: { clienteid: number | null }) => row.clienteid)
        .filter((id): id is number => typeof id === 'number');

      const visiblesPedidosSet = new Set(
        (visiblesPedidosRes.data ?? [])
          .map((row: Pick<ClienteVisibleRow, 'clienteid'>) => row.clienteid)
          .filter((id): id is number => typeof id === 'number'),
      );
      const visiblesCuentaVentaSet = new Set(
        (visiblesCuentaVentaRes.data ?? [])
          .map((row: Pick<ClienteVisibleCuentaVentaRow, 'clienteid'>) => row.clienteid)
          .filter((id): id is number => typeof id === 'number'),
      );

      const rulesMap: Record<number, ClienteBehaviorRuleConfig> = {};
      const ruleIds: number[] = [];
      for (const row of behaviorRulesRes.data ?? []) {
        if (typeof row.clienteid !== 'number') continue;
        ruleIds.push(row.clienteid);
        rulesMap[row.clienteid] = buildClienteBehaviorRule(row.clienteid, row);
      }

      const mergedPedidos = Array.from(new Set([...pedidoIdsFromDb, ...visiblesPedidosSet, ...ruleIds])).sort(
        (a, b) => a - b,
      );
      const mergedCuentaVenta = Array.from(new Set([...cuentaVentaIdsFromDb, ...visiblesCuentaVentaSet])).sort(
        (a, b) => a - b,
      );
      const mergedBehavior = Array.from(new Set([...mergedPedidos, ...mergedCuentaVenta, ...ruleIds])).sort(
        (a, b) => a - b,
      );
      const mergedForNames = Array.from(new Set([...mergedPedidos, ...mergedCuentaVenta])).sort((a, b) => a - b);

      const behaviorInputMap: ClienteBehaviorInputState = {};
      for (const clienteid of mergedBehavior) {
        const rule = rulesMap[clienteid] ?? buildClienteBehaviorRule(clienteid, DEFAULT_CLIENT_BEHAVIOR_RULE);
        behaviorInputMap[clienteid] = {
          skip_name_includes_pedidos: serializeRuleStringList(rule.skip_name_includes_pedidos),
          require_name_prefixes_pedidos: serializeRuleStringList(rule.require_name_prefixes_pedidos),
          skip_name_includes_cuentaventa: serializeRuleStringList(rule.skip_name_includes_cuentaventa),
          require_name_prefixes_cuentaventa: serializeRuleStringList(rule.require_name_prefixes_cuentaventa),
        };
      }
      await loadClienteNames(mergedForNames);

      setClienteIds(mergedPedidos);
      setClientesVisibles(visiblesPedidosSet);
      setClienteIdsCuentaVenta(mergedCuentaVenta);
      setClientesVisiblesCuentaVenta(visiblesCuentaVentaSet);
      setClienteBehaviorRules(rulesMap);
      setClienteBehaviorInputs(behaviorInputMap);
      clearClienteBehaviorRuleCache();
    } catch (err: any) {
      console.error('Error cargando configuración de clientes:', err);
      toast({
        title: 'No se pudo cargar la configuración de clientes',
        description: err?.message ?? 'Aplica la migración y prueba nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setClientesLoading(false);
    }
  };

  const loadFacturaErpRules = async () => {
    try {
      setFacturaErpRulesLoading(true);
      setFacturaErpRules(await facturasRecibidasErpRules.list());
    } catch (err: any) {
      console.error('Error cargando reglas ERP de facturas recibidas:', err);
      toast({
        title: 'No se pudieron cargar las reglas de facturas',
        description: err?.message ?? 'Aplica la migraci\u00f3n y prueba nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setFacturaErpRulesLoading(false);
    }
  };

  const resetFacturaErpRuleDraft = () => {
    setFacturaErpRuleDraft(emptyFacturaErpRuleDraft());
  };

  const editFacturaErpRule = (rule: FacturaRecibidaErpRule) => {
    setFacturaErpRuleDraft({
      id: rule.id,
      empresaId: String(rule.empresa_id),
      proveedorId: rule.proveedor_id,
      ejercicioErp: rule.ejercicio_erp === null ? '' : String(rule.ejercicio_erp),
      tipoFactura: rule.tipo_factura ?? '',
      regimenId: rule.regimen_id === null ? '' : String(rule.regimen_id),
      fechaCtbPolicy: rule.fecha_ctb_policy ?? 'inherit',
      cuentaGastoDefault: rule.cuenta_gasto_default ?? '',
      conceptoTemplate: rule.concepto_template ?? '',
      contabilizarDefault: 'N',
      activo: rule.activo,
      approvalNote: rule.approval_note ?? '',
    });
  };

  const saveFacturaErpRule = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      setFacturaErpRuleSaving(true);
      const empresaId = parseOptionalPositiveInteger(facturaErpRuleDraft.empresaId, 'La empresa ERP');
      if (empresaId === null) throw new Error('La empresa ERP es obligatoria.');

      await facturasRecibidasErpRules.save({
        id: facturaErpRuleDraft.id,
        empresa_id: empresaId,
        proveedor_id: facturaErpRuleDraft.proveedorId,
        ejercicio_erp: parseOptionalPositiveInteger(facturaErpRuleDraft.ejercicioErp, 'El ejercicio ERP'),
        tipo_factura: facturaErpRuleDraft.tipoFactura,
        regimen_id: parseOptionalPositiveInteger(facturaErpRuleDraft.regimenId, 'El r\u00e9gimen IVA'),
        fecha_ctb_policy:
          facturaErpRuleDraft.fechaCtbPolicy === 'inherit'
            ? null
            : facturaErpRuleDraft.fechaCtbPolicy,
        cuenta_gasto_default: facturaErpRuleDraft.cuentaGastoDefault,
        concepto_template: facturaErpRuleDraft.conceptoTemplate,
        contabilizar_default: 'N',
        activo: facturaErpRuleDraft.activo,
        approval_note: facturaErpRuleDraft.approvalNote,
      });

      toast({
        title: 'Regla de facturas guardada',
        description: facturaErpRuleDraft.proveedorId
          ? `Configuraci\u00f3n guardada para empresa ${empresaId} y acreedor ${facturaErpRuleDraft.proveedorId}.`
          : `Configuraci\u00f3n general guardada para empresa ${empresaId}.`,
      });
      resetFacturaErpRuleDraft();
      await loadFacturaErpRules();
    } catch (err: any) {
      console.error('Error guardando regla ERP de facturas recibidas:', err);
      toast({
        title: 'No se pudo guardar la regla',
        description: err?.message ?? 'Revisa los valores e int\u00e9ntalo de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setFacturaErpRuleSaving(false);
    }
  };

  const toggleClienteVisible = async (clienteid: number, nextVisible: boolean) => {
    setClienteUpdatingState(clienteid, true);

    setClientesVisibles((prev) => {
      const next = new Set(prev);
      if (nextVisible) next.add(clienteid);
      else next.delete(clienteid);
      return next;
    });

    try {
      if (nextVisible) {
        const { error } = await supabase
          .from('clientes_visibles')
          .upsert({ clienteid }, { onConflict: 'clienteid', ignoreDuplicates: true });
        if (error) throw error;
        toast({ title: 'Cliente visible', description: `clienteid ${clienteid} ahora es visible para usuarios.` });
      } else {
        const { error } = await supabase.from('clientes_visibles').delete().eq('clienteid', clienteid);
        if (error) throw error;
        toast({ title: 'Cliente oculto', description: `clienteid ${clienteid} ya no es visible para usuarios.` });
      }
    } catch (err: any) {
      console.error('Error actualizando visibilidad de cliente:', err);
      setClientesVisibles((prev) => {
        const next = new Set(prev);
        if (nextVisible) next.delete(clienteid);
        else next.add(clienteid);
        return next;
      });
      toast({
        title: 'No se pudo actualizar',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setClienteUpdatingState(clienteid, false);
    }
  };

  const addClienteVisibleFromSelector = async () => {
    if (!clienteToAddId || clienteToAddId <= 0) {
      toast({
        title: 'Selecciona un cliente',
        description: 'Debes elegir un cliente antes de agregarlo.',
        variant: 'destructive',
      });
      return;
    }

    const clienteid = clienteToAddId;
    setAddingClienteVisible(true);
    setClienteUpdatingState(clienteid, true);

    try {
      const { error } = await supabase
        .from('clientes_visibles')
        .upsert({ clienteid }, { onConflict: 'clienteid', ignoreDuplicates: true });

      if (error) throw error;

      setClientesVisibles((prev) => {
        const next = new Set(prev);
        next.add(clienteid);
        return next;
      });
      setClienteIds((prev) =>
        prev.includes(clienteid) ? prev : [...prev, clienteid].sort((a, b) => a - b),
      );
      if (!clienteNombres[clienteid]) {
        await loadSingleClienteName(clienteid);
      }
      setClienteToAddId(null);

      toast({
        title: 'Cliente agregado',
        description: `clienteid ${clienteid} disponible para selección e inserción manual.`,
      });
    } catch (err: any) {
      console.error('Error agregando cliente visible:', err);
      toast({
        title: 'No se pudo agregar el cliente',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setClienteUpdatingState(clienteid, false);
      setAddingClienteVisible(false);
    }
  };

  const toggleClienteVisibleCuentaVenta = async (clienteid: number, nextVisible: boolean) => {
    setClienteCuentaVentaUpdatingState(clienteid, true);

    setClientesVisiblesCuentaVenta((prev) => {
      const next = new Set(prev);
      if (nextVisible) next.add(clienteid);
      else next.delete(clienteid);
      return next;
    });

    try {
      if (nextVisible) {
        const { error } = await supabase
          .from('clientes_visibles_cuentaventa')
          .upsert({ clienteid }, { onConflict: 'clienteid', ignoreDuplicates: true });
        if (error) throw error;
        toast({
          title: 'Cliente visible en cuentas de venta',
          description: `clienteid ${clienteid} ahora es visible para usuarios en /cuentas.`,
        });
      } else {
        const { error } = await supabase
          .from('clientes_visibles_cuentaventa')
          .delete()
          .eq('clienteid', clienteid);
        if (error) throw error;
        toast({
          title: 'Cliente oculto en cuentas de venta',
          description: `clienteid ${clienteid} ya no es visible para usuarios en /cuentas.`,
        });
      }
    } catch (err: any) {
      console.error('Error actualizando visibilidad de cuentas de venta:', err);
      setClientesVisiblesCuentaVenta((prev) => {
        const next = new Set(prev);
        if (nextVisible) next.delete(clienteid);
        else next.add(clienteid);
        return next;
      });
      toast({
        title: 'No se pudo actualizar',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setClienteCuentaVentaUpdatingState(clienteid, false);
    }
  };

  const addClienteVisibleCuentaVentaFromSelector = async () => {
    if (!clienteCuentaVentaToAddId || clienteCuentaVentaToAddId <= 0) {
      toast({
        title: 'Selecciona un cliente',
        description: 'Debes elegir un cliente antes de agregarlo.',
        variant: 'destructive',
      });
      return;
    }

    const clienteid = clienteCuentaVentaToAddId;
    setAddingClienteVisibleCuentaVenta(true);
    setClienteCuentaVentaUpdatingState(clienteid, true);

    try {
      const { error } = await supabase
        .from('clientes_visibles_cuentaventa')
        .upsert({ clienteid }, { onConflict: 'clienteid', ignoreDuplicates: true });

      if (error) throw error;

      setClientesVisiblesCuentaVenta((prev) => {
        const next = new Set(prev);
        next.add(clienteid);
        return next;
      });
      setClienteIdsCuentaVenta((prev) =>
        prev.includes(clienteid) ? prev : [...prev, clienteid].sort((a, b) => a - b),
      );
      if (!clienteNombres[clienteid]) {
        await loadSingleClienteName(clienteid);
      }
      setClienteCuentaVentaToAddId(null);

      toast({
        title: 'Cliente agregado',
        description: `clienteid ${clienteid} disponible para cuentas de venta.`,
      });
    } catch (err: any) {
      console.error('Error agregando cliente visible de cuentas de venta:', err);
      toast({
        title: 'No se pudo agregar el cliente',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setClienteCuentaVentaUpdatingState(clienteid, false);
      setAddingClienteVisibleCuentaVenta(false);
    }
  };

  const getClienteBehaviorRuleConfig = (clienteid: number): ClienteBehaviorRuleConfig =>
    clienteBehaviorRules[clienteid] ?? buildClienteBehaviorRule(clienteid, DEFAULT_CLIENT_BEHAVIOR_RULE);

  const getRuleScopedListValue = (
    rule: ClienteBehaviorRuleConfig,
    scope: ClienteBehaviorListScope,
    field: ClienteBehaviorListField,
  ) => {
    const key = getScopedListFieldKey(field, scope);
    return normalizeRuleStringList(rule[key]);
  };

  const withRuleScopedListValue = (
    rule: ClienteBehaviorRuleConfig,
    scope: ClienteBehaviorListScope,
    field: ClienteBehaviorListField,
    value: string[],
  ): ClienteBehaviorRuleConfig => {
    const key = getScopedListFieldKey(field, scope);
    const normalized = normalizeRuleStringList(value);

    const nextRule: ClienteBehaviorRuleConfig = {
      ...rule,
      [key]: normalized,
    };

    // Legacy aliases stay aligned with pedidos scope for compatibility.
    if (scope === 'pedidos') {
      if (field === 'skip_name_includes') nextRule.skip_name_includes = normalized;
      if (field === 'require_name_prefixes') nextRule.require_name_prefixes = normalized;
    }

    return nextRule;
  };

  const getClienteBehaviorInputValue = (
    clienteid: number,
    scope: ClienteBehaviorListScope,
    field: ClienteBehaviorListField,
    fallback: string[],
  ) => {
    const key = getScopedListFieldKey(field, scope);
    return clienteBehaviorInputs[clienteid]?.[key] ?? serializeRuleStringList(fallback);
  };

  const setClienteBehaviorInputValue = (
    clienteid: number,
    scope: ClienteBehaviorListScope,
    field: ClienteBehaviorListField,
    value: string,
  ) => {
    const key = getScopedListFieldKey(field, scope);
    setClienteBehaviorInputs((prev) => ({
      ...prev,
      [clienteid]: {
        skip_name_includes_pedidos: prev[clienteid]?.skip_name_includes_pedidos ?? '',
        require_name_prefixes_pedidos: prev[clienteid]?.require_name_prefixes_pedidos ?? '',
        skip_name_includes_cuentaventa: prev[clienteid]?.skip_name_includes_cuentaventa ?? '',
        require_name_prefixes_cuentaventa: prev[clienteid]?.require_name_prefixes_cuentaventa ?? '',
        [key]: value,
      },
    }));
  };

  const toggleClienteBehaviorRule = async (
    clienteid: number,
    field: ClienteBehaviorToggleField,
    nextValue: boolean,
  ) => {
    const currentRule = getClienteBehaviorRuleConfig(clienteid);
    if (field === 'block_duplicate_reference_same_pdf' && !currentRule.allow_duplicate_reference) {
      return;
    }

    const nextRule: ClienteBehaviorRuleConfig = {
      ...currentRule,
      [field]: nextValue,
    };

    if (field === 'allow_duplicate_reference' && !nextValue) {
      nextRule.block_duplicate_reference_same_pdf = false;
    }

    setClienteBehaviorUpdatingState(clienteid, true);
    setClienteBehaviorRules((prev) => ({
      ...prev,
      [clienteid]: nextRule,
    }));

    try {
      const payload: Record<string, unknown> = { clienteid };
      for (const key of CLIENT_BEHAVIOR_TOGGLE_FIELDS) {
        payload[key] = nextRule[key];
      }
      const { data, error } = await supabase
        .from('cliente_behavior_rules')
        .upsert(payload, { onConflict: 'clienteid' })
        .select(CLIENT_BEHAVIOR_SELECT as '*')
        .single();

      if (error) throw error;

      if (data?.clienteid) {
        const savedRule = buildClienteBehaviorRule(data.clienteid, data);
        clearClienteBehaviorRuleCache();
        setClienteBehaviorRules((prev) => ({
          ...prev,
          [data.clienteid]: savedRule,
        }));
        setClienteBehaviorInputs((prev) => ({
          ...prev,
          [data.clienteid]: {
            skip_name_includes_pedidos: serializeRuleStringList(savedRule.skip_name_includes_pedidos),
            require_name_prefixes_pedidos: serializeRuleStringList(savedRule.require_name_prefixes_pedidos),
            skip_name_includes_cuentaventa: serializeRuleStringList(savedRule.skip_name_includes_cuentaventa),
            require_name_prefixes_cuentaventa: serializeRuleStringList(savedRule.require_name_prefixes_cuentaventa),
          },
        }));
        setClienteIds((prev) =>
          prev.includes(data.clienteid)
            ? prev
            : [...prev, data.clienteid].sort((a, b) => a - b),
        );
      }

      toast({
        title: 'Regla actualizada',
        description: `Configuración guardada para clienteid ${clienteid}.`,
      });
    } catch (err: any) {
      console.error('Error actualizando regla de cliente:', err);
      setClienteBehaviorRules((prev) => ({
        ...prev,
        [clienteid]: currentRule,
      }));
      setClienteBehaviorInputs((prev) => ({
        ...prev,
        [clienteid]: {
          skip_name_includes_pedidos: serializeRuleStringList(currentRule.skip_name_includes_pedidos),
          require_name_prefixes_pedidos: serializeRuleStringList(currentRule.require_name_prefixes_pedidos),
          skip_name_includes_cuentaventa: serializeRuleStringList(currentRule.skip_name_includes_cuentaventa),
          require_name_prefixes_cuentaventa: serializeRuleStringList(currentRule.require_name_prefixes_cuentaventa),
        },
      }));
      toast({
        title: 'No se pudo actualizar la regla',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setClienteBehaviorUpdatingState(clienteid, false);
    }
  };

  const saveClienteBehaviorFilters = async (clienteid: number) => {
    const currentRule = getClienteBehaviorRuleConfig(clienteid);
    const scope = clienteBehaviorListScope;
    const scopeLabel = scope === 'pedidos' ? 'Pedidos' : 'Cuentas de venta';
    const currentSkipNames = getRuleScopedListValue(currentRule, scope, 'skip_name_includes');
    const currentRequiredPrefixes = getRuleScopedListValue(currentRule, scope, 'require_name_prefixes');

    const rawSkipNames = getClienteBehaviorInputValue(
      clienteid,
      scope,
      'skip_name_includes',
      currentSkipNames,
    );
    const rawRequiredPrefixes = getClienteBehaviorInputValue(
      clienteid,
      scope,
      'require_name_prefixes',
      currentRequiredPrefixes,
    );

    const nextSkipNames = parseRuleStringListInput(rawSkipNames);
    const nextRequiredPrefixes = parseRuleStringListInput(rawRequiredPrefixes);

    const hasChanges =
      !areStringListsEqual(nextSkipNames, currentSkipNames) ||
      !areStringListsEqual(nextRequiredPrefixes, currentRequiredPrefixes);

    if (!hasChanges) {
      toast({
        title: 'Sin cambios',
        description: `No hay filtros nuevos de ${scopeLabel.toLowerCase()} para clienteid ${clienteid}.`,
      });
      return;
    }

    const nextRule = withRuleScopedListValue(
      withRuleScopedListValue(currentRule, scope, 'skip_name_includes', nextSkipNames),
      scope,
      'require_name_prefixes',
      nextRequiredPrefixes,
    );

    setClienteBehaviorUpdatingState(clienteid, true);
    setClienteBehaviorRules((prev) => ({
      ...prev,
      [clienteid]: nextRule,
    }));
    setClienteBehaviorInputs((prev) => ({
      ...prev,
      [clienteid]: {
        skip_name_includes_pedidos: serializeRuleStringList(nextRule.skip_name_includes_pedidos),
        require_name_prefixes_pedidos: serializeRuleStringList(nextRule.require_name_prefixes_pedidos),
        skip_name_includes_cuentaventa: serializeRuleStringList(nextRule.skip_name_includes_cuentaventa),
        require_name_prefixes_cuentaventa: serializeRuleStringList(nextRule.require_name_prefixes_cuentaventa),
      },
    }));

    try {
      const payload: Record<string, unknown> = { clienteid };

      if (scope === 'pedidos') {
        payload.skip_name_includes_pedidos = nextRule.skip_name_includes_pedidos;
        payload.require_name_prefixes_pedidos = nextRule.require_name_prefixes_pedidos;
        // Legacy compatibility
        payload.skip_name_includes = nextRule.skip_name_includes_pedidos;
        payload.require_name_prefixes = nextRule.require_name_prefixes_pedidos;
      } else {
        payload.skip_name_includes_cuentaventa = nextRule.skip_name_includes_cuentaventa;
        payload.require_name_prefixes_cuentaventa = nextRule.require_name_prefixes_cuentaventa;
      }

      const { data, error } = await supabase
        .from('cliente_behavior_rules')
        .upsert(payload, { onConflict: 'clienteid' })
        .select(CLIENT_BEHAVIOR_SELECT as '*')
        .single();

      if (error) throw error;

      if (data?.clienteid) {
        const savedRule = buildClienteBehaviorRule(data.clienteid, data);
        clearClienteBehaviorRuleCache();
        setClienteBehaviorRules((prev) => ({
          ...prev,
          [data.clienteid]: savedRule,
        }));
        setClienteBehaviorInputs((prev) => ({
          ...prev,
          [data.clienteid]: {
            skip_name_includes_pedidos: serializeRuleStringList(savedRule.skip_name_includes_pedidos),
            require_name_prefixes_pedidos: serializeRuleStringList(savedRule.require_name_prefixes_pedidos),
            skip_name_includes_cuentaventa: serializeRuleStringList(savedRule.skip_name_includes_cuentaventa),
            require_name_prefixes_cuentaventa: serializeRuleStringList(savedRule.require_name_prefixes_cuentaventa),
          },
        }));
        setClienteIds((prev) =>
          prev.includes(data.clienteid)
            ? prev
            : [...prev, data.clienteid].sort((a, b) => a - b),
        );
      }

      toast({
        title: 'Filtros guardados',
        description: `Filtros de PDF (${scopeLabel}) actualizados para clienteid ${clienteid}.`,
      });
    } catch (err: any) {
      console.error('Error guardando filtros de PDF por cliente:', err);
      setClienteBehaviorRules((prev) => ({
        ...prev,
        [clienteid]: currentRule,
      }));
      setClienteBehaviorInputs((prev) => ({
        ...prev,
        [clienteid]: {
          skip_name_includes_pedidos: serializeRuleStringList(currentRule.skip_name_includes_pedidos),
          require_name_prefixes_pedidos: serializeRuleStringList(currentRule.require_name_prefixes_pedidos),
          skip_name_includes_cuentaventa: serializeRuleStringList(currentRule.skip_name_includes_cuentaventa),
          require_name_prefixes_cuentaventa: serializeRuleStringList(currentRule.require_name_prefixes_cuentaventa),
        },
      }));
      toast({
        title: 'No se pudieron guardar los filtros',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setClienteBehaviorUpdatingState(clienteid, false);
    }
  };

  const loadEntries = async () => {
    try {
      setLoadingList(true);
      const { data, error } = await supabase
        .from('user_roles')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEntries(data ?? []);
    } catch (err: any) {
      console.error('Error cargando roles:', err);
      toast({
        title: 'No se pudieron cargar los roles',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setLoadingList(false);
    }
  };

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const { data, error } = await supabase.rpc('get_app_users');
      if (error) throw error;
      setAppUsers(data ?? []);
    } catch (err: any) {
      console.error('Error cargando usuarios:', err);
      toast({
        title: 'No se pudieron cargar los usuarios',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleRefreshAll = async () => {
    await Promise.all([loadEntries(), loadUsers(), loadClientesConfig(), loadFacturaErpRules()]);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createEmail.trim() || !createPassword.trim()) {
      toast({
        title: 'Faltan datos',
        description: 'Introduce email y contraseña.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setCreating(true);
      const { data, error } = await supabase.functions.invoke('admin-create-user', {
        body: {
          email: createEmail.trim(),
          password: createPassword,
          role: createRole,
          allowed_routes: createRole === 'admin' ? null : DEFAULT_USER_ROUTES,
        },
      });

      if (error) throw error;

      toast({
        title: 'Usuario creado',
        description: `Se creó ${data?.email || createEmail}`,
      });
      setCreateEmail('');
      setCreatePassword('');
      setCreateRole('user');
      await handleRefreshAll();
    } catch (err: any) {
      console.error('Error creando usuario:', err);
      toast({
        title: 'No se pudo crear el usuario',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    void Promise.all([loadClientesConfig(), loadFacturaErpRules()]);
  }, [isAdmin]);
  const toggleRoute = (route: string, checked: boolean) => {
    setFormRoutes((prev) => {
      const set = new Set(prev);
      if (checked) set.add(route);
      else set.delete(route);
      return Array.from(set);
    });
  };

  const handleSelectEntry = (entry: UserRoleRow) => {
    setFormUserId(entry.user_id);
    setFormEmail(entry.user_email ?? '');
    setFormRole(entry.role as UserRole);
    setFormRoutes(normalizeAllowedRoutes(entry.allowed_routes));
    setAccessTab('permissions');
  };

  const handleSelectUser = (user: AppUser) => {
    const existing = entries.find((e) => e.user_id === user.id);
    if (existing) {
      handleSelectEntry(existing);
      return;
    }
    setFormUserId(user.id);
    setFormEmail(user.email ?? '');
    setFormRole('user');
    setFormRoutes(DEFAULT_USER_ROUTES);
    setAccessTab('permissions');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formUserId.trim()) {
      toast({ title: 'Falta el ID de usuario', description: 'Introduce el ID de usuario para guardar.' });
      return;
    }

    try {
      setSaving(true);
      const payload = {
        user_id: formUserId.trim(),
        user_email: formEmail.trim() || null,
        role: formRole,
        allowed_routes: formRole === 'admin' ? null : normalizeAllowedRoutes(formRoutes),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('user_roles').upsert(payload);
      if (error) throw error;

      toast({
        title: 'Permisos guardados',
        description: formRole === 'admin'
          ? 'Este usuario ahora es administrador.'
          : 'Permisos actualizados para usuario.',
      });
      await loadEntries();
      resetForm();
    } catch (err: any) {
      console.error('Error guardando permisos:', err);
      toast({
        title: 'No se pudieron guardar los permisos',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const openDeleteDialog = (target: UserDeleteTarget) => {
    if (deletingId) return;
    setDeleteConfigTarget(target);
  };

  const handleDeleteConfigurationOnly = async (target: UserDeleteTarget) => {
    const userId = target.userId;
    try {
      setDeletingId(userId);
      const { error } = await supabase.from('user_roles').delete().eq('user_id', userId);
      if (error) throw error;
      toast({ title: 'Eliminado', description: 'Se quitaron los permisos del usuario.' });
      await loadEntries();
      if (formUserId === userId) resetForm();
    } catch (err: any) {
      console.error('Error eliminando usuario:', err);
      toast({
        title: 'No se pudo eliminar',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
      setDeleteConfigTarget(null);
    }
  };

  const handleDeleteAuthUser = async (target: UserDeleteTarget) => {
    if (currentUser?.id === target.userId) {
      toast({
        title: 'Operación no permitida',
        description: 'No puedes eliminar tu propio usuario desde este panel.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setDeletingId(target.userId);
      const { data: rpcData, error: rpcError } = await supabase.rpc('admin_delete_user', {
        p_user_id: target.userId,
      });

      if (rpcError) {
        if (!isMissingRpcFunctionError(rpcError)) {
          throw new Error(rpcError.message ?? 'No se pudo eliminar el usuario.');
        }

        const { data, error } = await supabase.functions.invoke('admin-delete-user', {
          body: {
            user_id: target.userId,
          },
        });

        const functionErrorMessage = getFunctionErrorMessage(data);
        if (error) throw new Error(functionErrorMessage ?? error.message ?? 'No se pudo eliminar el usuario.');
        if (functionErrorMessage) throw new Error(functionErrorMessage);
      } else {
        const functionErrorMessage = getFunctionErrorMessage(rpcData);
        if (functionErrorMessage) throw new Error(functionErrorMessage);
      }

      toast({
        title: 'Usuario eliminado',
        description: `Se eliminó ${target.email ?? target.userId} de Auth y su configuración.`,
      });
      await Promise.all([loadEntries(), loadUsers()]);
      if (formUserId === target.userId) resetForm();
    } catch (err: any) {
      console.error('Error eliminando usuario de Auth:', err);
      toast({
        title: 'No se pudo eliminar el usuario',
        description: err?.message ?? 'Intenta nuevamente.',
        variant: 'destructive',
      });
    } finally {
      setDeletingId(null);
      setDeleteUserTarget(null);
      setDeleteConfigTarget(null);
    }
  };

  const userRoutesAvailable = useMemo(
    () => [...USER_ROUTE_OPTIONS].sort((a, b) => a.path.localeCompare(b.path)),
    []
  );
  const pedidosGroupChecked = PEDIDOS_GROUP_ROUTES.every((r) => formRoutes.includes(r));
  const pedidosGroupPartial =
    PEDIDOS_GROUP_ROUTES.some((r) => formRoutes.includes(r)) && !pedidosGroupChecked;
  const pedidosGroupState = pedidosGroupChecked ? true : pedidosGroupPartial ? 'indeterminate' : false;
  const controlEntradaGroupChecked = CONTROL_ENTRADA_GROUP_ROUTES.every((r) => formRoutes.includes(r));
  const controlEntradaGroupPartial =
    CONTROL_ENTRADA_GROUP_ROUTES.some((r) => formRoutes.includes(r)) && !controlEntradaGroupChecked;
  const controlEntradaGroupState = controlEntradaGroupChecked ? true : controlEntradaGroupPartial ? 'indeterminate' : false;
  const correosGroupChecked = CORREOS_GROUP_ROUTES.every((r) => formRoutes.includes(r));
  const correosGroupPartial =
    CORREOS_GROUP_ROUTES.some((r) => formRoutes.includes(r)) && !correosGroupChecked;
  const correosGroupState = correosGroupChecked ? true : correosGroupPartial ? 'indeterminate' : false;

  const filteredClienteIds = useMemo(() => {
    const normalizedFilter = clienteFilter.trim();
    const normalizedFilterLower = normalizedFilter.toLowerCase();
    return clienteIds
      .filter((id) => {
        if (!normalizedFilter) return true;
        return (
          String(id).includes(normalizedFilter) ||
          (clienteNombres[id] ?? '').toLowerCase().includes(normalizedFilterLower)
        );
      })
      .filter((id) => {
        if (clienteVisibilityFilter === 'all') return true;
        const isVisible = clientesVisibles.has(id);
        return clienteVisibilityFilter === 'visible' ? isVisible : !isVisible;
      });
  }, [clienteFilter, clienteIds, clienteNombres, clienteVisibilityFilter, clientesVisibles]);

  const filteredClienteIdsCuentaVenta = useMemo(() => {
    const normalizedFilter = clienteCuentaVentaFilter.trim();
    return clienteIdsCuentaVenta
      .filter((id) => {
        if (!normalizedFilter) return true;
        return (
          String(id).includes(normalizedFilter) ||
          (clienteNombres[id] ?? '').toLowerCase().includes(normalizedFilter.toLowerCase())
        );
      })
      .filter((id) => {
        if (clienteCuentaVentaVisibilityFilter === 'all') return true;
        const isVisible = clientesVisiblesCuentaVenta.has(id);
        return clienteCuentaVentaVisibilityFilter === 'visible' ? isVisible : !isVisible;
      });
  }, [
    clienteCuentaVentaFilter,
    clienteCuentaVentaVisibilityFilter,
    clienteIdsCuentaVenta,
    clienteNombres,
    clientesVisiblesCuentaVenta,
  ]);

  const isPedidosVisibility = visibilityScope === 'pedidos';
  const visibilityTitle = isPedidosVisibility
    ? 'Visibilidad de pedidos por cliente'
    : 'Visibilidad de cuentas de venta por cliente';
  const visibilitySearchLabel = isPedidosVisibility ? 'Buscar clienteid' : 'Buscar clienteid o nombre';
  const visibilitySearchPlaceholder = isPedidosVisibility ? 'Ej: 123' : 'Ej: 1403 o eurogroup';
  const visibilitySearchInputId = isPedidosVisibility ? 'cliente-filter-pedidos' : 'cliente-filter-cv';
  const visibilityFilterSelectId = isPedidosVisibility
    ? 'cliente-visibility-filter-pedidos'
    : 'cliente-visibility-filter-cv';
  const visibilityFilterValue = isPedidosVisibility ? clienteVisibilityFilter : clienteCuentaVentaVisibilityFilter;
  const visibilitySearchValue = isPedidosVisibility ? clienteFilter : clienteCuentaVentaFilter;
  const visibilityClienteIds = isPedidosVisibility ? clienteIds : clienteIdsCuentaVenta;
  const visibilityClientesVisibles = isPedidosVisibility ? clientesVisibles : clientesVisiblesCuentaVenta;
  const visibilityClientesOcultos = isPedidosVisibility ? clientesOcultos : clientesCuentaVentaOcultos;
  const visibilityFilteredClienteIds = isPedidosVisibility ? filteredClienteIds : filteredClienteIdsCuentaVenta;
  const visibilityUpdatingSet = isPedidosVisibility ? clienteUpdating : clienteCuentaVentaUpdating;
  const visibilityAddClienteId = isPedidosVisibility ? clienteToAddId : clienteCuentaVentaToAddId;
  const visibilityAddingCliente = isPedidosVisibility ? addingClienteVisible : addingClienteVisibleCuentaVenta;
  const visibilityAddTitle = isPedidosVisibility
    ? 'Agregar cliente permitido para inserción'
    : 'Agregar cliente permitido para cuentas de venta';
  const visibilityAddDescription = isPedidosVisibility
    ? 'Selecciona un cliente para habilitarlo en la lista de selección de “Enviar pedido”.'
    : 'Selecciona un cliente para habilitarlo en el flujo de cuentas de venta.';
  const visibilityEmptyMessage = isPedidosVisibility
    ? 'No se encontraron clientes en la base de datos.'
    : 'No se encontraron clientes de cuentas de venta en la base de datos.';
  const visibilityAdviceText = isPedidosVisibility
    ? 'que los actives aquí.'
    : 'que los actives aquí para cuentas de venta.';

  const handleVisibilitySearchChange = (value: string) => {
    if (isPedidosVisibility) {
      setClienteFilter(value);
      return;
    }
    setClienteCuentaVentaFilter(value);
  };

  const handleVisibilityStateFilterChange = (value: ClientesVisibilityFilter) => {
    if (isPedidosVisibility) {
      setClienteVisibilityFilter(value);
      return;
    }
    setClienteCuentaVentaVisibilityFilter(value);
  };

  const handleVisibilityAddClienteChange = (value: number | null) => {
    if (isPedidosVisibility) {
      setClienteToAddId(value);
      return;
    }
    setClienteCuentaVentaToAddId(value);
  };

  const handleVisibilityAddCliente = async () => {
    if (isPedidosVisibility) {
      await addClienteVisibleFromSelector();
      return;
    }
    await addClienteVisibleCuentaVentaFromSelector();
  };

  const handleVisibilityToggle = async (clienteid: number, checked: boolean) => {
    if (isPedidosVisibility) {
      await toggleClienteVisible(clienteid, checked);
      return;
    }
    await toggleClienteVisibleCuentaVenta(clienteid, checked);
  };

  const filteredBehaviorClienteIds = useMemo(() => {
    const normalizedFilter = clienteBehaviorFilter.trim();
    return clienteBehaviorIds
      .filter((id) => {
        if (!normalizedFilter) return true;
        return (
          String(id).includes(normalizedFilter) ||
          (clienteNombres[id] ?? '').toLowerCase().includes(normalizedFilter.toLowerCase())
        );
      })
      .filter((id) => {
        if (clienteBehaviorStateFilter === 'all') return true;
        const rule = clienteBehaviorRules[id] ?? buildClienteBehaviorRule(id, DEFAULT_CLIENT_BEHAVIOR_RULE);
        const isActive = hasVisibleClienteBehaviorRules(rule);
        return clienteBehaviorStateFilter === 'active' ? isActive : !isActive;
      });
  }, [clienteBehaviorFilter, clienteBehaviorIds, clienteBehaviorStateFilter, clienteNombres, clienteBehaviorRules]);

  if (!isAdmin) {
    const fallback = getFirstAllowedPath({ role, allowedRoutes }) ?? '/';
    return <Navigate to={fallback} replace />;
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-3 py-8">
        <Card className="relative overflow-hidden border-none bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_transparent_55%)]" />
          <CardHeader className="relative space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Administración</p>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">
                  Panel de administración
                </h1>
                <p className="text-sm text-white/80">
                  Configura visibilidad de pedidos, cuentas de venta y reglas operativas por cliente.
                </p>
              </div>
              <div />
            </div>
            <div className="text-xs text-white/70">
              Clientes con reglas activas: <span className="font-semibold text-white">{clientesLoading ? '—' : clientesConReglasActivas}</span>
            </div>
          </CardHeader>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Reglas ERP de facturas recibidas
              </CardTitle>
              <CardDescription>
                Configuraci\u00f3n por empresa y, cuando exista una aprobaci\u00f3n espec\u00edfica, por acreedor ERP.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={resetFacturaErpRuleDraft}>
                Nueva regla
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => void loadFacturaErpRules()}
                disabled={facturaErpRulesLoading}
              >
                <RefreshCw className={`h-4 w-4 ${facturaErpRulesLoading ? 'animate-spin' : ''}`} />
                Refrescar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="border-l-2 border-amber-500 pl-3 text-sm text-muted-foreground">
              Estos valores no se deducen del a\u00f1o, del porcentaje de IVA, del PDF ni del origen de los punteos.
              Si un dato no tiene una regla aprobada, permanece pendiente para selecci\u00f3n manual.
            </p>

            <form onSubmit={saveFacturaErpRule} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="factura-rule-empresa">Empresa ERP</Label>
                  <Input
                    id="factura-rule-empresa"
                    inputMode="numeric"
                    value={facturaErpRuleDraft.empresaId}
                    onChange={(event) =>
                      setFacturaErpRuleDraft((current) => ({ ...current, empresaId: event.target.value }))
                    }
                    disabled={facturaErpRuleSaving}
                    placeholder="1"
                  />
                </div>
                <div className="space-y-2 md:col-span-1 xl:col-span-2">
                  <Label>Acreedor ERP (opcional)</Label>
                  <AcreedorCombobox
                    value={facturaErpRuleDraft.proveedorId}
                    onChange={(proveedorId) =>
                      setFacturaErpRuleDraft((current) => ({ ...current, proveedorId }))
                    }
                    placeholder="Buscar acreedor por nombre o NIF"
                    disabled={facturaErpRuleSaving}
                    className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    source="erp"
                    minSearchLength={2}
                    searchLimit={25}
                  />
                  <p className="text-xs text-muted-foreground">
                    Vac\u00edo aplica la regla general de la empresa.
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-7">
                  <Switch
                    id="factura-rule-activa"
                    checked={facturaErpRuleDraft.activo}
                    onCheckedChange={(activo) =>
                      setFacturaErpRuleDraft((current) => ({ ...current, activo }))
                    }
                    disabled={facturaErpRuleSaving}
                  />
                  <Label htmlFor="factura-rule-activa">Regla activa</Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-rule-ejercicio">Ejercicio ERP</Label>
                  <Input
                    id="factura-rule-ejercicio"
                    inputMode="numeric"
                    value={facturaErpRuleDraft.ejercicioErp}
                    onChange={(event) =>
                      setFacturaErpRuleDraft((current) => ({ ...current, ejercicioErp: event.target.value }))
                    }
                    disabled={facturaErpRuleSaving}
                    placeholder="Sin regla"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-rule-tipo">Tipo de factura</Label>
                  <Input
                    id="factura-rule-tipo"
                    value={facturaErpRuleDraft.tipoFactura}
                    onChange={(event) =>
                      setFacturaErpRuleDraft((current) => ({ ...current, tipoFactura: event.target.value }))
                    }
                    disabled={facturaErpRuleSaving}
                    maxLength={2}
                    placeholder="Selecci\u00f3n manual"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-rule-regimen">R\u00e9gimen IVA</Label>
                  <Input
                    id="factura-rule-regimen"
                    inputMode="numeric"
                    value={facturaErpRuleDraft.regimenId}
                    onChange={(event) =>
                      setFacturaErpRuleDraft((current) => ({ ...current, regimenId: event.target.value }))
                    }
                    disabled={facturaErpRuleSaving}
                    placeholder="Selecci\u00f3n manual"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-rule-fecha-ctb">Pol\u00edtica de fecha CTB</Label>
                  <Select
                    value={facturaErpRuleDraft.fechaCtbPolicy}
                    onValueChange={(value) =>
                      setFacturaErpRuleDraft((current) => ({
                        ...current,
                        fechaCtbPolicy: value as FacturaFechaCtbPolicy | 'inherit',
                      }))
                    }
                    disabled={facturaErpRuleSaving}
                  >
                    <SelectTrigger id="factura-rule-fecha-ctb">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">
                        {facturaErpRuleDraft.proveedorId === null ? 'Sin regla' : 'Heredar regla general'}
                      </SelectItem>
                      <SelectItem value="manual">Revisi\u00f3n manual</SelectItem>
                      <SelectItem value="invoice_date">Fecha de factura (requiere aprobaci\u00f3n)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {facturaErpRuleDraft.proveedorId === null
                      ? 'Sin regla, la fecha CTB queda para revisi\u00f3n manual.'
                      : 'Heredar conserva la pol\u00edtica general de la empresa.'}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-rule-cuenta-gasto">Cuenta de gasto por defecto</Label>
                  <Input
                    id="factura-rule-cuenta-gasto"
                    inputMode="numeric"
                    value={facturaErpRuleDraft.cuentaGastoDefault}
                    onChange={(event) =>
                      setFacturaErpRuleDraft((current) => ({
                        ...current,
                        cuentaGastoDefault: event.target.value,
                      }))
                    }
                    disabled={facturaErpRuleSaving}
                    maxLength={11}
                    placeholder="Selecci\u00f3n manual"
                  />
                  <p className="text-xs text-muted-foreground">Debe tener 11 d\u00edgitos.</p>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="factura-rule-concepto">Plantilla de concepto</Label>
                  <Input
                    id="factura-rule-concepto"
                    value={facturaErpRuleDraft.conceptoTemplate}
                    onChange={(event) =>
                      setFacturaErpRuleDraft((current) => ({
                        ...current,
                        conceptoTemplate: event.target.value,
                      }))
                    }
                    disabled={facturaErpRuleSaving}
                    maxLength={50}
                    placeholder="FRA. {proveedor}"
                  />
                  <p className="text-xs text-muted-foreground">
                    Usa <span className="font-mono">{'{proveedor}'}</span> para insertar el nombre del acreedor.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="factura-rule-contabilizar">Contabilizar por defecto</Label>
                  <Select
                    value="N"
                    onValueChange={() => undefined}
                    disabled
                  >
                    <SelectTrigger id="factura-rule-contabilizar">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="N">No</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Fijo en No mientras Netagro TEST no tenga disponible el servicio oficial.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="factura-rule-approval-note">Nota o evidencia de aprobaci\u00f3n</Label>
                <textarea
                  id="factura-rule-approval-note"
                  value={facturaErpRuleDraft.approvalNote}
                  onChange={(event) =>
                    setFacturaErpRuleDraft((current) => ({ ...current, approvalNote: event.target.value }))
                  }
                  disabled={facturaErpRuleSaving}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Indica qui\u00e9n aprob\u00f3 la regla y la evidencia utilizada."
                />
                <p className="text-xs text-muted-foreground">
                  Es obligatoria si la regla completa cualquier valor de la factura.
                </p>
              </div>

              <div className="flex justify-end gap-2">
                {facturaErpRuleDraft.id ? (
                  <Button type="button" variant="outline" onClick={resetFacturaErpRuleDraft} disabled={facturaErpRuleSaving}>
                    Cancelar edici\u00f3n
                  </Button>
                ) : null}
                <Button type="submit" className="gap-2" disabled={facturaErpRuleSaving}>
                  {facturaErpRuleSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {facturaErpRuleDraft.id ? 'Guardar cambios' : 'Crear regla'}
                </Button>
              </div>
            </form>

            <div className="overflow-x-auto border-t pt-4">
              {facturaErpRulesLoading ? (
                <p className="text-sm text-muted-foreground">Cargando reglas de facturas...</p>
              ) : facturaErpRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay reglas ERP configuradas para facturas recibidas.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Alcance</TableHead>
                      <TableHead>Ejercicio</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>R\u00e9gimen</TableHead>
                      <TableHead>Fecha CTB</TableHead>
                      <TableHead>Valores contables</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Evidencia</TableHead>
                      <TableHead className="text-right">Acci\u00f3n</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {facturaErpRules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell className="font-mono">{rule.empresa_id}</TableCell>
                        <TableCell>
                          {rule.proveedor_id === null ? 'General' : `Acreedor ${rule.proveedor_id}`}
                        </TableCell>
                        <TableCell>{rule.ejercicio_erp ?? 'Manual'}</TableCell>
                        <TableCell>{rule.tipo_factura ?? 'Manual'}</TableCell>
                        <TableCell>{rule.regimen_id ?? 'Manual'}</TableCell>
                        <TableCell>
                          {rule.fecha_ctb_policy === 'invoice_date'
                            ? 'Fecha de factura'
                            : rule.fecha_ctb_policy === 'manual'
                              ? 'Manual'
                              : rule.proveedor_id === null
                                ? 'Sin regla'
                                : 'Heredar'}
                        </TableCell>
                        <TableCell className="min-w-[220px] text-sm">
                          {rule.cuenta_gasto_default ||
                          rule.concepto_template ||
                          rule.contabilizar_default ? (
                            <div className="space-y-1">
                              <div>Cuenta: {rule.cuenta_gasto_default ?? 'Manual'}</div>
                              <div>Concepto: {rule.concepto_template ?? 'Manual'}</div>
                              <div>
                                Contabilizar:{' '}
                                {rule.contabilizar_default === 'S'
                                  ? 'S\u00ed'
                                  : rule.contabilizar_default === 'N'
                                    ? 'No'
                                    : 'Manual'}
                              </div>
                            </div>
                          ) : (
                            'Manual'
                          )}
                        </TableCell>
                        <TableCell>{rule.activo ? 'Activa' : 'Inactiva'}</TableCell>
                        <TableCell className="max-w-[280px] whitespace-normal text-sm text-muted-foreground">
                          {rule.approval_note ?? 'Sin valores autom\u00e1ticos'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            onClick={() => editFacturaErpRule(rule)}
                          >
                            <Edit2 className="h-4 w-4" />
                            Editar
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                {visibilityTitle}
              </CardTitle>
              <CardDescription>
                Gestiona qué <span className="font-mono">clienteid</span> están activados por flujo.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="space-y-1">
                <Label htmlFor="visibility-scope">Visibilidad</Label>
                <Select
                  value={visibilityScope}
                  onValueChange={(val) => setVisibilityScope(val as VisibilityScopeOption)}
                >
                  <SelectTrigger id="visibility-scope" className="sm:w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pedidos">Pedidos</SelectItem>
                    <SelectItem value="cuentaventa">Cuentas de venta</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={loadClientesConfig}
                disabled={clientesLoading}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${clientesLoading ? 'animate-spin' : ''}`} />
                Refrescar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr]">
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor={visibilitySearchInputId}>{visibilitySearchLabel}</Label>
                <Input
                  id={visibilitySearchInputId}
                  value={visibilitySearchValue}
                  onChange={(e) => handleVisibilitySearchChange(e.target.value)}
                  placeholder={visibilitySearchPlaceholder}
                />
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor={visibilityFilterSelectId}>Filtro</Label>
                <Select
                  value={visibilityFilterValue}
                  onValueChange={(val) => handleVisibilityStateFilterChange(val as ClientesVisibilityFilter)}
                >
                  <SelectTrigger id={visibilityFilterSelectId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="visible">Activado</SelectItem>
                    <SelectItem value="hidden">Desactivado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-semibold">Resumen</p>
                <p className="text-xs text-muted-foreground">
                  {visibilityClienteIds.length} clientes · {visibilityClientesVisibles.size} activados ·{' '}
                  {visibilityClientesOcultos} desactivados
                </p>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
              <p className="text-sm font-semibold">{visibilityAddTitle}</p>
              <p className="text-xs text-muted-foreground">{visibilityAddDescription}</p>
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <ClientCombobox
                  value={visibilityAddClienteId}
                  onChange={handleVisibilityAddClienteChange}
                  placeholder="Selecciona un cliente a habilitar"
                  disabled={clientesLoading || visibilityAddingCliente}
                  className="h-10"
                />
                <Button
                  type="button"
                  onClick={handleVisibilityAddCliente}
                  disabled={clientesLoading || visibilityAddingCliente || !visibilityAddClienteId}
                  className="gap-2 md:w-auto"
                >
                  {visibilityAddingCliente ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Agregar cliente
                </Button>
              </div>
            </div>

            {clientesLoading ? (
              <p className="text-sm text-muted-foreground">Cargando clientes...</p>
            ) : visibilityClienteIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">{visibilityEmptyMessage}</p>
            ) : visibilityFilteredClienteIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay resultados para ese filtro.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead>clienteid</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Estado (usuarios)</TableHead>
                      <TableHead className="text-right">Activado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibilityFilteredClienteIds.map((id) => {
                      const isVisible = visibilityClientesVisibles.has(id);
                      const isUpdating = visibilityUpdatingSet.has(id);
                      const clienteNombre = clienteNombres[id] ?? `Cliente #${id}`;
                      return (
                        <TableRow key={`${visibilityScope}-${id}`}>
                          <TableCell className="font-mono">{id}</TableCell>
                          <TableCell>{clienteNombre}</TableCell>
                          <TableCell>
                            <Badge variant={isVisible ? 'default' : 'outline'}>
                              {isVisible ? 'Activado' : 'Desactivado'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Switch
                                checked={isVisible}
                                onCheckedChange={(checked) => {
                                  void handleVisibilityToggle(id, checked);
                                }}
                                disabled={isUpdating}
                                aria-label={`Visibilidad ${visibilityScope} cliente ${id} (${clienteNombre})`}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Consejo: los <span className="font-mono">clienteid</span> nuevos quedan desactivados para usuarios hasta
              {` ${visibilityAdviceText}`}
            </p>
          </CardContent>
        </Card>

        <Card className="border border-border/60">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Reglas de comportamiento por cliente
              </CardTitle>
              <CardDescription>
                Configura reglas por <span className="font-mono">clienteid</span> para controlar duplicados y filtros
                PDF por flujo (pedidos / cuentas de venta).
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadClientesConfig}
              disabled={clientesLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${clientesLoading ? 'animate-spin' : ''}`} />
              Refrescar
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr_0.9fr_1fr]">
              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor="cliente-behavior-filter">Buscar cliente</Label>
                <Input
                  id="cliente-behavior-filter"
                  value={clienteBehaviorFilter}
                  onChange={(e) => setClienteBehaviorFilter(e.target.value)}
                  placeholder="clienteid o nombre"
                />
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor="cliente-behavior-scope">Filtros PDF</Label>
                <Select
                  value={clienteBehaviorListScope}
                  onValueChange={(val) => setClienteBehaviorListScope(val as ClienteBehaviorListScope)}
                >
                  <SelectTrigger id="cliente-behavior-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pedidos">Pedidos</SelectItem>
                    <SelectItem value="cuentaventa">Cuentas de venta</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor="cliente-behavior-state-filter">Estado de reglas</Label>
                <Select
                  value={clienteBehaviorStateFilter}
                  onValueChange={(val) => setClienteBehaviorStateFilter(val as ClientesBehaviorFilter)}
                >
                  <SelectTrigger id="cliente-behavior-state-filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="active">Con reglas activas</SelectItem>
                    <SelectItem value="default">Configuración por defecto</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-semibold">Resumen</p>
                <p className="text-xs text-muted-foreground">
                  {clienteBehaviorIds.length} clientes · {clientesConReglasActivas} con reglas activas
                </p>
              </div>
            </div>

            {clientesLoading ? (
              <p className="text-sm text-muted-foreground">Cargando reglas de cliente...</p>
            ) : clienteBehaviorIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No se encontraron clientes para configurar.</p>
            ) : filteredBehaviorClienteIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay resultados para ese filtro.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead>
                          <span className="cursor-help" title="Identificador numérico del cliente en AgroIris.">
                            clienteid
                          </span>
                        </TableHead>
                        <TableHead>
                          <span className="cursor-help" title="Nombre comercial del cliente asociado al clienteid.">
                            Nombre
                          </span>
                        </TableHead>
                        <TableHead>
                          <span
                            className="cursor-help"
                            title="Indica si ese cliente tiene alguna regla especial activada o está en comportamiento por defecto."
                          >
                            Activo
                          </span>
                        </TableHead>
                        <TableHead>
                          <span
                            className="cursor-help"
                            title="Permite referencias de cliente duplicadas en pedidos del mismo tipo/serie para este cliente."
                          >
                            Dup. ref
                          </span>
                        </TableHead>
                        <TableHead>
                          <span
                            className="cursor-help"
                            title="Si el cambio no encuentra pedido asociado, permite abrir el flujo para crear un nuevo pedido o previsión desde ese cambio."
                          >
                            Crear nuevo sin match
                          </span>
                        </TableHead>
                        <TableHead>
                          <span
                            className="cursor-help"
                            title="Si falla la referencia exacta, intenta localizar el pedido usando solo los dígitos de la referencia."
                          >
                            Match ref. por dígitos
                          </span>
                        </TableHead>
                        <TableHead>
                          <span
                            className="cursor-help"
                            title="Si está activa, aunque Dup. ref permita duplicados, se rechaza repetir la misma referencia dentro del mismo PDF."
                          >
                            Bloq. dup. mismo PDF
                          </span>
                        </TableHead>
                        <TableHead>
                          <span
                            className="cursor-help"
                            title="Lista de tokens (separados por coma) que excluyen un PDF si aparecen en su nombre."
                          >
                            Ignorar ({clienteBehaviorListScope === 'pedidos' ? 'Pedidos' : 'Cuentas de venta'})
                          </span>
                        </TableHead>
                        <TableHead>
                          <span
                            className="cursor-help"
                            title="Lista de prefijos permitidos (separados por coma). Si se define, el nombre del PDF debe empezar por uno."
                          >
                            Prefijos ({clienteBehaviorListScope === 'pedidos' ? 'Pedidos' : 'Cuentas de venta'})
                          </span>
                        </TableHead>
                        <TableHead className="text-right">
                          <span className="cursor-help" title="Guardar filtros de PDF de este cliente.">
                            Acción
                          </span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredBehaviorClienteIds.map((id) => {
                        const clienteNombre = clienteNombres[id] ?? `Cliente #${id}`;
                        const rule = getClienteBehaviorRuleConfig(id);
                        const skipNamesFallback = getRuleScopedListValue(
                          rule,
                          clienteBehaviorListScope,
                          'skip_name_includes',
                        );
                        const requiredPrefixesFallback = getRuleScopedListValue(
                          rule,
                          clienteBehaviorListScope,
                          'require_name_prefixes',
                        );
                        const skipNamesValue = getClienteBehaviorInputValue(
                          id,
                          clienteBehaviorListScope,
                          'skip_name_includes',
                          skipNamesFallback,
                        );
                        const requiredPrefixesValue = getClienteBehaviorInputValue(
                          id,
                          clienteBehaviorListScope,
                          'require_name_prefixes',
                          requiredPrefixesFallback,
                        );
                        const isUpdating = clienteBehaviorUpdating.has(id);
                        const hasActiveRules = hasVisibleClienteBehaviorRules(rule);
                        return (
                          <TableRow key={`rule-${id}`}>
                            <TableCell className="font-mono">{id}</TableCell>
                            <TableCell>{clienteNombre}</TableCell>
                            <TableCell>
                              <Badge variant={hasActiveRules ? 'default' : 'outline'}>
                                {hasActiveRules ? 'Activo' : 'Por defecto'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={rule.allow_duplicate_reference}
                                disabled={isUpdating}
                                onCheckedChange={(checked) =>
                                  toggleClienteBehaviorRule(id, 'allow_duplicate_reference', checked)
                                }
                                aria-label={`Permitir referencias duplicadas para cliente ${id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={rule.allow_create_new_order_from_unmatched_change}
                                disabled={isUpdating}
                                onCheckedChange={(checked) =>
                                  toggleClienteBehaviorRule(id, 'allow_create_new_order_from_unmatched_change', checked)
                                }
                                aria-label={`Permitir crear nuevo pedido sin match para cliente ${id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={rule.match_reference_by_digits_fallback}
                                disabled={isUpdating}
                                onCheckedChange={(checked) =>
                                  toggleClienteBehaviorRule(id, 'match_reference_by_digits_fallback', checked)
                                }
                                aria-label={`Habilitar match por dígitos para cliente ${id}`}
                              />
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={rule.block_duplicate_reference_same_pdf}
                                disabled={isUpdating || !rule.allow_duplicate_reference}
                                onCheckedChange={(checked) =>
                                  toggleClienteBehaviorRule(id, 'block_duplicate_reference_same_pdf', checked)
                                }
                                aria-label={`Bloquear duplicados en mismo PDF para cliente ${id}`}
                              />
                            </TableCell>
                            <TableCell className="min-w-[220px]">
                              <Input
                                value={skipNamesValue}
                                onChange={(event) =>
                                  setClienteBehaviorInputValue(
                                    id,
                                    clienteBehaviorListScope,
                                    'skip_name_includes',
                                    event.target.value,
                                  )
                                }
                                disabled={isUpdating}
                                placeholder="anexo, cartel"
                              />
                            </TableCell>
                            <TableCell className="min-w-[220px]">
                              <Input
                                value={requiredPrefixesValue}
                                onChange={(event) =>
                                  setClienteBehaviorInputValue(
                                    id,
                                    clienteBehaviorListScope,
                                    'require_name_prefixes',
                                    event.target.value,
                                  )
                                }
                                disabled={isUpdating}
                                placeholder="PED_"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                disabled={isUpdating}
                                onClick={() => saveClienteBehaviorFilters(id)}
                              >
                                {isUpdating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Guardar
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Sugerencia: si activas <span className="font-mono">Dup. ref</span> para un cliente, usa también
              <span className="font-mono"> Bloq. dup. mismo PDF</span> para evitar cargas repetidas del mismo archivo.
              También puedes parametrizar filtros de nombre de adjunto para el pretratado de correos, sin hardcode.
            </p>
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground space-y-1">
          <p>Solo los administradores pueden acceder a esta página.</p>
          <p>Los cambios se guardan por cliente para controlar flujos sin hardcodes en frontend.</p>
        </div>
      </main>
    </div>
  );

};

export default AdminSettings;
