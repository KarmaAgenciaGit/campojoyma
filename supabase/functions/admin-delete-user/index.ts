import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.0'

type DeleteUserBody = {
  user_id?: string
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
  }

  let body: DeleteUserBody = {}
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders })
  }

  const userId = (body.user_id || '').trim()
  if (!userId) {
    return new Response(JSON.stringify({ error: 'user_id es requerido' }), {
      status: 400,
      headers: corsHeaders,
    })
  }

  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const {
    data: { user: caller },
    error: userError,
  } = await supabaseAuth.auth.getUser()

  if (userError || !caller) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: corsHeaders })
  }

  const { data: callerRole, error: roleError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', caller.id)
    .maybeSingle()

  if (roleError || callerRole?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Solo administradores' }), { status: 403, headers: corsHeaders })
  }

  if (caller.id === userId) {
    return new Response(JSON.stringify({ error: 'No puedes eliminar tu propio usuario desde este panel' }), {
      status: 400,
      headers: corsHeaders,
    })
  }

  const { data: targetData, error: targetError } = await supabase.auth.admin.getUserById(userId)
  if (targetError || !targetData?.user) {
    return new Response(JSON.stringify({ error: 'Usuario no encontrado en Auth' }), {
      status: 404,
      headers: corsHeaders,
    })
  }

  const targetEmail = targetData.user.email ?? null

  const { data: existingRole, error: existingRoleError } = await supabase
    .from('user_roles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (existingRoleError) {
    return new Response(
      JSON.stringify({ error: existingRoleError.message || 'No se pudo leer la configuración del usuario' }),
      { status: 400, headers: corsHeaders },
    )
  }

  if (existingRole) {
    const { error: deleteRoleError } = await supabase.from('user_roles').delete().eq('user_id', userId)
    if (deleteRoleError) {
      return new Response(
        JSON.stringify({ error: deleteRoleError.message || 'No se pudo eliminar la configuración del usuario' }),
        { status: 400, headers: corsHeaders },
      )
    }
  }

  const { error: deleteUserError } = await supabase.auth.admin.deleteUser(userId)
  if (deleteUserError) {
    if (existingRole) {
      await supabase.from('user_roles').upsert(existingRole)
    }

    return new Response(
      JSON.stringify({ error: deleteUserError.message || 'No se pudo eliminar el usuario en Auth' }),
      { status: 400, headers: corsHeaders },
    )
  }

  return new Response(
    JSON.stringify({
      deleted: true,
      user_id: userId,
      email: targetEmail,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

Deno.serve(handler)
