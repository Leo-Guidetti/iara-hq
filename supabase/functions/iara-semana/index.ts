// IARA · planejamento da semana (Etapa 5, pedido do Leo em 09/11; 10/11: parte do Leo — expediente, compromissos
// e agenda são fixos — e devolve sugestão inicial + crítica, com deslocamento entre os lugares).
// Domingo 18:00 SP o pg_cron chama; a IARA junta os insumos de todos os agents (core.coletar_semana)
// e monta um rascunho dia a dia em core.planos_semana, tudo junto: carga de treino → dieta do dia → compras,
// estudo e contas. O Leo revisa e confirma em /semana; as adaptações de treino vão para a ClaudIA ao confirmar.
// App: { semana?: 'atual' | 'proxima' } refaz o rascunho. Plano já confirmado nunca é refeito (as tarefas já saíram).
import { agoraSP, authenticate, CORS, DIAS, fecharRun, iniciarRun, json, perfis, sql } from './_shared/common.ts';
import { anthropic, extrairJson, MODELS, textOf } from './_shared/ai.ts';

type Perfil = { user_id: string; nome: string | null };
type Item = {
  data: string; hora: string | null; area: string; titulo: string; detalhe: string | null;
  minutos: number | null; valor: number | null; ref: string | null;
  treino: { esporte: string; intensidade: string } | null;
};

const AREAS = new Set(['saude', 'financas', 'aprender', 'casa']);
// Valores aceitos pela ClaudIA em public.plan_sessions (checks da tabela).
const ESPORTES = new Set(['run', 'walk', 'hike', 'swim', 'ride_indoor', 'ride_outdoor', 'strength', 'hiit', 'yoga', 'mobility', 'row', 'other']);
const INTENSIDADES = new Set(['recovery', 'easy', 'moderate', 'tempo', 'threshold', 'intervals', 'long', 'strength']);

const IARA_SYSTEM = `Você é a IARA, orquestradora da rotina do Leo (no espírito do Jarvis: proativa, direta, nunca bajuladora).
Você fala pelos especialistas: ClaudIA (treino e dieta), AIrton (finanças), SabIA (estudos e leitura) e você mesma (casa e rotina).
- Use só os dados recebidos; não invente compromissos, valores nem treinos que não estejam nos insumos.
- Números exatamente como vieram.
- Português do Brasil.`;

type Fixo = { data: string; inicio: string | null; fim: string | null; titulo: string; tipo: string; fonte: string; local?: string | null; desloc_min?: number | null };
type Lugar = { nome: string; endereco: string | null; min_casa: number | null };

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Deslocamento a partir de casa (ida) para cada bloco com local: primeiro os lugares cadastrados pelo Leo
 *  (tempo informado); o que faltar vai ao Google Routes com trânsito se houver IARA_GOOGLE_MAPS_KEY e endereço de casa. */
