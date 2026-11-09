// ClaudIA · cliente de IA (padrão AIrton): tiers, chave e teto por funcionalidade, log em claudia.ai_usage.
import { sql } from './common.ts';
export const MODELS = {
  fast: 'claude-haiku-5-5',
  smart: 'claude-sonnet-5-5'
};
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
  ]
};
const APP = 'CLAUDIA';
const slug = (f)=>f.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
function keyFor(feature) {
  return Deno.env.get(`${APP}_ANTHROPIC_KEY_${slug(feature)}`) || Deno.env.get('ANTHROPIC_API_KEY') || undefined;
}
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
  return (u.input * pi + u.cacheWrite * pi * 1.25 + u.cacheRead * pi * cr + u.output * po) / 1e6;
}
/** Teto mensal geral (CLAUDIA_AI_BUDGET_USD, padrão 5) e opcional por funcionalidade. */ export async function checkBudget(feature) {
  const total = Number(Deno.env.get(`${APP}_AI_BUDGET_USD`) ?? '5');
  const own = Number(Deno.env.get(`${APP}_AI_BUDGET_USD_${slug(feature)}`) ?? '0');
  const [r] = await sql`select coalesce(sum(cost_usd),0)::float total, coalesce(sum(cost_usd) filter (where feature = ${feature}),0)::float mine
    from claudia.ai_usage where at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`;
  if (total > 0 && r.total >= total) throw new Error(`Teto mensal de IA da ClaudIA atingido (US$ ${r.total.toFixed(2)} de ${total}).`);
  if (own > 0 && r.mine >= own) throw new Error(`Teto mensal de "${feature}" atingido (US$ ${r.mine.toFixed(2)} de ${own}).`);
}
export async function anthropic(body, meta) {
  const key = keyFor(meta.feature);
  if (!key) throw new Error(`IA não configurada: defina ${APP}_ANTHROPIC_KEY_${slug(meta.feature)} ou ANTHROPIC_API_KEY.`);
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
      const u = {
        input: j.usage.input_tokens ?? 0,
        output: j.usage.output_tokens ?? 0,
        cacheRead: j.usage.cache_read_input_tokens ?? 0,
        cacheWrite: j.usage.cache_creation_input_tokens ?? 0
      };
      await sql`insert into claudia.ai_usage (user_id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
        values (${meta.userId}, ${meta.feature}, 'anthropic', ${body.model}, ${u.input}, ${u.output}, ${u.cacheRead}, ${u.cacheWrite}, ${cost(body.model, u)})`;
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
export const textOf = (b)=>b.filter((x)=>x.type === 'text').map((x)=>x.text ?? '').join('').trim();
export function extrairJson(text, tag) {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) throw new Error(`Resposta sem <${tag}>`);
  return JSON.parse(m[1].trim().replace(/^```(?:json)?|```$/g, '').trim());
}
/** Regras comuns a todo system prompt da ClaudIA (fixas, entram no cache). */ export const BASE_RULES = `Você é a ClaudIA, assistente de nutrição e treino de uso individual. O foco é distinguir perda de gordura de perda de massa magra usando peso (média de 7 dias), fita métrica e fotos de espelho; a balança é comum, sem bioimpedância.
Regras fixas:
- Apoie recomendações em referências acadêmicas reconhecidas (ex.: ISSN position stands, ACSM, Helms et al., Morton et al. 2018, Hall et al.) e cite-as de forma curta no campo "refs".
- Seja conservador com déficit calórico e com volume de treino; priorize proteína e treino de força para preservar massa magra, especialmente com uso de agonistas de GLP-1 (tirzepatida, semaglutida).
- Nunca prescreva nem ajuste medicação. Sinais de alerta (perda > 1% do peso por semana por semanas seguidas, tontura, dor, sintomas gastrointestinais fortes) viram recomendação de procurar o médico.
- Escreva em português do Brasil, direto e sem jargão desnecessário.
- Você organiza o processo; não é aconselhamento médico.
- Responda apenas com JSON válido dentro da tag pedida, sem texto fora dela.`;
/** System em dois blocos fixos (regras + instruções da feature) com cache no último. */ export function system(featureRules) {
  return [
    {
      type: 'text',
      text: BASE_RULES
    },
    {
      type: 'text',
      text: featureRules,
      cache_control: {
        type: 'ephemeral'
      }
    }
  ];
}
/**
 * Chama o modelo, extrai <tag>JSON</tag> e valida. Se a validação falhar, tenta
 * uma vez mais mostrando o erro ao modelo.
 */ export async function callJson(opts) {
  const messages = [
    {
      role: 'user',
      content: opts.content
    }
  ];
  let lastErr = '';
  for(let i = 0; i < 2; i++){
    const r = await anthropic({
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages,
      ...opts.effort ? {
        output_config: {
          effort: opts.effort
        }
      } : {}
    }, {
      feature: opts.feature,
      userId: opts.userId
    });
    const text = textOf(r.content);
    try {
      return {
        data: opts.validate(extrairJson(text, opts.tag)),
        usage: r.usage
      };
    } catch (e) {
      lastErr = e.message;
      messages.push({
        role: 'assistant',
        content: text
      });
      messages.push({
        role: 'user',
        content: `Sua resposta não passou na validação: ${lastErr}. Responda de novo, só com <${opts.tag}>JSON</${opts.tag}> no formato pedido.`
      });
    }
  }
  throw new Error(`Resposta da IA inválida: ${lastErr}`);
}
