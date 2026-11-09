// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// AIrton — mercado (parte 2): IPCA, histórico de investimentos do Open Finance e plano da carteira por IA.
import { admin, spDate } from './common.ts';
import { anthropic, MODELS, textOf } from './ai.ts';
// ---------- IPCA (BCB SGS 433, % ao mês) → índice base 100 no último dia de cada mês ----------
export async function loadIpca() {
  const db = admin();
  // base fixa (jan/2023 = 100) para o índice não mudar de escala entre atualizações
  const hoje = new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo'
  });
  const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/01/2023&dataFinal=${hoje}`);
  if (!r.ok) throw new Error(`BCB IPCA ${r.status}`);
  const rows = await r.json();
  let idx = 100;
  const out = rows.map((x)=>{
    idx *= 1 + Number(x.valor) / 100;
    const [, mm, yy] = x.data.split('/');
    const end = new Date(Date.UTC(Number(yy), Number(mm), 0)).toISOString().slice(0, 10);
    return {
      ticker: 'IPCA',
      date: end,
      close: Math.round(idx * 10000) / 10000,
      currency: 'BRL'
    };
  });
  if (out.length) await db.from('inv_prices').upsert(out);
  return out.length;
}
// ---------- Open Finance: posição detalhada (com taxas) e movimentações dos investimentos ----------
const PLUGGY = 'https://api.pluggy.ai';
let cachedKey = null;
async function pluggyKey() {
  if (cachedKey && cachedKey.exp > Date.now()) return cachedKey.key;
  const id = Deno.env.get('PLUGGY_CLIENT_ID'), secret = Deno.env.get('PLUGGY_CLIENT_SECRET');
  if (!id || !secret) throw new Error('Open Finance não configurado.');
  const res = await fetch(`${PLUGGY}/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clientId: id,
      clientSecret: secret
    })
  });
  if (!res.ok) throw new Error(`Pluggy /auth ${res.status}`);
  const { apiKey } = await res.json();
  cachedKey = {
    key: apiKey,
    exp: Date.now() + 100 * 60_000
  };
  return apiKey;
}
async function pg(path) {
  const res = await fetch(`${PLUGGY}/${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': await pluggyKey()
    }
  });
  if (!res.ok) throw new Error(`Pluggy ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return await res.json();
}
export async function ofHistory(userId) {
  const db = admin();
  const { data: items } = await db.from('of_items').select('id').eq('user_id', userId).eq('sync_investments', true);
  const out = {
    investments: 0,
    movements: 0,
    errors: [],
    fields: []
  };
  for (const it of items ?? []){
    const invs = [];
    for(let page = 1; page <= 10; page++){
      const r = await pg(`investments?itemId=${it.id}&pageSize=500&page=${page}`);
      invs.push(...r.results);
      if (!r.totalPages || page >= r.totalPages) break;
    }
    if (invs[0]) out.fields = Object.keys(invs[0]);
    const now = new Date().toISOString();
    await db.from('inv_of').upsert(invs.map((i)=>({
        user_id: userId,
        pluggy_id: i.id,
        produto: String(i.name || i.code || i.id).replace(/\s+/g, ' ').trim().slice(0, 120),
        raw: i,
        updated_at: now
      })));
    out.investments += invs.length;
    for (const i of invs){
      try {
        const rows = [];
        for(let page = 1; page <= 5; page++){
          const r = await pg(`investments/${i.id}/transactions?pageSize=500&page=${page}`);
          rows.push(...r.results);
          if (!r.totalPages || page >= r.totalPages) break;
        }
        if (!rows.length) continue;
        const produto = String(i.name || i.code || i.id).replace(/\s+/g, ' ').trim().slice(0, 120);
        await db.from('inv_movements').upsert(rows.map((t)=>({
            user_id: userId,
            pluggy_id: t.id,
            investment_id: i.id,
            produto,
            date: String(t.date ?? t.tradeDate).slice(0, 10),
            type: t.type ?? null,
            movement_type: t.movementType ?? null,
            amount: t.amount ?? t.netAmount ?? t.value ?? null,
            raw: t
          })));
        out.movements += rows.length;
      } catch (e) {
        if (out.errors.length < 5) out.errors.push(String(e).slice(0, 160));
      }
    }
  }
  console.log('[history]', JSON.stringify(out));
  return out;
}
// ---------- plano da carteira (IA) — semanal, aos domingos ----------
const CLASSES = [
  'Caixa/Liquidez',
  'Renda Fixa Pós',
  'Renda Fixa Inflação',
  'Renda Fixa Pré',
  'Crédito Privado',
  'Multimercado',
  'Cambial/Ouro',
  'Ações BR',
  'FIIs',
  'Ações Globais',
  'ETFs Globais',
  'Cripto',
  'Outros'
];
const r1 = (v)=>Math.round(v * 10) / 10;
/** Liquidez aproximada: saldo em conta e CDB/LCI pós com carência vencida = diária. */ function liq(p, o) {
  if (/saldo em conta/i.test(p.produto) || p.classe === 'Caixa/Liquidez') return 'diária';
  if (o?.subtype && /TREASURY|SELIC/i.test(o.subtype) && /SELIC/i.test(String(o.name ?? ''))) return 'diária';
  if (o?.type === 'FIXED_INCOME') {
    const today = spDate();
    if (o.gracePeriodDate && String(o.gracePeriodDate).slice(0, 10) <= today && /CDI|SELIC/i.test(o.rateType ?? '')) return 'diária';
    return o.dueDate ? `no vencimento (${String(o.dueDate).slice(0, 10)})` : 'a verificar';
  }
  if (o?.type === 'MUTUAL_FUND') return 'fundo (D+X)';
  if (p.ticker) return 'bolsa (D+2)';
  return 'a verificar';
}
const pct = (v)=>v == null ? null : r1(v * 100);
/** A API devolve no máximo 1000 linhas por chamada: pagina. */ async function pricesAll(db, tickers, since) {
  const out = [];
  for(let from = 0; from < 50_000; from += 1000){
    const { data, error } = await db.from('inv_prices').select('ticker,date,close').in('ticker', tickers).gte('date', since).order('ticker').order('date').range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data ?? []);
    if (!data || data.length < 1000) break;
  }
  return {
    data: out.sort((a, b)=>a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
  };
}
/** Selic meta vigente (BCB SGS 432) — substitui a busca na web que o plano fazia para conferir taxas. */ async function selicMeta() {
  try {
    const r = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json');
    if (!r.ok) return null;
    const [x] = await r.json();
    return x ? Number(x.valor) : null;
  } catch  {
    return null;
  }
}
async function sha256(s) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [
    ...new Uint8Array(h)
  ].map((b)=>b.toString(16).padStart(2, '0')).join('');
}
export async function plan(userId, opts = {}) {
  const db = admin();
  const today = spDate();
  const [{ data: pos }, { data: snaps }, { data: months }, { data: prices }, { data: news }, { data: alerts }, { data: info }, { data: emp }, { data: pe }, { data: spend }, { data: of }, { data: tgt }, selic] = await Promise.all([
    (async ()=>{
      const out = [];
      for(let f = 0; f < 20_000; f += 1000){
        const { data } = await db.from('v_inv_position').select('mes,produto,nome,classe,saldo,rent_mes,ticker').eq('user_id', userId).gt('saldo', 0).order('mes').order('produto').range(f, f + 999);
        out.push(...data ?? []);
        if (!data || data.length < 1000) break;
      }
      return {
        data: out
      };
    })(),
    db.from('inv_snapshot').select('mes,patrimonio,source').eq('user_id', userId).order('mes'),
    db.from('v_inv_month').select('*').eq('user_id', userId).order('mes'),
    pricesAll(db, [
      'CDI',
      'IPCA',
      'IBOV',
      'SPX',
      'USDBRL',
      ...((await db.from('inv_holdings').select('ticker').eq('user_id', userId).eq('active', true)).data ?? []).map((h)=>h.ticker)
    ], new Date(Date.now() - 560 * 86_400_000).toISOString().slice(0, 10)),
    db.from('inv_news').select('ticker,published,kind,title,impact,sentiment').eq('user_id', userId).gte('published', new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)).order('published').limit(30),
    db.from('inv_alerts').select('ref_date,title').eq('user_id', userId).order('ref_date', {
      ascending: false
    }).limit(8),
    db.from('inv_product_info').select('produto,nome_curto,classe,gestora,descricao,risco').eq('user_id', userId),
    db.from('employments').select('role,gross_salary,base_salary,plr_months,start_date,end_date').eq('user_id', userId).order('start_date'),
    db.from('planned_events').select('date,label,amount,income_type').eq('user_id', userId).gte('date', today).order('date').limit(15),
    db.from('v_tx').select('date,spend,nature').eq('user_id', userId).gte('date', new Date(Date.now() - 190 * 86_400_000).toISOString().slice(0, 10)).gt('spend', 0).limit(5000),
    db.from('inv_of').select('produto,raw').eq('user_id', userId),
    db.from('settings').select('value').eq('user_id', userId).eq('key', 'inv_target').maybeSingle(),
    selicMeta()
  ]);
  const P = (pos ?? []).filter((p)=>p);
  const lastMes = (snaps ?? []).at(-1)?.mes;
  const last = P.filter((p)=>p.mes === lastMes);
  const total = last.reduce((s, p)=>s + Number(p.saldo), 0);
  const byClass = {};
  for (const p of last)byClass[p.classe] = (byClass[p.classe] ?? 0) + Number(p.saldo);
  const series = (t)=>(prices ?? []).filter((p)=>p.ticker === t).map((p)=>({
        date: p.date,
        close: Number(p.close)
      }));
  const retBetween = (t, from)=>{
    const s = series(t);
    const b = [
      ...s
    ].reverse().find((x)=>x.date <= from) ?? s[0];
    const l = s.at(-1);
    return b && l ? l.close / b.close - 1 : null;
  };
  const ago = (d)=>new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
  const ytd = `${today.slice(0, 4)}-01-01`;
  const bench = {
    selic_meta_aa: selic,
    CDI: {
      m12: pct(retBetween('CDI', ago(365))),
      ytd: pct(retBetween('CDI', ytd)),
      m3: pct(retBetween('CDI', ago(92)))
    },
    IPCA: {
      m12: pct(retBetween('IPCA', ago(380))),
      ytd: pct(retBetween('IPCA', `${Number(today.slice(0, 4)) - 1}-12-31`))
    },
    Ibovespa: {
      m12: pct(retBetween('IBOV', ago(365))),
      ytd: pct(retBetween('IBOV', ytd))
    },
    SP500_USD: {
      m12: pct(retBetween('SPX', ago(365))),
      ytd: pct(retBetween('SPX', ytd))
    },
    dolar: series('USDBRL').at(-1)?.close
  };
  // rentabilidade por classe (rent_mes ponderado), últimos 12 meses com dado
  const ms = [
    ...new Set(P.map((p)=>p.mes))
  ].sort().slice(-12);
  const classRet = {};
  for (const c of CLASSES){
    let acc = 1, n = 0;
    for (const m of ms){
      const ps = P.filter((p)=>p.mes === m && p.classe === c && p.rent_mes != null && Number(p.saldo) > 0);
      const w = ps.reduce((s, p)=>s + Number(p.saldo), 0);
      if (w) {
        acc *= 1 + ps.reduce((s, p)=>s + Number(p.saldo) * Number(p.rent_mes), 0) / w / 100;
        n++;
      }
    }
    if (n) classRet[c] = {
      acum12m: pct(acc - 1),
      meses: n
    };
  }
  const infoBy = new Map((info ?? []).map((i)=>[
      i.produto,
      i
    ]));
  const ofBy = new Map((of ?? []).map((o)=>[
      o.produto,
      o.raw
    ]));
  const top = last.sort((a, b)=>Number(b.saldo) - Number(a.saldo)).slice(0, 15).map((p)=>{
    const i = infoBy.get(p.produto), o = ofBy.get(p.produto);
    return {
      produto: p.nome,
      classe: p.classe,
      saldo: Math.round(Number(p.saldo)),
      peso: r1(Number(p.saldo) / total * 100),
      ticker: p.ticker ?? undefined,
      risco: i?.risco ?? undefined,
      gestora: i?.gestora ?? undefined,
      descricao: i?.descricao ? String(i.descricao).slice(0, 160) : undefined,
      rent_12m_pct_of: o?.lastTwelveMonthsRate ?? undefined,
      taxa: o?.rate ? `${o.rate}% ${o.rateType ?? ''}`.trim() : undefined,
      vencimento: o?.dueDate ? String(o.dueDate).slice(0, 10) : undefined,
      liquidez: liq(p, o),
      ret_acao_12m_pct: p.ticker ? pct(retBetween(p.ticker, ago(365))) : undefined,
      ret_acao_1m_pct: p.ticker ? pct(retBetween(p.ticker, ago(31))) : undefined
    };
  });
  const spendByMonth = {}, recByMonth = {};
  for (const t of spend ?? []){
    const m = String(t.date).slice(0, 7);
    if (m >= today.slice(0, 7)) continue;
    spendByMonth[m] = (spendByMonth[m] ?? 0) + Number(t.spend);
    if (t.nature === 'fixo' || t.nature === 'variavel') recByMonth[m] = (recByMonth[m] ?? 0) + Number(t.spend);
  }
  const sm = Object.values(spendByMonth);
  const gastoMedio = sm.length ? Math.round(sm.reduce((a, b)=>a + b, 0) / sm.length) : null;
  const rec = Object.values(recByMonth).sort((a, b)=>a - b);
  const gastoRecorrente = rec.length ? Math.round(rec[Math.floor(rec.length / 2)]) : null;
  const liquidezImediata = Math.round(last.filter((p)=>liq(p, ofBy.get(p.produto)) === 'diária').reduce((s2, p)=>s2 + Number(p.saldo), 0));
  // rentabilidade da carteira (extratos) × CDI × IPCA no mesmo período, e fluxo externo estimado
  const M = months ?? [];
  const idxEnd = (t, m)=>{
    const s2 = series(t);
    const end = `${m}-31`;
    for(let k = s2.length - 1; k >= 0; k--)if (s2[k].date <= end) return s2[k].close;
    return undefined;
  };
  const prevM = (m)=>{
    const [yy, mm] = m.split('-').map(Number);
    return mm === 1 ? `${yy - 1}-12` : `${yy}-${String(mm - 1).padStart(2, '0')}`;
  };
  const mr = (t, m)=>{
    const a = idxEnd(t, prevM(m)), b = idxEnd(t, m);
    return a && b ? b / a - 1 : null;
  };
  const withRet = M.filter((m)=>m.ret_pct != null);
  const lastRet = withRet.at(-1)?.mes;
  const win = lastRet ? M.filter((m)=>m.mes <= lastRet).slice(-12) : [];
  let ac = 1, bc2 = 1, ic = 1, nn = 0;
  for (const m of win){
    const rc = mr('CDI', m.mes), ri = mr('IPCA', m.mes);
    if (m.ret_pct == null || rc == null || ri == null) continue;
    ac *= 1 + Number(m.ret_pct) / 100;
    bc2 *= 1 + rc;
    ic *= 1 + ri;
    nn++;
  }
  const comparacao = lastRet ? {
    periodo: `${nn} meses até ${lastRet} (último extrato com rentabilidade; depois disso o Open Finance só informa saldo)`,
    carteira_pct: pct(ac - 1),
    cdi_pct: pct(bc2 - 1),
    ipca_pct: pct(ic - 1),
    pct_do_cdi: bc2 > 1 ? Math.round((ac - 1) / (bc2 - 1) * 100) : null
  } : null;
  const job = (emp ?? []).filter((e)=>!e.end_date).at(-1) ?? (emp ?? []).at(-1);
  const context = {
    hoje: today,
    referencia: lastMes,
    patrimonio: Math.round(total),
    alocacao: Object.fromEntries(Object.entries(byClass).sort((a, b)=>b[1] - a[1]).map(([c, v])=>[
        c,
        {
          valor: Math.round(v),
          peso: r1(v / total * 100)
        }
      ])),
    alvo_atual: tgt?.value ?? null,
    historico_mensal: M.slice(-13).map((m)=>({
        mes: m.mes,
        patrimonio: Math.round(Number(m.patrimonio)),
        fonte: m.source,
        rent_carteira_pct: m.ret_pct != null ? r1(Number(m.ret_pct)) : null,
        // fluxo externo estimado = variação do patrimônio que não veio de rendimento (positivo = dinheiro novo; negativo = resgate para gastar)
        fluxo_externo_estimado: m.ret_pct != null && m.prev ? Math.round(Number(m.patrimonio) - Number(m.prev) * (1 + Number(m.ret_pct) / 100)) : null
      })),
    rentabilidade_carteira_vs_indices: comparacao,
    rentabilidade_por_classe_12m: classRet,
    indices: bench,
    maiores_posicoes: top,
    noticias_e_eventos: news ?? [],
    alertas_recentes: alerts ?? [],
    perfil: {
      trabalho: job ? `${job.role}, salário bruto R$ ${job.gross_salary ?? job.base_salary}/mês, PLR semestral (fev e ago) que é a maior parte da renda variável` : null,
      gasto_total_medio_6m: gastoMedio,
      gasto_recorrente_mensal_mediana: gastoRecorrente,
      nota_gastos: 'O gasto total dos últimos meses inclui uma viagem longa (ago–set) e gastos pontuais de moradia; use o gasto recorrente (fixo + variável, mediana) para dimensionar a reserva.',
      liquidez_imediata_hoje: liquidezImediata,
      eventos_planejados: pe ?? [],
      observacoes: 'Mora sozinho em São Paulo, renda concentrada em salário + PLR semestral. Carteira na XP (Brasil) e XP Internacional (ações dos EUA).'
    }
  };
  // nada mudou desde o último plano (ex.: botão apertado duas vezes)? devolve o que já existe, sem chamar a IA
  const { hoje: _h, ...stable } = context;
  const hash = await sha256(JSON.stringify(stable));
  if (!opts.force) {
    const { data: prev } = await db.from('inv_plan').select('id,content,context').eq('user_id', userId).order('created_at', {
      ascending: false
    }).limit(1).maybeSingle();
    if (prev && prev.context?._hash === hash) return {
      ok: true,
      id: prev.id,
      titulo: prev.content?.titulo,
      acoes: prev.content?.acoes?.length ?? 0,
      cached: true
    };
  }
  const prompt = `Você é um planejador financeiro CFP brasileiro, direto, sóbrio e prático (sem sensacionalismo). Este é o plano da SEMANA (gerado no domingo). Analise a carteira abaixo (dados reais do app AIrton) e responda SOMENTE um JSON válido, sem texto fora dele, no formato:
{"titulo":"frase curta com o diagnóstico principal","resumo":"2 a 3 frases: como a carteira está, como rendeu vs CDI e IPCA, maior risco","nota":0-10,
"vs_indices":{"carteira_12m":número|null,"cdi_12m":número|null,"ipca_12m":número|null,"comentario":"1 frase"},
"acoes":[{"prazo":"esta semana|este mês|próximos 3 meses","tipo":"aportar|resgatar|rebalancear|revisar|acompanhar|proteger","titulo":"verbo no imperativo, curto","detalhe":"o que fazer e por quê, com valores em R$ quando fizer sentido","valor":número|null,"classe":"uma das classes"|null,"prioridade":"alta|media|baixa"}],
"alvo":{"<classe>":percentual inteiro,...},"racional_alvo":"2 a 4 frases explicando a alocação sugerida",
"reserva":{"meses_recomendados":número,"valor_recomendado":número,"valor_atual_liquido":número,"comentario":"1 frase"},
"riscos":["até 3 riscos concretos da carteira hoje"]}
Regras: classes válidas = ${CLASSES.join(', ')}. O alvo soma 100 e usa só classes válidas. Entre 3 e 6 ações, ordenadas por prioridade, concretas e acionáveis; a primeira deve caber "esta semana". Prefira direcionar aportes novos (incluindo a próxima PLR) a vender, porque venda gera IR e custo; considere a reserva de emergência (6 meses de gasto, em liquidez diária pós-fixada), concentração em poucos ativos, exposição cambial, eventos e notícias da semana. Compare sempre com CDI e IPCA usando rentabilidade_carteira_vs_indices (meta mínima: IPCA + 4% a.a. no longo prazo). Queda de patrimônio com fluxo_externo_estimado negativo é resgate para consumo, não prejuízo — não confunda. A reserva usa gasto_recorrente_mensal_mediana e liquidez_imediata_hoje (inclui CDB pós com liquidez diária). Use só os números do contexto (a Selic meta está em indices.selic_meta_aa); não cite taxas de títulos específicos (ex.: Tesouro IPCA+ 2035) que não estejam no contexto — fale da classe. Se algo estiver estimado, diga. Linguagem simples, português do Brasil. Não é recomendação de investimento individual; seja educativo.
CONTEXTO:
${JSON.stringify(context)}`;
  const r = await anthropic({
    model: MODELS.smart,
    max_tokens: 6000,
    effort: 'medium',
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  }, {
    userId,
    feature: 'plan'
  });
  const text = textOf(r);
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  const content = JSON.parse(text.slice(s, e + 1));
  // normaliza o alvo para somar 100
  if (content.alvo) {
    const ent = Object.entries(content.alvo).filter(([c, v])=>CLASSES.includes(c) && Number(v) > 0);
    const sum = ent.reduce((a, [, v])=>a + Number(v), 0);
    content.alvo = Object.fromEntries(ent.map(([c, v])=>[
        c,
        Math.round(Number(v) / sum * 100)
      ]));
  }
  const { data: row, error } = await db.from('inv_plan').insert({
    user_id: userId,
    content,
    context: {
      ...context,
      _hash: hash
    },
    model: MODELS.smart
  }).select('id,created_at').single();
  if (error) throw new Error(error.message);
  return {
    ok: true,
    id: row.id,
    titulo: content.titulo,
    acoes: content.acoes?.length ?? 0
  };
}