async function deslocamentos(fixos: Fixo[], lugares: Lugar[]): Promise<{ fixos: Fixo[]; fonte: string }> {
  const casa = lugares.find((l) => norm(l.nome) === 'casa');
  const porNome = (local: string) => lugares.find((l) => norm(l.nome) !== 'casa' && (norm(local) === norm(l.nome) || norm(local).includes(norm(l.nome))));
  const faltam = new Map<string, string>(); // local → endereço para a consulta
  for (const f of fixos) {
    if (!f.local) continue;
    const l = porNome(f.local);
    if (l?.min_casa != null) f.desloc_min = l.min_casa;
    else if (norm(f.local) === 'casa' || norm(f.local) === 'home') f.desloc_min = 0;
    else faltam.set(f.local, l?.endereco ?? f.local);
  }
  const chave = Deno.env.get('IARA_GOOGLE_MAPS_KEY');
  if (!faltam.size || !chave || !casa?.endereco) return { fixos, fonte: 'informado' };
  try {
    const destinos = [...faltam.entries()].slice(0, 10);
    // Saída de referência: próximo dia útil às 08:00 de São Paulo (trânsito típico de ida).
    const ref = new Date(Date.now() + 864e5);
    while ([0, 6].includes(ref.getUTCDay())) ref.setUTCDate(ref.getUTCDate() + 1);
    const partida = `${ref.toISOString().slice(0, 10)}T11:00:00Z`;
    const r = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': chave, 'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,condition' },
      body: JSON.stringify({
        origins: [{ waypoint: { address: casa.endereco } }],
        destinations: destinos.map(([, end]) => ({ waypoint: { address: end } })),
        travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', departureTime: partida,
      }),
    });
    if (!r.ok) throw new Error(`Routes ${r.status}`);
    const els = (await r.json()) as { destinationIndex: number; duration?: string; condition?: string }[];
    const min = new Map<string, number>();
    for (const e of els) {
      if (e.condition !== 'ROUTE_EXISTS' || !e.duration) continue;
      min.set(destinos[e.destinationIndex][0], Math.round(parseInt(e.duration) / 60));
    }
    for (const f of fixos) if (f.local && f.desloc_min == null && min.has(f.local)) f.desloc_min = min.get(f.local)!;
    return { fixos, fonte: 'google_routes' };
  } catch (e) {
    console.error('deslocamentos', e);
    return { fixos, fonte: 'informado' };
  }
}

function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const body = await req.json().catch(() => ({}));
  const lista = (await perfis(caller)) as unknown as Perfil[];
  const { data, dow } = agoraSP();
  // Domingo planeja a semana que vem; nos outros dias (pelo app), a semana atual, salvo pedido explícito.
  const proxima = body.semana === 'proxima' || (body.semana !== 'atual' && dow === 0);
  const inicio = proxima ? addDias(data, ((8 - dow) % 7) || 7) : addDias(data, -((dow + 6) % 7));
  // Semana atual (pedido no meio da semana): planeja de hoje em diante; os dias que já passaram ficam de fora.
  const desde = proxima ? inicio : data;
  // @ts-ignore EdgeRuntime existe no runtime do Supabase
  EdgeRuntime.waitUntil(Promise.all(lista.map((p) => planejar(p.user_id, p.nome ?? 'Leo', inicio, desde))));
  return json(202, { ok: true, semana: inicio, perfis: lista.length });
});

