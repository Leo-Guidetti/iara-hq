// claudia-food-parse · texto livre de refeição -> itens com macros. Não grava em food_logs: o app confirma e salva.
//   POST { text: string, meal?: MEAL, date?: 'YYYY-MM-DD' }
//   200  { items: [{ description, meal, protein_g, kcal, carbs_g, fat_g }], totals, local_date, model, prompt_version }
// `meal` usa os valores do CHECK de public.food_logs; o app grava com source = 'ai_estimate'.
import { authenticate, json, CORS, spDate } from '../_shared/claudia/common.ts'
import { anthropic, MODELS, textOf, extrairJson } from '../_shared/claudia/ai.ts'

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'shake']
const PROMPT_VERSION = 'food-parse@2'
const SYSTEM = `Você é o módulo de registro alimentar da ClaudIA. Converta a descrição em português de uma refeição em itens com macros estimados.
Regras:
- Um item por alimento ou bebida, com quantidade explícita na descrição (ex.: "Arroz branco, 4 colheres (100 g)"). Estime porções típicas brasileiras quando não houver quantidade.
- Valores por item: protein_g, carbs_g, fat_g (1 casa decimal) e kcal (inteiro, coerente com 4/4/9 kcal por grama).
- meal: um de ${MEALS.join(', ')} (café da manhã, almoço, jantar, lanche, shake/whey). Use o informado; senão deduza pelo texto; na dúvida, "snack".
- Não invente alimentos que não foram citados.
Responda só com <items>[...]</items>, um array JSON de objetos {description, meal, protein_g, kcal, carbs_g, fat_g}.`

type Item = { description: string; meal: string; protein_g: number; kcal: number; carbs_g: number; fat_g: number }
const n = (v: unknown, d = 1) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.round(x * 10 ** d) / 10 ** d : 0 }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  const who = await authenticate(req)
  if (who instanceof Response) return who

  let body: { text?: string; meal?: string; date?: string }
  try { body = await req.json() } catch { return json(400, { error: 'JSON inválido.' }) }
  const text = (body.text ?? '').trim()
  if (!text) return json(400, { error: 'Descreva o que você comeu.' })
  if (text.length > 2000) return json(400, { error: 'Descrição longa demais (máx. 2000 caracteres).' })
  const meal = body.meal && MEALS.includes(body.meal) ? body.meal : undefined
  const localDate = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '') ? body.date! : spDate()

  try {
    const r = await anthropic({
      model: MODELS.fast,
      max_tokens: 1500,
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Data: ${localDate}${meal ? `\nRefeição: ${meal}` : ''}\n\n${text}` }],
    }, { feature: 'food-parse', userId: who.userId })

    const raw = extrairJson<Item[]>(textOf(r.content), 'items')
    const items = (Array.isArray(raw) ? raw : []).filter((i) => i?.description).map((i) => ({
      description: String(i.description).slice(0, 200),
      meal: meal ?? (MEALS.includes(i.meal) ? i.meal : 'snack'),
      protein_g: n(i.protein_g), carbs_g: n(i.carbs_g), fat_g: n(i.fat_g), kcal: Math.round(n(i.kcal, 0)),
    }))
    if (!items.length) return json(422, { error: 'Não reconheci nenhum alimento.' })
    const totals = items.reduce((t, i) => ({ protein_g: n(t.protein_g + i.protein_g), carbs_g: n(t.carbs_g + i.carbs_g),
      fat_g: n(t.fat_g + i.fat_g), kcal: t.kcal + i.kcal }), { protein_g: 0, carbs_g: 0, fat_g: 0, kcal: 0 })
    return json(200, { items, totals, local_date: localDate, model: MODELS.fast, prompt_version: PROMPT_VERSION })
  } catch (e) {
    console.error('food-parse', e)
    return json(502, { error: (e as Error).message })
  }
})
