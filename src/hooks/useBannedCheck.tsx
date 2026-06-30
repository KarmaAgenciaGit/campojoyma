import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export const useBannedCheck = () => {
  const { user } = useAuth();
  const [isBanned, setIsBanned] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const checkIfBanned = async () => {
      if (!user) {
        if (active) {
          setIsBanned(false);
          setIsLoading(false);
        }
        return;
      }

      // Importante: marcar carga al iniciar verificación
      if (active) setIsLoading(true);

      try {
        const { data, error } = await supabase.rpc('is_banned');
        
        if (error) {
          if (error.code === 'PGRST202') {
            console.warn('RPC is_banned not found; skipping banned check.');
            setIsBanned(false);
          } else {
            console.error('Error checking banned status:', error);
            setIsBanned(false);
          }
        } else {
          setIsBanned(Boolean(data));
        }
      } catch (error) {
        console.error('Error checking banned status:', error);
        setIsBanned(false);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    checkIfBanned();
    return () => {
      active = false;
    };
  }, [user]);

  return { isBanned, isLoading };
};