async function planejar(userId: string, nome: string, inicio: string, desde: string) {
  const [existente] = await sql`select id, status from core.planos_semana where user_id = ${userId} and semana = ${inicio}`;
  if (existente?.status === 'confirmado') return;
  const run = await iniciarRun('iara', userId, 'plano_semana', { semana: inicio, desde });
  try {
    const fim = addDias(inicio, 6);
    const [[{ v: insumos }], [{ f: fixosBrutos, l: lugaresBrutos }]] = await Promise.all([
      sql`select core.coletar_semana(${userId}, ${inicio}::date) as v`,
      sql`select core.fixos(${userId}, ${desde}::date, ${fim}::date) as f,
            (select coalesce(config -> 'lugares', '[]'::jsonb) from core.perfil where user_id = ${userId}) as l`,
    ]);
    const lugares = (lugaresBrutos ?? []) as Lugar[];
    const desloc = await deslocamentos((fixosBrutos ?? []) as Fixo[], lugares);
    // Os fixos da semana (expediente, compromissos do Leo e agenda) mandam no encaixe de todo o resto.
    insumos.fixos = desloc.fixos;
    insumos.lugares = lugares.map((l) => ({ nome: l.nome, min_casa: l.min_casa }));
    insumos.deslocamento_fonte = desloc.fonte;
    const n = Math.round((Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 864e5) + 1;
    const dias = Array.from({ length: n }, (_, i) => {
      const d = addDias(desde, i);
      return `${DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()]} ${d}`;
    }).join(', ');
    const refs = new Set<string>([
      ...(insumos?.saude?.treinos ?? []).map((t: { ref: string }) => t.ref),
      ...(insumos?.financas?.contas_semana ?? []).map((c: { ref: string }) => c.ref),
    ]);

    const pedido = `Monte o PLANO DA SEMANA do ${nome}, de ${desde} a ${fim} (${dias}).${desde > inicio ? `
A semana começou em ${inicio}, mas os dias antes de ${desde} já passaram: planeje só de ${desde} em diante (use o que já aconteceu como contexto).` : ''}
Isto é uma SUGESTÃO INICIAL com CRÍTICA: o Leo decide. Ele ajusta, tira e move itens e só então confirma;
depois cada item vira tarefa do dia no app e os treinos vão para a ClaudIA.

0. Blocos fixos ("fixos"): expediente de trabalho, compromissos que o Leo registrou (jantares, bares, dates, médico...) e
   eventos da agenda dele. NUNCA marque nada por cima deles. Antes e depois de cada fixo com local, reserve o deslocamento
   ("desloc_min" = minutos de casa até lá; sem número, estime com folga e diga isso na crítica). Durante o expediente,
   só o que cabe no intervalo (ex.: almoço). Evento com "ocupado": false é informativo.

Planeje TUDO JUNTO em volta dos fixos, nesta ordem, e deixe as áreas conversarem:
1. Carga de treino da semana: parta dos treinos previstos (use o "ref" de cada um). Adapte à semana: dias com conta grande,
   compromisso da rotina ou semana passada com treinos pulados pedem ajuste (mover de dia, encurtar). Para mover, mantenha o
   "ref" e mude "data"/"minutos". Se o plano termina antes do fim da semana ("plano_treino_ate"), proponha as sessões que faltam
   repetindo o "padrao_recente" (sem "ref", com "treino":{"esporte","intensidade"} nos valores aceitos:
   esporte run|walk|hike|swim|ride_indoor|ride_outdoor|strength|hiit|yoga|mobility|row|other;
   intensidade recovery|easy|moderate|tempo|threshold|intervals|long|strength). Horário que caiba na rotina.
2. Dieta casada com a carga: 1 item "Dieta do dia" por dia (área saude), com kcal e proteína do dia derivadas da meta
   (dia de treino forte: mais carboidrato perto do treino; descanso: um pouco menos), média da semana na meta.
   Use "comida_7d" e "peso" para calibrar (ex.: proteína abaixo da meta vira prioridade). 1 preparo de refeições no início da semana.
3. Casa: a lista de compras da semana derivada do cardápio e do preparo (itens concretos no detalhe), no dia anterior ao preparo,
   mais as pendências da casa recebidas.
4. Aprender: trilha de segunda a sexta (minutos_trilha) no horário da rotina; em dia de treino pesado, nada além da trilha.
   Imersão no sábado (~60 min). Livro em leitura: meta de páginas da semana.
5. Finanças: um item por conta ou entrada prevista (use "ref" e "valor" exatamente como vieram, negativo = saída) e 1 revisão
   de gastos com o livre por dia; categoria apertada vira alerta no detalhe (e pesa nas compras da casa).
- Não marque duas coisas no mesmo horário (contando deslocamento); respeite a rotina; no máximo 7 itens por dia; nada genérico.
- Compromisso social à noite (bar, jantar, date) pesa no dia seguinte: nada de treino intenso cedo, dieta com margem
  para a refeição fora, e o gasto entra na conta do livre por dia.

"critica": a crítica honesta da semana em 4 a 7 bullets de markdown, cada um com o problema e o ajuste concreto:
dias apertados (blocos colados sem deslocamento), sono curto antes de treino cedo, treino que não cabe, excesso de
compromissos sociais vs. meta de dieta e o livre por dia, dias sem respiro, deslocamento desconhecido, o que sobra solto.

"resumo": 100–170 palavras em markdown com **negrito**: o fio da semana em 1 frase (como treino, dieta e o resto se encaixam)
e 1 linha por área (Saúde, Finanças, Aprender, Casa), dizendo o que foi adaptado e por quê.
Responda só com o JSON dentro de <semana></semana>:
{"resumo":"...","critica":"- ...","itens":[{"data":"aaaa-mm-dd","hora":"HH:MM ou null","area":"saude|financas|aprender|casa","titulo":"curto","detalhe":"1 frase ou null","minutos":45,"valor":null,"ref":null,"treino":null}]}`;

    const r = await anthropic({
      model: MODELS.smart,
      max_tokens: 8000,
      system: IARA_SYSTEM,
      // Sem effort o Sonnet 5.5 pensa no padrão e o pensamento (cobrado como saída) pode esgotar o teto.
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: `Insumos (JSON):\n${JSON.stringify(insumos)}\n\n${pedido}` }],
    }, { run, feature: 'plano-semana', papel: 'orquestrador' });

    const saida = extrairJson(textOf(r.content), 'semana');
    const itens: Item[] = [];
    for (const i of Array.isArray(saida.itens) ? saida.itens : []) {
      const d = String(i.data ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < desde || d > fim || !AREAS.has(i.area)) continue;
      const titulo = String(i.titulo ?? '').trim().slice(0, 120);
      if (!titulo) continue;
      const hora = typeof i.hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(i.hora) ? i.hora : null;
      const min = Math.round(Number(i.minutos));
      const valor = i.area === 'financas' && Number.isFinite(Number(i.valor)) && i.valor !== null ? Number(i.valor) : null;
      itens.push({
        data: d, hora, area: i.area, titulo,
        detalhe: typeof i.detalhe === 'string' && i.detalhe.trim() ? i.detalhe.trim().slice(0, 400) : null,
        minutos: min >= 1 && min <= 240 ? min : null,
        valor,
        ref: typeof i.ref === 'string' && refs.has(i.ref) ? i.ref : null,
        treino: i.area === 'saude' && !i.ref && ESPORTES.has(i.treino?.esporte)
          ? { esporte: i.treino.esporte, intensidade: INTENSIDADES.has(i.treino?.intensidade) ? i.treino.intensidade : 'moderate' }
          : null,
      });
      if (itens.length >= 49) break;
    }
    if (itens.length < 3) throw new Error(`Poucos itens válidos (${itens.length})`);
    const resumo = typeof saida.resumo === 'string' ? saida.resumo.slice(0, 3000) : null;
    const critica = typeof saida.critica === 'string' ? saida.critica.slice(0, 3000) : null;

    // Rascunho novo substitui o anterior da mesma semana (os itens saem junto pelo on delete cascade).
    const planoId = await sql.begin(async (tx) => {
      if (existente) await tx`delete from core.planos_semana where id = ${existente.id}`;
      const [p] = await tx`insert into core.planos_semana (user_id, semana, status, resumo, critica, insumos, run_id)
        values (${userId}, ${inicio}, 'rascunho', ${resumo}, ${critica}, ${tx.json(insumos)}, ${run.id}) returning id`;
      for (const [n, it] of itens.entries()) {
        await tx`insert into core.planos_semana_itens (plano_id, user_id, data, hora, area, titulo, detalhe, minutos, valor, ref, treino, ordem)
          values (${p.id}, ${userId}, ${it.data}, ${it.hora}, ${it.area}, ${it.titulo}, ${it.detalhe}, ${it.minutos}, ${it.valor}, ${it.ref},
            ${it.treino ? tx.json(it.treino) : null}, ${n})`;
      }
      return p.id;
    });

    const porArea: Record<string, number> = {};
    for (const it of itens) porArea[it.area] = (porArea[it.area] ?? 0) + 1;
    await fecharRun(run, 'ok', { output: { semana: inicio, plano_id: Number(planoId), itens: itens.length, por_area: porArea } });
  } catch (e) {
    await fecharRun(run, 'erro', { erro: String(e), descartado: true });
  }
}
