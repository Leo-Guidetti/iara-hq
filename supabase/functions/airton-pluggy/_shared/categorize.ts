// Classificação de lançamentos novos: estrutural → regra → histórico → IA.
// Nunca toca lançamento já revisado (decisão sua).
import { admin } from './common.ts';
import { anthropic, cachedSystem, hasAnthropic, MODELS, textOf } from './ai.ts';
const STOP = new Set([
  'pix',
  'enviado',
  'enviada',
  'recebido',
  'recebida',
  'para',
  'pagamento',
  'compra',
  'parcela',
  'ted',
  'doc',
  'transferencia',
  'sao',
  'paulo',
  'nupay',
  'ltda',
  'com',
  'bra',
  'dos',
  'das',
  'www',
  'http',
  'https'
]);
export function norm(s) {
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
export function merchantKey(d) {
  return norm(d).replace(/[^a-z]+/g, ' ').trim().split(/\s+/).filter((w)=>w.length >= 3 && !STOP.has(w)).slice(0, 3).join(' ');
}
const FATURA = /pagamento\s+(de\s+)?fatura|pagto\.?\s*fatura|pag\s+fatura|pagamento\s+recebido|nu\s+pagamentos|fatura\s+(do\s+)?cart|pagamento\s+para\s+banco\s+xp|credit card payment/i;
const INVEST = /\bresgate\b|\baplica[cç][aã]o\b|\baplic\b|tesouro\s+direto|\bcdb\b|\blci\b|\blca\b|\bcoe\b|fundo\s+de\s+invest/i;
const OWN = /mesma\s+titularidade|entre\s+contas|same ownership|transf.*\bpr[oó]pria\b/i;
const SALARY = /sal[aá]rio|folha\s+de\s+pag|proventos|pro\s*-?labore|adiantamento\s+salarial|ferias|13[ºo°]?\s*sal/i;
function structural(t) {
  const text = `${t.description} ${t.pluggy_category ?? ''}`;
  if (t.account_type.startsWith('investment')) return 'invest';
  if (FATURA.test(text)) return 'fatura';
  if (INVEST.test(text) || /investment/i.test(t.pluggy_category ?? '')) return 'invest';
  if (OWN.test(text)) return 'own';
  return null;
}
function kindFor(cat, cats, amount, fallback) {
  if (!cat) return fallback;
  const nature = cat.parent_id ? cats.get(cat.parent_id)?.nature ?? cat.nature : cat.nature;
  if (nature === 'transferencia' || nature === 'investimento') return 'transfer';
  if (nature === 'renda') return amount >= 0 ? 'income' : 'expense';
  return amount >= 0 ? 'refund' : 'expense';
}
export async function categorize(userId, txs) {
  const out = {
    structural: 0,
    rule: 0,
    history: 0,
    ai: 0,
    none: 0
  };
  if (txs.length === 0) return out;
  const db = admin();
  const { data: catRows } = await db.from('categories').select('id,name,parent_id,nature').eq('user_id', userId).eq('archived', false);
  const cats = new Map((catRows ?? []).map((c)=>[
      c.id,
      c
    ]));
  const byNature = (n)=>[
      ...cats.values()
    ].find((c)=>!c.parent_id && c.nature === n)?.id ?? null;
  const transferCat = byNature('transferencia');
  const investCat = byNature('investimento') ?? transferCat;
  const rendaCat = byNature('renda');
  const { data: ruleRows } = await db.from('rules').select('pattern,category_id,kind,priority').eq('user_id', userId).order('priority');
  const rules = ruleRows ?? [];
  const since = new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10);
  const hist = new Map();
  for(let from = 0;; from += 1000){
    const { data } = await db.from('transactions').select('description,merchant,category_id,cat_source').eq('user_id', userId).eq('reviewed', true).not('category_id', 'is', null).gte('date', since).range(from, from + 999);
    for (const r of data ?? []){
      const k = merchantKey(r.merchant || r.description);
      if (k.length < 4) continue;
      const m = hist.get(k) ?? new Map();
      m.set(r.category_id, (m.get(r.category_id) ?? 0) + (r.cat_source === 'manual' ? 3 : 1));
      hist.set(k, m);
    }
    if (!data || data.length < 1000) break;
  }
  const updates = [];
  const rest = [];
  for (const t of txs){
    const s = structural(t);
    if (s) {
      updates.push({
        id: t.id,
        category_id: s === 'invest' ? investCat : transferCat,
        kind: 'transfer',
        cat_source: 'structural',
        cat_confidence: 1,
        reviewed: true
      });
      out.structural++;
      continue;
    }
    const text = norm(`${t.merchant ?? ''} ${t.description}`);
    const rule = rules.find((r)=>{
      const p = norm(r.pattern).trim();
      if (p.length < 3) return false;
      return new RegExp(`(^|[^a-z0-9])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text);
    });
    if (rule && cats.has(rule.category_id)) {
      updates.push({
        id: t.id,
        category_id: rule.category_id,
        kind: rule.kind ?? kindFor(cats.get(rule.category_id), cats, t.amount, 'expense'),
        cat_source: 'rule',
        cat_confidence: 0.95
      });
      out.rule++;
      continue;
    }
    const k = merchantKey(t.merchant || t.description);
    const h = k.length >= 4 ? hist.get(k) : undefined;
    if (h && h.size) {
      const total = [
        ...h.values()
      ].reduce((a, b)=>a + b, 0);
      const [best, w] = [
        ...h.entries()
      ].sort((a, b)=>b[1] - a[1])[0];
      if (cats.has(best) && w / total >= 0.6) {
        updates.push({
          id: t.id,
          category_id: best,
          kind: kindFor(cats.get(best), cats, t.amount, 'expense'),
          cat_source: 'history',
          cat_confidence: Math.min(0.95, 0.6 + 0.1 * w)
        });
        out.history++;
        continue;
      }
    }
    if (t.amount > 0 && SALARY.test(t.description) && rendaCat) {
      updates.push({
        id: t.id,
        category_id: rendaCat,
        kind: 'income',
        cat_source: 'rule',
        cat_confidence: 0.9
      });
      out.rule++;
      continue;
    }
    rest.push(t);
  }
  if (rest.length && hasAnthropic('categorize')) {
    const catList = [
      ...cats.values()
    ].filter((c)=>c.nature !== 'transferencia').map((c)=>`${c.id} | ${c.parent_id ? (cats.get(c.parent_id)?.name ?? '') + ' > ' : ''}${c.name} | ${c.nature}`).join('\n');
    const examples = [
      ...hist.entries()
    ].slice(0, 60).map(([k, m])=>{
      const best = [
        ...m.entries()
      ].sort((a, b)=>b[1] - a[1])[0][0];
      return `${k} -> ${cats.get(best)?.name ?? best}`;
    }).join('\n');
    // O system (categorias + exemplos) é igual em todos os lotes: fica em cache e os lotes seguintes pagam ~10% dele.
    const system = cachedSystem('Você classifica lançamentos bancários brasileiros de uma pessoa física em categorias. Responda SOMENTE um JSON array ' + '[{"i":<índice>,"c":"<id da categoria ou null>","p":<confiança 0-1>}]. Use null quando não der para saber (ex.: Pix para pessoa sem contexto). ' + 'Valores positivos geralmente são reembolsos (categoria do gasto) ou renda.\n\nCategorias (id | nome | natureza):\n' + catList + (examples ? '\n\nComo esta pessoa já classificou estabelecimentos:\n' + examples : ''));
    for(let i = 0; i < rest.length; i += 50){
      const batch = rest.slice(i, i + 50);
      try {
        const r = await anthropic({
          model: MODELS.fast,
          max_tokens: 4000,
          effort: 'low',
          system,
          messages: [
            {
              role: 'user',
              content: batch.map((t, j)=>`${j}. ${t.description}${t.merchant ? ` [${t.merchant}]` : ''} | ${t.amount.toFixed(2)}${t.pluggy_category ? ` | banco: ${t.pluggy_category}` : ''}`).join('\n')
            }
          ]
        }, {
          userId,
          feature: 'categorize'
        });
        const txt = textOf(r);
        const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
        for (const a of arr){
          const t = batch[a.i];
          if (!t) continue;
          if (a.c && cats.has(a.c)) {
            updates.push({
              id: t.id,
              category_id: a.c,
              kind: kindFor(cats.get(a.c), cats, t.amount, t.amount >= 0 ? 'income' : 'expense'),
              cat_source: 'ai',
              cat_confidence: Math.max(0, Math.min(1, a.p ?? 0.5))
            });
            out.ai++;
          }
        }
      } catch (err) {
        console.warn('[categorize] IA falhou:', err);
        if (String(err).includes('Teto mensal')) break;
      }
    }
  }
  out.none = txs.length - updates.length;
  for (const u of updates){
    const { id, ...patch } = u;
    await db.from('transactions').update(patch).eq('id', id).eq('user_id', userId).eq('reviewed', false);
  }
  return out;
}
