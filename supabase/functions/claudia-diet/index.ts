// claudia-diet · TDEE (fórmula ou adaptativo), metas de kcal e proteína e orientação prática.
//   POST {}  →  200 { recommendation: linha de public.diet_recommendations }
// O TDEE e os limites das metas são calculados aqui, de forma determinística; a IA escolhe dentro
// desses limites e escreve o racional. Grava em public.diet_recommendations com o JWT do usuário.
import { authenticate, json, CORS, spDate, addDays, DISCLAIMER } from '../_shared/claudia/common.ts'
import { callJson, MODELS, system } from '../_shared/claudia/ai.ts'
import { obj, num, str, strList, arr, optStr } from '../_shared/claudia/validate.ts'

const PROMPT_VERSION = 'diet@5'
const WINDOW = 21
const KCAL_PER_KG = 7700

const RULES = `Tarefa: montar as metas diárias de energia e proteína para perda de gordura preservando massa magra, e a orientação prática da semana.
Você recebe um TDEE já calculado e os limites permitidos. Respeite-os:
- kcal: entre kcal_min e kcal_max informados (déficit de 300 a 700 kcal, nunca abaixo do piso de segurança).
- proteína: entre protein_min e protein_max (1,6 a 2,2 g/kg do peso-tendência); com GLP-1 e déficit, prefira a metade superior.
- day_targets: um item por dia da semana (segunda a domingo), mais carboidrato nos dias de treino forte, gordura estável, proteína igual todos os dias.
- Se a cobertura de registro for baixa, diga isso em "flags" e não tire conclusão do consumo médio.
- Com apetite reduzido por GLP-1, proteína é prioridade e kcal é teto, não meta a perseguir.
Formato: <diet>{
 "summary": "3–5 frases",
 "kcal_target": inteiro, "protein_g_target": inteiro,
 "rationale": "parágrafo curto explicando as escolhas",
 "day_targets": [{"day": "segunda", "tipo": "descanso|leve|moderado|forte", "treino": "texto curto", "kcal": int, "protein_g": int, "carbs_g": int, "fat_g": int}],
 "protein_distribution": [{"meal": "Café da manhã", "protein_g": int, "examples": ["..."]}],
 "hydration_fiber": ["..."], "low_appetite_strategies": ["..."], "flags": ["..."], "refs": ["..."]
}</diet>`

