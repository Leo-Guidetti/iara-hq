// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// IARA HQ · utilidades das edge functions do core/sabia.
// Acesso ao banco por SQL direto (SUPABASE_DB_URL): os schemas core e sabia
// ainda não estão expostos na Data API, e o backend não precisa disso.
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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-iara-cron',
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
/** pg_cron (header x-iara-cron = core_private.kv.cron_secret) ou usuário logado que está em core.members. */ export async function authenticate(req) {
  const cron = req.headers.get('x-iara-cron');
  if (cron) {
    const [row] = await sql`select value #>> '{}' as v from core_private.kv where key = 'cron_secret'`;
    if (row?.v && cron === row.v) return {
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
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return json(401, {
    error: 'Sessão inválida — entre de novo.'
  });
  const [m] = await sql`select 1 from core.members where user_id = ${data.user.id}`;
  if (!m) return json(403, {
    error: 'Esta conta não tem acesso ao IARA HQ.'
  });
  return {
    kind: 'user',
    userId: data.user.id
  };
}
/** Perfis a processar: todos (cron) ou só o do usuário (app). */ export async function perfis(c) {
  return c.kind === 'cron' ? await sql`select user_id, nome, config from core.perfil` : await sql`select user_id, nome, config from core.perfil where user_id = ${c.userId}`;
}
export function agoraSP() {
  const now = new Date();
  const data = now.toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo'
  });
  const hora = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(now));
  const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
  return {
    data,
    hora,
    dow
  };
}
export const DIAS = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado'
];
export async function iniciarRun(agent, userId, tipo, input) {
  const [r] = await sql`insert into core.agent_runs (agent, user_id, tipo, input) values (${agent}, ${userId}, ${tipo}, ${sql.json(input)}) returning id`;
  return {
    id: Number(r.id),
    agent,
    userId,
    custo: 0,
    chamadas: 0,
    uso: {}
  };
}
export async function fecharRun(run, status, extra) {
  await sql`update core.agent_runs set status = ${status}, finished_at = now(),
    output = ${extra.output === undefined ? null : sql.json(extra.output)}, erro = ${extra.erro ?? null},
    descartado = ${extra.descartado ?? false}, uso = ${sql.json(run.uso)},
    custo_usd = ${Math.round(run.custo * 10000) / 10000}, chamadas = ${run.chamadas}
    where id = ${run.id}`;
}
