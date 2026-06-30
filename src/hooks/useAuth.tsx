import { useState, useEffect, createContext, useContext } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getUserRole, type UserRole } from '@/config/accessControl';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  role: UserRole;
  isAdmin: boolean;
  allowedRoutes: string[] | null;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialCheckDone, setInitialCheckDone] = useState(false);
  const [role, setRole] = useState<UserRole>('user');
  const [allowedRoutes, setAllowedRoutes] = useState<string[] | null>(null);

  const loadRole = async (userId?: string | null) => {
    if (!userId) {
      setRole('user');
      setAllowedRoutes(null);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role, allowed_routes')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.warn('No se pudo obtener rol del usuario, usando fallback estático:', error.message);
        setRole(getUserRole(userId));
        setAllowedRoutes(null);
        return;
      }

      if (data) {
        setRole((data.role as UserRole) ?? getUserRole(userId));
        setAllowedRoutes(data.allowed_routes ?? null);
      } else {
        setRole(getUserRole(userId));
        setAllowedRoutes(null);
      }
    } catch (err) {
      console.warn('Error cargando rol del usuario, usando fallback:', err);
      setRole(getUserRole(userId));
      setAllowedRoutes(null);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const setLoadingWithOptionalDelay = () => {
      if (initialCheckDone) {
        setLoading(false);
        return;
      }
      setTimeout(() => {
        if (cancelled) return;
        setLoading(false);
        setInitialCheckDone(true);
      }, 800);
    };

    const initSession = async () => {
      try {
        // getSession() lee localStorage (puede contener refresh token inválido).
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;

        let nextSession = data.session ?? null;

        // Validar sesión contra el servidor para evitar quedarse "logueado" con refresh token roto.
        if (nextSession) {
          const { error } = await supabase.auth.getUser();
          if (error) {
            console.warn('Sesión inválida detectada. Cerrando sesión local:', error.message);
            await supabase.auth.signOut();
            nextSession = null;
          }
        }

        if (cancelled) return;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        loadRole(nextSession?.user?.id);
      } catch (err) {
        console.warn('Error inicializando sesión, forzando estado anónimo:', err);
        if (cancelled) return;
        setSession(null);
        setUser(null);
        loadRole(null);
      } finally {
        if (!cancelled) setLoadingWithOptionalDelay();
      }
    };

    initSession();

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        loadRole(session?.user?.id);
        // No delay for auth state changes after initial load
        if (initialCheckDone) {
          setLoading(false);
        }
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    return { error };
  };

  const logAccessEvent = async (action: 'login' | 'logout', authUser?: User | null) => {
    if (!authUser) return;
    try {
      await supabase.from('user_access_logs').insert({
        user_id: authUser.id,
        email: authUser.email,
        action,
      });
    } catch (err) {
      console.warn('No se pudo registrar el log de acceso:', err);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (!error && data?.user) {
      await logAccessEvent('login', data.user);
    }
    return { error };
  };

  const signOut = async () => {
    await logAccessEvent('logout', user);
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    role,
    isAdmin: role === 'admin',
    allowedRoutes,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
