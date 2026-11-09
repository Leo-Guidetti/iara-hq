// claudia-coach · cria ou ajusta o plano de treino e materializa as sessões.
//   POST { action: 'plan', instruction?: string, start_date?: 'YYYY-MM-DD' }  → IA (Sonnet 5.5), novo workout_plans
//   POST { action: 'extend', days?: number }                                → sem IA: estende a semana-modelo ativa
// Nunca apaga sessões: o plano novo começa no dia seguinte ao último já materializado (ou na data pedida,
// se ela for depois disso). O plano anterior é desativado (is_active = false, valid_to).
import { authenticate, json, CORS, spDate, addDays, DISCLAIMER } from '../_shared/claudia/common.ts'
import { callJson, MODELS, system } from '../_shared/claudia/ai.ts'
import { activePlan, materialize, profileText, trainingSummary, validatePlan, WEEKDAY_PT, type Plan } from '../_shared/claudia/training.ts'

const PROMPT_VERSION = 'coach@5'
const HORIZON = 14

const RULES = `Tarefa: montar (ou ajustar) a semana-modelo de treino para perder gordura preservando massa magra e ganhar condicionamento.
Princípios: força 2–4x/semana como base (cada grupo muscular ≥ 2x/semana quando possível, 10+ séries semanais por grupo), dupla progressão com RPE-alvo 7–8, aeróbio majoritariamente em Z2, respeito às limitações e lesões, sessões dentro do tempo disponível, nada de aumentar volume total > 10% por semana. Respeite pedidos explícitos do usuário quando forem seguros.
Use o histórico de cargas para definir cargas de partida em load_kg quando houver registro; sem registro, deixe null e use RPE.
weekday: 0 = segunda … 6 = domingo. Sessões de força usam sport "strength", intensity "strength" e strength_day_index apontando para days[].
Formato: <plan>{
 "name": "...", "rationale": "parágrafo curto",
 "days": [{"label": "Força A — ...", "focus": "...", "exercises": [{"name": "...", "sets": 3, "reps": "8-10", "rpe_target": 8, "rest_s": 90, "load_kg": null, "notes": "..."}]}],
 "week": [{"weekday": 0, "sport": "strength", "title": "...", "intensity": "strength", "duration_min": 45, "strength_day_index": 0, "zone": null, "notes": null, "structure": []}],
 "progression_rule": "...", "deload_rule": "...", "daily_steps_target": 8000, "flags": ["..."], "refs": ["..."]
}</plan>
sport ∈ run, walk, hike, swim, ride_indoor, ride_outdoor, strength, hiit, yoga, mobility, row, other; intensity ∈ recovery, easy, moderate, tempo, threshold, intervals, long, strength. structure: [{"label","minutes","target"}] para sessões aeróbias.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  const who = await authenticate(req)
  if (who instanceof Response) return who
  const { db, userId } = who
  const body = await req.json().catch(() => ({})) as { action?: string; instruction?: string; start_date?: string; days?: number }
  const today = spDate()
  const current = await activePlan(db)

  try {
    if (body.action === 'extend') {
      if (!current) return json(400, { error: 'Nenhum plano ativo.' })
      const from = current.materialized_through && current.materialized_through >= today ? addDays(current.materialized_through, 1) : today
      const to = addDays(from, Math.min(28, Math.max(1, body.days ?? 7)) - 1)
      const n = await materialize(db, userId, current.id, current.plan, from, to)
      return json(200, { plan_id: current.id, created: n, from, to })
    }
    if (body.action !== 'plan') return json(400, { error: 'action deve ser plan ou extend.' })

    const instruction = (body.instruction ?? '').trim().slice(0, 2000)
    const [{ data: tp }, { data: trend }, { data: comp }] = await Promise.all([
      db.from('training_profiles').select('*').eq('user_id', userId).maybeSingle(),
      db.from('weight_with_trend').select('local_date, trend_7d').order('local_date', { ascending: false }).limit(1),
      db.from('body_comp_estimates').select('local_date, bf_mean, lean_mass_kg').order('local_date', { ascending: false }).limit(2),
    ])
    if (!tp) return json(400, { error: 'Preencha o perfil de treino primeiro.' })
    const hist = await trainingSummary(db, today, 28)

    const minStart = current?.materialized_through && current.materialized_through >= today ? addDays(current.materialized_through, 1) : today
    const start = body.start_date && /^\d{4}-\d{2}-\d{2}$/.test(body.start_date) && body.start_date > minStart ? body.start_date : minStart

    const prompt = [
      `Hoje: ${today} (${WEEKDAY_PT[(new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7]}). O plano novo começa em ${start}.`,
      profileText(tp),
      `Peso-tendência ${trend?.[0]?.trend_7d ?? '—'} kg; composição: ${comp?.map((c) => `${c.local_date} gordura ${c.bf_mean}%, magra ${c.lean_mass_kg} kg`).join(' | ') || 'sem medidas'}.`,
      hist.text,
      current ? `Plano atual (${current.plan.name}): semana ${JSON.stringify(current.plan.week.map((w) => [w.weekday, w.title, w.duration_min]))}; dias de força ${JSON.stringify(current.plan.days)}; progressão: ${current.plan.progression_rule ?? '—'}.` : 'Sem plano atual.',
      instruction ? `Pedido do usuário: ${instruction}` : 'Sem pedido específico: revise e monte a melhor semana-modelo.',
    ].join('\n')

    const { data: plan } = await callJson<Plan>({
      model: MODELS.smart, maxTokens: 6000, system: system(RULES), content: prompt, tag: 'plan', validate: validatePlan,
      feature: 'coach', userId, effort: 'medium',
    })
    const prefs = { weekdays: tp.weekdays, session_minutes: tp.session_minutes }
    const full = { ...plan, prefs, disclaimer: DISCLAIMER }

    if (current) {
      const { error } = await db.from('workout_plans').update({ is_active: false, valid_to: addDays(start, -1) }).eq('id', current.id)
      if (error) throw new Error(error.message)
    }
    const { data: row, error } = await db.from('workout_plans').insert({
      user_id: userId, goal: tp.goal, plan: full as never, rationale: plan.rationale ?? null, model: MODELS.smart,
      prompt_version: PROMPT_VERSION, valid_from: start, is_active: true,
    }).select('id').single()
    if (error) throw new Error(error.message)
    const n = await materialize(db, userId, row.id, plan, start, addDays(start, HORIZON - 1))
    await db.from('plan_changes').insert({
      user_id: userId, plan_id: row.id, scope: 'plan', source: 'ai', local_date: start,
      summary: `${current ? 'Plano ajustado' : 'Plano criado'}: ${plan.name}`.slice(0, 4000), instruction: instruction || null,
      before: current ? { plan_id: current.id, name: current.plan.name } : null, after: { plan_id: row.id, name: plan.name },
    })
    return json(200, { plan_id: row.id, start, sessions: n })
  } catch (e) {
    console.error('coach', e)
    return json(502, { error: (e as Error).message })
  }
})