type DayT = { day: string; tipo: string; treino: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
type Diet = {
  summary: string; kcal_target: number; protein_g_target: number; rationale: string
  day_targets: DayT[]; protein_distribution: { meal: string; protein_g: number; examples: string[] }[]
  hydration_fiber: string[]; low_appetite_strategies: string[]; flags: string[]; refs: string[]
}

function validator(lim: { kcalMin: number; kcalMax: number; pMin: number; pMax: number }) {
  return (v: unknown): Diet => {
    const o = obj(v)
    return {
      summary: str(o.summary, 'summary', 1500),
      kcal_target: Math.round(num(o.kcal_target, 'kcal_target', lim.kcalMin, lim.kcalMax)),
      protein_g_target: Math.round(num(o.protein_g_target, 'protein_g_target', lim.pMin, lim.pMax)),
      rationale: str(o.rationale, 'rationale', 2500),
      day_targets: arr(o.day_targets, 'day_targets').slice(0, 7).map((d, i) => {
        const x = obj(d, `day_targets[${i}]`)
        return {
          day: str(x.day, `day_targets[${i}].day`, 20), tipo: str(x.tipo, `day_targets[${i}].tipo`, 20),
          treino: optStr(x.treino, `day_targets[${i}].treino`, 120) ?? '',
          kcal: Math.round(num(x.kcal, `day_targets[${i}].kcal`, lim.kcalMin - 250, lim.kcalMax + 250)),
          protein_g: Math.round(num(x.protein_g, `day_targets[${i}].protein_g`, lim.pMin - 10, lim.pMax + 10)),
          carbs_g: Math.round(num(x.carbs_g, `day_targets[${i}].carbs_g`, 0, 600)),
          fat_g: Math.round(num(x.fat_g, `day_targets[${i}].fat_g`, 20, 200)),
        }
      }),
      protein_distribution: arr(o.protein_distribution ?? [], 'protein_distribution').slice(0, 7).map((d, i) => {
        const x = obj(d, `protein_distribution[${i}]`)
        return { meal: str(x.meal, 'meal', 40), protein_g: Math.round(num(x.protein_g, 'protein_g', 0, 120)), examples: strList(x.examples ?? [], 'examples', 4) }
      }),
      hydration_fiber: strList(o.hydration_fiber ?? [], 'hydration_fiber', 6),
      low_appetite_strategies: strList(o.low_appetite_strategies ?? [], 'low_appetite_strategies', 8),
      flags: strList(o.flags ?? [], 'flags', 8), refs: strList(o.refs ?? [], 'refs', 8),
    }
  }
}

const age = (birth: string | null, today: string) => birth ? Math.floor((Date.parse(today) - Date.parse(birth)) / (365.25 * 864e5)) : null
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  const who = await authenticate(req)
  if (who instanceof Response) return who
  const { db } = who
  const today = spDate()
  const from = addDays(today, -WINDOW)

  const [{ data: profile }, { data: trend }, { data: food }, { data: comp }, { data: meds }, { data: acts }, { data: plan }] = await Promise.all([
    db.from('profiles').select('sex, birth_date, height_cm, goal').eq('id', who.userId).single(),
    db.from('weight_with_trend').select('local_date, trend_7d').gte('local_date', addDays(from, -7)).order('local_date'),
    db.from('food_logs').select('local_date, kcal, protein_g').gte('local_date', from).lt('local_date', today),
    db.from('body_comp_estimates').select('local_date, bf_mean, lean_mass_kg, fat_mass_kg').order('local_date', { ascending: false }).limit(2),
    db.from('medication_logs').select('local_date, drug, dose_mg, side_effects').order('administered_at', { ascending: false }).limit(4),
    db.from('activities').select('local_date, sport, duration_min, kcal').gte('local_date', addDays(today, -14)),
    db.from('workout_plans').select('plan').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const weight = Number(trend?.at(-1)?.trend_7d ?? 0)
  if (!weight) return json(400, { error: 'Registre o peso por alguns dias antes de pedir a dieta.' })
  const years = age(profile?.birth_date ?? null, today)
  if (!profile?.height_cm || !profile?.sex || !years) return json(400, { error: 'Preencha sexo, altura e data de nascimento no Perfil.' })

  // Mifflin-St Jeor × 1,4 (atividade leve a moderada)
  const bmr = 10 * weight + 6.25 * Number(profile.height_cm) - 5 * years + (profile.sex === 'male' ? 5 : -161)
  const mifflinTdee = Math.round(bmr * 1.4)

  // Adaptativo: consumo médio - variação de tendência convertida em energia, com ≥ 15 dias registrados
  const perDay = new Map<string, { kcal: number; p: number }>()
  for (const f of food ?? []) {
    const d = perDay.get(f.local_date) ?? { kcal: 0, p: 0 }
    d.kcal += Number(f.kcal ?? 0); d.p += Number(f.protein_g ?? 0); perDay.set(f.local_date, d)
  }
  const days = [...perDay.values()].filter((d) => d.kcal >= 600)
  const avgIntake = avg(days.map((d) => d.kcal))
  const avgProtein = avg(days.map((d) => d.p))
  const tStart = trend?.find((t) => t.local_date! >= from)?.trend_7d
  const tEnd = trend?.at(-1)?.trend_7d
  const trendDeltaKg = tStart != null && tEnd != null ? Number(tEnd) - Number(tStart) : null
  let method: 'mifflin' | 'adaptive' = 'mifflin'
  let tdee = mifflinTdee
  if (days.length >= 15 && avgIntake && trendDeltaKg != null) {
    const adaptive = Math.round(avgIntake - (trendDeltaKg * KCAL_PER_KG) / WINDOW)
    if (adaptive > bmr && adaptive < mifflinTdee * 1.4) { method = 'adaptive'; tdee = adaptive }
  }
  const floor = Math.round(Math.max(bmr, profile.sex === 'male' ? 1500 : 1200))
  const lim = {
    kcalMin: Math.max(floor, tdee - 700), kcalMax: Math.max(floor + 100, tdee - 300),
    pMin: Math.round(weight * 1.6), pMax: Math.round(weight * 2.2),
  }
  const tdeeInfo = {
    tdee, method, mifflinTdee, avgIntake: avgIntake && Math.round(avgIntake), daysWithKcal: days.length, windowDays: WINDOW,
    coverage: days.length / WINDOW, trendDeltaKg: trendDeltaKg && Math.round(trendDeltaKg * 100) / 100,
    note: method === 'adaptive'
      ? `Adaptativo: consumo médio registrado menos a variação da média de 7 dias em ${WINDOW} dias.`
      : `Estimativa por fórmula (Mifflin × 1,4). O cálculo adaptativo liga com ≥ 15 dias de calorias registradas em ${WINDOW}.`,
  }

  const weekly = (plan?.plan as { days?: unknown[]; weekly_targets?: unknown } | null) ?? null
  const actSummary = (acts ?? []).map((a) => `${a.local_date} ${a.sport} ${Math.round(Number(a.duration_min))} min`).join('; ') || 'nenhuma'
  const prompt = [
    `Hoje: ${today}. Perfil: ${profile.sex}, ${years} anos, ${profile.height_cm} cm. Objetivo: ${profile.goal ?? 'perder gordura preservando massa magra'}.`,
    `Peso-tendência (média 7 dias): ${weight.toFixed(1)} kg; variação em ${WINDOW} dias: ${tdeeInfo.trendDeltaKg ?? 'sem dados'} kg.`,
    `Composição (fita): ${comp?.length ? comp.map((c) => `${c.local_date} gordura ${c.bf_mean}%, magra ${c.lean_mass_kg} kg`).join(' | ') : 'sem medidas'}.`,
    `Registro alimentar: ${days.length} de ${WINDOW} dias com kcal; média ${tdeeInfo.avgIntake ?? '—'} kcal e ${avgProtein ? Math.round(avgProtein) : '—'} g de proteína.`,
    `Medicação recente: ${meds?.length ? meds.map((m) => `${m.local_date} ${m.drug} ${m.dose_mg} mg${m.side_effects?.length ? ` (efeitos: ${m.side_effects.join(', ')})` : ''}`).join('; ') : 'nenhuma'}.`,
    `Atividades 14 dias: ${actSummary}.`,
    `Plano de treino ativo (resumo): ${weekly ? JSON.stringify(weekly.days ?? weekly).slice(0, 1500) : 'nenhum'}.`,
    `TDEE calculado: ${tdee} kcal (${method}). BMR ${Math.round(bmr)}. Limites: kcal_min ${lim.kcalMin}, kcal_max ${lim.kcalMax}, protein_min ${lim.pMin}, protein_max ${lim.pMax}.`,
  ].join('\n')

  try {
    const { data } = await callJson({
      model: MODELS.smart, maxTokens: 3500, system: system(RULES), content: prompt, tag: 'diet',
      validate: validator(lim), feature: 'diet', userId: who.userId, effort: 'medium',
    })
    const payload = {
      summary: data.summary, rationale: data.rationale, tdee: tdeeInfo,
      targets: { kcal: data.kcal_target, proteinG: data.protein_g_target, proteinRange: [lim.pMin, lim.pMax], deficit: tdee - data.kcal_target, basis: `1,6–2,2 g/kg do peso-tendência (${weight.toFixed(1)} kg)` },
      day_targets: data.day_targets, protein_distribution: data.protein_distribution, hydration_fiber: data.hydration_fiber,
      low_appetite_strategies: data.low_appetite_strategies, flags: data.flags, refs: data.refs, disclaimer: DISCLAIMER,
    }
    const { data: row, error } = await db.from('diet_recommendations').insert({
      user_id: who.userId, tdee_estimate: tdee, tdee_method: method, kcal_target: data.kcal_target, protein_g_target: data.protein_g_target,
      rationale: data.rationale, payload, model: MODELS.smart, prompt_version: PROMPT_VERSION,
    }).select().single()
    if (error) throw new Error(error.message)
    return json(200, { recommendation: row })
  } catch (e) {
    console.error('diet', e)
    return json(502, { error: (e as Error).message })
  }
})
