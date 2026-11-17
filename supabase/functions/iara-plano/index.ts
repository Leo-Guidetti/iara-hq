// IARA · plano nasce de uma frase (UX-11). POST /functions/v1/iara-plano, só usuário logado (JWT de core.members).
// Ações: criar {frase, respostas?, rascunho_id?} | confirmar {plano_id} | descartar {plano_id}.
// Resposta sempre {fala, tela, pendente} (contrato de fala, plano.md §3.6).
// criar: 1 `fast` (Haiku) extrai tipo/título/valor/prazo e pode devolver 1 pergunta (até 3 rodadas, contadas em código);
//        SQL junta o resumo de cada agente (sem IA); 1 `smart` (Sonnet) propõe as metas; grava RASCUNHO (nada em core.itens).
// confirmar/descartar: SQL puro (core.plano_confirmar cria a airton.goals ligada por ref; descartar = status 'abandonado').
// Orçamento: US$ 0,10 por execução (aborta antes de passar); chave IARA_ANTHROPIC_KEY_PLANO (fallback ANTHROPIC_API_KEY).
import { agoraSP, authenticate, CORS, fecharRun, iniciarRun, json, sql } from './_shared/common.ts';
import { anthropicJson, MODELS } from './_shared/ai.ts';
import {
  decidirRodada, estimarSmart, falaRascunho, garantirTeto, limparFala, normalizarExtracao, normalizarMetas, viabilidade,
  DONOS, HORIZONTES, TIPOS, type Extracao,
} from './plano-lib.ts';

const obj = (props: Record<string, unknown>) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const ouNulo = (t: Record<string, unknown>) => ({ anyOf: [t, { type: 'null' }] });

const EXTRACAO_SCHEMA = obj({
  tipo: { type: 'string', enum: [...TIPOS] },
  titulo: { type: 'string' },
  envolve_dinheiro: { type: 'boolean' },
  valor: ouNulo({ type: 'number' }),
  data: ouNulo({ type: 'string' }),
  porque: ouNulo({ type: 'string' }),
  pergunta: ouNulo(obj({ texto: { type: 'string' }, opcoes: { type: 'array', items: { type: 'string' } } })),
});

const METAS_SCHEMA = obj({
  metas: {
    type: 'array',
    items: obj({
      horizonte: { type: 'string', enum: [...HORIZONTES] },
      dono: { type: 'string', enum: [...DONOS] },
      titulo: { type: 'string' },
      medida: obj({
        tipo: { type: 'string', enum: ['valor', 'contagem', 'habito', 'marco'] },
        unidade: ouNulo({ type: 'string' }), alvo: ouNulo({ type: 'number' }), inicio: ouNulo({ type: 'string' }), valor_inicial: ouNulo({ type: 'number' }),
      }),
      prazo: ouNulo({ type: 'string' }), cadencia: ouNulo({ type: 'string' }),
      reais_mes: ouNulo({ type: 'number' }), minutos_semana: ouNulo({ type: 'integer' }), ref: ouNulo({ type: 'string' }),
    }),
  },
  primeiro_passo: obj({ titulo: { type: 'string' }, dono: { type: 'string', enum: [...DONOS] }, detalhe: ouNulo({ type: 'string' }) }),
});

const FAST_SYSTEM = `Você extrai o pedido de plano de vida do Leo. Use só o que ele disse (frase e respostas); nunca adivinhe valor em dinheiro nem prazo.
- tipo: imovel, carro, carreira, habilidade (instrumento, idioma, hobby), habito (ex.: ler N livros no ano, treinar) ou outro.
- valor: número em reais ("800 mil" = 800000), ou null se ele não disse. data: AAAA-MM-DD ("até 2030" = 2030-12-31; "este ano" = fim do ano atual), ou null.
- envolve_dinheiro: true se há compra, entrada, aporte, curso pago etc.
- pergunta: só se faltar valor (quando há dinheiro) ou prazo; 1 pergunta curta e fechada, até 3 opções curtas. Senão null.
- titulo curto (até 6 palavras); porque: motivo dito por ele, ou null. Português do Brasil.`;

