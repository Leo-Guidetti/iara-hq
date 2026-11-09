// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// claudia-strava · integração com o Strava. Secrets: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.
//   POST { action: 'status' }                         → strava_status()
//   POST { action: 'connect', redirect_uri, state }   → { url } de autorização (o callback volta para o app)
//   POST { action: 'exchange', code }                 → troca o code por tokens (strava_save_tokens) e sincroniza
//   POST { action: 'sync', days? }                    → importa atividades para public.activities (upsert por external_id)
//   POST { action: 'disconnect' }                     → strava_disconnect() (apaga tokens e atividades do Strava)
// Os tokens ficam em private.strava_tokens e só passam pelas funções strava_* com o JWT do usuário.
import { authenticate, json, CORS, addDays } from '../_shared/claudia/common.ts';
const API = 'https://www.strava.com/api/v3';
const SPORT = {
  Run: 'run',
  TrailRun: 'run',
  VirtualRun: 'run',
  Walk: 'walk',
  Hike: 'hike',
  Swim: 'swim',
  Ride: 'ride_outdoor',
  MountainBikeRide: 'ride_outdoor',
  GravelRide: 'ride_outdoor',
  EBikeRide: 'ride_outdoor',
  VirtualRide: 'ride_indoor',
  WeightTraining: 'strength',
  Crossfit: 'hiit',
  HighIntensityIntervalTraining: 'hiit',
  Yoga: 'yoga',
  Pilates: 'mobility',
  Rowing: 'row',
  VirtualRow: 'row'
};
const FAMILY = {
  ride_indoor: 'ride',
  ride_outdoor: 'ride',
  walk: 'walk',
  hike: 'walk'
};
const fam = (s)=>FAMILY[s] ?? s;
async function tokenRequest(params) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      client_id: Deno.env.get('STRAVA_CLIENT_ID'),
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET'),
      ...params
    })
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Strava ${res.status}: ${j.message ?? 'falha no token'}`);
  return j;
}
async function accessToken(db) {
  const { data, error } = await db.rpc('strava_get_tokens');
  if (error) throw new Error(error.message);
  const t = data?.[0];
  if (!t) throw new Error('Strava não conectado.');
  if (new Date(t.expires_at).getTime() - Date.now() > 5 * 60_000) return t.access_token;
  const r = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token
  });
  const { error: e2 } = await db.rpc('strava_update_tokens', {
    p_access: r.access_token,
    p_refresh: r.refresh_token,
    p_expires_at: new Date(r.expires_at * 1000).toISOString()
  });
  if (e2) throw new Error(e2.message);
  return r.access_token;
}
async function sync(db, userId, days) {
  const token = await accessToken(db);
  const { data: st } = await db.rpc('strava_status');
  const last = st?.last_sync_at;
  const after = Math.floor((last ? Math.min(Date.parse(last) - 3 * 864e5, Date.now()) : Date.now() - days * 864e5) / 1000);
  const all = [];
  for(let page = 1; page <= 5; page++){
    const res = await fetch(`${API}/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    if (!res.ok) throw new Error(`Strava ${res.status} ao listar atividades`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  const rows = all.map((a)=>{
    const sport = SPORT[String(a.sport_type ?? a.type)] ?? 'other';
    const local = String(a.start_date_local ?? a.start_date).slice(0, 10);
    const minutes = Math.max(1, Math.round(Number(a.moving_time ?? a.elapsed_time ?? 60) / 6) / 10);
    const kj = a.kilojoules == null ? null : Number(a.kilojoules);
    return {
      user_id: userId,
      source: 'strava',
      external_id: String(a.id),
      started_at: String(a.start_date),
      local_date: local,
      sport,
      title: String(a.name ?? '').slice(0, 200) || null,
      duration_min: Math.min(1440, minutes),
      distance_km: a.distance ? Math.round(Number(a.distance) / 10) / 100 : null,
      elevation_m: a.total_elevation_gain == null ? null : Math.round(Number(a.total_elevation_gain)),
      avg_hr: a.average_heartrate ? Math.round(Number(a.average_heartrate)) : null,
      max_hr: a.max_heartrate ? Math.round(Number(a.max_heartrate)) : null,
      avg_power_w: a.average_watts ? Math.round(Number(a.average_watts)) : null,
      avg_cadence: a.average_cadence ? Math.round(Number(a.average_cadence)) : null,
      kcal: kj ? Math.round(kj) : null,
      kcal_estimated: true,
      load: a.suffer_score == null ? null : Number(a.suffer_score),
      details: {
        strava_type: a.sport_type ?? a.type,
        moving_time_s: a.moving_time,
        elapsed_time_s: a.elapsed_time,
        average_speed: a.average_speed,
        trainer: a.trainer ?? null
      }
    };
  });
  if (rows.length) {
    const { error } = await db.from('activities').upsert(rows, {
      onConflict: 'user_id,source,external_id'
    });
    if (error) throw new Error(error.message);
  }
  // liga cada atividade nova a uma sessão planejada do mesmo dia e esporte (só se houver exatamente uma)
  let linked = 0;
  const minDate = rows.length ? rows.map((r)=>r.local_date).sort()[0] : addDays(new Date().toISOString().slice(0, 10), -days);
  const [{ data: acts }, { data: sessions }] = await Promise.all([
    db.from('activities').select('id, local_date, sport').eq('source', 'strava').is('plan_session_id', null).gte('local_date', minDate),
    db.from('plan_sessions').select('id, local_date, sport, status').gte('local_date', minDate).eq('status', 'planned')
  ]);
  for (const a of acts ?? []){
    const cand = (sessions ?? []).filter((s)=>s.local_date === a.local_date && fam(s.sport) === fam(a.sport) && s.status === 'planned');
    if (cand.length !== 1) continue;
    await db.from('activities').update({
      plan_session_id: cand[0].id
    }).eq('id', a.id);
    await db.from('plan_sessions').update({
      status: 'done'
    }).eq('id', cand[0].id);
    cand[0].status = 'done';
    linked++;
  }
  await db.rpc('strava_mark_synced');
  return {
    imported: rows.length,
    linked
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
  try {
    switch(body.action){
      case 'status':
        {
          const { data, error } = await db.rpc('strava_status');
          if (error) throw new Error(error.message);
          return json(200, data);
        }
      case 'connect':
        {
          const id = Deno.env.get('STRAVA_CLIENT_ID');
          if (!id) return json(500, {
            error: 'STRAVA_CLIENT_ID não configurado.'
          });
          const redirect = String(body.redirect_uri ?? '');
          if (!/^https:\/\/[^/]+\/treino\/strava$/.test(redirect) && !/^http:\/\/localhost(:\d+)?\/treino\/strava$/.test(redirect)) return json(400, {
            error: 'redirect_uri inválida.'
          });
          const u = new URL('https://www.strava.com/oauth/mobile/authorize');
          u.search = new URLSearchParams({
            client_id: id,
            response_type: 'code',
            redirect_uri: redirect,
            approval_prompt: 'auto',
            scope: 'read,activity:read_all',
            state: String(body.state ?? '').slice(0, 64)
          }).toString();
          return json(200, {
            url: u.toString()
          });
        }
      case 'exchange':
        {
          if (!body.code) return json(400, {
            error: 'code ausente.'
          });
          const r = await tokenRequest({
            grant_type: 'authorization_code',
            code: body.code
          });
          if (!r.athlete) throw new Error('Resposta do Strava sem atleta.');
          const { error } = await db.rpc('strava_save_tokens', {
            p_athlete_id: r.athlete.id,
            p_athlete_name: [
              r.athlete.firstname,
              r.athlete.lastname
            ].filter(Boolean).join(' '),
            p_access: r.access_token,
            p_refresh: r.refresh_token,
            p_expires_at: new Date(r.expires_at * 1000).toISOString(),
            p_scope: r.scope ?? 'read,activity:read_all'
          });
          if (error) throw new Error(error.message);
          return json(200, await sync(db, userId, 60));
        }
      case 'sync':
        return json(200, await sync(db, userId, Math.min(180, Math.max(1, body.days ?? 30))));
      case 'disconnect':
        {
          const { error } = await db.rpc('strava_disconnect');
          if (error) throw new Error(error.message);
          return json(200, {
            connected: false
          });
        }
      default:
        return json(400, {
          error: 'action inválida.'
        });
    }
  } catch (e) {
    console.error('strava', e);
    return json(502, {
      error: e.message
    });
  }
});
