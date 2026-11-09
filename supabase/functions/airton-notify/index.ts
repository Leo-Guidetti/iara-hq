// AIrton — notificações push. O pg_cron chama a cada 15 min; aqui decide se é hora da
// diária (padrão 22h) ou da semanal (padrão domingo 19h) e manda para os aparelhos inscritos.
// Ações do app: vapid (chave pública) | test {kind} | preview {kind}.
import { addDays, admin, authenticate, brl, CORS, json, kvGet, kvSet, memberIds, spDate } from './_shared/common.ts';
import { generateVapidKeys, sendWebPush } from './_shared/webpush.ts';
const DEFAULT = {
  dailyEnabled: true,
  dailyTime: '22:00',
  weeklyEnabled: true,
  weeklyDow: 0,
  weeklyTime: '19:00'
};
async function vapid() {
  const k = await kvGet('vapid');
  if (k) return k;
  const keys = await generateVapidKeys();
  await kvSet('vapid', keys);
  return keys;
}
function localNow(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  }).formatToParts(d);
  const g = (t)=>p.find((x)=>x.type === t)?.value ?? '';
  return {
    date: spDate(d),
    minutes: Number(g('hour')) % 24 * 60 + Number(g('minute')),
    dow: [
      'Sun',
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat'
    ].indexOf(g('weekday'))
  };
}
const due = (now, hhmm)=>{
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + (m || 0);
  return now >= t && now < t + 180;
};
const pct = (v)=>v >= 1 ? `${(1 + v).toLocaleString('pt-BR', {
    maximumFractionDigits: 1
  })}×` : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const plural = (n, a, b)=>`${n} ${n === 1 ? a : b}`;
async function rpc(fn, args) {
  const { data, error } = await admin().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}