const SMART_SYSTEM = `Você é a IARA, orquestradora da rotina do Leo (direta, nunca bajuladora). Você propõe o RASCUNHO de um plano de vida em metas por horizonte.
Horizontes: curto (semana a mês), medio (trimestre a 1 ano), longo (mais de 1 ano). Pelo menos 1 meta em CADA horizonte; no máximo 8 metas.
Dono (exatamente um por meta): airton (dinheiro, aporte, reserva), claudia (peso, treino, sono), sabia (estudo, livros), iara (rotina, agenda, casa, marcos, e TUDO de carreira e hobbies/instrumento).
Medida por dono (o progresso é medido sozinho; use exatamente estes formatos):
- airton: meta de dinheiro com valor total: medida {tipo:"valor", unidade:"BRL", alvo:<reais>} (no máximo UMA por plano, a de médio ou longo prazo, nunca o valor total do bem se for entrada; use o que o Leo disse); aporte do mês: tipo "habito" com reais_mes. ref sempre null.
- sabia: livros no ano: ref "sabia.livros:ano", medida {tipo:"contagem", alvo:<livros>}; demais: tipo "habito", ref null.
- claudia: peso: ref "claudia.peso", medida {tipo:"valor", unidade:"kg", alvo:<kg>}; treinos por semana: ref "claudia.sessoes:semana", medida {tipo:"habito", alvo:<sessões>}.
- iara: marco (medida {tipo:"marco"}) ou contagem manual (medida {tipo:"contagem", alvo}). ref null.
reais_mes só em metas do airton; minutos_semana = tempo semanal pedido. Prazos AAAA-MM-DD, no futuro. Títulos curtos e concretos.
primeiro_passo: UMA ação concreta para esta semana, com dono. Use só os dados recebidos; números exatamente como vieram; não invente valores que o Leo não disse.`;

const NUMERO = (n: unknown) => Number(n ?? 0);

async function planoCompleto(userId: string, planoId: number) {
  const [pl] = await sql`select id, titulo, tipo, status, prioridade, alvo, porque, proxima_revisao from core.planos where id = ${planoId} and user_id = ${userId}`;
  if (!pl) return null;
  const metas = await sql`select id, horizonte, dono, titulo, medida, prazo::text as prazo, cadencia, demanda, ref, progresso, ritmo, status
    from core.plano_metas where plano_id = ${planoId} and status <> 'cancelada' order by prazo nulls last, id`;
  const por = (h: string) => metas.filter((m) => m.horizonte === h);
  const { primeiro_passo, ...alvo } = (pl.alvo ?? {}) as Record<string, unknown>;
  return {
    plano: { ...(pl as Record<string, any>), alvo } as Record<string, any>,
    metas: { curto: por('curto'), medio: por('medio'), longo: por('longo') },
    primeiro_passo: primeiro_passo ?? null,
  };
}

const erro = (status: number, msg: string) => json(status, { error: msg, fala: msg, tela: null, pendente: null });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return erro(405, 'Use POST.');
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  if (caller.kind !== 'user') return erro(403, 'Esta função só aceita usuário logado.');
  const body = await req.json().catch(() => ({}));
  try {
    if (body.acao === 'criar') return await criar(caller.userId as string, body);
    if (body.acao === 'confirmar' || body.acao === 'descartar') return await decidir(caller.userId as string, body);
    return erro(400, 'acao deve ser criar, confirmar ou descartar.');
  } catch (e) {
    console.error('iara-plano', e);
    return erro(500, 'Não consegui montar o plano agora. Tente de novo em instantes.');
  }
});

async function decidir(userId: string, body: { acao: string; plano_id?: unknown }) {
  const id = Number(body.plano_id);
  if (!Number.isInteger(id) || id <= 0) return erro(400, 'plano_id obrigatório.');
  try {
    if (body.acao === 'confirmar') {
      const r = await sql`select core.plano_confirmar(${userId}::uuid, ${id}::bigint) as r`;
      const tela = await planoCompleto(userId, id);
      const goals = ((r[0].r as { goals_criadas?: unknown[] }).goals_criadas ?? []).length;
      return json(200, { fala: `Plano "${limparFala(tela!.plano.titulo)}" ativo${goals ? ', com a meta financeira criada no AIrton' : ''}.`, tela, pendente: null });
    }
    await sql`select core.plano_descartar(${userId}::uuid, ${id}::bigint)`;
    const tela = await planoCompleto(userId, id);
    return json(200, { fala: `Descartei o plano "${limparFala(tela!.plano.titulo)}".`, tela, pendente: null });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    if (/não encontrado|não pode ser confirmado/.test(msg)) return erro(/encontrado/.test(msg) ? 404 : 409, msg.includes('encontrado') ? 'Plano não encontrado.' : 'Esse plano não pode mais ser confirmado.');
    throw e;
  }
}

