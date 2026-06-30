import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ErrorPayload = {
  email?: string | null;
  subject?: string | null;
  error?: string | null;
};

const normalizeString = (value?: string | null) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'Missing Supabase environment configuration' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const payload = await req.json().catch(() => null);

    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload. Provide an object or array with error data.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const entries: ErrorPayload[] = Array.isArray(payload) ? payload : [payload];
    const created: Array<{ id: string; subject: string; created_at: string }> = [];
    const failed: Array<{ index: number; reason: string }> = [];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const subject = normalizeString(entry?.subject);
      const errorMessage = normalizeString(entry?.error);
      const email = normalizeString(entry?.email);

      if (!subject || !errorMessage) {
        failed.push({ index: i, reason: 'subject and error are required' });
        continue;
      }

      const { data, error } = await supabase
        .from('errores_app')
        .insert({
          email,
          subject,
          error: errorMessage,
          revisado: false,
        })
        .select('id, subject, created_at')
        .single();

      if (error || !data) {
        failed.push({ index: i, reason: error?.message ?? 'Unknown error inserting record' });
      } else {
        created.push(data);
      }
    }

    return new Response(
      JSON.stringify({
        success: failed.length === 0,
        created,
        failed,
      }),
      { status: failed.length ? 207 : 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('log-error function failed', error);
    return new Response(JSON.stringify({ error: 'Unexpected error registering error event' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
