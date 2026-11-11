// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// IARA HQ · cliente de IA (mesmo padrão do AIrton): tiers, chave e teto por funcionalidade,
// log de toda chamada em core.ai_usage com o run e o papel (orquestrador | worker).
import { sql } from './common.ts';
export const MODELS = {
  fast: 'claude-haiku-5-5',
  smart: 'claude-sonnet-5-5',
  gemini: Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash-lite'
};
// US$ por milhão de tokens: [entrada, saída, multiplicador de leitura de cache]
const PRICE = {
  'claude-haiku-5-5': [
    0.10,
    0.50,
    0.1
  ],
  'claude-sonnet-5-5': [
    2,
    10,
    0.05
  ],
  'claude-opus-5-5': [
    4,
    20,
    0.05
  ],
  'gemini-3.5-flash-lite': [
    0.30,
    2.50,
    0.1
  ],
  'gemini-3.1-flash-lite': [
    0.25,
    1.50,
    0.1
  ],
  'gemini-3.8-flash': [
    0.75,
    3.75,
    0.1
  ],
  'gemini-2.5-flash-lite': [
    0.10,
    0.40,
    0.1
  ]
};
const APP = 'IARA';
const slug = (f)=>f.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
const WEB_SEARCH_USD = 10 / 1000 // só Anthropic; o Google Search do Gemini tem 5.000 buscas/mês grátis
;
function keyFor(provider, feature) {
  return Deno.env.get(`${APP}_${provider}_KEY_${slug(feature)}`) || Deno.env.get(`${provider}_API_KEY`) || undefined;
}
export const hasGemini = (feature)=>Boolean(keyFor('GEMINI', feature));
function cost(model, u, provider) {
  let [pi, po, cr] = PRICE[model] ?? [
    3,
    15,
    0.1
  ];
  if (model === 'claude-haiku-5-5' && u.input + u.cacheRead + u.cacheWrite > 100_000) [pi, po] = [
    0.5,
    2.5
  ];
  return (u.input * pi + u.cacheWrite * pi * 1.25 + u.cacheRead * pi * cr + u.output * po) / 1e6 + (provider === 'anthropic' ? u.searches * WEB_SEARCH_USD : 0);
}
/** Teto mensal geral do HQ (IARA_AI_BUDGET_USD, padrão 10) e opcional por funcionalidade. */ export async function checkBudget(feature) {
  const total = Number(Deno.env.get(`${APP}_AI_BUDGET_USD`) ?? '10');
  const own = Number(Deno.env.get(`${APP}_AI_BUDGET_USD_${slug(feature)}`) ?? '0');
  const [r] = await sql`select coalesce(sum(cost_usd),0)::float total, coalesce(sum(cost_usd) filter (where feature = ${feature}),0)::float mine
    from core.ai_usage where at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`;
  if (total > 0 && r.total >= total) throw new Error(`Teto mensal de IA do HQ atingido (US$ ${r.total.toFixed(2)} de ${total}).`);
  if (own > 0 && r.mine >= own) throw new Error(`Teto mensal de "${feature}" atingido (US$ ${r.mine.toFixed(2)} de ${own}).`);
}
/** Registra a chamada no run e em core.ai_usage. */ async function registrar(meta, provider, model, u) {
  const c = cost(model, u, provider);
  const { run } = meta;
  run.custo += c;
  run.chamadas += 1;
  const acc = run.uso[meta.papel] ??= {
    chamadas: 0,
    input: 0,
    output: 0,
    buscas: 0,
    custo_usd: 0
  };
  acc.chamadas += 1;
  acc.input += u.input + u.cacheRead + u.cacheWrite;
  acc.output += u.output;
  acc.buscas += u.searches;
  acc.custo_usd = Math.round((acc.custo_usd + c) * 10000) / 10000;
  await sql`insert into core.ai_usage (user_id, agent, feature, papel, run_id, provider, model, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, web_searches, cost_usd)
    values (${run.userId}, ${run.agent}, ${meta.feature}, ${meta.papel}, ${run.id}, ${provider}, ${model}, ${u.input}, ${u.output},
      ${u.cacheRead}, ${u.cacheWrite}, ${u.searches}, ${c})`;
}
export async function anthropic(body, meta) {
  const key = keyFor('ANTHROPIC', meta.feature);
  if (!key) throw new Error(`IA não configurada: defina ${APP}_ANTHROPIC_KEY_${slug(meta.feature)} ou ANTHROPIC_API_KEY nos secrets das edge functions.`);
  await checkBudget(meta.feature);
  let last;
  for(let attempt = 0; attempt < 3; attempt++){
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const j = await res.json();
      await registrar(meta, 'anthropic', body.model, {
        input: j.usage.input_tokens ?? 0,
        output: j.usage.output_tokens ?? 0,
        cacheRead: j.usage.cache_read_input_tokens ?? 0,
        cacheWrite: j.usage.cache_creation_input_tokens ?? 0,
        searches: j.usage.server_tool_use?.web_search_requests ?? 0
      });
      return j;
    }
    last = new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (![
      429,
      500,
      502,
      503,
      529
    ].includes(res.status)) break;
    await new Promise((r)=>setTimeout(r, 1500 * (attempt + 1)));
  }
  throw last;
}
/** Chamada com web search da Anthropic: continua em pause_turn e devolve só URLs que vieram da busca. */ export async function comBusca(body, meta) {
  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: body.maxUses,
      user_location: {
        type: 'approximate',
        city: 'São Paulo',
        region: 'São Paulo',
        country: 'BR',
        timezone: 'America/Sao_Paulo'
      }
    }
  ];
  const messages = [
    {
      role: 'user',
      content: body.prompt
    }
  ];
  const blocks = [];
  for(let i = 0; i < 4; i++){
    const r = await anthropic({
      model: body.model,
      max_tokens: body.max_tokens,
      system: body.system,
      messages,
      tools,
      output_config: {
        effort: 'low'
      }
    }, meta);
    blocks.push(...r.content);
    if (r.stop_reason !== 'pause_turn') break;
    messages.push({
      role: 'assistant',
      content: r.content
    });
  }
  const urls = new Set();
  for (const b of blocks){
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content)if (r.url) urls.add(normalizar(r.url));
    }
  }
  return {
    text: textOf(blocks),
    urls
  };
}
/** Resolve o link de redirecionamento do grounding do Google para a URL real da página. */ async function resolver(uri) {
  try {
    const r = await fetch(uri, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5000)
    });
    await r.body?.cancel();
    return normalizar(r.headers.get('location') ?? uri);
  } catch  {
    return normalizar(uri);
  }
}
/**
 * Chamada ao Gemini com Google Search. As páginas lidas não são cobradas como token e as buscas
 * têm cota grátis, por isso é o caminho barato para pesquisa. Devolve o texto e as URLs reais das fontes.
 */ export async function geminiBusca(body, meta) {
  const key = keyFor('GEMINI', meta.feature);
  if (!key) throw new Error(`Gemini não configurado: defina ${APP}_GEMINI_KEY_${slug(meta.feature)} ou GEMINI_API_KEY.`);
  await checkBudget(meta.feature);
  const model = body.model ?? MODELS.gemini;
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: body.prompt
          }
        ]
      }
    ],
    tools: [
      {
        google_search: {}
      }
    ],
    generationConfig: {
      maxOutputTokens: body.maxTokens ?? 2000
    }
  };
  if (body.system) payload.systemInstruction = {
    parts: [
      {
        text: body.system
      }
    ]
  };
  let last;
  for(let attempt = 0; attempt < 3; attempt++){
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      // deno-lint-ignore no-explicit-any
      const j = await res.json();
      const cand = j.candidates?.[0];
      // deno-lint-ignore no-explicit-any
      const text = (cand?.content?.parts ?? []).filter((p)=>p.text && !p.thought).map((p)=>p.text).join('').trim();
      const gm = cand?.groundingMetadata ?? {};
      // deno-lint-ignore no-explicit-any
      const uris = (gm.groundingChunks ?? []).map((c)=>c.web?.uri).filter(Boolean).slice(0, 20);
      const urls = new Set(await Promise.all(uris.map(resolver)));
      const um = j.usageMetadata ?? {};
      await registrar(meta, 'google', model, {
        input: (um.promptTokenCount ?? 0) - (um.cachedContentTokenCount ?? 0),
        cacheRead: um.cachedContentTokenCount ?? 0,
        cacheWrite: 0,
        output: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
        searches: (gm.webSearchQueries ?? []).length
      });
      return {
        text,
        urls
      };
    }
    last = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    if (![
      429,
      500,
      502,
      503
    ].includes(res.status)) break;
    await new Promise((r)=>setTimeout(r, 1500 * (attempt + 1)));
  }
  throw last;
}
/** JSON da resposta com structured outputs (output_config.format). Se a API recusar o schema (400 sobre o
 *  formato), repete uma vez sem ele e lê o objeto do texto. Corte por max_tokens ou recusa vira erro claro. */
export async function anthropicJson(body, meta) {
  let r;
  try {
    r = await anthropic(body, meta);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (!msg.startsWith('Anthropic 400') || !/format|schema|output_config/i.test(msg)) throw e;
    const { format: _formato, ...resto } = body.output_config ?? {};
    r = await anthropic({ ...body, output_config: resto }, meta);
  }
  if (r.stop_reason === 'max_tokens') throw new Error('Resposta cortada no max_tokens');
  if (r.stop_reason === 'refusal') throw new Error('Pedido recusado pelo modelo');
  const t = textOf(r.content);
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('Resposta sem JSON');
    return JSON.parse(t.slice(a, b + 1));
  }
}
export function textOf(blocks) {
  return blocks.filter((b)=>b.type === 'text').map((b)=>b.text ?? '').join('').trim();
}
export function extrairJson(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) throw new Error(`Resposta sem <${tag}>`);
  return JSON.parse(m[1].trim().replace(/^```(?:json)?|```$/g, '').trim());
}
export function normalizar(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const p of [
      ...u.searchParams.keys()
    ])if (p.startsWith('utm_')) u.searchParams.delete(p);
    return u.toString().replace(/\/$/, '');
  } catch  {
    return url;
  }
}
