// ClaudIA · utilidades das edge functions. SQL direto: o schema claudia não está exposto na Data API.
import postgres from 'npm:postgres@3.4.5'
import { createClient } from 'npm:@supabase/supabase-js@2.46.1'

export const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 3, idle_timeout: 20 })
const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}

/** Usuário logado (JWT válido) presente em claudia.members. */
export async function authenticate(req: Request): Promise<{ userId: string } | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json(401, { error: 'Faça login.' })
  const { data, error } = await auth.auth.getUser(token)
  if (error || !data.user) return json(401, { error: 'Sessão inválida — entre de novo.' })
  const [m] = await sql`select 1 from claudia.members where user_id = ${data.user.id}`
  if (!m) return json(403, { error: 'Esta conta não tem acesso à ClaudIA.' })
  return { userId: data.user.id }
}

export function spDate(d = new Date()): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}
