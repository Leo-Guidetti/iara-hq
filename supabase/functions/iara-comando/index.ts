// IARA · porta única "Peça à IARA" (UX-15). POST /functions/v1/iara-comando, só usuário logado (JWT de core.members).
// Body: { texto, canal: 'hub'|'atalho'|'voz', conversa?, dry_run? }. Resposta SEMPRE { fala, tela, pendente } (+ intencao, slots, desfazer).
// UX-16: pendente de confirmação traz acao_id/expira_em (core.acoes_pendentes, 10 min); "sim"/"não"/"desfaz" são frases reconhecidas em código
//        antes do roteador; escrita executada por RPC devolve desfazer {acao_id, ate} (10 min) quando a intenção tem desfazer.
// Fluxo: catálogo ativo + turnos de 30 min + candidatos -> 1 `fast` (Haiku, effort low, structured outputs, system cacheado) roteia ->
//        slots validados em código -> risco baixo/médio executa a RPC COMO O USUÁRIO (hub_acao_pedir com o JWT dele), alto grava a ação
//        pendente e devolve pendente {tipo:'confirmacao', acao_id}; só o "sim" executa -> pergunta ao especialista (airton-ai) ou fala curta.
// Custo: rota <= US$ 0,001 (ai_usage feature `comando-rota`, worker, chave IARA_ANTHROPIC_KEY_COMANDO com reserva em ANTHROPIC_API_KEY).
// Pergunta ao especialista é registrada pela função dele (airton-ai: feature `chat`). agent_runs tipo `comando`.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { agoraSP, authenticate, CORS, fecharRun, iniciarRun, json, sql } from './_shared/common.ts';
import { anthropicJson, MODELS } from './_shared/ai.ts';
import { corpoFn, processar, ROTA_SCHEMA, SO_LEITURA, type Acoes, type AcaoInfo, type Contexto, type Destino, type Intencao, type Turno } from './comando-lib.ts';

const CANAIS = ['hub', 'atalho', 'voz'];
const erro = (status: number, msg: string) => json(status, { error: msg, fala: msg, tela: null, pendente: null });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return erro(405, 'Use POST.');
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== 'user') return erro(403, 'Esta função só aceita usuário logado.');
  const body = await req.json().catch(() => ({}));
  const texto = typeof body.texto === 'string' ? body.texto.trim().slice(0, 600) : '';
  if (!texto) return erro(400, 'Diga o que você quer fazer.');
  const canal = CANAIS.includes(body.canal) ? body.canal : 'hub';
  const dryRun = body.dry_run === true;
  const userId = caller.userId as string;
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const inicio = new Date().toISOString();
  const { data: hoje } = agoraSP();
  const run = await iniciarRun('iara', userId, 'comando', { canal, texto: texto.slice(0, 200), dry_run: dryRun });
  try {
    const catalogo = (await sql`select slug, agent, exemplos, rpc, slots, risco, confirmacao, desfazer_rpc
      from core.intencoes where ativo order by slug`) as unknown as Intencao[];
    const turnos = (await sql`select papel, texto, pendente, at::text as at from core.conversas
      where user_id = ${userId} and at > now() - interval '30 minutes' order by at desc limit 12`).reverse() as unknown as Turno[];
    const [{ c }] = await sql`select core.comando_contexto(${userId}::uuid, ${hoje}::date) as c`;

    // Cliente COM o JWT do usuário: auth.uid() das RPCs é ele (nunca service role para escrita do usuário).
    const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const rpc = async <T = unknown>(nome: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await db.rpc(nome, args);
      if (error) throw new Error(error.message);
      return data as T;
    };
    // UX-16: toda escrita por RPC passa por hub_acao_pedir (registra a ação e o desfazer; risco alto só grava pendente).
    // Leituras puras chamam a RPC direto. Funções (fn:) seguem como antes.
    const chamar = async (d: Destino, args: Record<string, unknown>, textoLeo: string, intencao: string) => {
      if (d.via === 'rpc') {
        if (SO_LEITURA.has(intencao)) {
          const { data, error } = await (d.schema ? db.schema(d.schema).rpc(d.nome, args) : db.rpc(d.nome, args));
          if (error) throw new Error(error.message);
          return data;
        }
        return await rpc<AcaoInfo>('hub_acao_pedir', { p_intencao: intencao, p_args: args, p_canal: canal });
      }
      const r = await fetch(`${url}/functions/v1/${d.funcao}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, apikey: anon, 'content-type': 'application/json' },
        body: JSON.stringify(corpoFn(d, args, textoLeo)),
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
    if (!dryRun) {
      await sql`insert into core.conversas (user_id, canal, papel, texto, at) values (${userId}, ${canal}, 'leo', ${texto}, ${inicio})`;
      await sql`insert into core.conversas (user_id, canal, papel, texto, intencao, slots, pendente) values
        (${userId}, ${canal}, 'iara', ${saida.fala}, ${saida.intencao}, ${saida.slots ? sql.json(saida.slots as never) : null}, ${saida.pendente ? sql.json(saida.pendente as never) : null})`;
    }
    await fecharRun(run, 'ok', { output: { intencao: saida.intencao, executou: (saida.tela as any)?.executou ?? false, confianca: rota?.confianca } });
    return json(200, dryRun ? { ...resposta, tela: { ...(resposta.tela ?? {}), rota } } : resposta);
  } catch (e) {
    console.error('iara-comando', e);
    await fecharRun(run, 'erro', { erro: String((e as Error).message ?? e).slice(0, 300) }).catch(() => {});
    // Nunca erro seco para a tela: devolve pergunta/aviso no mesmo contrato.
    return json(200, { fala: 'Não consegui entender agora. Tente de novo em instantes ou abra o módulo.', tela: null, pendente: null, intencao: null, slots: null });
  }
});
