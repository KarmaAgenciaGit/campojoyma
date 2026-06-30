import { supabase } from '@/integrations/supabase/client';

export const createAdminUser = async () => {
  try {
    // Create the admin user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: 'administrador@karma-box.com',
      password: 'Karma2025/*',
      email_confirm: true
    });

    if (authError) {
      console.error('Error creating admin user:', authError);
      return { success: false, error: authError.message };
    }

    if (!authData.user) {
      return { success: false, error: 'No user data returned' };
    }

    // Assign admin role
    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({
        user_id: authData.user.id,
        role: 'admin'
      });

    if (roleError) {
      console.error('Error assigning admin role:', roleError);
      return { success: false, error: roleError.message };
    }

    return { 
      success: true, 
      message: 'Usuario administrador creado correctamente',
      userId: authData.user.id
    };
  } catch (error) {
    console.error('Error in createAdminUser:', error);
    return { success: false, error: 'Error inesperado' };
  }
};

export const banUser = async (email: string) => {
  try {
    // First get the user from profiles table by email
    const { data: profileData, error: profileError } = await supabase
      .from('profiles')
      .select('user_id')
      .eq('email', email)
      .maybeSingle();

    if (profileError) {
      console.error('Error finding user profile:', profileError);
      return { success: false, error: profileError.message };
    }

    if (!profileData) {
      return { success: false, error: 'Usuario no encontrado' };
    }

    // Check if user already has banned role
    const { data: existingRole, error: checkError } = await supabase
      .from('user_roles')
      .select('*')
      .eq('user_id', profileData.user_id)
      .eq('role', 'banned')
      .maybeSingle();

    if (checkError) {
      console.error('Error checking existing role:', checkError);
      return { success: false, error: checkError.message };
    }

    if (existingRole) {
      return { success: true, message: 'El usuario ya está baneado' };
    }

    // Add banned role
    const { error: insertError } = await supabase
      .from('user_roles')
      .insert({
        user_id: profileData.user_id,
        role: 'banned'
      });

    if (insertError) {
      console.error('Error banning user:', insertError);
      return { success: false, error: insertError.message };
    }

    return { 
      success: true, 
      message: 'Usuario baneado correctamente',
      userId: profileData.user_id
    };
  } catch (error) {
    console.error('Error in banUser:', error);
    return { success: false, error: 'Error inesperado' };
  }
};