import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Edit2,
  Mail,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { getFirstAllowedPath, type UserRole } from '@/config/accessControl';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';

type UserRoleRow = Database['public']['Tables']['user_roles']['Row'];
type AppUser = { id: string; email: string | null; created_at: string | null };
type UserDeleteTarget = { userId: string; email: string | null };
type RoleFilter = 'all' | 'admin' | 'user' | 'unconfigured';
type ModuleFilter = 'all' | 'facturas' | string;

type UserListEntry = {
  id: string;
  email: string | null;
  created_at: string | null;
  role: UserRole | null;
  allowed_routes: string[] | null;
  configured: boolean;
};

const USERS_PAGE_SIZE = 10;

const FACTURAS_GROUP_ROUTES = ['/facturas-recibidas'];
const PEDIDOS_GROUP_ROUTES: string[] = [];
const CONTROL_ENTRADA_GROUP_ROUTES: string[] = [];
const CORREOS_GROUP_ROUTES: string[] = [];
const USER_ROUTE_OPTIONS = [
  { path: '/facturas-recibidas', label: 'Facturas recibidas' },
];
const DEFAULT_USER_ROUTES = [...FACTURAS_GROUP_ROUTES];
const ACTIVE_ROUTE_PATHS = new Set(USER_ROUTE_OPTIONS.map((route) => route.path));

const LEGACY_ROUTE_ALIASES: Record<string, string> = {
  '/admin/buscar-archivo': '/buscar-archivo',
};

const ROUTE_LABELS = new Map([
  ...USER_ROUTE_OPTIONS.map((route) => [route.path, route.label] as const),
]);

const ROLE_FILTER_OPTIONS: Array<{ value: RoleFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'admin', label: 'Administradores' },
  { value: 'user', label: 'Usuarios normales' },
  { value: 'unconfigured', label: 'Sin configuración' },
];

const MODULE_FILTER_OPTIONS: Array<{ value: ModuleFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'facturas', label: 'Facturas recibidas' },
  ...USER_ROUTE_OPTIONS,
];

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

const getRoleLabel = (role: UserRole | null, configured: boolean) => {
  if (!configured) return 'Sin configuración';
  return role === 'admin' ? 'Administrador' : 'Usuario normal';
};

