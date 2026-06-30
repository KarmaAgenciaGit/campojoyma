import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

type UserLabelMap = Record<string, string>;

type RoleRow = {
  user_id: string;
  user_email: string | null;
};

type AppUserRow = {
  id: string;
  email: string | null;
};

const normalizeUserId = (value?: string | null) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const fallbackUserLabel = (userId: string) => `Usuario ${userId.slice(0, 6)}`;

const buildFallbackMap = (userIds: string[]): UserLabelMap =>
  Object.fromEntries(userIds.map((userId) => [userId, fallbackUserLabel(userId)]));

export const useUserLabels = (userIds: Array<string | null | undefined>, enabled = true) => {
  const normalizedUserIds = useMemo(() => {
    const ids = userIds
      .map((userId) => normalizeUserId(userId))
      .filter((userId): userId is string => Boolean(userId));

    return Array.from(new Set(ids)).sort((left, right) => left.localeCompare(right));
  }, [userIds]);

  const [labelsById, setLabelsById] = useState<UserLabelMap>({});

  useEffect(() => {
    let cancelled = false;

    if (!enabled || normalizedUserIds.length === 0) {
      setLabelsById({});
      return () => {
        cancelled = true;
      };
    }

    const loadLabels = async () => {
      try {
        const [rolesRes, usersRes] = await Promise.all([
          supabase
            .from('user_roles')
            .select('user_id, user_email')
            .in('user_id', normalizedUserIds),
          supabase.rpc('get_app_users'),
        ]);

        if (rolesRes.error) throw rolesRes.error;
        if (usersRes.error) throw usersRes.error;

        const roleRows = (rolesRes.data ?? []) as RoleRow[];
        const appUsers = (usersRes.data ?? []) as AppUserRow[];

        const emailById = new Map<string, string>();

        roleRows.forEach((row) => {
          const userId = normalizeUserId(row.user_id);
          if (!userId) return;
          const email = row.user_email?.trim();
          if (email) emailById.set(userId, email);
        });

        appUsers.forEach((row) => {
          const userId = normalizeUserId(row.id);
          if (!userId) return;
          if (emailById.has(userId)) return;
          const email = row.email?.trim();
          if (email) emailById.set(userId, email);
        });

        const nextMap: UserLabelMap = {};
        normalizedUserIds.forEach((userId) => {
          nextMap[userId] = emailById.get(userId) ?? fallbackUserLabel(userId);
        });

        if (!cancelled) {
          setLabelsById(nextMap);
        }
      } catch (error) {
        console.error('Error cargando nombres de usuario para trazabilidad:', error);
        if (!cancelled) {
          setLabelsById(buildFallbackMap(normalizedUserIds));
        }
      }
    };

    void loadLabels();

    return () => {
      cancelled = true;
    };
  }, [enabled, normalizedUserIds]);

  return { labelsById };
};
