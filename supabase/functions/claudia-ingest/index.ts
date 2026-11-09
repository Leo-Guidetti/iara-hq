// claudia-ingest · entrada de dados pelo Atalho do iPhone (Shortcuts). Autentica pelo token de ingestão
// (cla_…, criado no Perfil), enviado em `Authorization: Bearer cla_…` ou `x-claudia-token`. Publicada com verify_jwt = false.
//   POST { weight_kg: 82.4 | "82,4", measured_at?: ISO, source?: 'shortcut'|'apple_health' }       → ingest_weight
//   POST { date?: 'YYYY-MM-DD', steps?, active_kcal?, resting_kcal?, exercise_min?, sleep_min?|sleep_h?, resting_hr?, hrv_ms? } → ingest_health (1 dia)
//   POST { daily?: [ {local_date, ...} ], activities?: [ {started_at, sport, duration_min, ...} ] }  → ingest_health (lote)
// As funções ingest_* validam o token (hash sha-256) e os limites; aqui só normalizamos o formato do Atalho.
import { createClient } from 'npm:@supabase/supabase-js@2.46.1';
import { json, CORS, spDate } from '../_shared/claudia/common.ts';
const anon = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_ANON_KEY'), {
  auth: {
    persistSession: false
  }
});
/** Aceita 82,4 / "82.4" / "82,4 kg". */ const n = (v)=>{
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : Number(String(v).replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : null;
};
const iso = (v)=>{
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const DAILY = [
  'steps',
  'active_kcal',
  'resting_kcal',
  'exercise_min',
  'sleep_min',
  'resting_hr',
  'hrv_ms'
];
function dailyRow(o) {
  const date = String(o.local_date ?? o.date ?? spDate()).slice(0, 10);
  const row = {
    local_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : spDate()
  };
  for (const k of DAILY){
    const x = n(o[k]);
    if (x != null) row[k] = Math.round(x * (k === 'hrv_ms' ? 10 : 1)) / (k === 'hrv_ms' ? 10 : 1);
  }
  const sleepH = n(o.sleep_h);
  if (row.sleep_min == null && sleepH != null) row.sleep_min = Math.round(sleepH * 60);
  return row;
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: CORS
  });
  if (req.method !== 'POST') return json(405, {
    error: 'Use POST.'
  });
  const token = (req.headers.get('x-claudia-token') ?? req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!/^cla_[0-9a-f]{48}$/.test(token)) return json(401, {
    error: 'Token de ingestão ausente ou inválido.'
  });
  const body = await req.json().catch(()=>null);
  if (!body || typeof body !== 'object') return json(400, {
    error: 'JSON inválido.'
  });
  try {
    if (body.weight_kg != null) {
      const kg = n(body.weight_kg);
      if (kg == null) return json(400, {
        error: 'weight_kg inválido.'
      });
      const { data, error } = await anon.rpc('ingest_weight', {
        p_token: token,
        p_weight_kg: kg,
        p_measured_at: iso(body.measured_at) ?? new Date().toISOString(),
        p_source: body.source === 'apple_health' ? 'apple_health' : 'shortcut'
      });
      if (error) return json(error.code === '28000' ? 401 : 400, {
        error: error.message
      });
      return json(200, {
        ok: true,
        weight: data
      });
    }
    const daily = Array.isArray(body.daily) ? body.daily.map(dailyRow) : DAILY.some((k)=>body[k] != null) || body.sleep_h != null ? [
      dailyRow(body)
    ] : [];
    const activities = Array.isArray(body.activities) ? body.activities.map((a)=>({
        ...a,
        started_at: iso(a.started_at),
        duration_min: n(a.duration_min),
        distance_km: n(a.distance_km),
        kcal: n(a.kcal),
        avg_hr: n(a.avg_hr),
        max_hr: n(a.max_hr),
        external_id: a.external_id ?? (a.started_at ? `hk-${iso(a.started_at)}-${a.sport ?? 'other'}` : null)
      })) : [];
    if (!daily.length && !activities.length) return json(400, {
      error: 'Nada para registrar: envie weight_kg, métricas do dia ou activities.'
    });
    const { data, error } = await anon.rpc('ingest_health', {
      p_token: token,
      p_activities: activities,
      p_daily: daily
    });
    if (error) return json(error.code === '28000' ? 401 : 400, {
      error: error.message
    });
    return json(200, {
      ok: true,
      ...data
    });
  } catch (e) {
    console.error('ingest', e);
    return json(500, {
      error: e.message
    });
  }
});
