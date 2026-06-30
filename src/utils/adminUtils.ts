import { supabase } from '@/integrations/supabase/client';

export const assignAdminRole = async (userId: string) => {
  try {
    // Check if user already has admin role
    const { data: existingRole, error: checkError } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();

    if (checkError) {
      console.error('Error checking existing role:', checkError);
      return { success: false, error: checkError.message };
    }

    if (existingRole) {
      return { success: true, message: 'El usuario ya tiene rol de administrador' };
    }

    // Assign admin role
    const { error: insertError } = await supabase
      .from('user_roles')
      .insert({
        user_id: userId,
        role: 'admin'
      });

    if (insertError) {
      console.error('Error assigning admin role:', insertError);
      return { success: false, error: insertError.message };
    }

    return { success: true, message: 'Rol de administrador asignado correctamente' };
  } catch (error) {
    console.error('Error in assignAdminRole:', error);
    return { success: false, error: 'Error inesperado' };
  }
};

export const removeAdminRole = async (userId: string) => {
  try {
    // Remove admin role
    const { error: deleteError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role', 'admin');

    if (deleteError) {
      console.error('Error removing admin role:', deleteError);
      return { success: false, error: deleteError.message };
    }

    return { success: true, message: 'Rol de administrador removido correctamente' };
  } catch (error) {
    console.error('Error in removeAdminRole:', error);
    return { success: false, error: 'Error inesperado' };
  }
};