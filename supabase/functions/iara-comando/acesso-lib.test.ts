import { assertEquals } from 'jsr:@std/assert@1';
import { autenticarToken, chamadaRpc, extrairToken, querTexto, type Entrada } from './acesso-lib.ts';

const TOK = 'iar_' + 'a'.repeat(48);
const U = '11111111-1111-1111-1111-111111111111';

Deno.test('extrairToken: Bearer, x-iara-token; JWT e vazio não são token', () => {
  assertEquals(extrairToken(new Headers({ Authorization: `Bearer ${TOK}` })), TOK);
  assertEquals(extrairToken(new Headers({ 'x-iara-token': TOK })), TOK);
  assertEquals(extrairToken(new Headers({ Authorization: 'Bearer eyJhbGciOi.x.y' })), null);
  assertEquals(extrairToken(new Headers()), null);
});

Deno.test('autenticarToken: válido, revogado/escopo errado (null) => 401, limite => 429, formato ruim nem consulta', async () => {
  let chamadas = 0;
  const entrar = (r: Entrada) => (_t: string) => { chamadas++; return Promise.resolve(r); };
  assertEquals(await autenticarToken(TOK, entrar({ user_id: U, token_id: 7, status: 'ok' })), { ok: true, userId: U, tokenId: 7 });
  const rev = await autenticarToken(TOK, entrar(null));
  assertEquals(rev.ok === false && rev.status, 401);
  const lim = await autenticarToken(TOK, entrar({ user_id: U, token_id: 7, status: 'limite' }));
  assertEquals(lim.ok === false && lim.status, 429);
  chamadas = 0;
  const ruim = await autenticarToken('iar_curto', entrar({ user_id: U, token_id: 7, status: 'ok' }));
  assertEquals(ruim.ok === false && ruim.status, 401);
  assertEquals(chamadas, 0);
  const cla = await autenticarToken('cla_' + 'a'.repeat(48), entrar({ user_id: U, token_id: 7, status: 'ok' })); // token de peso não abre a IARA
  assertEquals(cla.ok, false);
});

Deno.test('querTexto: canal atalho ou ?formato=texto; ?formato=json força JSON', () => {
  assertEquals(querTexto('https://x/functions/v1/iara-comando', 'atalho'), true);
  assertEquals(querTexto('https://x/functions/v1/iara-comando', 'hub'), false);
  assertEquals(querTexto('https://x/functions/v1/iara-comando?formato=texto', 'voz'), true);
  assertEquals(querTexto('https://x/functions/v1/iara-comando?formato=json', 'atalho'), false);
});

Deno.test('chamadaRpc: args nomeados, objeto vira JSON, identificador malicioso é recusado', () => {
  const c = chamadaRpc(null, 'hub_acao_pedir', { p_intencao: 'peso.registrar', p_args: { kg: 82.4 }, p_canal: 'atalho', p_pergunta: null });
  assertEquals(c.texto, 'select "public"."hub_acao_pedir"("p_intencao" => $1, "p_args" => $2, "p_canal" => $3, "p_pergunta" => $4) as r');
  assertEquals(c.valores, ['peso.registrar', { kg: 82.4 }, 'atalho', null]);
  assertEquals(chamadaRpc('sabia', 'hub_x', {}).texto, 'select "sabia"."hub_x"() as r');
  let erro = false;
  try { chamadaRpc(null, 'x"; drop', {}); } catch { erro = true; }
  assertEquals(erro, true);
});
