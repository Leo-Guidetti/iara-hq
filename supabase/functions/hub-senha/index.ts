// hub-senha · define a senha de login do hub sem e-mail (pedido do Leo em 09/11).
//   POST { email, senha, codigo } → { ok: true }
// Só aceita o e-mail do Leo e só com o código guardado no secret HUB_CADASTRO_CODIGO (definido pelo Leo no
// painel do Supabase). Sem o secret, o cadastro fica fechado. Depois de usar, o Leo pode apagar o secret.
// verify_jwt = false: a função autentica sozinha (e-mail permitido + código), como as demais do HQ.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';

const PERMITIDO = 'leonardoguidettic@gmail.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Comparação em tempo constante (não revela quantos caracteres batem). */
async function iguais(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  const esperado = Deno.env.get('HUB_CADASTRO_CODIGO') ?? '';
  if (esperado.length < 12) return json(403, { error: 'Cadastro fechado.' });

  const body = await req.json().catch(() => ({})) as { email?: unknown; senha?: unknown; codigo?: unknown };
  const email = String(body.email ?? '').trim().toLowerCase();
  const senha = String(body.senha ?? '');
  const codigo = String(body.codigo ?? '');

  // Mesma resposta para e-mail e código errados: não revela qual dos dois falhou.
  if (email !== PERMITIDO || !(await iguais(codigo, esperado))) {
    await new Promise((r) => setTimeout(r, 1000));
    return json(403, { error: 'E-mail ou código inválido.' });
  }
  if (senha.length < 10) return json(400, { error: 'A senha precisa ter pelo menos 10 caracteres.' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: lista, error: erroLista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (erroLista) return json(500, { error: erroLista.message });
  const user = lista.users.find((u) => u.email?.toLowerCase() === PERMITIDO);

  const { error } = user
    ? await admin.auth.admin.updateUserById(user.id, { password: senha, email_confirm: true })
    : await admin.auth.admin.createUser({ email: PERMITIDO, password: senha, email_confirm: true });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true });
});
