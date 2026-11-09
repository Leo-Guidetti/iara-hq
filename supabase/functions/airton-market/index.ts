// AIrton — mercado: curva diária das ações (B3 e EUA), câmbio, quantidade estimada e alertas.
// Ações: refresh (cron em dias úteis e botão do app) | news (dom, qua e sex) | plan (domingo) | history.
import { admin, authenticate, CORS, json, kvGet, memberIds, spDate } from './common.ts';
import { sendWebPush } from './webpush.ts';
import { loadIpca, ofHistory, plan } from './extra.ts';
import { anthropic, gemini, hasGemini, MODELS, textOf } from './ai.ts';
const sym = (h)=>h.market === 'B3' ? `${h.ticker}.SA` : h.ticker.replace('.', '-');
async function yahoo(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&includePrePost=false`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (AIrton)',
      Accept: 'application/json'
    }
  });
  if (!r.ok) throw new Error(`yahoo ${symbol} ${r.status}`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  if (!res?.timestamp) return [];
  const off = Number(res.meta?.gmtoffset ?? 0);
  const closes = res.indicators?.quote?.[0]?.close ?? [];
  const out = [];
  res.timestamp.forEach((ts, i)=>{
    const c = closes[i];
    if (c != null && Number.isFinite(c)) out.push({
      date: new Date((ts + off) * 1000).toISOString().slice(0, 10),
      close: Math.round(c * 10000) / 10000
    });
  });
  // último preço intradiário do dia (o candle do dia vem com o preço corrente)
  const live = Number(res.meta?.regularMarketPrice);
  const liveTs = Number(res.meta?.regularMarketTime);
  if (Number.isFinite(live) && liveTs) {
    const d = new Date((liveTs + off) * 1000).toISOString().slice(0, 10);
    const last = out[out.length - 1];
    if (last?.date === d) last.close = live;
    else if (!last || d > last.date) out.push({
      date: d,
      close: live
    });
  }
  return out;
}
async function stooq(symbol) {
  const r = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}&i=d`);
  if (!r.ok) return [];
  const lines = (await r.text()).trim().split('\n').slice(1);
  return lines.map((l)=>l.split(',')).filter((c)=>c.length >= 5 && c[4] !== 'N/D').map((c)=>({
      date: c[0],
      close: Number(c[4])
    })).slice(-260);
}
async function history(h, range) {
  try {
    const p = await yahoo(sym(h), range);
    if (p.length) return p;
  } catch (e) {
    console.warn('[market]', String(e));
  }
  return h.market === 'US' ? stooq(`${h.ticker}.us`) : [];
}
const pct = (v)=>`${v >= 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')}%`;
const brl = (v)=>v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0
  });
