/**
 * @condobox/shared — Cliente Supabase Compartilhado
 * 
 * Exporta funções para criar clientes Supabase reutilizáveis.
 * Cada pacote (web/local-api) injeta as credenciais via variáveis de ambiente.
 */

import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';

let _anonClient: SupabaseClient | null = null;
let _serviceClient: SupabaseClient | null = null;

/**
 * Cria (ou reutiliza) um cliente Supabase com a chave ANON (uso no browser/edge)
 * Adequado para: apps/web (PWA mobile)
 */
export function createAnonClient(supabaseUrl: string, supabaseAnonKey: string): SupabaseClient {
  if (_anonClient) return _anonClient;
  _anonClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: { eventsPerSecond: 10 }
    }
  });
  return _anonClient;
}

/**
 * Cria (ou reutiliza) um cliente Supabase com a Service Role Key (apenas no backend)
 * Adequado para: apps/local-api (Node.js — nunca expor no browser)
 */
export function createServiceClient(supabaseUrl: string, serviceRoleKey: string): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  _serviceClient = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      params: { eventsPerSecond: 20 }
    }
  });
  return _serviceClient;
}

/** Reseta os singletons (útil em testes) */
export function resetClients() {
  _anonClient = null;
  _serviceClient = null;
}