const getRouteLabel = (route: string) => ROUTE_LABELS.get(route) ?? route.replace(/^\//, '');

const getRoutesTooltip = (entry: UserListEntry) => {
  if (entry.role === 'admin') return ['Acceso completo de administrador'];
  if (!entry.configured) return ['Sin permisos guardados'];
  const routes = normalizeAllowedRoutes(entry.allowed_routes);
  return routes.length > 0 ? routes.map(getRouteLabel) : ['Sin rutas asignadas'];
};

const getModulesLabel = (entry: UserListEntry) => {
  if (entry.role === 'admin') return 'Todos los módulos';
  if (!entry.configured) return 'Sin permisos';
  const count = normalizeAllowedRoutes(entry.allowed_routes).length;
  return `${count} ${count === 1 ? 'módulo' : 'módulos'}`;
};

const getAccessLabel = (entry: UserListEntry) => {
  if (entry.role === 'admin') return 'Acceso completo';
  if (!entry.configured) return 'Pendiente';
  return 'Acceso limitado';
};

const routeMatchesModuleFilter = (entry: UserListEntry, moduleFilter: ModuleFilter) => {
  if (moduleFilter === 'all') return true;
  if (entry.role === 'admin') return true;
  if (!entry.configured) return false;

  const routes = normalizeAllowedRoutes(entry.allowed_routes);
  if (moduleFilter === 'facturas') return FACTURAS_GROUP_ROUTES.some((route) => routes.includes(route));
  return routes.includes(moduleFilter);
};

interface RouteSelectorProps {
  routes: string[];
  onRoutesChange: (routes: string[]) => void;
}

const toggleRouteSet = (currentRoutes: string[], route: string, checked: boolean) => {
  const next = new Set(currentRoutes);
  if (checked) next.add(route);
  else next.delete(route);
  return Array.from(next);
};

const toggleRouteGroup = (currentRoutes: string[], groupRoutes: string[], checked: boolean) => {
  const next = new Set(currentRoutes);
  groupRoutes.forEach((route) => {
    if (checked) next.add(route);
    else next.delete(route);
  });
  return Array.from(next);
};

function RouteSelector({ routes, onRoutesChange }: RouteSelectorProps) {
  const pedidosChecked = PEDIDOS_GROUP_ROUTES.every((route) => routes.includes(route));
  const pedidosPartial = PEDIDOS_GROUP_ROUTES.some((route) => routes.includes(route)) && !pedidosChecked;
  const controlChecked = CONTROL_ENTRADA_GROUP_ROUTES.every((route) => routes.includes(route));
  const controlPartial = CONTROL_ENTRADA_GROUP_ROUTES.some((route) => routes.includes(route)) && !controlChecked;
  const correosChecked = CORREOS_GROUP_ROUTES.every((route) => routes.includes(route));
  const correosPartial = CORREOS_GROUP_ROUTES.some((route) => routes.includes(route)) && !correosChecked;
  const sortedRoutes = [...USER_ROUTE_OPTIONS].sort((left, right) => left.path.localeCompare(right.path));

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
      <div className="hidden">
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
          <Checkbox
            checked={pedidosChecked ? true : pedidosPartial ? 'indeterminate' : false}
            onCheckedChange={(checked) =>
              onRoutesChange(toggleRouteGroup(routes, PEDIDOS_GROUP_ROUTES, checked === true || checked === 'indeterminate'))
            }
          />
          <span>
            <span className="block font-medium text-slate-900">Gestión de pedidos</span>
            <span className="mt-1 block text-xs text-slate-500">Previsiones, pedidos y cambios.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
          <Checkbox
            checked={controlChecked ? true : controlPartial ? 'indeterminate' : false}
            onCheckedChange={(checked) =>
              onRoutesChange(toggleRouteGroup(routes, CONTROL_ENTRADA_GROUP_ROUTES, checked === true || checked === 'indeterminate'))
            }
          />
          <span>
            <span className="block font-medium text-slate-900">Control de entrada</span>
            <span className="mt-1 block text-xs text-slate-500">Avisos y buscador de archivos.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
          <Checkbox
            checked={correosChecked ? true : correosPartial ? 'indeterminate' : false}
            onCheckedChange={(checked) =>
              onRoutesChange(toggleRouteGroup(routes, CORREOS_GROUP_ROUTES, checked === true || checked === 'indeterminate'))
            }
          />
          <span>
            <span className="block font-medium text-slate-900">Correos</span>
            <span className="mt-1 block text-xs text-slate-500">Buzones de pedidos y cuentas.</span>
          </span>
        </label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sortedRoutes.map((route) => (
          <label key={route.path} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm">
            <Checkbox
              checked={routes.includes(route.path)}
              onCheckedChange={(checked) => onRoutesChange(toggleRouteSet(routes, route.path, Boolean(checked)))}
            />
            <span className="min-w-0">
              <span className="block font-medium text-slate-900">{route.label}</span>
              <span className="mt-1 block truncate font-mono text-xs text-slate-500">{route.path}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

const AdminUsers = () => {
  const { user: currentUser, isAdmin, role, allowedRoutes } = useAuth();
  const { toast } = useToast();

  const [entries, setEntries] = useState<UserRoleRow[]>([]);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all');
  const [usersPage, setUsersPage] = useState(1);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRole, setCreateRole] = useState<UserRole>('user');
  const [createRoutes, setCreateRoutes] = useState<string[]>(DEFAULT_USER_ROUTES);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorUserId, setEditorUserId] = useState('');
  const [editorEmail, setEditorEmail] = useState('');
  const [editorRole, setEditorRole] = useState<UserRole>('user');
  const [editorRoutes, setEditorRoutes] = useState<string[]>(DEFAULT_USER_ROUTES);

  const [deleteConfigTarget, setDeleteConfigTarget] = useState<UserDeleteTarget | null>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserDeleteTarget | null>(null);

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

  const handleRefreshUsers = async () => {
    await Promise.all([loadEntries(), loadUsers()]);
  };

  useEffect(() => {
    void handleRefreshUsers();
  }, []);

  useEffect(() => {
    setUsersPage(1);
  }, [search, roleFilter, moduleFilter]);

  const userEntries = useMemo<UserListEntry[]>(() => {
    const byId = new Map<string, UserListEntry>();

    appUsers.forEach((appUser) => {
      byId.set(appUser.id, {
        id: appUser.id,
        email: appUser.email,
        created_at: appUser.created_at,
        role: null,
        allowed_routes: null,
        configured: false,
      });
    });

    entries.forEach((entry) => {
      const current = byId.get(entry.user_id);
      byId.set(entry.user_id, {
        id: entry.user_id,
        email: current?.email ?? entry.user_email,
        created_at: current?.created_at ?? entry.created_at,
        role: entry.role as UserRole,
        allowed_routes: entry.allowed_routes,
        configured: true,
      });
    });

    return Array.from(byId.values()).sort((left, right) => {
      const leftAdmin = left.role === 'admin' ? 0 : 1;
      const rightAdmin = right.role === 'admin' ? 0 : 1;
      if (leftAdmin !== rightAdmin) return leftAdmin - rightAdmin;
      return (left.email ?? '').localeCompare(right.email ?? '');
    });
  }, [appUsers, entries]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return userEntries
      .filter((entry) => {
        if (roleFilter === 'all') return true;
        if (roleFilter === 'unconfigured') return !entry.configured;
        return entry.role === roleFilter;
      })
      .filter((entry) => routeMatchesModuleFilter(entry, moduleFilter))
      .filter((entry) => {
        if (!normalizedSearch) return true;
        const searchable = [
          entry.email,
          entry.id,
          getRoleLabel(entry.role, entry.configured),
          getAccessLabel(entry),
          ...getRoutesTooltip(entry),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(normalizedSearch);
      });
  }, [moduleFilter, roleFilter, search, userEntries]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / USERS_PAGE_SIZE));
  const safePage = Math.min(usersPage, totalPages);
  const usersPageStart = filteredUsers.length === 0 ? 0 : (safePage - 1) * USERS_PAGE_SIZE + 1;
  const usersPageEnd = Math.min(filteredUsers.length, safePage * USERS_PAGE_SIZE);
  const paginatedUsers = filteredUsers.slice((safePage - 1) * USERS_PAGE_SIZE, safePage * USERS_PAGE_SIZE);
  const hasFilters = Boolean(search.trim()) || roleFilter !== 'all' || moduleFilter !== 'all';

  const resetCreateForm = () => {
    setCreateEmail('');
    setCreatePassword('');
    setCreateRole('user');
    setCreateRoutes(DEFAULT_USER_ROUTES);
  };

  const closeCreateDialog = () => {
    if (creating) return;
    setCreateDialogOpen(false);
    resetCreateForm();
  };

  const openEditor = (entry: UserListEntry) => {
    setEditorUserId(entry.id);
    setEditorEmail(entry.email ?? '');
    setEditorRole(entry.role ?? 'user');
    setEditorRoutes(entry.configured ? normalizeAllowedRoutes(entry.allowed_routes) : DEFAULT_USER_ROUTES);
    setEditorOpen(true);
  };

  const closeEditor = (force = false) => {
    if (!force && (saving || deletingId)) return;
    setEditorOpen(false);
    setEditorUserId('');
    setEditorEmail('');
    setEditorRole('user');
    setEditorRoutes(DEFAULT_USER_ROUTES);
  };

  const handleCreateUser = async (event: FormEvent) => {
    event.preventDefault();
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
      const payload = {
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
        allowed_routes: createRole === 'admin' ? null : normalizeAllowedRoutes(createRoutes),
      };

      let createdUser: any = null;
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('admin_create_user', {
        p_email: payload.email,
        p_password: payload.password,
        p_role: payload.role,
        p_allowed_routes: payload.allowed_routes,
      });

      if (rpcError) {
        if (!isMissingRpcFunctionError(rpcError)) {
          throw new Error(rpcError.message ?? 'No se pudo crear el usuario.');
        }

        const { data, error } = await supabase.functions.invoke('admin-create-user', { body: payload });
        if (error) throw error;
        createdUser = data;
      } else {
        createdUser = rpcData;
      }

      const data = createdUser;
      toast({
        title: 'Usuario creado',
        description: `Se creó ${data?.email || createEmail.trim()}.`,
      });
      setCreateDialogOpen(false);
      resetCreateForm();
      await handleRefreshUsers();
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

  const handleSaveEditor = async () => {
    if (!editorUserId.trim()) {
      toast({ title: 'Falta el ID de usuario', description: 'Selecciona un usuario antes de guardar.' });
      return;
    }

    try {
      setSaving(true);
      const payload = {
        user_id: editorUserId.trim(),
        user_email: editorEmail.trim() || null,
        role: editorRole,
        allowed_routes: editorRole === 'admin' ? null : normalizeAllowedRoutes(editorRoutes),
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('user_roles').upsert(payload);
      if (error) throw error;

      toast({
        title: 'Permisos guardados',
        description: editorRole === 'admin' ? 'Este usuario ahora es administrador.' : 'Permisos actualizados.',
      });
      await loadEntries();
      closeEditor(true);
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

  const handleDeleteConfigurationOnly = async (target: UserDeleteTarget) => {
    try {
      setDeletingId(target.userId);
      const { error } = await supabase.from('user_roles').delete().eq('user_id', target.userId);
      if (error) throw error;

      toast({ title: 'Configuración eliminada', description: 'Se quitaron los permisos del usuario.' });
      await loadEntries();
      if (editorUserId === target.userId) closeEditor(true);
    } catch (err: any) {
      console.error('Error eliminando configuración:', err);
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
          body: { user_id: target.userId },
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
      await handleRefreshUsers();
      if (editorUserId === target.userId) closeEditor(true);
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

  const requestDelete = (entry: UserListEntry) => {
    const target = { userId: entry.id, email: entry.email };
    if (entry.configured) {
      setDeleteConfigTarget(target);
      return;
    }
    setDeleteUserTarget(target);
  };

  if (!isAdmin) {
    const fallback = getFirstAllowedPath({ role, allowedRoutes }) ?? '/';
    return <Navigate to={fallback} replace />;
  }

  return (
    <div className="min-h-screen bg-[#eef3f8]">
      <main className="mx-auto flex max-w-[1188px] flex-col gap-5 px-4 py-8 lg:px-6">
        <section className="relative overflow-hidden rounded-lg bg-gradient-to-br from-[#2f7df1] to-[#4b93f1] px-7 py-7 text-white shadow-[0_18px_52px_rgba(37,99,235,0.18)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.22),transparent_42%)]" />
          <div className="relative space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">Control de acceso</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Administración de usuarios</h1>
            <p className="max-w-3xl text-sm text-white/86">
              Gestiona cuentas, módulos habilitados y rutas visibles desde un único punto del panel.
            </p>
          </div>
        </section>

        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleRefreshUsers}
              disabled={loadingList || loadingUsers}
              className="h-10 gap-2 rounded-lg border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-50"
            >
              <RefreshCw className={`h-4 w-4 ${loadingList || loadingUsers ? 'animate-spin' : ''}`} />
              Refrescar
            </Button>
            <Button
              type="button"
              onClick={() => setCreateDialogOpen(true)}
              className="h-10 gap-2 rounded-lg bg-[#2f7df1] text-white shadow-sm hover:bg-[#276ee0]"
            >
              <UserPlus className="h-4 w-4" />
              Crear usuario
            </Button>
          </div>
          <p className="text-sm font-medium text-slate-500">
            {filteredUsers.length > 0
              ? `Mostrando ${usersPageStart}-${usersPageEnd} de ${filteredUsers.length}`
              : '0 usuarios visibles'}
            {hasFilters ? ` · ${userEntries.length} totales` : ''}
          </p>
        </section>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-base font-semibold text-slate-950">Filtros de usuarios</h2>
            <p className="mt-1 text-sm text-slate-500">Busca cuentas y acota por rol o módulo habilitado.</p>
          </div>
          <div className="grid gap-4 px-6 py-5 md:grid-cols-3">
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="admin-users-search">Buscar cuenta</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="admin-users-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nombre, email, ID o módulo..."
                  className="h-10 rounded-lg border-slate-200 bg-white pl-9"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rol de plataforma</Label>
              <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as RoleFilter)}>
                <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Módulo</Label>
              <Select value={moduleFilter} onValueChange={(value) => setModuleFilter(value)}>
                <SelectTrigger className="h-10 rounded-lg border-slate-200 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODULE_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {loadingList && loadingUsers ? (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-500">
              Cargando usuarios...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-5 py-7 text-sm text-slate-500">
              <p className="font-medium text-slate-900">No hay cuentas que coincidan con los filtros.</p>
              <p className="mt-2">Ajusta la búsqueda o limpia los filtros para recuperar resultados.</p>
              {hasFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    setSearch('');
                    setRoleFilter('all');
                    setModuleFilter('all');
                  }}
                >
                  Limpiar filtros
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3">
              {paginatedUsers.map((entry) => {
                const isCurrent = entry.id === currentUser?.id;
                const iconBoxStyle =
                  entry.role === 'admin'
                    ? {
                        borderColor: 'hsl(42 72% 68% / 0.76)',
                        background:
                          'radial-gradient(circle at 30% 18%, hsl(46 98% 82% / 0.44), transparent 42%), linear-gradient(135deg, hsl(44 92% 96%), hsl(39 86% 88%))',
                        boxShadow: 'inset 0 1px 0 hsl(0 0% 100% / 0.78), 0 4px 10px hsl(39 60% 28% / 0.11)',
                      }
                    : {
                        borderColor: 'hsl(214 58% 76% / 0.74)',
                        background:
                          'radial-gradient(circle at 30% 18%, hsl(208 92% 72% / 0.18), transparent 42%), linear-gradient(135deg, hsl(214 84% 97%), hsl(214 70% 93%))',
                        boxShadow: 'inset 0 1px 0 hsl(0 0% 100% / 0.72), 0 4px 10px hsl(214 42% 24% / 0.08)',
                      };
                const iconLogoGradient =
                  entry.role === 'admin'
                    ? 'linear-gradient(135deg, hsl(36 92% 42%), hsl(48 96% 64%))'
                    : 'linear-gradient(135deg, hsl(214 88% 42%), hsl(208 94% 64%))';
                const routesTooltip = getRoutesTooltip(entry).join(' · ');

                return (
                  <article
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEditor(entry)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openEditor(entry);
                      }
                    }}
                    className="grid cursor-pointer gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4 text-left transition hover:border-blue-300 hover:bg-blue-50/30 hover:shadow-sm"
                  >
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
                          style={iconBoxStyle}
                        >
                          <span
                            className="block h-[23px] w-[23px]"
                            style={{
                              background: iconLogoGradient,
                              WebkitMaskImage: "url('/lovable-uploads/agro-logo-comprimido-light.webp')",
                              maskImage: "url('/lovable-uploads/agro-logo-comprimido-light.webp')",
                              WebkitMaskPosition: 'center',
                              maskPosition: 'center',
                              WebkitMaskRepeat: 'no-repeat',
                              maskRepeat: 'no-repeat',
                              WebkitMaskSize: 'contain',
                              maskSize: 'contain',
                            }}
                          />
                        </span>
                        <div className="min-w-0">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <h3 className="truncate text-sm font-bold text-slate-950">{entry.email || 'Sin email'}</h3>
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
                              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                              {getRoleLabel(entry.role, entry.configured)}
                            </span>
                            {isCurrent ? <span className="text-xs font-semibold text-slate-500">Cuenta actual</span> : null}
                          </div>
                          <p className="mt-1 flex min-w-0 items-center gap-1 text-xs text-slate-500">
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{entry.id}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-start gap-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm md:justify-end">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditor(entry);
                          }}
                          className="flex h-9 w-10 items-center justify-center border-r border-slate-200 text-slate-500 transition hover:bg-blue-50 hover:text-blue-700"
                          aria-label={`Editar ${entry.email ?? entry.id}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            requestDelete(entry);
                          }}
                          disabled={deletingId === entry.id}
                          className="inline-flex h-9 items-center gap-2 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                        >
                          {deletingId === entry.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Eliminar
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-2">
                        <span>Acceso</span>
                        <strong className="font-semibold text-slate-800">{getAccessLabel(entry)}</strong>
                      </span>
                      <span className="h-4 w-px bg-slate-200" />
                      <span className="inline-flex items-center gap-2" title={routesTooltip}>
                        <span>Módulos</span>
                        <strong className="border-b border-dotted border-slate-400 font-semibold text-slate-800">
                          {getModulesLabel(entry)}
                        </strong>
                      </span>
                      <span className="h-4 w-px bg-slate-200" />
                      <span className="inline-flex items-center gap-2">
                        <span>Estado</span>
                        <strong className="font-semibold text-slate-800">{entry.configured ? 'Configurado' : 'Pendiente'}</strong>
                      </span>
                    </div>
                  </article>
                );
              })}

              {filteredUsers.length > USERS_PAGE_SIZE ? (
                <div className="mt-2 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">
                    Mostrando {usersPageStart}-{usersPageEnd} de {filteredUsers.length}
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setUsersPage(1)}
                      disabled={safePage <= 1}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                      aria-label="Primera página"
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setUsersPage((current) => Math.max(1, current - 1))}
                      disabled={safePage <= 1}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                      aria-label="Página anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="min-w-14 text-center text-sm text-slate-500">
                      <strong className="text-slate-900">{safePage}</strong> / {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setUsersPage((current) => Math.min(totalPages, current + 1))}
                      disabled={safePage >= totalPages}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                      aria-label="Página siguiente"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setUsersPage(totalPages)}
                      disabled={safePage >= totalPages}
                      className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                      aria-label="Última página"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>

      </main>

      {createDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/52 p-0 md:items-center md:p-6"
          onClick={closeCreateDialog}
        >
          <form
            onSubmit={handleCreateUser}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-user-title"
            className="flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-none border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] md:h-auto md:max-h-[92vh] md:rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 md:px-8">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700">
                  <UserPlus className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Alta</p>
                  <h2 id="create-user-title" className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                    Crear usuario del panel
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">Configura cuenta, rol y módulos visibles.</p>
                </div>
              </div>
              <Button type="button" variant="outline" className="h-10 w-10 p-0" onClick={closeCreateDialog} disabled={creating}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/70 px-5 py-5 md:px-8">
              <section className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-950">Datos base</h3>
                <p className="mt-1 text-xs text-slate-500">Cuenta y contraseña inicial para dejar el acceso operativo.</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="create-email">Email</Label>
                    <Input
                      id="create-email"
                      type="email"
                      value={createEmail}
                      onChange={(event) => setCreateEmail(event.target.value)}
                      placeholder="nuevo@correo.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="create-password">Contraseña inicial</Label>
                    <Input
                      id="create-password"
                      type="password"
                      value={createPassword}
                      onChange={(event) => setCreatePassword(event.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      required
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-950">Acceso del panel</h3>
                <p className="mt-1 text-xs text-slate-500">Define el rol de plataforma y los módulos disponibles.</p>
                <div className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="create-role">Rol inicial</Label>
                    <Select value={createRole} onValueChange={(value) => setCreateRole(value as UserRole)}>
                      <SelectTrigger id="create-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador (acceso total)</SelectItem>
                        <SelectItem value="user">Usuario (acceso limitado)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {createRole === 'admin' ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                      Los administradores tienen acceso completo sin limitar por módulos.
                    </div>
                  ) : (
                    <RouteSelector routes={createRoutes} onRoutesChange={setCreateRoutes} />
                  )}
                </div>
              </section>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-end md:px-8">
              <Button type="button" variant="outline" onClick={resetCreateForm} disabled={creating}>
                Limpiar
              </Button>
              <Button type="submit" disabled={creating} className="gap-2 bg-[#2f7df1] hover:bg-[#276ee0]">
                {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {creating ? 'Creando...' : 'Crear usuario'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {editorOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/52 p-0 md:items-center md:p-6"
          onClick={closeEditor}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-editor-title"
            className="flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden rounded-none border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] md:h-auto md:max-h-[92vh] md:rounded-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 md:px-8">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700">
                  <Edit2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Edición</p>
                  <h2 id="user-editor-title" className="mt-2 break-all text-xl font-semibold tracking-tight text-slate-950">
                    Configurar {editorEmail || editorUserId}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">Ajusta rol y rutas visibles para esta cuenta.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                      {editorRole === 'admin' ? 'Administrador' : 'Usuario normal'}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500">
                      {editorRole === 'admin' ? 'Todos los módulos' : `${normalizeAllowedRoutes(editorRoutes).length} módulos activos`}
                    </span>
                  </div>
                </div>
              </div>
              <Button type="button" variant="outline" className="h-10 w-10 p-0" onClick={closeEditor} disabled={saving || Boolean(deletingId)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto bg-slate-50/70 px-5 py-5 md:px-8">
              <section className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-950">Perfil y acceso</h3>
                <p className="mt-1 text-xs text-slate-500">Datos identificativos y configuración principal.</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>ID de usuario</Label>
                    <Input value={editorUserId} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editor-email">Email</Label>
                    <Input id="editor-email" value={editorEmail} onChange={(event) => setEditorEmail(event.target.value)} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="editor-role">Rol</Label>
                    <Select value={editorRole} onValueChange={(value) => setEditorRole(value as UserRole)}>
                      <SelectTrigger id="editor-role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador (acceso total)</SelectItem>
                        <SelectItem value="user">Usuario (acceso limitado)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-slate-950">Módulos permitidos</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Si vacías esta lista, la cuenta no tendrá acceso a navegación protegida.
                </p>
                <div className="mt-4">
                  {editorRole === 'admin' ? (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                      Los administradores tienen acceso completo sin limitar por módulos.
                    </div>
                  ) : (
                    <RouteSelector routes={editorRoutes} onRoutesChange={setEditorRoutes} />
                  )}
                </div>
              </section>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between md:px-8">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDeleteConfigTarget({ userId: editorUserId, email: editorEmail || null });
                }}
                disabled={saving || Boolean(deletingId) || currentUser?.id === editorUserId}
                className="gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
              >
                <Trash2 className="h-4 w-4" />
                Eliminar cuenta
              </Button>
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <Button type="button" variant="outline" onClick={closeEditor} disabled={saving || Boolean(deletingId)}>
                  Cerrar
                </Button>
                <Button type="button" onClick={handleSaveEditor} disabled={saving || Boolean(deletingId)} className="gap-2 bg-[#2f7df1] hover:bg-[#276ee0]">
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(deleteConfigTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingId) setDeleteConfigTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar configuración</AlertDialogTitle>
            <AlertDialogDescription>
              Elige si quieres eliminar solo permisos y rutas, o también eliminar el usuario de Auth.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 rounded-md border bg-slate-50 p-3 text-sm">
            <p>
              <span className="font-medium">Usuario:</span> {deleteConfigTarget?.email ?? 'Sin email'}
            </p>
            <p className="break-all">
              <span className="font-medium">ID:</span> {deleteConfigTarget?.userId}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={!deleteConfigTarget || Boolean(deletingId)}
              onClick={() => {
                if (!deleteConfigTarget) return;
                void handleDeleteConfigurationOnly(deleteConfigTarget);
              }}
            >
              {deletingId === deleteConfigTarget?.userId ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Solo configuración
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="gap-2"
              disabled={!deleteConfigTarget || Boolean(deletingId) || deleteConfigTarget.userId === currentUser?.id}
              onClick={() => {
                if (!deleteConfigTarget) return;
                setDeleteUserTarget(deleteConfigTarget);
                setDeleteConfigTarget(null);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Eliminar usuario
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteUserTarget)}
        onOpenChange={(open) => {
          if (!open && !deletingId) setDeleteUserTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar eliminación de usuario</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción borrará el usuario de Supabase Auth y también su configuración de permisos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm">
            <p>
              <span className="font-medium">Usuario:</span> {deleteUserTarget?.email ?? 'Sin email'}
            </p>
            <p className="break-all">
              <span className="font-medium">ID:</span> {deleteUserTarget?.userId}
            </p>
            <p className="flex items-center gap-2 font-medium text-rose-700">
              <AlertTriangle className="h-4 w-4" />
              Esta acción no se puede deshacer.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancelar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              className="gap-2"
              disabled={!deleteUserTarget || Boolean(deletingId)}
              onClick={() => {
                if (!deleteUserTarget) return;
                void handleDeleteAuthUser(deleteUserTarget);
              }}
            >
              {deletingId === deleteUserTarget?.userId ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Eliminar usuario definitivamente
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminUsers;
