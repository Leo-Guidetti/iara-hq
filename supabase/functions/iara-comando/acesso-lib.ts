// UX-19 · acesso por token (Atalho da Siri) ao iara-comando. Lógica pura, testável com `deno test` (sem banco, sem rede).
export const TOKEN_RE = /^iar_[0-9a-f]{48}$/;
export type Entrada = { user_id: string; token_id: number; status: 'ok' | 'limite' } | null;
export type Acesso = { ok: true; userId: string; tokenId: number } | { ok: false; status: 401 | 429; msg: string };

const MSG_TOKEN = 'Token da Siri inválido ou revogado. Crie outro no Perfil.';

/** Token do Atalho: `Authorization: Bearer iar_…` ou header `x-iara-token`. JWT de usuário (eyJ…) não é token. */
export function extrairToken(h: Headers): string | null {
  const v = (h.get('x-iara-token') ?? h.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  return v.startsWith('iar_') ? v : null;
}

/** `entrar` = core.iara_token_entrar (valida hash, revogação, escopo iara, membro e limite por minuto). */
export async function autenticarToken(token: string, entrar: (t: string) => Promise<Entrada>): Promise<Acesso> {
  if (!TOKEN_RE.test(token)) return { ok: false, status: 401, msg: MSG_TOKEN };
  const r = await entrar(token);
  if (!r) return { ok: false, status: 401, msg: MSG_TOKEN };
  if (r.status === 'limite') return { ok: false, status: 429, msg: 'Muitos comandos seguidos. Espere um minuto e tente de novo.' };
  return { ok: true, userId: r.user_id, tokenId: r.token_id };
}

/** O Atalho fala o corpo inteiro: texto puro no canal atalho ou com ?formato=texto; ?formato=json força JSON. */
export function querTexto(url: string, canal: string | null): boolean {
  const f = new URL(url).searchParams.get('formato');
  if (f === 'json') return false;
  if (f === 'texto') return true;
  return canal === 'atalho';
}

/** Chamada SQL de uma RPC com argumentos nomeados (como o PostgREST), identificadores validados. O postgres.js descobre o
 *  tipo de cada parâmetro no servidor: jsonb recebe o objeto como está e serializa sozinho (string viraria jsonb string). */
export function chamadaRpc(schema: string | null, nome: string, args: Record<string, unknown>): { texto: string; valores: unknown[] } {
  const id = (s: string) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`identificador inválido: ${s}`); return `"${s}"`; };
  const chaves = Object.keys(args);
  return { texto: `select ${id(schema ?? 'public')}.${id(nome)}(${chaves.map((k, i) => `${id(k)} => $${i + 1}`).join(', ')}) as r`, valores: chaves.map((k) => args[k] ?? null) };
}