async function criar(userId: string, body: { frase?: unknown; respostas?: unknown; rascunho_id?: unknown }) {
  const frase = typeof body.frase === 'string' ? body.frase.trim().slice(0, 1000) : '';
  if (frase.length < 5) return erro(400, 'Conte em uma frase o que você quer conquistar.');
  const respostas = (Array.isArray(body.respostas) ? body.respostas : []).slice(0, 3)
    .map((r: any) => ({ pergunta: String(r?.pergunta ?? '').slice(0, 300), resposta: String(r?.resposta ?? '').slice(0, 300) }))
    .filter((r) => r.resposta);
  const { data: hoje } = agoraSP();
  const run = await iniciarRun('iara', userId, 'plano_criar', { frase: frase.slice(0, 200), rodada: respostas.length + 1 });
  try {
    // (a) fast: extrai tipo, título, valor, prazo, porquê.
    const conversa = `Frase do Leo: ${frase}${respostas.map((r) => `\nPergunta: ${r.pergunta}\nResposta: ${r.resposta}`).join('')}`;
    garantirTeto(run.custo, 0.01);
    const bruta = await anthropicJson({
      model: MODELS.fast, max_tokens: 600, system: FAST_SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACAO_SCHEMA } },
      messages: [{ role: 'user', content: `Hoje é ${hoje}.\n${conversa}` }],
    }, { run, feature: 'plano', papel: 'worker' });
    const ext: Extracao = normalizarExtracao(bruta, hoje);

    const q = decidirRodada(ext, respostas);
    if (q) {
      const pendente = { tipo: 'pergunta', pergunta: q.pergunta, opcoes: q.opcoes, rodada: q.rodada };
      await fecharRun(run, 'ok', { output: { pergunta: q.pergunta, rodada: q.rodada } });
      return json(200, { fala: q.pergunta, tela: { rascunho: null, entendido: { tipo: ext.tipo, titulo: ext.titulo, valor: ext.valor, data: ext.data } }, pendente });
    }

    // Título: o do rascunho que o cliente está refinando, se veio; senão o extraído.
    let titulo = ext.titulo;
    const rid = Number(body.rascunho_id);
    if (Number.isInteger(rid) && rid > 0) {
      const [r] = await sql`select titulo from core.planos where id = ${rid} and user_id = ${userId} and status = 'rascunho'`;
      if (r) titulo = r.titulo;
    }
    // Plano com esse título que já saiu de rascunho: não refaz (e não gasta o smart).
    const [existente] = await sql`select id, status from core.planos where user_id = ${userId} and titulo = ${titulo} and status <> 'rascunho'`;
    if (existente) {
      await fecharRun(run, 'ok', { output: { plano_id: Number(existente.id), existente: true } });
      return json(200, {
        fala: `Você já tem o plano "${limparFala(titulo)}" (${existente.status}). Quer ajustar esse?`,
        tela: await planoCompleto(userId, Number(existente.id)), pendente: null,
      });
    }

    // (b) resumo de cada agente, sem IA.
    const [{ r: resumo }] = await sql`select core.plano_resumo_agentes(${userId}::uuid) as r`;

    // (c) smart: propõe as metas por horizonte. Teto por execução: aborta antes de passar.
    const pedido = `Hoje é ${hoje}. Monte o rascunho do plano.
${conversa}
Entendido: tipo ${ext.tipo}, título "${titulo}", valor ${ext.valor ?? 'não informado'}, prazo ${ext.data ?? 'não informado'}, porquê ${ext.porque ?? 'não informado'}.
Resumo dos agentes (JSON): ${JSON.stringify(resumo)}
${ext.tipo === 'carreira' || ext.tipo === 'habilidade' ? 'D1: este plano é de carreira/hobby: todas as metas têm dono "iara".\n' : ''}${ext.valor === null && ext.envolve_dinheiro ? 'O valor não foi informado: não invente; use tipo "habito" nas metas de dinheiro.\n' : ''}Cada horizonte (curto, medio, longo) precisa de pelo menos 1 meta.`;
    const MAX = 3500;
    garantirTeto(run.custo, estimarSmart(pedido.length + SMART_SYSTEM.length, MAX));
    const saida = await anthropicJson({
      model: MODELS.smart, max_tokens: MAX, system: SMART_SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: METAS_SCHEMA } },
      messages: [{ role: 'user', content: pedido }],
    }, { run, feature: 'plano', papel: 'orquestrador' });

    const pesoAtual = (resumo?.saude?.peso?.tendencia_7d ?? null) as number | null;
    const norm = normalizarMetas(saida, { tipo: ext.tipo, titulo, alvo: { valor: ext.valor, data: ext.data }, hoje, pesoAtual: pesoAtual === null ? null : Number(pesoAtual) });

    // Grava como RASCUNHO (idempotente por título). Nada vai para core.itens.
    const alvo = { valor: ext.valor, data: ext.data, primeiro_passo: norm.primeiro_passo };
    const [{ g }] = await sql`select core.plano_rascunho_gravar(${userId}::uuid, ${sql.json({ titulo, tipo: ext.tipo, alvo, porque: ext.porque, metas: norm.metas as any })}::jsonb) as g`;
    const planoId = NUMERO((g as { id: number }).id);
    const tela = await planoCompleto(userId, planoId);
    const viab = viabilidade(norm.metas, resumo?.financas ?? null);
    await fecharRun(run, 'ok', { output: { plano_id: planoId, metas: norm.metas.length, avisos: norm.avisos, custo_usd: Math.round(run.custo * 10000) / 10000 } });
    return json(200, {
      fala: falaRascunho(titulo, norm.metas.length, viab),
      tela: { ...tela, viabilidade: viab, avisos: norm.avisos },
      pendente: { tipo: 'confirmacao', pergunta: 'Posso ativar esse plano?', opcoes: ['sim', 'não'], plano_id: planoId },
    });
  } catch (e) {
    await fecharRun(run, 'erro', { erro: String(e), descartado: true });
    throw e;
  }
}
