// IARA · porta única "Peça à IARA" (UX-15). POST /functions/v1/iara-comando, só usuário logado (JWT de core.members).
// Body: { texto, canal: 'hub'|'atalho'|'voz', conversa?, dry_run? }. Resposta SEMPRE { fala, tela, pendente } (+ intencao, slots, desfazer).
// UX-16: pendente de confirmação traz acao_id/expira_em (core.acoes_pendentes, 10 min); "sim"/"não"/"desfaz" são frases reconhecidas em código
//        antes do roteador; escrita executada por RPC devolve desfazer {acao_id, ate} (10 min) quando a intenção tem desfazer.
// Fluxo: catálogo ativo + turnos de 30 min + candidatos -> 1 `fast` (Haiku, effort low, structured outputs, system cacheado) roteia ->
//        slots validados em código -> risco baixo/médio executa a RPC COMO O USUÁRIO (hub_acao_pedir com o JWT dele), alto grava a ação
//        pendente e devolve pendente {tipo:'confirmacao', acao_id}; só o "sim" executa -> pergunta ao especialista (airton-ai) ou fala curta.
// UX-18: canal voz/atalho -> fala limpa (<= 2 frases, 40 palavras, sem markdown, R$ arredondado) e pergunta ao airton-ai em modo voz;
//        latencia_ms gravada em core.agent_runs.output (e started_at/finished_at já medem a duração).
// UX-19: além do JWT, aceita o token do Atalho da Siri (`Authorization: Bearer iar_…` ou `x-iara-token`, escopo `iara` em
//        public.ingest_tokens, validado por core.iara_token_entrar: hash, revogação, membro, 10 comandos/min). Sem JWT, a escrita
//        roda por SQL direto numa transação `set local role authenticated` + claims do dono do token (auth.uid() = ele; nunca
//        service role). Intenções `fn:` (airton-ai exige JWT) respondem "isso eu respondo pelo app". Canal atalho = texto puro.
// Custo: rota <= US$ 0,001 (ai_usage feature `comando-rota`, worker, chave IARA_ANTHROPIC_KEY_COMANDO com reserva em ANTHROPIC_API_KEY).
// Pergunta ao especialista é registrada pela função dele (airton-ai: feature `chat`). agent_runs tipo `comando`.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { agoraSP, authenticate, CORS, fecharRun, iniciarRun, json, sql } from './_shared/common.ts';
import { canalFala, limparFala, limparFalaHub } from './_shared/fala.ts';
import { anthropicJson, MODELS } from './_shared/ai.ts';
import { autenticarToken, chamadaRpc, extrairToken, querTexto } from './acesso-lib.ts';
import { corpoFn, processar, ROTA_SCHEMA, SO_LEITURA, type Acoes, type AcaoInfo, type Contexto, type Destino, type Intencao, type Turno } from './comando-lib.ts';

