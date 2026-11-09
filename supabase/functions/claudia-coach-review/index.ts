// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// claudia-coach-review · revisão semanal do treino com propostas de ajuste.
//   POST { action: 'review', week_start?: 'YYYY-MM-DD', trigger?: 'manual'|'auto' } → IA (Sonnet 5.5), grava coach_reviews (1 por semana)
//   POST { action: 'apply', review_id, index, decision: 'accept'|'reject' }         → sem IA: aplica ou descarta a proposta
// Sinais (aderência, RPE acima do alvo) são calculados no código; a IA só redige as propostas.
import { authenticate, json, CORS, spDate, addDays, weekStart, DISCLAIMER } from '../_shared/claudia/common.ts';
import { callJson, MODELS, system } from '../_shared/claudia/ai.ts';
import { arr, num, obj, oneOf, optStr, str, strList } from '../_shared/claudia/validate.ts';
import { activePlan, exercisesOf, profileText, trainingSummary, validateExercise, WEEKDAY_PT } from '../_shared/claudia/training.ts';
const PROMPT_VERSION = 'coach-review@2';
const RULES = `Tarefa: revisão semanal do treino. Você recebe sinais já calculados (aderência, RPE acima do alvo, cargas) e as próximas sessões.
Proponha no máximo 4 ajustes concretos e seguros, cada um com o porquê baseado nos dados (autorregulação por RPE, dupla progressão, deload quando a fadiga acumula, encaixar sessões perdidas sem empilhar carga).
Tipos:
- "session": muda UMA sessão futura (session_id da lista de próximas). patch pode ter title, duration_min, intensity, notes, exercises.
- "template": muda os exercícios de um dia de força do plano (strength_day_index), valendo para as próximas semanas.
Formato: <review>{"summary": "3–5 frases", "proposals": [{"kind": "session"|"template", "session_id"?: int, "strength_day_index"?: int, "why": "...", "patch": {...}}], "refs": ["..."]}</review>`;
function validator(futureIds, nDays) {
  return (v)=>{
    const o = obj(v);
    const proposals = arr(o.proposals ?? [], 'proposals').slice(0, 4).map((p, i)=>{
      const x = obj(p, `proposals[${i}]`);
      const kind = oneOf(x.kind, `proposals[${i}].kind`, [
        'session',
        'template'
      ]);
      const patch = obj(x.patch, `proposals[${i}].patch`);
      const clean = {};
      if (patch.exercises != null) clean.exercises = arr(patch.exercises, 'exercises').slice(0, 12).map((e, j)=>validateExercise(e, `proposals[${i}].patch.exercises[${j}]`));
      if (kind === 'session') {
        const id = Math.round(num(x.session_id, `proposals[${i}].session_id`));
        if (!futureIds.has(id)) throw new Error(`proposals[${i}].session_id ${id} não está entre as próximas sessões`);
        if (patch.title != null) clean.title = str(patch.title, 'title', 120);
        if (patch.duration_min != null) clean.duration_min = Math.round(num(patch.duration_min, 'duration_min', 5, 480));
        if (patch.intensity != null) clean.intensity = str(patch.intensity, 'intensity', 20);
        if (patch.notes != null) clean.notes = optStr(patch.notes, 'notes', 600);
        if (!Object.keys(clean).length) throw new Error(`proposals[${i}].patch vazio`);
        return {
          kind,
          session_id: id,
          why: str(x.why, 'why', 800),
          patch: clean
        };
      }
      const idx = Math.round(num(x.strength_day_index, `proposals[${i}].strength_day_index`, 0, Math.max(0, nDays - 1)));
      if (!clean.exercises) throw new Error(`proposals[${i}]: template precisa de exercises`);
      return {
        kind,
        strength_day_index: idx,
        why: str(x.why, 'why', 800),
        patch: clean
      };
    });
    return {
      summary: str(o.summary, 'summary', 1500),
      proposals,
      refs: strList(o.refs ?? [], 'refs', 6)
    };
  };
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  if (req.method !== 'POST') return json(405, {
    error: 'Use POST.'
  });
  const who = await authenticate(req);
  if (who instanceof Response) return who;
  const { db, userId } = who;
  const body = await req.json().catch(()=>({}));
  const today = spDate();
  try {
    if (body.action === 'apply') {
      const { data: rv } = await db.from('coach_reviews').select('*').eq('id', Number(body.review_id)).maybeSingle();
      if (!rv) return json(404, {
        error: 'Revisão não encontrada.'
      });
      const proposals = rv.payload.proposals ?? [];
      const i = Number(body.index);
      const p = proposals[i];
      if (!p) return json(400, {
        error: 'Proposta inexistente.'
      });
      const decisions = {
        ...rv.decisions
      };
      if (decisions[i]) return json(409, {
        error: 'Proposta já decidida.'
      });
      const decision = oneOf(body.decision, 'decision', [
        'accept',
        'reject'
      ]);
      if (decision === 'accept') {
        if (p.kind === 'session') {
          const { data: s } = await db.from('plan_sessions').select('*').eq('id', p.session_id).maybeSingle();
          if (!s) return json(404, {
            error: 'Sessão da proposta não existe mais.'
          });
          const target = {
            ...s.target,
            ...p.patch.exercises ? {
              exercises: p.patch.exercises
            } : {},
            ...p.patch.notes !== undefined ? {
              notes: p.patch.notes
            } : {}
          };
          const upd = {
            target,
            edited: true
          };
          for (const k of [
            'title',
            'duration_min',
            'intensity'
          ])if (p.patch[k] !== undefined) upd[k] = p.patch[k];
          const { error } = await db.from('plan_sessions').update(upd).eq('id', s.id);
          if (error) throw new Error(error.message);
          await db.from('plan_changes').insert({
            user_id: userId,
            plan_id: s.plan_id,
            session_id: s.id,
            local_date: s.local_date,
            scope: 'session',
            source: 'ai',
            summary: `Revisão semanal: ${p.why}`.slice(0, 4000),
            before: {
              title: s.title,
              target: s.target
            },
            after: upd
          });
        } else {
          const cur = await activePlan(db);
          if (!cur) return json(400, {
            error: 'Nenhum plano ativo.'
          });
          const plan = structuredClone(cur.plan);
          const before = plan.days[p.strength_day_index];
          if (!before) return json(400, {
            error: 'Dia de força inexistente no plano ativo.'
          });
          plan.days[p.strength_day_index] = {
            ...before,
            exercises: p.patch.exercises
          };
          const { error } = await db.from('workout_plans').update({
            plan: plan
          }).eq('id', cur.id);
          if (error) throw new Error(error.message);
          await db.from('plan_changes').insert({
            user_id: userId,
            plan_id: cur.id,
            local_date: today,
            scope: 'template',
            source: 'ai',
            summary: `Revisão semanal (${before.label}): ${p.why}`.slice(0, 4000),
            before: before,
            after: plan.days[p.strength_day_index]
          });
        }
      }
      decisions[i] = {
        decision,
        at: new Date().toISOString()
      };
      const { data: updated, error } = await db.from('coach_reviews').update({
        decisions
      }).eq('id', rv.id).select().single();
      if (error) throw new Error(error.message);
      return json(200, {
        review: updated
      });
    }
    if (body.action !== 'review') return json(400, {
      error: 'action deve ser review ou apply.'
    });
    // semana revisada: a última completa (segunda a domingo) se não informada
    const ws = body.week_start && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start) ? weekStart(body.week_start) : addDays(weekStart(today), -7);
    const we = addDays(ws, 6);
    const cur = await activePlan(db);
    const plan = cur?.plan ?? null;
    const [{ data: tp }, hist, { data: next }] = await Promise.all([
      db.from('training_profiles').select('*').eq('user_id', userId).maybeSingle(),
      trainingSummary(db, addDays(we, 1), 21),
      db.from('plan_sessions').select('id, local_date, title, sport, intensity, duration_min, target, plan_id').gte('local_date', today).lte('local_date', addDays(today, 10)).eq('status', 'planned').order('local_date')
    ]);
    // sinais determinísticos
    const signals = [];
    const week = hist.sessions.filter((s)=>s.local_date >= ws && s.local_date <= we);
    const done = week.filter((s)=>s.status === 'done').length;
    signals.push({
      area: 'aderência',
      level: week.length && done / week.length < 0.7 ? 'warn' : 'ok',
      text: `Semana ${ws}: ${done}/${week.length} sessões feitas.`
    });
    const targets = new Map();
    for (const d of plan?.days ?? [])for (const e of d.exercises)if (e.rpe_target) targets.set(e.name, e.rpe_target);
    // maior RPE do último dia em que cada exercício foi feito (logs vêm em ordem cronológica)
    const lastDay = new Map();
    for (const l of hist.logs)lastDay.set(l.exercise, l.local_date);
    const lastRpe = new Map();
    for (const l of hist.logs){
      if (l.rpe == null || l.local_date !== lastDay.get(l.exercise)) continue;
      lastRpe.set(l.exercise, Math.max(lastRpe.get(l.exercise) ?? 0, Number(l.rpe)));
    }
    for (const [ex, rpe] of lastRpe){
      const t = targets.get(ex);
      if (t && rpe >= t + 1.5) signals.push({
        area: 'força',
        level: 'warn',
        text: `${ex}: RPE ${rpe} na última vez, alvo ${t}.`
      });
    }
    const upcoming = (next ?? []).map((s)=>`#${s.id} ${s.local_date} (${WEEKDAY_PT[(new Date(`${s.local_date}T12:00:00Z`).getUTCDay() + 6) % 7]}) ${s.title} ${s.duration_min ?? '—'} min; exercícios ${JSON.stringify(exercisesOf(s.target, plan).map((e)=>[
          e.name,
          e.sets,
          e.reps,
          e.load_kg,
          e.rpe_target
        ]))}`);
    const prompt = [
      `Hoje: ${today}. Semana revisada: ${ws} a ${we}.`,
      profileText(tp),
      hist.text,
      `Sinais calculados: ${signals.map((s)=>`[${s.level}] ${s.text}`).join(' | ')}`,
      `Dias de força do plano: ${JSON.stringify((plan?.days ?? []).map((d, i)=>({
          i,
          label: d.label,
          exercises: d.exercises.map((e)=>[
              e.name,
              e.sets,
              e.reps,
              e.load_kg,
              e.rpe_target
            ])
        })))}`,
      `Próximas sessões: ${upcoming.join(' | ') || 'nenhuma'}`
    ].join('\n');
    const { data } = await callJson({
      model: MODELS.smart,
      maxTokens: 4000,
      system: system(RULES),
      content: prompt,
      tag: 'review',
      validate: validator(new Set((next ?? []).map((s)=>s.id)), plan?.days.length ?? 0),
      feature: 'coach-review',
      userId,
      effort: 'medium'
    });
    const payload = {
      summary: data.summary,
      signals,
      proposals: data.proposals,
      refs: data.refs,
      prompt_version: PROMPT_VERSION,
      disclaimer: DISCLAIMER
    };
    const trigger = body.trigger === 'auto' ? 'auto' : 'manual';
    const { data: existing } = await db.from('coach_reviews').select('id').eq('week_start', ws).maybeSingle();
    const q = existing ? db.from('coach_reviews').update({
      payload,
      decisions: {},
      model: MODELS.smart,
      trigger
    }).eq('id', existing.id) : db.from('coach_reviews').insert({
      user_id: userId,
      week_start: ws,
      payload,
      decisions: {},
      model: MODELS.smart,
      trigger
    });
    const { data: row, error } = await q.select().single();
    if (error) throw new Error(error.message);
    return json(200, {
      review: row
    });
  } catch (e) {
    console.error('coach-review', e);
    return json(502, {
      error: e.message
    });
  }
});
