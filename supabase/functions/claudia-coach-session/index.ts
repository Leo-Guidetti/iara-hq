// claudia-coach-session · conversa sobre UMA sessão do plano e mudanças pontuais nela.
//   POST { action: 'chat', session_id, message, history?: [{role, content}] } → { reply, change|null }   (Sonnet 5.5)
//   POST { action: 'apply', session_id, change }                              → aplica a mudança (sem IA) e registra em plan_changes
// A IA só propõe; aplicar é uma ação separada, validada e determinística.
import { authenticate, json, CORS, spDate, DISCLAIMER } from '../_shared/claudia/common.ts'
import { callJson, MODELS, system } from '../_shared/claudia/ai.ts'
import { obj, str, optNum, oneOf, optStr, arr } from '../_shared/claudia/validate.ts'
import { exercisesOf, profileText, validateExercise, INTENSITIES, SPORTS, type Exercise, type Plan } from '../_shared/claudia/training.ts'

const PROMPT_VERSION = 'coach-session@2'

const RULES = `Tarefa: conversar com o usuário sobre UMA sessão específica do plano (substituir exercício, encurtar, trocar de dia, adaptar a dor ou equipamento, explicar o porquê).
Responda curto (até 6 frases). Se a conversa pedir uma mudança concreta e segura nesta sessão, proponha em "change"; senão, change = null. Nunca mude outras sessões. Com dor, sugira versão sem dor e, se persistir, procurar um profissional.
Formato: <reply>{"reply": "texto", "change": null | {"summary": "uma frase", "patch": {"title"?: "...", "sport"?: "...", "intensity"?: "...", "duration_min"?: int, "distance_km"?: num, "local_date"?: "YYYY-MM-DD", "status"?: "planned"|"done"|"skipped", "notes"?: "...", "exercises"?: [{"name","sets","reps","rpe_target","rest_s","load_kg","notes"}]}}}</reply>`

type Patch = { title?: string; sport?: string; intensity?: string; duration_min?: number; distance_km?: number | null; local_date?: string; status?: string; notes?: string | null; exercises?: Exercise[] }
type Change = { summary: string; patch: Patch }

