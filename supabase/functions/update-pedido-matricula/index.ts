import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { referencia_cliente, referencia2_cliente, matricula_tractora, matricula_remolque } = body;

    // Validar campos requeridos
    if (!referencia_cliente && !referencia2_cliente) {
      return new Response(
        JSON.stringify({ error: 'referencia_cliente or referencia2_cliente is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!matricula_tractora && !matricula_remolque) {
      return new Response(
        JSON.stringify({ error: 'At least one of matricula_tractora or matricula_remolque is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const lookupField = referencia_cliente ? 'referencia_cliente' : 'referencia2_cliente';
    const lookupValue = referencia_cliente ?? referencia2_cliente;

    // Buscar el pedido por referencia_cliente o referencia2_cliente
    const { data: pedidos, error: searchError } = await supabase
      .from('pedidos')
      .select('id, referencia_cliente, referencia2_cliente, matricula_tractora, matricula_remolque')
      .eq(lookupField, lookupValue)
      .limit(2);

    if (searchError) {
      console.error('Pedido not found:', searchError);
      return new Response(
        JSON.stringify({ 
          error: 'Pedido not found',
          referencia_cliente: referencia_cliente,
          referencia2_cliente: referencia2_cliente
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!pedidos || pedidos.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Pedido not found',
          referencia_cliente: referencia_cliente,
          referencia2_cliente: referencia2_cliente
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (pedidos.length > 1) {
      return new Response(
        JSON.stringify({
          error: 'Multiple pedidos found for the provided referencia',
          referencia_cliente: referencia_cliente,
          referencia2_cliente: referencia2_cliente
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const pedidoExistente = pedidos[0];

    // Preparar datos a actualizar (solo los campos enviados)
    const updateData: any = {};
    if (matricula_tractora !== undefined) {
      updateData.matricula_tractora = matricula_tractora;
    }
    if (matricula_remolque !== undefined) {
      updateData.matricula_remolque = matricula_remolque;
    }
    updateData.needs_sync = true;

    // Actualizar el pedido
    const { data: pedidoActualizado, error: updateError } = await supabase
      .from('pedidos')
      .update(updateData)
      .eq('id', pedidoExistente.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating pedido:', updateError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to update pedido',
          details: updateError.message
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Pedido updated successfully',
        pedido: {
          id: pedidoActualizado.id,
          referencia_cliente: pedidoActualizado.referencia_cliente,
          referencia2_cliente: pedidoActualizado.referencia2_cliente,
          matricula_tractora: pedidoActualizado.matricula_tractora,
          matricula_remolque: pedidoActualizado.matricula_remolque
        },
        before: {
          matricula_tractora: pedidoExistente.matricula_tractora,
          matricula_remolque: pedidoExistente.matricula_remolque
        },
        after: {
          matricula_tractora: pedidoActualizado.matricula_tractora,
          matricula_remolque: pedidoActualizado.matricula_remolque
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Server error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error.message
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