const CANAIS = ['hub', 'atalho', 'voz'];
const MSG_FN_TOKEN = 'Isso eu respondo pelo app por enquanto.';
/** Resposta no contrato { fala, tela, pendente }; texto puro (a Siri fala o corpo) quando `txt`. */
const responder = (status: number, o: Record<string, any>, txt: boolean) => txt
  ? new Response(String(o.fala ?? ''), { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Iara-Pendente': o.pendente ? 'sim' : 'nao' } })
  : json(status, o);
const erro = (status: number, msg: string, txt = false) => responder(status, { error: msg, fala: msg, tela: null, pendente: null }, txt);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return erro(405, 'Use POST.');
  const tokenAtalho = extrairToken(req.headers);
  const viaToken = tokenAtalho !== null;
  let userId: string;
  if (tokenAtalho) {
    const acesso = await autenticarToken(tokenAtalho, async (t) => (await sql`select core.iara_token_entrar(${t}) as e`)[0]?.e ?? null)
      .catch((e) => { console.error('iara-comando token', e); return null; });
    if (!acesso) return erro(500, 'Não consegui validar o token agora.', querTexto(req.url, 'atalho'));
    if (!acesso.ok) return erro(acesso.status, acesso.msg, querTexto(req.url, 'atalho'));
    userId = acesso.userId;
  } else {
    const caller = await authenticate(req);
    if (caller instanceof Response) return caller;
    if (caller.kind !== 'user') return erro(403, 'Esta função só aceita usuário logado.');
    userId = caller.userId as string;
  }
  const body = await req.json().catch(() => ({}));
  const texto = typeof body.texto === 'string' ? body.texto.trim().slice(0, 600) : '';
  const canal = viaToken ? (body.canal === 'voz' ? 'voz' : 'atalho') : CANAIS.includes(body.canal) ? body.canal : 'hub';
  const txt = querTexto(req.url, canal);
  if (!texto) return erro(400, 'Diga o que você quer fazer.', txt);
  const dryRun = !viaToken && body.dry_run === true;
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const inicio = new Date().toISOString();
  const t0 = Date.now();
  const { data: hoje } = agoraSP();
  const run = await iniciarRun('iara', userId, 'comando', { canal, texto: texto.slice(0, 200), dry_run: dryRun, via: viaToken ? 'token' : 'jwt' });
  try {
    const catalogo = (await sql`select slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc
      from core.intencoes where ativo order by slug`) as unknown as Intencao[];
    const turnos = (await sql`select papel, texto, pendente, at::text as at from core.conversas
      where user_id = ${userId} and at > now() - interval '30 minutes' order by at desc limit 12`).reverse() as unknown as Turno[];
    const [{ c }] = await sql`select core.comando_contexto(${userId}::uuid, ${hoje}::date) as c`;

    // Cliente COM o JWT do usuário: auth.uid() das RPCs é ele (nunca service role para escrita do usuário).
    // Token da Siri (sem JWT): mesma RPC por SQL numa transação `authenticated` com os claims do dono do token.
    const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const rpcSchema = async (schema: string | null, nome: string, args: Record<string, unknown> = {}): Promise<any> => {
      if (!viaToken) {
        const { data, error } = await (schema ? db.schema(schema).rpc(nome, args) : db.rpc(nome, args));
        if (error) throw new Error(error.message);
        return data;
      }
      const c = chamadaRpc(schema, nome, args);
      const rows = await sql.begin(async (tx: any) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claim.sub', ${userId}, true), set_config('request.jwt.claim.role', 'authenticated', true),
          set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;
        return await tx.unsafe(c.texto, c.valores);
      });
      return rows[0]?.r ?? null;
    };
    const rpc = async <T = unknown>(nome: string, args: Record<string, unknown> = {}) => (await rpcSchema(null, nome, args)) as T;
    let fnNegada = false;
    // UX-16: toda escrita por RPC passa por hub_acao_pedir (registra a ação e o desfazer; risco alto só grava pendente).
    // Leituras puras chamam a RPC direto. Funções (fn:) seguem como antes.
    const chamar = async (d: Destino, args: Record<string, unknown>, textoLeo: string, intencao: string) => {
      if (d.via === 'rpc') {
        if (SO_LEITURA.has(intencao)) {
          return await rpcSchema(d.schema, d.nome, args);
        }
        return await rpc<AcaoInfo>('hub_acao_pedir', { p_intencao: intencao, p_args: args, p_canal: canal });
      }
      if (viaToken) { fnNegada = true; throw new Error('função exige JWT'); } // sem JWT não há como chamar o airton-ai como o usuário
      const r = await fetch(`${url}/functions/v1/${d.funcao}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify(corpoFn(d, args, textoLeo, canal)),
      });
      if (!r.ok) throw new Error(`${d.funcao} ${r.status}`);
      return await r.json();
    };
    const acoes: Acoes = {
      criar: (intencao, args, pergunta) => rpc<AcaoInfo>('hub_acao_pedir', { p_intencao: intencao, p_args: args, p_canal: canal, p_pergunta: pergunta }),
      confirmar: (id) => rpc<AcaoInfo>('hub_acao_confirmar', { p_id: id }),
      cancelar: (id) => rpc<AcaoInfo>('hub_acao_cancelar', { p_id: id }),
      desfazerUltima: async () => {
        const r = await rpc<{ ok: boolean; fala: string }>('hub_acao_desfazer_ultima');
        return { ok: !!r?.ok, fala: r?.fala ?? 'Não consegui desfazer agora.' };
      },
    };
    const rotear = (system: string, usuario: string) => anthropicJson({
      model: MODELS.fast, max_tokens: 400,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ROTA_SCHEMA } },
      messages: [{ role: 'user', content: usuario }],
    }, { run, feature: 'comando-rota', papel: 'worker', chave: 'comando' });

    const saida = await processar(texto, { catalogo, turnos, contexto: (c ?? {}) as Contexto, hoje, rotear, chamar, acoes }, { dryRun });
    const { rota, ...resposta } = saida;
    resposta.fala = canalFala(canal) ? limparFala(resposta.fala) : limparFalaHub(resposta.fala); // defesa final: voz/atalho <= 2 frases e 40 palavras; hub = UX-15/16 (240 caracteres)
    if (fnNegada) { resposta.fala = MSG_FN_TOKEN; resposta.tela = { ...(resposta.tela ?? {}), executou: false }; }
    saida.fala = resposta.fala;
    if (!dryRun) {
      await sql`insert into core.conversas (user_id, canal, papel, texto, at) values (${userId}, ${canal}, 'leo', ${texto}, ${inicio})`;
      await sql`insert into core.conversas (user_id, canal, papel, texto, intencao, slots, pendente) values
        (${userId}, ${canal}, 'iara', ${saida.fala}, ${saida.intencao}, ${saida.slots ? sql.json(saida.slots as never) : null}, ${saida.pendente ? sql.json(saida.pendente as never) : null})`;
    }
    await fecharRun(run, 'ok', { output: { latencia_ms: Date.now() - t0, intencao: saida.intencao, executou: (saida.tela as any)?.executou ?? false, confianca: rota?.confianca } });
    return responder(200, dryRun ? { ...resposta, tela: { ...(resposta.tela ?? {}), rota } } : resposta, txt);
  } catch (e) {
    console.error('iara-comando', e);
    await fecharRun(run, 'erro', { erro: String((e as Error).message ?? e).slice(0, 300) }).catch(() => {});
    // Nunca erro seco para a tela: devolve pergunta/aviso no mesmo contrato.
    return responder(200, { fala: 'Não consegui entender agora. Tente de novo em instantes ou abra o módulo.', tela: null, pendente: null, intencao: null, slots: null }, txt);
  }
});
