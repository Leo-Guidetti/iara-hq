// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
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
  weeklyTime: '19:00',
  // Resumo de custo de IA de todos os apps (PROGRESSO 0.5): domingo 20:00 SP.
  costEnabled: true,
  costDow: 0,
  costTime: '20:00',
  // Plano da semana (Etapa 5): a IARA monta domingo 18:00 SP; o push sai 19:30 e o Leo revisa às 20:00.
  semanaEnabled: true,
  semanaDow: 0,
  semanaTime: '19:30'
};
const HUB_URL = 'https://iara-agents-hq.vercel.app';
const AREA_NOME = {
  saude: 'saúde',
  financas: 'finanças',
  aprender: 'estudos',
  casa: 'casa'
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
const APP_NOME = {
  airton: 'AIrton',
  claudia: 'ClaudIA',
  sabia: 'SabIA',
  iara: 'IARA',
  core: 'HQ'
};
// Teto mensal de cada app (o mesmo que o cliente de IA de cada um usa). SabIA e IARA dividem o IARA_*.
const TETO = {
  airton: ['AIRTON', 10],
  claudia: ['CLAUDIA', 5],
  sabia: ['IARA', 10],
  iara: ['IARA', 10],
  core: ['IARA', 10]
};
const usd = (v)=>`US$ ${Number(v).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
export async function composeCost() {
  const r = await rpc('ai_cost_report', {
    p_dias: 7
  });
  const fator = Number(r.dias_no_mes) / Math.max(1, Number(r.dia_do_mes));
  const apps = r.por_app ?? [];
  const semana = apps.filter((a)=>Number(a.semana_usd) >= 0.005).map((a)=>`${APP_NOME[a.app] ?? a.app} ${usd(a.semana_usd)}`);
  const lines = [
    `Mês até agora: ${usd(r.mes_usd)} · projeção ${usd(Number(r.mes_usd) * fator)}.`,
    semana.length ? semana.join(' · ') : 'Nenhum custo de IA na semana.'
  ];
  const top = (r.top_semana ?? [])[0];
  if (top && Number(top.usd) >= 0.005) lines.push(`Maior: ${APP_NOME[top.app] ?? top.app} / ${top.feature} (${usd(top.usd)}).`);
  // Projeção por teto (SabIA, IARA e HQ somados no IARA_AI_BUDGET_USD).
  const porTeto = {};
  for (const a of apps){
    const [pref, padrao] = TETO[a.app] ?? [
      'IARA',
      10
    ];
    porTeto[pref] ??= {
      gasto: 0,
      teto: Number(Deno.env.get(`${pref}_AI_BUDGET_USD`) ?? padrao)
    };
    porTeto[pref].gasto += Number(a.mes_usd);
  }
  const acima = Object.entries(porTeto).filter(([, v])=>v.gasto * fator > v.teto).map(([k, v])=>`${k} ${usd(v.gasto * fator)} / teto ${usd(v.teto)}`);
  if (acima.length) lines.unshift(`Atenção: projeção acima do teto (${acima.join('; ')}).`);
  return {
    title: `IA na semana: ${usd(r.semana_usd)}`,
    body: lines.slice(0, 4).join('\n'),
    url: '/',
    tag: 'custo',
    badge: undefined
  };
}
export async function composeSemana(userId) {
  const r = await rpc('semana_push', {
    p_user: userId
  });
  if (!r || !Number(r.itens)) return null;
  const partes = Object.entries(r.por_area ?? {}).map(([a, n])=>`${n} de ${AREA_NOME[a] ?? a}`);
  return {
    title: 'Sua semana: sugestão e crítica prontas',
    body: `${plural(Number(r.itens), 'sugestão', 'sugestões')} (${partes.join(', ')}) em volta dos seus compromissos. Ajuste e confirme no hub.`,
    url: `${HUB_URL}/semana`,
    tag: 'semana',
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
      ],
      [
        'custo',
        cfg.costEnabled && now.dow === cfg.costDow && due(now.minutes, cfg.costTime)
      ],
      [
        'semana',
        cfg.semanaEnabled && now.dow === cfg.semanaDow && due(now.minutes, cfg.semanaTime)
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
        const msg = kind === 'daily' ? await composeDaily(uid) : kind === 'custo' ? await composeCost() : kind === 'semana' ? await composeSemana(uid) : await composeWeekly(uid);
        // Sem plano da semana (a função não rodou ou falhou): registra e não manda push vazio.
        if (!msg) {
          await admin().from('notify_log').update({
            body: 'sem plano da semana'
          }).eq('user_id', uid).eq('kind', kind).eq('local_date', now.date);
          continue;
        }
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
    const msg = body.kind === 'weekly' ? await composeWeekly(caller.userId) : body.kind === 'daily' ? await composeDaily(caller.userId) : body.kind === 'custo' ? await composeCost() : body.kind === 'semana' ? await composeSemana(caller.userId) ?? {
      title: 'Plano da semana',
      body: 'Ainda não há plano da semana que vem.',
      url: `${HUB_URL}/semana`,
      tag: 'semana'
    } : {
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
