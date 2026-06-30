import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.44.0'

type CreateUserBody = {
  email?: string
  password?: string
  role?: 'admin' | 'user'
  allowed_routes?: string[] | null
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

  let body: CreateUserBody = {}
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders })
  }

  const email = (body.email || '').trim().toLowerCase()
  const password = body.password || ''
  const role: 'admin' | 'user' = body.role === 'admin' ? 'admin' : 'user'
  const allowedRoutes = Array.isArray(body.allowed_routes) ? body.allowed_routes : null

  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email y password son requeridos' }), {
      status: 400,
      headers: corsHeaders,
    })
  }

  // Cliente para validar token del usuario (usa anon + Authorization)
  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  // Cliente con service role para operaciones privilegiadas
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // Validar que quien llama sea admin
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

  // Crear usuario en auth
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !created?.user) {
    return new Response(
      JSON.stringify({ error: createError?.message || 'No se pudo crear el usuario' }),
      { status: 400, headers: corsHeaders },
    )
  }

  const newUser = created.user

  // Insertar perfil
  await supabase
    .from('profiles')
    .upsert({
      id: newUser.id,
      email: newUser.email ?? email,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle()

  // Asignar rol
  await supabase
    .from('user_roles')
    .upsert({
      user_id: newUser.id,
      user_email: newUser.email ?? email,
      role,
      allowed_routes: allowedRoutes,
    })

  return new Response(
    JSON.stringify({
      user_id: newUser.id,
      email: newUser.email ?? email,
      role,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    },
  )
}

Deno.serve(handler)
