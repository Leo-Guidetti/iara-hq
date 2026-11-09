// ClaudIA · cliente de IA (padrão AIrton): tiers, chave e teto por funcionalidade, log em claudia.ai_usage.
import { sql } from './common.ts'

export const MODELS = { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' } as const
const PRICE: Record<string, [number, number, number]> = {
  'claude-haiku-5-5': [0.10, 0.50, 0.1],
  'claude-sonnet-5-5': [2, 10, 0.05],
  'claude-opus-5-5': [4, 20, 0.05],
}
const APP = 'CLAUDIA'
const slug = (f: string) => f.toUpperCase().replace(/[^A-Z0-9]+/g, '_')

function keyFor(feature: string) {
  return Deno.env.get(`${APP}_ANTHROPIC_KEY_${slug(feature)}`) || Deno.env.get('ANTHROPIC_API_KEY') || undefined
}
function cost(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  let [pi, po, cr] = PRICE[model] ?? [3, 15, 0.1]
  if (model === 'claude-haiku-5-5' && u.input + u.cacheRead + u.cacheWrite > 100_000) [pi, po] = [0.5, 2.5]
  return (u.input * pi + u.cacheWrite * pi * 1.25 + u.cacheRead * pi * cr + u.output * po) / 1e6
}

/** Teto mensal geral (CLAUDIA_AI_BUDGET_USD, padrão 5) e opcional por funcionalidade. */
export async function checkBudget(feature: string) {
  const total = Number(Deno.env.get(`${APP}_AI_BUDGET_USD`) ?? '5')
  const own = Number(Deno.env.get(`${APP}_AI_BUDGET_USD_${slug(feature)}`) ?? '0')
  const [r] = await sql`select coalesce(sum(cost_usd),0)::float total, coalesce(sum(cost_usd) filter (where feature = ${feature}),0)::float mine
    from claudia.ai_usage where at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'`
  if (total > 0 && r.total >= total) throw new Error(`Teto mensal de IA da ClaudIA atingido (US$ ${r.total.toFixed(2)} de ${total}).`)
  if (own > 0 && r.mine >= own) throw new Error(`Teto mensal de "${feature}" atingido (US$ ${r.mine.toFixed(2)} de ${own}).`)
}

export interface AResponse {
  content: { type: string; text?: string }[]
  stop_reason: string
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
}

export async function anthropic(
  body: { model: string; max_tokens: number; system?: unknown; messages: unknown[]; output_config?: unknown },
  meta: { feature: string; userId: string },
): Promise<AResponse> {
  const key = keyFor(meta.feature)
  if (!key) throw new Error(`IA não configurada: defina ${APP}_ANTHROPIC_KEY_${slug(meta.feature)} ou ANTHROPIC_API_KEY.`)
  await checkBudget(meta.feature)
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      const j = (await res.json()) as AResponse
      const u = { input: j.usage.input_tokens ?? 0, output: j.usage.output_tokens ?? 0,
        cacheRead: j.usage.cache_read_input_tokens ?? 0, cacheWrite: j.usage.cache_creation_input_tokens ?? 0 }
      await sql`insert into claudia.ai_usage (user_id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
        values (${meta.userId}, ${meta.feature}, 'anthropic', ${body.model}, ${u.input}, ${u.output}, ${u.cacheRead}, ${u.cacheWrite}, ${cost(body.model, u)})`
      return j
    }
    last = new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`)
    if (![429, 500, 502, 503, 529].includes(res.status)) break
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
  throw last
}

export const textOf = (b: AResponse['content']) => b.filter((x) => x.type === 'text').map((x) => x.text ?? '').join('').trim()
export function extrairJson<T>(text: string, tag: string): T {
  const m = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  if (!m) throw new Error(`Resposta sem <${tag}>`)
  return JSON.parse(m[1].trim().replace(/^```(?:json)?|```$/g, '').trim()) as T
}
