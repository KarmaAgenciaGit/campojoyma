import { useEffect } from 'react';
import type { User } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';

export const useOnlinePresence = (user: User | null) => {
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase.channel('online-users', {
      config: { presence: { key: user.id } },
    });

    const connectedAt = new Date().toISOString();

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({
          user_id: user.id,
          connected_at: connectedAt,
        });
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);
};
