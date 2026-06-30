import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface Module {
  id: string;
  name: string;
  display_name: string;
  is_enabled: boolean;
  description?: string;
  icon?: string;
  path: string;
}

export const useModules = () => {
  const [modules, setModules] = useState<Module[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchModules = async () => {
    try {
      const { data, error } = await supabase
        .from('modules')
        .select('*')
        .order('display_name');

      if (error) {
        console.error('Error fetching modules:', error);
        return;
      }

      setModules(data || []);
    } catch (error) {
      console.error('Error fetching modules:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updateModule = async (id: string, updates: Partial<Module>) => {
    try {
      const { error } = await supabase
        .from('modules')
        .update(updates)
        .eq('id', id);

      if (error) {
        console.error('Error updating module:', error);
        return false;
      }

      // Update local state
      setModules(prev => 
        prev.map(module => 
          module.id === id ? { ...module, ...updates } : module
        )
      );

      return true;
    } catch (error) {
      console.error('Error updating module:', error);
      return false;
    }
  };

  const getEnabledModules = () => {
    return modules.filter(module => module.is_enabled);
  };

  useEffect(() => {
    fetchModules();
  }, []);

  return {
    modules,
    isLoading,
    fetchModules,
    updateModule,
    getEnabledModules
  };
};