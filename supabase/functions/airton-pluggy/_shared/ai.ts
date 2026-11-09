// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// Cliente de IA do AIrton (chaves só no servidor). Toda chamada passa por aqui:
// registra tokens, cache, buscas e custo em airton.ai_usage e respeita os tetos mensais.
import { admin } from './common.ts';
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
  'claude-sonnet-5': [
    2,
    10,
    0.1
  ],
  'claude-haiku-4-5': [
    1,
    5,
    0.1
  ],
  'claude-sonnet-4-6': [
    3,
    15,
    0.1
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
const APP = 'AIRTON';
const slug = (f)=>f.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
/**
 * Uma chave por funcionalidade: AIRTON_ANTHROPIC_KEY_CHAT, AIRTON_GEMINI_KEY_NEWS etc.
 * Sem a chave específica, usa a geral (ANTHROPIC_API_KEY / GEMINI_API_KEY).
 */ function keyFor(provider, feature) {
  return Deno.env.get(`${APP}_${provider}_KEY_${slug(feature)}`) || Deno.env.get(`${provider}_API_KEY`) || undefined;
}
const WEB_SEARCH_USD = 10 / 1000 // busca da Anthropic; a do Gemini tem 5.000/mês grátis (ver gemini())
;
function cost(model, u) {
  let [pi, po, cr] = PRICE[model] ?? [
    3,
    15,
    0.1
  ];
  if (model === 'claude-haiku-5-5' && u.input + u.cacheRead + u.cacheWrite > 100_000) [pi, po] = [
    0.5,
    2.5
  ];
  const tokens = (u.input * pi + u.cacheWrite * pi * 1.25 + u.cacheRead * pi * cr + u.output * po) / 1e6;
  return tokens + (u.provider === 'anthropic' ? u.searches * WEB_SEARCH_USD : 0);
}
/**
 * Tetos mensais (US$): o geral do AIrton (AIRTON_AI_BUDGET_USD, padrão 10) e, opcionalmente,
 * um por funcionalidade (AIRTON_AI_BUDGET_USD_CHAT, _NEWS, _PLAN, _CATEGORIZE, _VOICE).
 */ export async function checkBudget(feature) {
  const total = Number(Deno.env.get('AIRTON_AI_BUDGET_USD') ?? '10');
  const own = Number(Deno.env.get(`AIRTON_AI_BUDGET_USD_${slug(feature)}`) ?? '0');
  if (!(total > 0) && !(own > 0)) return;
  const start = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo'
  }).slice(0, 8) + '01';
  const { data } = await admin().from('ai_usage').select('cost_usd,feature').gte('at', `${start}T03:00:00Z`);
  const rows = data ?? [];
  const spent = rows.reduce((s, r)=>s + Number(r.cost_usd), 0);
  if (total > 0 && spent >= total) throw new Error(`Teto mensal de IA do AIrton atingido (US$ ${spent.toFixed(2)} de ${total}).`);
  const mine = rows.filter((r)=>r.feature === feature).reduce((s, r)=>s + Number(r.cost_usd), 0);
  if (own > 0 && mine >= own) throw new Error(`Teto mensal de IA de "${feature}" atingido (US$ ${mine.toFixed(2)} de ${own}).`);
}
async function log(meta, provider, model, u) {
  const { error } = await admin().from('ai_usage').insert({
    user_id: meta.userId,
    feature: meta.feature,
    model,
    provider,
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_tokens: u.cacheRead,
    cache_write_tokens: u.cacheWrite,
    web_searches: u.searches,
    cost_usd: cost(model, {
      ...u,
      provider
    })
  });
  if (error) console.warn('[ai_usage]', error.message);
}
// ---------------- Anthropic ----------------
export function hasAnthropic(feature = '') {
  return Boolean(keyFor('ANTHROPIC', feature));
}
/** Marca um texto de system como cacheável (prefixo reaproveitado por 5 min a ~10% do preço). */ export function cachedSystem(text) {
  return [
    {
      type: 'text',
      text,
      cache_control: {
        type: 'ephemeral'
      }
    }
  ];
}
export async function anthropic(body, meta) {
  const key = keyFor('ANTHROPIC', meta.feature);
  if (!key) throw new Error(`IA não configurada: defina ${APP}_ANTHROPIC_KEY_${slug(meta.feature)} (ou ANTHROPIC_API_KEY) no Supabase.`);
  await checkBudget(meta.feature);
  const { effort, ...rest } = body;
  const payload = {
    ...rest
  };
  if (effort) payload.output_config = {
    effort
  };
  let last;
  for(let attempt = 0; attempt < 3; attempt++){
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const j = await res.json();
      await log(meta, 'anthropic', body.model, {
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
export function textOf(r) {
  return r.content.filter((b)=>b.type === 'text').map((b)=>b.text ?? '').join('').trim();
}
// ---------------- Google Gemini ----------------
export function hasGemini(feature = '') {
  return Boolean(keyFor('GEMINI', feature));
}
/**
 * Uma chamada ao Gemini, opcionalmente com Grounding no Google Search.
 * No Gemini 3+, as buscas têm 5.000/mês grátis (depois US$ 14/1.000) e o conteúdo
 * das páginas não é cobrado como token de entrada — é o que torna o news barato.
 */ export async function gemini(opts, meta) {
  const key = keyFor('GEMINI', meta.feature);
  if (!key) throw new Error(`Gemini não configurado: defina ${APP}_GEMINI_KEY_${slug(meta.feature)} (ou GEMINI_API_KEY) no Supabase.`);
  await checkBudget(meta.feature);
  const model = opts.model ?? MODELS.gemini;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: opts.prompt
          }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 3000
    }
  };
  if (opts.system) body.systemInstruction = {
    parts: [
      {
        text: opts.system
      }
    ]
  };
  if (opts.search) body.tools = [
    {
      google_search: {}
    }
  ];
  let last;
  for(let attempt = 0; attempt < 3; attempt++){
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      // deno-lint-ignore no-explicit-any
      const j = await res.json();
      const cand = j.candidates?.[0];
      // deno-lint-ignore no-explicit-any
      const text = (cand?.content?.parts ?? []).filter((p)=>p.text && !p.thought).map((p)=>p.text).join('').trim();
      const gm = cand?.groundingMetadata ?? {};
      const searches = (gm.webSearchQueries ?? []).length;
      // deno-lint-ignore no-explicit-any
      const sources = (gm.groundingChunks ?? []).map((c)=>({
          title: c.web?.title ?? '',
          uri: c.web?.uri ?? ''
        })).filter((s)=>s.uri);
      const um = j.usageMetadata ?? {};
      await log(meta, 'google', model, {
        input: (um.promptTokenCount ?? 0) - (um.cachedContentTokenCount ?? 0),
        cacheRead: um.cachedContentTokenCount ?? 0,
        cacheWrite: 0,
        output: (um.candidatesTokenCount ?? 0) + (um.thoughtsTokenCount ?? 0),
        searches
      });
      return {
        text,
        searches,
        sources
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
