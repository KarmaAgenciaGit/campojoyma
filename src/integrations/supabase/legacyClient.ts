import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './client';

// Los módulos heredados del fork de Agroiris (pedidos, cambios, cuentas de venta,
// resúmenes diarios, etc.) consultan tablas y RPC que no existen en el proyecto
// Supabase de CAMPOJOYMA ni en `types.ts`. Se reexporta la MISMA instancia sin
// esquema tipado para no fabricar contratos falsos con tablas inexistentes.
// El módulo de Facturas Recibidas debe seguir importando el cliente tipado
// de `./client`; este puente es solo para el código heredado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const legacySupabase = supabase as unknown as SupabaseClient<any, 'public', any>;
