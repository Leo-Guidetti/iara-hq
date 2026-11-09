// @ts-nocheck -- fonte baixado da produção (o Supabase guarda sem tipos). Tirar ao tipar (PROGRESSO 0.2).
// AIrton — Open Finance (Meu Pluggy) rodando no servidor.
// Ações: connect_token | add_item | remove_item | sync. O pg_cron chama `sync` 2x por dia
// para todos os membros; o app chama ao abrir (se o último sync tiver mais de 3 h) e no botão.
import { addDays, admin, authenticate, CORS, json, memberIds, spDate } from './_shared/common.ts';
import { categorize, merchantKey } from './_shared/categorize.ts';
const PLUGGY = 'https://api.pluggy.ai';
let cachedKey = null;
async function pluggyKey() {
  if (cachedKey && cachedKey.exp > Date.now()) return cachedKey.key;
  const id = Deno.env.get('PLUGGY_CLIENT_ID');
  const secret = Deno.env.get('PLUGGY_CLIENT_SECRET');
  if (!id || !secret) throw new Error('Open Finance não configurado: defina PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no Supabase.');
  const res = await fetch(`${PLUGGY}/auth`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clientId: id,
      clientSecret: secret
    })
  });
  if (!res.ok) throw new Error(`Pluggy /auth ${res.status}`);
  const { apiKey } = await res.json();
  cachedKey = {
    key: apiKey,
    exp: Date.now() + 100 * 60_000
  };
  return apiKey;
}
async function pg(path, init = {}) {
  const key = await pluggyKey();
  const res = await fetch(`${PLUGGY}/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': key,
      ...init.headers ?? {}
    }
  });
  if (!res.ok) throw new Error(`Pluggy ${path.split('?')[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}
const localDate = (iso)=>new Date(iso).toLocaleDateString('sv-SE', {
    timeZone: 'America/Sao_Paulo'
  });
const days = (a, b)=>Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86_400_000;
const lastFour = (n)=>{
  const d = (n ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
};
function institutionOf(s) {
  const n = s.toLowerCase();
  if (/nubank|nu pagamentos|\bnu\b|platinum|ultravioleta/.test(n)) return 'nubank';
  if (/\bxp\b|xp invest|banco xp/.test(n)) return 'xp';
  if (/ita[uú]/.test(n)) return 'itau';
  return 'outros';
}
function similar(a, b) {
  const ka = new Set(merchantKey(a).split(' ').filter(Boolean));
  const kb = merchantKey(b).split(' ').filter(Boolean);
  if (ka.size === 0 || kb.length === 0) return true;
  return kb.some((w)=>ka.has(w) || [
      ...ka
    ].some((x)=>x.length >= 4 && w.length >= 4 && (x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4)))));
}
function parseInst(desc) {
  const m = /(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i.exec(desc.trim());
  if (!m) return null;
  const n = Number(m[1]), t = Number(m[2]);
  return t > 1 && n >= 1 && n <= t ? {
    n,
    t
  } : null;
}
async function syncUser(userId, onlyItem) {
  const db = admin();
  const { data: items } = await db.from('of_items').select('*').eq('user_id', userId);
  const { data: lastSetting } = await db.from('settings').select('value').eq('user_id', userId).eq('key', 'investment_last4').maybeSingle();
  const investLast4 = new Set((lastSetting?.value ?? [
    '3067'
  ]).map(String));
  const today = spDate();
  const summary = [];
  for (const item of (items ?? []).filter((i)=>!onlyItem || i.id === onlyItem)){
    const res = {
      item: item.connector_name,
      inserted: 0,
      linked: 0,
      reIdentified: 0,
      duplicates: 0,
      error: null,
      categorize: null
    };
    try {
      const pItem = await pg(`items/${item.id}`);
      const connector = pItem.connector?.name ?? item.connector_name;
      const { results: pAccounts } = await pg(`accounts?itemId=${item.id}`);
      const { data: myAccounts } = await db.from('accounts').select('*').eq('user_id', userId);
      const accounts = [
        ...myAccounts ?? []
      ];
      const instGuess = [
        ...new Set(pAccounts.map((a)=>institutionOf(`${connector} ${a.name} ${a.marketingName ?? ''}`)).filter((x)=>x !== 'outros'))
      ];
      const itemInst = instGuess.length === 1 ? instGuess[0] : 'outros';
      const cursors = {
        ...item.cursors ?? {}
      };
      const newTx = [];
      for (const pa of pAccounts){
        const type = pa.type === 'CREDIT' || pa.subtype === 'CREDIT_CARD' ? 'credit' : 'checking';
        const l4 = lastFour(pa.number);
        let inst = institutionOf(`${connector} ${pa.name} ${pa.marketingName ?? ''}`);
        if (inst === 'outros') inst = itemInst;
        let acc = accounts.find((a)=>a.pluggy_account_id === pa.id);
        if (!acc) {
          const free = accounts.filter((a)=>!a.pluggy_account_id && a.institution === inst && (a.type === type || l4 && investLast4.has(l4) && a.type.startsWith('investment')));
          acc = l4 && free.find((a)=>a.last_four === l4) || (free.length === 1 ? free[0] : undefined);
        }
        const isInvest = Boolean(l4 && investLast4.has(l4));
        const patch = {
          pluggy_item_id: item.id,
          pluggy_account_id: pa.id,
          ...type === 'checking' ? {
            balance: pa.balance,
            balance_at: new Date().toISOString()
          } : {},
          ...pa.creditData?.creditLimit ? {
            credit_limit: pa.creditData.creditLimit
          } : {},
          ...isInvest ? {
            type: 'investment_onshore'
          } : {}
        };
        if (acc) {
          await db.from('accounts').update(patch).eq('id', acc.id);
          Object.assign(acc, patch);
        } else {
          const { data: created } = await db.from('accounts').insert({
            user_id: userId,
            name: `${pa.marketingName || pa.name}${l4 ? ` ••${l4}` : ''}`.slice(0, 60),
            institution: inst,
            type: isInvest ? 'investment_onshore' : type,
            currency: pa.currencyCode === 'USD' ? 'USD' : 'BRL',
            last_four: l4,
            balance: type === 'checking' ? pa.balance : 0,
            ...patch
          }).select('*').single();
          acc = created;
          accounts.push(created);
        }
        let from;
        if (cursors[pa.id]) from = addDays(cursors[pa.id], -10);
        else {
          const { data: last } = await db.from('transactions').select('date').eq('account_id', acc.id).neq('source', 'openfinance').lte('date', today).order('date', {
            ascending: false
          }).limit(1);
          from = last?.[0]?.date ? addDays(last[0].date, -10) : addDays(today, -365);
        }
        const txs = [];
        let after = null;
        for(let i = 0; i < 60; i++){
          const qs = new URLSearchParams({
            accountId: pa.id,
            dateFrom: from,
            dateTo: today
          });
          if (after) qs.set('after', after);
          const page = await pg(`v2/transactions?${qs}`);
          txs.push(...page.results ?? []);
          after = page.next ? new URLSearchParams(page.next.includes('?') ? page.next.slice(page.next.indexOf('?') + 1) : page.next).get('after') : null;
          if (!after) break;
        }
        const posted = txs.filter((t)=>!t.status || t.status === 'POSTED');
        const siblings = accounts.filter((a)=>a.institution === acc.institution && a.type === acc.type).map((a)=>a.id);
        const minDate = posted.reduce((m, t)=>localDate(t.date) < m ? localDate(t.date) : m, from);
        const { data: existing } = await db.from('transactions').select('id,date,amount,description,source,source_ref,of_ref,account_id').eq('user_id', userId).in('account_id', siblings).gte('date', addDays(minDate, -200));
        const known = new Set();
        for (const e of existing ?? []){
          if (e.source === 'openfinance' && e.source_ref) known.add(e.source_ref);
          if (e.of_ref) known.add(e.of_ref);
        }
        const imported = (existing ?? []).filter((e)=>e.source !== 'openfinance' && !e.of_ref);
        const fetchedIds = new Set(posted.map((t)=>t.id));
        const innerFrom = addDays(from, 1), innerTo = addDays(today, -1);
        let orphans = (existing ?? []).filter((e)=>e.account_id === acc.id && e.source === 'openfinance' && e.source_ref && !fetchedIds.has(e.source_ref) && e.date >= innerFrom && e.date <= innerTo);
        const knownInner = (existing ?? []).filter((e)=>e.account_id === acc.id && e.source === 'openfinance' && e.date >= innerFrom && e.date <= innerTo).length;
        if (posted.filter((t)=>{
          const d = localDate(t.date);
          return d >= innerFrom && d <= innerTo;
        }).length < knownInner * 0.5) orphans = [];
        const used = new Set();
        const rows = [];
        for (const t of posted){
          if (known.has(t.id)) {
            res.duplicates++;
            continue;
          }
          const date = localDate(t.date);
          const mag = Math.abs(t.amountInAccountCurrency ?? t.amount);
          const amount = Math.round((t.type === 'DEBIT' ? -mag : mag) * 100) / 100;
          let desc = (t.descriptionRaw || t.description || '').trim() || '(sem descrição)';
          const m = t.creditCardMetadata;
          let inst = m?.installmentNumber && m.totalInstallments && m.totalInstallments > 1 ? {
            n: m.installmentNumber,
            t: m.totalInstallments
          } : parseInst(desc);
          if (inst && !parseInst(desc)) desc = `${desc} ${inst.n}/${inst.t}`;
          const twinOf = (pool)=>pool.find((e)=>{
              if (used.has(e.id) || Math.abs(Number(e.amount) - amount) > 0.015) return false;
              const d = days(e.date, date);
              if (d > 200 || !similar(e.description, desc)) return false;
              if (d <= 3) return true;
              const ei = parseInst(e.description);
              return Boolean(inst && ei && ei.n === inst.n && ei.t === inst.t);
            });
          const orphan = twinOf(orphans);
          if (orphan) {
            used.add(orphan.id);
            await db.from('transactions').update({
              source_ref: t.id
            }).eq('id', orphan.id);
            res.reIdentified++;
            continue;
          }
          const twin = twinOf(imported);
          if (twin) {
            used.add(twin.id);
            await db.from('transactions').update({
              of_ref: t.id
            }).eq('id', twin.id);
            res.linked++;
            continue;
          }
          if (!inst) inst = null;
          rows.push({
            user_id: userId,
            account_id: acc.id,
            date,
            amount,
            currency: 'BRL',
            description: desc.slice(0, 300),
            merchant: t.merchant?.businessName || t.merchant?.name || null,
            kind: amount < 0 ? 'expense' : acc.type === 'credit' ? 'refund' : 'income',
            installment_n: inst?.n ?? null,
            installment_total: inst?.t ?? null,
            source: 'openfinance',
            source_ref: t.id,
            notes: null
          });
          rows[rows.length - 1]._pcat = t.category ?? null;
        }
        for(let i = 0; i < rows.length; i += 200){
          const chunk = rows.slice(i, i + 200);
          const clean = chunk.map(({ _pcat, ...r })=>r);
          const { data: ins, error } = await db.from('transactions').upsert(clean, {
            onConflict: 'user_id,source,source_ref',
            ignoreDuplicates: true
          }).select('id,description,merchant,amount,source_ref');
          if (error) throw new Error(error.message);
          const pcat = new Map(chunk.map((r)=>[
              r.source_ref,
              r._pcat
            ]));
          for (const r of ins ?? [])newTx.push({
            id: r.id,
            description: r.description,
            merchant: r.merchant,
            amount: Number(r.amount),
            account_type: acc.type,
            pluggy_category: pcat.get(r.source_ref)
          });
          res.inserted += ins?.length ?? 0;
        }
        cursors[pa.id] = today;
      }
      res.categorize = await categorize(userId, newTx);
      if (item.sync_investments) await saveInvestments(userId, item.id).catch((e)=>console.warn('[pluggy] investimentos', e));
      await db.from('of_items').update({
        connector_name: connector,
        status: pItem.status,
        execution_status: pItem.executionStatus ?? null,
        pluggy_updated_at: pItem.lastUpdatedAt ?? null,
        last_sync_at: new Date().toISOString(),
        cursors,
        last_error: pItem.status === 'LOGIN_ERROR' || pItem.status === 'OUTDATED' ? 'Renove o consentimento no app Meu Pluggy.' : pItem.status === 'WAITING_USER_INPUT' ? 'A instituição pediu uma confirmação no Meu Pluggy.' : null
      }).eq('id', item.id);
    } catch (err) {
      res.error = err instanceof Error ? err.message : String(err);
      await db.from('of_items').update({
        last_error: res.error
      }).eq('id', item.id);
    }
    summary.push(res);
  }
  const ok = summary.length > 0 && summary.some((s)=>!s.error);
  await db.from('sync_runs').insert({
    user_id: userId,
    kind: 'openfinance',
    finished_at: new Date().toISOString(),
    ok,
    summary
  });
  return {
    ok,
    items: summary
  };
}
function estrategia(i) {
  const t = (i.type || '').toUpperCase(), st = (i.subtype || '').toUpperCase(), rate = (i.rateType || '').toUpperCase();
  if (t === 'FIXED_INCOME' || t === 'SECURITY') {
    const tipo = /TREASURY|TESOURO/.test(st) ? 'Tesouro' : [
      'CDB',
      'LCI',
      'LCA',
      'CRA',
      'CRI',
      'DEBENTURE',
      'LF'
    ].find((x)=>st.includes(x)) ?? 'Renda Fixa';
    if (/IPCA|IGPM|INFLA/.test(rate)) return [
      'Inflação',
      tipo,
      'IPCA'
    ];
    if (/PRE/.test(rate)) return [
      'Pré Fixado',
      tipo,
      'Pré'
    ];
    return [
      'Pós Fixado',
      tipo,
      'CDI'
    ];
  }
  if (t === 'MUTUAL_FUND') {
    if (/MULTIMARKET/.test(st)) return [
      'Multimercado',
      'Fundo',
      'Multimercado'
    ];
    if (/STOCK|ACOES/.test(st)) return [
      'Renda Variável Brasil',
      'Fundo',
      'Ações'
    ];
    if (/FIXED_INCOME|RENDA_FIXA/.test(st)) return [
      'Pós Fixado',
      'Fundo',
      'CDI'
    ];
    if (/OFFSHORE|INTERNATIONAL/.test(st)) return [
      'Renda Variável Global',
      'Fundo',
      'Ações Globais'
    ];
    return [
      'Alternativo',
      'Fundo',
      'Alternativo'
    ];
  }
  if (t === 'EQUITY' || t === 'ETF') return /BDR/.test(st) ? [
    'Renda Variável Global',
    'BDR',
    'Ações Globais'
  ] : [
    'Renda Variável Brasil',
    t === 'ETF' ? 'ETF' : 'Ação',
    'Ações'
  ];
  return [
    'Alternativo',
    'Outro',
    'Alternativo'
  ];
}
async function saveInvestments(userId, itemId) {
  const db = admin();
  const invs = [];
  for(let page = 1; page <= 10; page++){
    const r = await pg(`investments?itemId=${itemId}&pageSize=500&page=${page}`);
    invs.push(...r.results.filter((i)=>i.balance > 0.01));
    if (!r.totalPages || page >= r.totalPages) break;
  }
  if (!invs.length) return;
  const mes = spDate().slice(0, 7);
  const { data: snap } = await db.from('inv_snapshot').select('source').eq('user_id', userId).eq('mes', mes).maybeSingle();
  if (snap && snap.source !== 'openfinance') return;
  await db.from('inv_position').delete().eq('user_id', userId).eq('mes', mes).eq('manual', false).neq('estrategia', 'Investimentos Offshore');
  const by = new Map();
  for (const i of invs){
    const produto = (i.name || i.code || i.id).replace(/\s+/g, ' ').trim().slice(0, 120);
    const [e, t, x] = estrategia(i);
    const cur = by.get(produto) ?? {
      estrategia: e,
      tipo: t,
      indexador: x,
      saldo: 0
    };
    cur.saldo += i.balance;
    by.set(produto, cur);
  }
  await db.from('inv_position').upsert([
    ...by.entries()
  ].map(([produto, v])=>({
      user_id: userId,
      mes,
      produto,
      ...v
    })));
  const { count } = await db.from('inv_position').select('*', {
    count: 'exact',
    head: true
  }).eq('user_id', userId).eq('mes', mes).or('manual.eq.true,estrategia.eq.Investimentos Offshore');
  if (!count) {
    const { data: prev } = await db.from('inv_position').select('*').eq('user_id', userId).lt('mes', mes).or('manual.eq.true,estrategia.eq.Investimentos Offshore').order('mes', {
      ascending: false
    });
    const prevMes = prev?.[0]?.mes;
    if (prevMes) await db.from('inv_position').upsert(prev.filter((p)=>p.mes === prevMes).map((p)=>({
        ...p,
        mes
      })));
  }
  const { data: cashAccs } = await db.from('accounts').select('name,balance').eq('user_id', userId).like('type', 'investment%').eq('currency', 'BRL');
  for (const a of cashAccs ?? []){
    const produto = `Saldo em conta - ${a.name}`;
    await db.from('inv_position').delete().eq('user_id', userId).eq('mes', mes).eq('produto', produto);
    if (Number(a.balance) > 0.01) await db.from('inv_position').insert({
      user_id: userId,
      mes,
      produto,
      estrategia: 'Pós Fixado',
      tipo: 'Saldo em conta',
      indexador: 'CDI',
      saldo: a.balance
    });
  }
  const { data: all } = await db.from('inv_position').select('produto,saldo').eq('user_id', userId).eq('mes', mes);
  const total = (all ?? []).reduce((s, p)=>s + Number(p.saldo ?? 0), 0);
  for (const p of all ?? [])await db.from('inv_position').update({
    aloc: total ? Number(p.saldo) * 100 / total : null
  }).eq('user_id', userId).eq('mes', mes).eq('produto', p.produto);
  await db.from('inv_snapshot').upsert({
    user_id: userId,
    mes,
    ref: new Date().toLocaleDateString('pt-BR'),
    patrimonio: total,
    source: 'openfinance',
    updated_at: new Date().toISOString()
  });
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: CORS
  });
  const caller = await authenticate(req);
  if (caller instanceof Response) return caller;
  const body = await req.json().catch(()=>({}));
  try {
    if (caller.kind === 'cron') {
      const out = [];
      for (const uid of (await memberIds()))out.push(await syncUser(uid));
      return json(200, {
        ok: true,
        runs: out.length
      });
    }
    const db = admin();
    switch(body.action){
      case 'connect_token':
        {
          const r = await pg('connect_token', {
            method: 'POST',
            body: JSON.stringify(body.itemId ? {
              itemId: body.itemId
            } : {})
          });
          return json(200, {
            accessToken: r.accessToken
          });
        }
      case 'add_item':
        {
          if (!body.itemId) return json(400, {
            error: 'itemId obrigatório'
          });
          const it = await pg(`items/${body.itemId}`);
          await db.from('of_items').upsert({
            id: it.id,
            user_id: caller.userId,
            connector_name: it.connector?.name ?? 'Open Finance',
            status: it.status,
            pluggy_updated_at: it.lastUpdatedAt ?? null
          });
          return json(200, await syncUser(caller.userId, it.id));
        }
      case 'remove_item':
        {
          await db.from('of_items').delete().eq('id', body.itemId).eq('user_id', caller.userId);
          return json(200, {
            ok: true
          });
        }
      case 'sync':
      default:
        {
          if (!body.force) {
            const { data: last } = await db.from('of_items').select('last_sync_at').eq('user_id', caller.userId).order('last_sync_at', {
              ascending: true,
              nullsFirst: true
            }).limit(1);
            const at = last?.[0]?.last_sync_at;
            if (at && Date.now() - Date.parse(at) < 3 * 3_600_000) return json(200, {
              ok: true,
              skipped: 'recent'
            });
          }
          return json(200, await syncUser(caller.userId));
        }
    }
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : String(err)
    });
  }
});