async function ofProblem(userId) {
  const { data } = await admin().from('of_items').select('connector_name,last_error,pluggy_updated_at').eq('user_id', userId);
  for (const i of data ?? []){
    if (i.last_error) return `Open Finance (${i.connector_name}): ${i.last_error}`;
    if (i.pluggy_updated_at && Date.now() - Date.parse(i.pluggy_updated_at) > 48 * 3_600_000) return `Open Finance parado desde ${new Date(i.pluggy_updated_at).toLocaleDateString('pt-BR')} — renove no Meu Pluggy.`;
  }
  return null;
}
export async function composeDaily(userId) {
  const today = spDate();
  const mp = await rpc('month_plan', {
    p_user: userId
  });
  const rc = await rpc('review_counts', {
    p_user: userId
  });
  const { data: tx } = await admin().from('v_tx').select('date,spend,nature').eq('user_id', userId).gte('date', addDays(today, -1)).lte('date', today);
  const day = (d)=>(tx ?? []).filter((t)=>t.date === d && Number(t.spend) > 0 && ![
        'renda',
        'transferencia',
        'investimento'
      ].includes(t.nature));
  const t0 = day(today), t1 = day(addDays(today, -1));
  const sum = (a)=>a.reduce((s, t)=>s + Number(t.spend), 0);
  const lines = [];
  const avail = Number(mp.available);
  const title = avail >= 0 ? `Disponível: ${brl(avail)}${mp.perDay != null ? ` · ${brl(Number(mp.perDay))}/dia` : ''}` : `Passou do livre do mês em ${brl(-avail)}`;
  lines.push(t0.length ? `Hoje: ${brl(sum(t0))} em ${plural(t0.length, 'gasto', 'gastos')}${t1.length ? ` · ontem ${brl(sum(t1))}` : ''}.` : `Cartão chega pelo Open Finance amanhã; lance o que foi em dinheiro/Pix.${t1.length ? ` Ontem: ${brl(sum(t1))}.` : ''}`);
  if (Number(rc.pending) > 0) lines.push(`${plural(Number(rc.pending), 'lançamento precisa', 'lançamentos precisam')} de você.`);
  else if (Number(rc.unconfirmed) > 0) lines.push(`${plural(Number(rc.unconfirmed), 'lançamento novo', 'lançamentos novos')} para conferir.`);
  const next = (mp.upcoming ?? []).find((u)=>Number(u.amount) < 0);
  if (next) lines.push(`Próximo: ${next.label} ${brl(-Number(next.amount))} (${String(next.date).slice(8, 10)}/${String(next.date).slice(5, 7)}).`);
  const of = await ofProblem(userId);
  if (of) lines.push(of);
  return {
    title,
    body: lines.slice(0, 4).join('\n'),
    url: '/?revisar=1',
    tag: 'daily',
    badge: Number(rc.pending)
  };
}
export async function composeWeekly(userId) {
  const wk = await rpc('week_summary', {
    p_user: userId
  });
  const mp = await rpc('month_plan', {
    p_user: userId
  });
  const yr = await rpc('year_summary', {
    p_user: userId
  });
  const d = wk.deltaPct;
  const title = `Semana: ${brl(Number(wk.spent))}${d != null && Math.abs(d) >= 0.05 ? ` (${pct(d)} ${d >= 1 ? 'o normal' : 'vs normal'})` : ''}`;
  const lines = [
    `Disponível no mês: ${brl(Number(mp.available))}${mp.perDay != null ? ` (${brl(Number(mp.perDay))}/dia)` : ''}.`,
    `Mês: gasto previsto ${brl(Number(mp.projectedSpend), true)}; sobra ${brl(Number(mp.projectedNet), true)}.`
  ];
  if (yr.savingsRate != null) lines.push(`${yr.year}: sobra ${brl(Number(yr.projectedNet), true)} — ${Math.round(yr.savingsRate * 100)}% da renda (meta ${Math.round(yr.targetRate * 100)}%).`);
  const over = (wk.byCategory ?? []).map((c)=>({
      ...c,
      over: Number(c.spent) - Number(c.typical)
    })).filter((c)=>c.over > 80).sort((a, b)=>b.over - a.over)[0];
  if (over) lines.push(`Acima do normal: ${over.name} (+${brl(over.over)}).`);
  return {
    title,
    body: lines.slice(0, 4).join('\n'),
    url: '/mes',
    tag: 'weekly',
    badge: undefined
  };
}
async function send(userId, msg, ttl = 6 * 3600) {
  const db = admin();
  const { data: subs } = await db.from('push_subscriptions').select('*').eq('user_id', userId);
  const keys = await vapid();
  let sent = 0, failed = 0;
  for (const s of subs ?? []){
    const r = await sendWebPush({
      endpoint: s.endpoint,
      keys: {
        p256dh: s.p256dh,
        auth: s.auth
      }
    }, msg, keys, 'mailto:leonardoguidettic@gmail.com', {
      ttl,
      topic: msg.tag
    });
    if (r.ok) {
      sent++;
      await db.from('push_subscriptions').update({
        last_ok_at: new Date().toISOString(),
        failures: 0
      }).eq('id', s.id);
    } else if (r.gone || s.failures >= 7) {
      failed++;
      await db.from('push_subscriptions').delete().eq('id', s.id);
    } else {
      failed++;
      await db.from('push_subscriptions').update({
        failures: s.failures + 1
      }).eq('id', s.id);
    }
  }
  return {
    sent,
    failed
  };
}
async function tick() {
  const now = localNow();
  for (const uid of (await memberIds())){
    const { data: s } = await admin().from('settings').select('value').eq('user_id', uid).eq('key', 'notify').maybeSingle();
    const cfg = {
      ...DEFAULT,
      ...s?.value ?? {}
    };
    const jobs = [
      [
        'daily',
        cfg.dailyEnabled && due(now.minutes, cfg.dailyTime)
      ],
      [
        'weekly',
        cfg.weeklyEnabled && now.dow === cfg.weeklyDow && due(now.minutes, cfg.weeklyTime)
      ]
    ];
    for (const [kind, isDue] of jobs){
      if (!isDue) continue;
      // reserva o envio do dia (único por usuário/tipo/dia) antes de mandar
      const { error } = await admin().from('notify_log').insert({
        user_id: uid,
        kind,
        local_date: now.date
      });
      if (error) continue;
      try {
        const msg = kind === 'daily' ? await composeDaily(uid) : await composeWeekly(uid);
        const r = await send(uid, msg, kind === 'daily' ? 6 * 3600 : 24 * 3600);
        await admin().from('notify_log').update({
          title: msg.title,
          body: msg.body,
          ...r
        }).eq('user_id', uid).eq('kind', kind).eq('local_date', now.date);
      } catch (err) {
        await admin().from('notify_log').update({
          body: `erro: ${err instanceof Error ? err.message : err}`
        }).eq('user_id', uid).eq('kind', kind).eq('local_date', now.date);
      }
    }
  }
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: CORS
  });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  try {
    if (caller.kind === 'cron') {
      await tick();
      return json(200, {
        ok: true
      });
    }
    const body = await req.json().catch(()=>({}));
    if (body.action === 'vapid') return json(200, {
      publicKey: (await vapid()).publicKey
    });
    const msg = body.kind === 'weekly' ? await composeWeekly(caller.userId) : body.kind === 'daily' ? await composeDaily(caller.userId) : {
      title: 'AIrton',
      body: 'Notificações funcionando neste aparelho.',
      url: '/',
      tag: 'ping'
    };
    if (body.action === 'preview') return json(200, {
      message: msg
    });
    const r = await send(caller.userId, msg);
    return json(200, {
      ok: r.sent > 0,
      ...r,
      message: msg
    });
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : String(err)
    });
  }
});