function validatePatch(v: unknown): Patch {
  const o = obj(v, 'patch')
  const p: Patch = {}
  if (o.title != null) p.title = str(o.title, 'title', 120)
  if (o.sport != null) p.sport = oneOf(o.sport, 'sport', SPORTS)
  if (o.intensity != null) p.intensity = oneOf(o.intensity, 'intensity', INTENSITIES)
  if (o.duration_min != null) p.duration_min = Math.round(optNum(o.duration_min, 'duration_min', 5, 480)!)
  if (o.distance_km !== undefined) p.distance_km = optNum(o.distance_km, 'distance_km', 0, 300)
  if (o.local_date != null) { const d = str(o.local_date, 'local_date', 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('local_date inválida'); p.local_date = d }
  if (o.status != null) p.status = oneOf(o.status, 'status', ['planned', 'done', 'skipped'] as const)
  if (o.notes !== undefined) p.notes = optStr(o.notes, 'notes', 600)
  if (o.exercises != null) p.exercises = arr(o.exercises, 'exercises').slice(0, 12).map((e, i) => validateExercise(e, `exercises[${i}]`))
  if (!Object.keys(p).length) throw new Error('patch vazio')
  return p
}
function validateReply(v: unknown): { reply: string; change: Change | null } {
  const o = obj(v)
  const c = o.change == null ? null : obj(o.change, 'change')
  return { reply: str(o.reply, 'reply', 2000), change: c ? { summary: str(c.summary, 'summary', 300), patch: validatePatch(c.patch) } : null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' })
  const who = await authenticate(req)
  if (who instanceof Response) return who
  const { db, userId } = who
  const body = await req.json().catch(() => ({})) as { action?: string; session_id?: number; message?: string; history?: { role: string; content: string }[]; change?: unknown }

  const { data: s } = await db.from('plan_sessions').select('*').eq('id', Number(body.session_id)).maybeSingle()
  if (!s) return json(404, { error: 'Sessão não encontrada.' })
  const { data: planRow } = s.plan_id ? await db.from('workout_plans').select('plan').eq('id', s.plan_id).maybeSingle() : { data: null }
  const plan = (planRow?.plan ?? null) as Plan | null
  const target = (s.target ?? {}) as Record<string, unknown>
  const exercises = exercisesOf(target, plan)

  try {
    if (body.action === 'apply') {
      const patch = validatePatch(obj(body.change, 'change').patch)
      const before = { title: s.title, sport: s.sport, intensity: s.intensity, duration_min: s.duration_min, distance_km: s.distance_km, local_date: s.local_date, status: s.status, target }
      const newTarget = { ...target, ...(patch.notes !== undefined ? { notes: patch.notes } : {}), ...(patch.exercises ? { exercises: patch.exercises } : {}) }
      const upd: Record<string, unknown> = { edited: true, target: newTarget }
      for (const k of ['title', 'sport', 'intensity', 'duration_min', 'distance_km', 'local_date', 'status'] as const) if (patch[k] !== undefined) upd[k] = patch[k]
      const { data: after, error } = await db.from('plan_sessions').update(upd).eq('id', s.id).select().single()
      if (error) throw new Error(error.message)
      const summary = str(obj(body.change, 'change').summary ?? 'Ajuste na sessão', 'summary', 300)
      await db.from('plan_changes').insert({ user_id: userId, plan_id: s.plan_id, session_id: s.id, local_date: s.local_date, scope: 'session', source: 'ai', summary, before, after: { ...upd } })
      return json(200, { session: after })
    }
    if (body.action !== 'chat') return json(400, { error: 'action deve ser chat ou apply.' })
    const message = (body.message ?? '').trim().slice(0, 2000)
    if (!message) return json(400, { error: 'Mensagem vazia.' })

    const [{ data: tp }, { data: logs }] = await Promise.all([
      db.from('training_profiles').select('*').eq('user_id', userId).maybeSingle(),
      exercises.length
        ? db.from('workout_logs').select('local_date, exercise, set_number, reps, load_kg, rpe').in('exercise', exercises.map((e) => e.name)).order('performed_at', { ascending: false }).limit(60)
        : Promise.resolve({ data: [] as { local_date: string; exercise: string; set_number: number; reps: number | null; load_kg: number | null; rpe: number | null }[] }),
    ])
    const lastBy = new Map<string, string>()
    for (const l of logs ?? []) if (!lastBy.has(l.exercise)) lastBy.set(l.exercise, `${l.local_date}: ${l.load_kg ?? '—'} kg × ${l.reps ?? '—'}${l.rpe ? ` @${l.rpe}` : ''}`)

    const ctx = [
      `Hoje: ${spDate()}. ${profileText(tp)}`,
      `Sessão #${s.id} em ${s.local_date}: ${s.title} (${s.sport}, ${s.intensity}, ${s.duration_min ?? '—'} min${s.distance_km ? `, ${s.distance_km} km` : ''}), status ${s.status}. Notas: ${target.notes ?? '—'}. Estrutura: ${JSON.stringify(target.structure ?? [])}.`,
      exercises.length ? `Exercícios: ${exercises.map((e) => `${e.name} ${e.sets}x${e.reps}${e.rpe_target ? ` @RPE ${e.rpe_target}` : ''}${e.load_kg ? ` ${e.load_kg} kg` : ''} (último: ${lastBy.get(e.name) ?? 'sem registro'})`).join(' | ')}` : 'Sem exercícios de força.',
    ].join('\n')
    const history = (body.history ?? []).slice(-8).map((h) => `${h.role === 'assistant' ? 'ClaudIA' : 'Usuário'}: ${String(h.content).slice(0, 800)}`).join('\n')
    const { data } = await callJson({
      model: MODELS.smart, maxTokens: 1800, system: system(RULES),
      content: `${ctx}\n\nConversa até aqui:\n${history || '(início)'}\n\nUsuário: ${message}`,
      tag: 'reply', validate: validateReply, feature: 'coach-session', userId, effort: 'low',
    })
    return json(200, { ...data, prompt_version: PROMPT_VERSION, disclaimer: DISCLAIMER })
  } catch (e) {
    console.error('coach-session', e)
    return json(502, { error: (e as Error).message })
  }
})