export async function pushTo(userId, msg, ttl = 12 * 3600) {
  const keys = await kvGet('vapid');
  const { data: subs } = await admin().from('push_subscriptions').select('*').eq('user_id', userId);
  if (!keys || !subs?.length) return 0;
  let pushed = 0;
  for (const s of subs)if ((await sendWebPush({
    endpoint: s.endpoint,
    keys: {
      p256dh: s.p256dh,
      auth: s.auth
    }
  }, msg, keys, 'mailto:leonardoguidettic@gmail.com', {
    ttl,
    topic: msg.tag
  })).ok) pushed++;
  return pushed;
}
async function refresh(userId) {
  const db = admin();
  const { data: hs } = await db.from('inv_holdings').select('*').eq('user_id', userId).eq('active', true);
  const holdings = hs ?? [];
  const tickers = [
    ...holdings.map((h)=>({
        ticker: h.ticker,
        market: h.market
      })),
    {
      ticker: 'USDBRL',
      market: 'US'
    }
  ];
  const summary = {};
  // 1) preços: 1 ano na primeira vez, depois só o último mês
  for (const t of tickers){
    const { count } = await db.from('inv_prices').select('*', {
      count: 'exact',
      head: true
    }).eq('ticker', t.ticker);
    const range = count && count > 150 ? '1mo' : '1y';
    const s = t.ticker === 'USDBRL' ? 'BRL=X' : sym(t);
    let p = [];
    try {
      p = await yahoo(s, range);
    } catch (e) {
      console.warn('[market]', String(e));
    }
    if (!p.length && t.ticker !== 'USDBRL') p = await history(t, range);
    if (p.length) {
      await db.from('inv_prices').upsert(p.map((x)=>({
          ticker: t.ticker,
          date: x.date,
          close: x.close,
          currency: t.ticker === 'USDBRL' ? 'BRL' : t.market === 'B3' ? 'BRL' : 'USD'
        })));
      summary[t.ticker] = p.length;
    } else summary[t.ticker] = 'sem dados';
  }
  // benchmarks: Ibovespa, S&P 500 e CDI (índice acumulado, base 100)
  for (const [t, s] of [
    [
      'IBOV',
      '^BVSP'
    ],
    [
      'SPX',
      '^GSPC'
    ]
  ]){
    try {
      const p = await yahoo(s, '2y');
      if (p.length) await db.from('inv_prices').upsert(p.map((x)=>({
          ticker: t,
          date: x.date,
          close: x.close,
          currency: t === 'SPX' ? 'USD' : 'BRL'
        })));
    } catch (e) {
      console.warn('[market]', String(e));
    }
  }
  try {
    const fmt = (d)=>d.toLocaleDateString('pt-BR', {
        timeZone: 'America/Sao_Paulo'
      });
    const r = await fetch(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${fmt(new Date(Date.now() - 600 * 86_400_000))}&dataFinal=${fmt(new Date())}`);
    if (r.ok) {
      const rows = await r.json();
      let idx = 100;
      const out = rows.map((x)=>{
        idx *= 1 + Number(x.valor) / 100;
        const [dd, mm, yy] = x.data.split('/');
        return {
          ticker: 'CDI',
          date: `${yy}-${mm}-${dd}`,
          close: Math.round(idx * 10000) / 10000,
          currency: 'BRL'
        };
      });
      if (out.length) await db.from('inv_prices').upsert(out);
    }
  } catch (e) {
    console.warn('[market] cdi', String(e));
  }
  try {
    await loadIpca();
  } catch (e) {
    console.warn('[market] ipca', String(e));
  }
  const series = async (ticker, days = 400)=>{
    const { data } = await db.from('inv_prices').select('date,close').eq('ticker', ticker).gte('date', new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)).order('date');
    return (data ?? []).map((r)=>({
        date: r.date,
        close: Number(r.close)
      }));
  };
  const closeAt = (ps, d)=>[
      ...ps
    ].reverse().find((x)=>x.date <= d)?.close ?? ps[0]?.close;
  // 2) quantidade estimada = valor na data de referência ÷ preço daquele dia
  const fx = await series('USDBRL');
  const fxNow = fx[fx.length - 1]?.close ?? 5;
  const fxPrev = fx[fx.length - 2]?.close ?? fxNow;
  const live = [];
  for (const h of holdings){
    const ps = await series(h.ticker);
    if (!ps.length) continue;
    let qty = h.quantity != null ? Number(h.quantity) : null;
    if (qty == null && h.ref_value && h.ref_date) {
      const px = closeAt(ps, h.ref_date);
      if (px) {
        qty = Math.round(Number(h.ref_value) / px * 10000) / 10000;
        await db.from('inv_holdings').update({
          quantity: qty,
          qty_source: 'estimado',
          updated_at: new Date().toISOString()
        }).eq('user_id', userId).eq('ticker', h.ticker);
      }
    }
    if (!qty) continue;
    const last = ps[ps.length - 1], prev = ps[ps.length - 2];
    const k = h.market === 'US' ? fxNow : 1, kp = h.market === 'US' ? fxPrev : 1;
    live.push({
      h,
      ps,
      qty,
      last,
      prev,
      valueBrl: qty * last.close * k,
      prevBrl: qty * (prev?.close ?? last.close) * kp
    });
  }
  // 2b) exterior não vem pelo Open Finance: atualiza o mês corrente com quantidade × preço × dólar
  const mes = spDate().slice(0, 7);
  const { data: snapNow } = await db.from('inv_snapshot').select('source').eq('user_id', userId).eq('mes', mes).maybeSingle();
  if (snapNow && [
    'openfinance',
    'estimado'
  ].includes(snapNow.source)) {
    for (const x of live.filter((l)=>l.h.market === 'US')){
      await db.from('inv_position').update({
        saldo: Math.round(x.valueBrl * 100) / 100,
        valor_orig: Math.round(x.qty * x.last.close * 100) / 100
      }).eq('user_id', userId).eq('mes', mes).eq('produto', x.h.ticker);
    }
    const { data: all } = await db.from('inv_position').select('saldo').eq('user_id', userId).eq('mes', mes);
    const totalNow = (all ?? []).reduce((s2, p)=>s2 + Number(p.saldo ?? 0), 0);
    if (totalNow > 0) await db.from('inv_snapshot').update({
      patrimonio: Math.round(totalNow * 100) / 100,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId).eq('mes', mes);
  }
  // 3) alertas do dia
  const alerts = [];
  for (const x of live){
    if (!x.prev) continue;
    const d1 = x.last.close / x.prev.close - 1;
    const lim = x.h.market === 'US' ? 0.06 : 0.05;
    if (Math.abs(d1) >= lim) {
      alerts.push({
        ticker: x.h.ticker,
        kind: d1 < 0 ? 'queda' : 'alta',
        severity: Math.abs(d1) >= lim * 1.6 ? 'alta' : 'media',
        ref_date: x.last.date,
        title: `${x.h.ticker} ${pct(d1)} hoje`,
        body: `${x.h.name ?? x.h.ticker}: sua posição ~${brl(x.valueBrl)} (${d1 < 0 ? '−' : '+'}${brl(Math.abs(x.valueBrl - x.prevBrl))} no dia).`
      });
    }
    const yr = x.ps.slice(-252);
    const peak = Math.max(...yr.map((p)=>p.close));
    const dd = x.last.close / peak - 1, ddPrev = x.prev.close / peak - 1;
    if (dd <= -0.2 && ddPrev > -0.2) {
      alerts.push({
        ticker: x.h.ticker,
        kind: 'drawdown',
        severity: 'media',
        ref_date: x.last.date,
        title: `${x.h.ticker} caiu 20% da máxima de 12 meses`,
        body: `Está ${pct(dd)} abaixo do topo do ano. Vale revisar a tese.`
      });
    }
  }
  const tot = live.reduce((s, x)=>s + x.valueBrl, 0), totPrev = live.reduce((s, x)=>s + x.prevBrl, 0);
  const lastDate = live.map((x)=>x.last.date).sort().pop() ?? spDate();
  if (totPrev > 0 && Math.abs(tot / totPrev - 1) >= 0.025) {
    const d = tot / totPrev - 1;
    alerts.push({
      ticker: 'CARTEIRA',
      kind: d < 0 ? 'queda' : 'alta',
      severity: Math.abs(d) >= 0.04 ? 'alta' : 'media',
      ref_date: lastDate,
      title: `Ações ${pct(d)} hoje`,
      body: `Sua carteira de ações (BR + exterior) ${d < 0 ? 'perdeu' : 'ganhou'} ${brl(Math.abs(tot - totPrev))} no dia, para ~${brl(tot)}.`
    });
  }
  if (fx.length > 1 && Math.abs(fxNow / fxPrev - 1) >= 0.02) {
    const d = fxNow / fxPrev - 1;
    alerts.push({
      ticker: 'USDBRL',
      kind: d < 0 ? 'queda' : 'alta',
      severity: 'media',
      ref_date: fx[fx.length - 1].date,
      title: `Dólar ${pct(d)} hoje (R$ ${fxNow.toFixed(2).replace('.', ',')})`,
      body: 'Mexe no valor em reais das suas ações no exterior.'
    });
  }
  let pushed = 0;
  if (alerts.length) {
    const { data: fresh } = await db.from('inv_alerts').upsert(alerts.map((a)=>({
        user_id: userId,
        ...a
      })), {
      onConflict: 'user_id,ref_date,ticker,kind',
      ignoreDuplicates: true
    }).select('id,title,body,severity');
    if (fresh?.length) {
      const top = [
        ...fresh
      ].sort((a, b)=>(a.severity === 'alta' ? -1 : 1) - (b.severity === 'alta' ? -1 : 1));
      pushed = await pushTo(userId, {
        title: `Alerta: ${top[0].title}`,
        body: top.length > 1 ? `${top[0].body} +${top.length - 1} alerta(s).` : top[0].body,
        url: '/patrimonio',
        tag: `mercado-${lastDate}`
      }, 6 * 3600);
      await db.from('inv_alerts').update({
        pushed: pushed > 0
      }).in('id', fresh.map((f)=>f.id));
    }
  }
  return {
    ok: true,
    prices: summary,
    positions: live.length,
    equityBrl: Math.round(tot),
    alerts: alerts.length,
    pushed
  };
}
const NEWS_MAX_TICKERS = 8;
const NEWS_BATCH = 4;
function parseNews(text) {
  const start = text.indexOf('['), end = text.lastIndexOf(']');
  let arr = [];
  try {
    if (start >= 0 && end > start) arr = JSON.parse(text.slice(start, end + 1));
  } catch  {}
  if (!arr.length) for (const o of text.match(/\{[^{}]*"ticker"[^{}]*\}/g) ?? []){
    try {
      arr.push(JSON.parse(o));
    } catch  {}
  }
  return arr.filter((n)=>n?.ticker && n?.title);
}
async function news(userId, opts = {}) {
  const db = admin();
  const { data: hs } = await db.from('inv_holdings').select('ticker,name,market,quantity').eq('user_id', userId).eq('active', true);
  const { data: px } = await db.from('inv_prices').select('ticker,close,date').in('ticker', [
    ...(hs ?? []).map((h)=>h.ticker),
    'USDBRL'
  ]).gte('date', new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10)).order('date');
  const lastPx = new Map();
  for (const p of px ?? [])lastPx.set(p.ticker, Number(p.close));
  const fx = lastPx.get('USDBRL') ?? 5.4;
  const { data: recent } = opts.force ? {
    data: []
  } : await db.from('inv_news').select('ticker').eq('user_id', userId).gte('created_at', new Date(Date.now() - 36 * 3_600_000).toISOString());
  const covered = new Set((recent ?? []).map((r)=>r.ticker));
  const ranked = (hs ?? []).filter((h)=>h.quantity).map((h)=>({
      ...h,
      v: Number(h.quantity) * (lastPx.get(h.ticker) ?? 0) * (h.market === 'US' ? fx : 1)
    })).sort((a, b)=>b.v - a.v).filter((h)=>!covered.has(h.ticker)).slice(0, NEWS_MAX_TICKERS);
  if (!ranked.length) return {
    ok: true,
    skipped: 'todos os ativos já têm notícia das últimas 36 h'
  };
  const today = spDate();
  const provider = hasGemini('news') ? 'gemini' : 'claude';
  const found = [];
  const diag = [];
  let searches = 0;
  const SYS = 'Você é um analista de investimentos que acompanha a carteira de um investidor pessoa física brasileiro. Seja factual, cite a fonte e não invente. A resposta final deve ser apenas o array JSON pedido.';
  const batches = [];
  for(let i = 0; i < ranked.length; i += NEWS_BATCH)batches.push(ranked.slice(i, i + NEWS_BATCH));
  await Promise.all(batches.map(async (batch)=>{
    const list = batch.map((h)=>`${h.ticker} (${h.name ?? h.ticker}, ${h.market === 'B3' ? 'B3' : 'bolsa dos EUA'})`).join('; ');
    const prompt = `Hoje é ${today}. Busque na web, para cada ativo: (1) notícias relevantes dos últimos 7 dias e (2) próximos eventos agendados (resultado trimestral, dividendos/JCP, assembleia, split). Ativos: ${list}.\nResponda SOMENTE um array JSON, sem texto antes ou depois: [{"ticker":"XXXX","published":"YYYY-MM-DD","kind":"noticia|resultado|dividendo|evento|rating","title":"título curto em português","summary":"1 frase em português sobre o que significa para quem tem a ação","url":"https://...","source":"nome do veículo","impact":"alta|media|baixa","sentiment":"positivo|neutro|negativo"}]. No máximo 2 itens por ativo, só o que pode mexer no preço; se não houver nada relevante para um ativo, não inclua nada para ele. Para eventos futuros, use a data do evento em "published".`;
    // 1) Gemini (buscas grátis); 2) se falhar ou vier vazio, Claude Haiku 5.5 com até 2 buscas
    if (provider === 'gemini') {
      try {
        const r = await gemini({
          prompt,
          system: SYS,
          search: true,
          maxTokens: 3000
        }, {
          userId,
          feature: 'news'
        });
        searches += r.searches;
        const itens = parseNews(r.text);
        if (itens.length) {
          found.push(...itens);
          diag.push(`${batch[0].ticker}…: gemini, ${r.searches} buscas, ${itens.length} itens`);
          return;
        }
        diag.push(`${batch[0].ticker}…: gemini sem itens; usando claude`);
      } catch (e) {
        diag.push(`${batch[0].ticker}…: gemini falhou (${String(e).slice(0, 120)}); usando claude`);
      }
    }
    try {
      const messages = [
        {
          role: 'user',
          content: prompt
        }
      ];
      let text = '';
      for(let turn = 0; turn < 2; turn++){
        const r = await anthropic({
          model: MODELS.fast,
          max_tokens: 3000,
          effort: 'low',
          system: SYS,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: 2
            }
          ],
          messages
        }, {
          userId,
          feature: 'news'
        });
        searches += r.usage.server_tool_use?.web_search_requests ?? 0;
        text += textOf(r);
        if (r.stop_reason === 'pause_turn') {
          messages.push({
            role: 'assistant',
            content: r.content
          });
          continue;
        }
        break;
      }
      const itens = parseNews(text);
      found.push(...itens);
      diag.push(`${batch[0].ticker}…: claude, ${itens.length} itens`);
    } catch (e) {
      diag.push(`${batch[0].ticker}…: ${String(e).slice(0, 160)}`);
    }
  }));
  const okKind = new Set([
    'noticia',
    'resultado',
    'dividendo',
    'evento',
    'rating'
  ]);
  const rows = found.map((n)=>({
      user_id: userId,
      ticker: String(n.ticker).toUpperCase().slice(0, 12),
      title: String(n.title).slice(0, 300),
      summary: n.summary ? String(n.summary).slice(0, 800) : null,
      published: /^\d{4}-\d{2}-\d{2}$/.test(n.published ?? '') ? n.published : null,
      kind: okKind.has(n.kind ?? '') ? n.kind : 'noticia',
      url: n.url && /^https?:\/\//.test(n.url) ? n.url.slice(0, 500) : null,
      source: n.source ? String(n.source).slice(0, 80) : null,
      impact: [
        'alta',
        'media',
        'baixa'
      ].includes(n.impact ?? '') ? n.impact : 'media',
      sentiment: [
        'positivo',
        'neutro',
        'negativo'
      ].includes(n.sentiment ?? '') ? n.sentiment : 'neutro'
    }));
  const { data: fresh, error } = rows.length ? await db.from('inv_news').upsert(rows, {
    onConflict: 'user_id,ticker,title',
    ignoreDuplicates: true
  }).select('ticker,title,summary,impact,sentiment,published') : {
    data: [],
    error: null
  };
  if (error) throw new Error(error.message);
  // notícia de alto impacto negativo e recente vira notificação
  const urgent = (fresh ?? []).filter((n)=>n.impact === 'alta' && n.sentiment === 'negativo' && (!n.published || n.published >= new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)) && (!n.published || n.published <= today));
  let pushed = 0;
  if (urgent.length) {
    pushed = await pushTo(userId, {
      title: `Alerta: ${urgent[0].ticker} — ${urgent[0].title}`.slice(0, 120),
      body: (urgent[0].summary ?? '').slice(0, 220) + (urgent.length > 1 ? ` +${urgent.length - 1}` : ''),
      url: '/patrimonio',
      tag: `noticia-${today}`
    });
  }
  const out = {
    ok: true,
    provider,
    tickers: ranked.map((r)=>r.ticker),
    found: found.length,
    saved: fresh?.length ?? 0,
    searches,
    pushed,
    diag
  };
  console.log('[news]', JSON.stringify(out));
  return out;
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: CORS
  });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  try {
    const body = await req.json().catch(()=>({}));
    const opts = {
      force: Boolean(body.force),
      fromCron: caller.kind === 'cron'
    };
    const run = (uid)=>body.action === 'news' ? news(uid, opts) : body.action === 'history' ? ofHistory(uid) : body.action === 'plan' ? plan(uid, opts).then(async (r)=>{
        // plano semanal (domingo): avisa no celular que está pronto
        if (opts.fromCron && r.ok && !r.cached) await pushTo(uid, {
          title: 'Plano da semana pronto',
          body: r.titulo ?? 'Abra o AIrton para ver as ações da semana.',
          url: '/patrimonio',
          tag: `plano-${spDate()}`
        }, 24 * 3600);
        return r;
      }) : refresh(uid);
    if (caller.kind === 'cron') {
      const out = [];
      for (const uid of (await memberIds()))out.push(await run(uid));
      return json(200, {
        ok: true,
        runs: out
      });
    }
    return json(200, await run(caller.userId));
  } catch (err) {
    console.error('[market]', String(err));
    return json(500, {
      error: err instanceof Error ? err.message : String(err)
    });
  }
});
