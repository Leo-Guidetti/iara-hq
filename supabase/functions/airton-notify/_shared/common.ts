// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// Utilidades comuns das Edge Functions do AIrton (schema `airton` no projeto ClaudIA).
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
export const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
// deno-lint-ignore no-explicit-any
export function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    db: {
      schema: 'airton'
    }
  });
}
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-airton-cron',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};
export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
// airton_private não é exposto na API: acesso só por RPC restrita à service role.
export async function kvGet(key) {
  const { data, error } = await admin().rpc('kv_get', {
    p_key: key
  });
  if (error) throw new Error(`kv_get: ${error.message}`);
  return data ?? null;
}
export async function kvSet(key, value) {
  const { error } = await admin().rpc('kv_set', {
    p_key: key,
    p_value: value
  });
  if (error) throw new Error(`kv_set: ${error.message}`);
}
/** Quem chamou: o usuário logado (membro do AIrton) ou o pg_cron (segredo compartilhado). */ export async function authenticate(req) {
  const cron = req.headers.get('x-airton-cron');
  if (cron) {
    const secret = await kvGet('cron_secret');
    if (secret && cron === secret) return {
      kind: 'cron'
    };
    return json(401, {
      error: 'cron secret inválido'
    });
  }
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, {
    error: 'Faça login.'
  });
  const db = admin();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return json(401, {
    error: 'Sessão inválida — entre de novo.'
  });
  const { data: m } = await db.from('members').select('user_id').eq('user_id', data.user.id).maybeSingle();
  if (!m) return json(403, {
    error: 'Esta conta não tem acesso ao AIrton.'
  });
  return {
    kind: 'user',
    userId: data.user.id
  };
}
export async function memberIds() {
  const { data } = await admin().from('members').select('user_id');
  return (data ?? []).map((r)=>r.user_id);
}
export function spDate(d = new Date()) {
  return d.toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo'
  });
}
export function addDays(iso, n) {
  const t = Date.parse(iso + 'T12:00:00Z') + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
export function brl(v, compact = false) {
  const abs = Math.abs(v);
  if (compact && abs >= 10_000) return `R$ ${(v / 1000).toLocaleString('pt-BR', {
    maximumFractionDigits: 1
  })} mil`;
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: abs >= 1000 ? 0 : 2,
    minimumFractionDigits: abs >= 1000 ? 0 : 2
  });
}
