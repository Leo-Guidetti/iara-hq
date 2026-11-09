// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// claudia-checkin · check-in semanal com nota de 0 a 100.
//   POST { week_start?: 'YYYY-MM-DD' } → { checkin }   (Sonnet 5.5; 1 por semana em weekly_checkins, refaz se pedir de novo)
// A nota é determinística (pesagens, proteína, treinos, registro alimentar, medidas/fotos); a IA escreve o texto.
import { authenticate, json, CORS, spDate, addDays, weekStart, DISCLAIMER } from '../_shared/claudia/common.ts';
import { callJson, MODELS, system } from '../_shared/claudia/ai.ts';
import { arr, obj, str, strList } from '../_shared/claudia/validate.ts';
import { trainingSummary } from '../_shared/claudia/training.ts';
const PROMPT_VERSION = 'checkin@3';
const RULES = `Tarefa: check-in semanal. Você recebe números já calculados da semana e a nota (não recalcule a nota).
Seja específico com os números, reconheça o que foi bem, aponte no máximo 3 pontos de atenção e dê 3 próximos passos concretos para a semana que vem, cada um com o porquê.
Interprete peso pela média de 7 dias, nunca por um dia isolado. Se faltar dado (sem medida, sem registro), diga que falta em vez de concluir.
Formato: <checkin>{"headline": "uma frase", "narrative": "1 parágrafo", "wins": ["..."], "watch_outs": ["..."], "next_steps": [{"text": "...", "why": "..."}], "focus_of_week": "uma frase", "refs": ["..."]}</checkin>`;
function validate(v) {
  const o = obj(v);
  return {
    headline: str(o.headline, 'headline', 240),
    narrative: str(o.narrative, 'narrative', 2500),
    wins: strList(o.wins ?? [], 'wins', 5),
    watch_outs: strList(o.watch_outs ?? [], 'watch_outs', 4),
    next_steps: arr(o.next_steps ?? [], 'next_steps').slice(0, 4).map((x, i)=>{
      const n = obj(x, `next_steps[${i}]`);
      return {
        text: str(n.text, 'text', 300),
        why: str(n.why, 'why', 400)
      };
    }),
    focus_of_week: str(o.focus_of_week, 'focus_of_week', 300),
    refs: strList(o.refs ?? [], 'refs', 5)
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
  // por padrão, a última semana completa
  const ws = body.week_start && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start) ? weekStart(body.week_start) : addDays(weekStart(today), -7);
  const we = addDays(ws, 6);
  const [{ data: weights }, { data: trend }, { data: food }, { data: diet }, { data: meas }, { data: photos }, { data: daily }, { data: meds }, { data: prev }] = await Promise.all([
    db.from('weight_entries').select('local_date').gte('local_date', ws).lte('local_date', we),
    db.from('weight_with_trend').select('local_date, trend_7d').gte('local_date', addDays(ws, -7)).lte('local_date', we).order('local_date'),
    db.from('food_logs').select('local_date, kcal, protein_g').gte('local_date', ws).lte('local_date', we),
    db.from('diet_recommendations').select('kcal_target, protein_g_target').order('created_at', {
      ascending: false
    }).limit(1).maybeSingle(),
    db.from('measurements').select('local_date, waist_cm').gte('local_date', addDays(ws, -7)).lte('local_date', we),
    db.from('progress_photos').select('local_date').gte('local_date', addDays(ws, -7)).lte('local_date', we),
    db.from('daily_activity').select('steps, sleep_min, resting_hr').gte('local_date', ws).lte('local_date', we),
    db.from('medication_logs').select('local_date, drug, dose_mg, side_effects').gte('local_date', ws).lte('local_date', we),
    db.from('weekly_checkins').select('week_start, score').lt('week_start', ws).order('week_start', {
      ascending: false
    }).limit(1).maybeSingle()
  ]);
  const hist = await trainingSummary(db, addDays(we, 1), 7);
  const weighDays = new Set((weights ?? []).map((w)=>w.local_date)).size;
  const perDay = new Map();
  for (const f of food ?? []){
    const d = perDay.get(f.local_date) ?? {
      kcal: 0,
      p: 0
    };
    d.kcal += f.kcal ?? 0;
    d.p += Number(f.protein_g ?? 0);
    perDay.set(f.local_date, d);
  }
  const foodDays = [
    ...perDay.values()
  ].filter((d)=>d.kcal >= 600);
  const pTarget = diet?.protein_g_target ?? null;
  const proteinHit = pTarget ? foodDays.filter((d)=>d.p >= pTarget * 0.9).length : 0;
  const avgP = foodDays.length ? Math.round(foodDays.reduce((a, d)=>a + d.p, 0) / foodDays.length) : null;
  const avgK = foodDays.length ? Math.round(foodDays.reduce((a, d)=>a + d.kcal, 0) / foodDays.length) : null;
  const tStart = trend?.find((t)=>t.local_date >= ws)?.trend_7d, tEnd = trend?.at(-1)?.trend_7d;
  const bodyCheck = (meas?.length ?? 0) + (photos?.length ?? 0) > 0;
  const parts = {
    pesagens: Math.round(20 * Math.min(1, weighDays / 7)),
    proteina: pTarget && foodDays.length ? Math.round(25 * (proteinHit / Math.max(foodDays.length, 4))) : 0,
    treinos: hist.planned ? Math.round(35 * Math.min(1, hist.done / hist.planned)) : 0,
    registro: Math.round(10 * Math.min(1, foodDays.length / 7)),
    corpo: bodyCheck ? 10 : 0
  };
  const score = Object.values(parts).reduce((a, b)=>a + b, 0);
  const steps = (daily ?? []).filter((d)=>d.steps != null);
  const prompt = [
    `Semana ${ws} a ${we}. Nota calculada: ${score}/100 (${Object.entries(parts).map(([k, v])=>`${k} ${v}`).join(', ')}). Semana anterior: ${prev ? `${prev.score} (${prev.week_start})` : 'sem check-in'}.`,
    `Peso-tendência: ${tStart ?? '—'} → ${tEnd ?? '—'} kg; pesagens ${weighDays}/7.`,
    `Alimentação: ${foodDays.length}/7 dias registrados; média ${avgK ?? '—'} kcal e ${avgP ?? '—'} g de proteína; meta ${diet?.kcal_target ?? '—'} kcal / ${pTarget ?? '—'} g; proteína na meta em ${proteinHit} dias.`,
    hist.text,
    `Medidas/fotos na semana (ou na anterior): ${bodyCheck ? `${meas?.map((m)=>`${m.local_date} cintura ${m.waist_cm}`).join(', ') || ''} ${photos?.length ? `${photos.length} fotos` : ''}` : 'nenhuma'}.`,
    `Apple Watch: ${steps.length ? `${Math.round(steps.reduce((a, d)=>a + (d.steps ?? 0), 0) / steps.length)} passos/dia em ${steps.length} dias` : 'sem dados'}.`,
    `Medicação: ${meds?.map((m)=>`${m.local_date} ${m.drug} ${m.dose_mg} mg${m.side_effects?.length ? ` (${m.side_effects.join(', ')})` : ''}`).join('; ') || 'nenhuma registrada'}.`
  ].join('\n');
  try {
    const { data } = await callJson({
      model: MODELS.smart,
      maxTokens: 2500,
      system: system(RULES),
      content: prompt,
      tag: 'checkin',
      validate,
      feature: 'checkin',
      userId,
      effort: 'low'
    });
    const payload = {
      ...data,
      score_parts: parts,
      disclaimer: DISCLAIMER
    };
    const { data: existing } = await db.from('weekly_checkins').select('id').eq('week_start', ws).maybeSingle();
    const q = existing ? db.from('weekly_checkins').update({
      score,
      payload,
      model: MODELS.smart,
      prompt_version: PROMPT_VERSION
    }).eq('id', existing.id) : db.from('weekly_checkins').insert({
      user_id: userId,
      week_start: ws,
      score,
      payload,
      model: MODELS.smart,
      prompt_version: PROMPT_VERSION
    });
    const { data: row, error } = await q.select().single();
    if (error) throw new Error(error.message);
    return json(200, {
      checkin: row
    });
  } catch (e) {
    console.error('checkin', e);
    return json(502, {
      error: e.message
    });
  }
});
