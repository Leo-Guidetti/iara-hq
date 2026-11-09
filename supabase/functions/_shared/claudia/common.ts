// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// ClaudIA · utilidades das edge functions. SQL direto: o schema claudia não está exposto na Data API.
import postgres from 'npm:postgres@3.4.5';
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
export const sql = postgres(Deno.env.get('SUPABASE_DB_URL'), {
  prepare: false,
  max: 3,
  idle_timeout: 20
});
const auth = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});
export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
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
/** Cliente com o JWT do usuário: leituras e escritas em public passam pelo RLS. */ export function userClient(token) {
  return createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
export async function authenticate(req) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, {
    error: 'Faça login.'
  });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return json(401, {
    error: 'Sessão inválida — entre de novo.'
  });
  const [m] = await sql`select 1 from claudia.members where user_id = ${data.user.id}`;
  if (!m) return json(403, {
    error: 'Esta conta não tem acesso à ClaudIA.'
  });
  return {
    userId: data.user.id,
    token,
    db: userClient(token)
  };
}
export function spDate(d = new Date()) {
  return d.toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo'
  });
}
export function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Segunda-feira da semana de `iso`. */ export function weekStart(iso) {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}
export const DISCLAIMER = 'Organiza o processo com base em referências acadêmicas; não é aconselhamento médico.';
