// IARA · porta única "Peça à IARA" (UX-15). Lógica pura (sem banco, sem rede): testável com `deno test`.
// Fluxo: catálogo + turnos -> 1 chamada fast (roteador) -> validação de slots em CÓDIGO -> decisão por risco -> executa a RPC
// como o próprio usuário (index.ts) -> fala curta. A IA só roteia; quem executa e valida é o código.

import { canalFala, limparFalaHub as limparFala } from './_shared/fala.ts';
import { arredondarReais } from './_shared/fala.ts';

export type Intencao = {
  slug: string; agent: string; exemplos: string[]; rpc: string; slots: Record<string, string>;
  risco: 'baixo' | 'medio' | 'alto'; confirmacao: 'nenhuma' | 'repetir' | 'sim'; desfazer_rpc?: string | null;
};
export type Turno = { papel: 'leo' | 'iara'; texto: string; pendente?: Record<string, any> | null; at?: string };
export type Contexto = {
  itens?: { id: number; origem: string; titulo: string }[]; trilha?: { id: number; titulo: string }[];
  semana?: { id: number; status: string } | null; planos?: { id: number; titulo: string; status: string }[];
  compromissos?: { id: number; titulo: string; data: string }[];
  lancamentos?: { id: string; descricao: string; valor: number }[]; categorias?: { id: string; nome: string }[];
  /** UX-24: candidatos para editar metas e decidir sem estar na tela (Atalho, /hoje). */
  metas?: { id: number; titulo: string; plano?: string; horizonte?: string; status?: string }[];
  decisoes?: { id: number; pergunta: string }[]; propostas?: { id: number; campo: string; motivo?: string }[];
};
/** UX-23: itens marcados na tela do hub (data-iara-*), na ordem da página, visíveis primeiro. Os ids são dica do cliente:
 *  só servem de candidatos e toda escrita roda como o usuário (RLS), então id alheio não acha nada. */
export type ItemTela = { tipo: string; id: string; titulo: string; detalhe?: string; visivel: boolean };
export type Tela = { rota: string; itens: ItemTela[] };
const TIPOS_TELA = ['plano', 'meta', 'meta_financeira', 'semana_item', 'decisao', 'proposta', 'compromisso', 'item', 'trilha'];
const curto = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
/** Corpo do cliente (qualquer lixo) -> Tela segura: até 25 itens, tipos conhecidos, id numérico ou slug curto. */
export function lerTela(bruto: unknown): Tela | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const b = bruto as Record<string, unknown>;
  const rota = curto(b.rota, 60);
  const itens = (Array.isArray(b.itens) ? b.itens : []).flatMap((x): ItemTela[] => {
    if (!x || typeof x !== 'object') return [];
    const i = x as Record<string, unknown>;
    const tipo = curto(i.tipo, 20), id = curto(i.id, 40), titulo = curto(i.titulo, 80);
    if (!TIPOS_TELA.includes(tipo) || !/^[A-Za-z0-9_-]{1,40}$/.test(id) || !titulo) return [];
    const detalhe = curto(i.detalhe, 120);
    return [{ tipo, id, titulo, ...(detalhe ? { detalhe } : {}), visivel: i.visivel === true }];
  }).slice(0, 25);
  return rota || itens.length ? { rota, itens } : null;
}

export type Rota = { intencao: string; slots: Record<string, unknown>; confianca: number; pergunta: string | null; opcoes: string[] };
export type Destino = { via: 'rpc'; schema: string | null; nome: string } | { via: 'fn'; funcao: string; acao: string };
export type Desfazer = { acao_id: number; ate: string };
export type Resposta = { fala: string; tela: Record<string, unknown> | null; pendente: Record<string, unknown> | null; desfazer?: Desfazer | null };
/** Retorno das RPCs hub_acao_* (UX-16). status: pendente | executada | cancelada | expirada | desfeita | nao_encontrada | erro. */
export type AcaoInfo = {
  acao_id?: number; status: string; intencao?: string; args?: Record<string, unknown>; pergunta?: string | null; expira_em?: string;
  resultado?: unknown; desfazer?: Desfazer | null; fala?: string | null; erro?: string; requer_sim?: boolean;
};
/** Acesso às ações pendentes/executadas (no index.ts: RPCs hub_acao_* chamadas COM o JWT do usuário). */
export type Acoes = {
  criar: (intencao: string, args: Record<string, unknown>, pergunta: string) => Promise<AcaoInfo>;
  confirmar: (id: number) => Promise<AcaoInfo>;
  cancelar: (id: number) => Promise<AcaoInfo>;
  desfazerUltima: () => Promise<{ ok: boolean; fala: string }>;
};

export const LIMIAR = 0.6;
export const JANELA_MIN = 30;
export const ROTAS_ESPECIAIS = ['pergunta', 'fora'] as const;
export const MENU_FORA = 'Posso anotar peso, leitura ou prática, criar compromisso, marcar item como feito, tratar lançamentos, falar dos planos ou das finanças. O que você quer?';

// ---------- prompt do roteador (system FIXO e cacheado; a data vai na mensagem do usuário) ----------

export function montarSystem(catalogo: Intencao[]): string {
  const linhas = [...catalogo].sort((a, b) => a.slug.localeCompare(b.slug)).map((c) =>
    `- ${c.slug} [${c.agent}, risco ${c.risco}] slots ${JSON.stringify(c.slots)} | ex.: ${c.exemplos.slice(0, 2).join(' / ')}`);
  return `Você é o roteador da IARA, assistente pessoal do Leo. Dado o que ele disse, escolha UMA intenção do catálogo e extraia os slots. Você só roteia; não executa nem responde.
Regras:
- intencao: o slug exato do catálogo (prefira sempre o slug); "pergunta" só se ele quer saber algo sobre dinheiro (slots {"dominio":"dinheiro","pergunta":"..."}) ou sobre os planos (slots {"dominio":"planos"}) que nenhum slug cobre; "fora" se nada se aplica.
- slots_json: texto JSON de um objeto com os nomes de slot do catálogo. Preencha só o que ele disse ou o que está em "Candidatos" (ids SÓ de lá, nunca invente id). Datas em AAAA-MM-DD a partir de "Hoje é"; horas HH:MM. Slot opcional ausente: omita.
- Valor em dinheiro, peso, página e prazo NUNCA se adivinham: se não foi dito, omita o slot.
- confianca de 0 a 1. Ambíguo (dois itens possíveis, intenção duvidosa): confianca baixa, "pergunta_esclarecimento" com UMA pergunta curta e "opcoes" com até 3 respostas curtas. Senão pergunta_esclarecimento null e opcoes [].
- Use os turnos recentes para entender respostas curtas ("a segunda", "sim", "essa").
- "Na tela" lista o que o Leo está vendo agora, numerado na ordem da página (os visíveis primeiro). "essa", "esse", "isso", "a primeira", "o segundo" e o nome de um item se referem a esses itens: use o id dele (meta -> p_id de meta.editar; plano -> p_id de plano.editar/plano.confirmar/plano.descartar ou p_plano de meta.adicionar; semana_item -> p_id de semana.*; meta_financeira -> p.id de meta.salvar; decisao/proposta -> p_id; decisao -> decisao_id de decisao.painel). Se mais de um item visível servir, pergunte qual.
- Editar: plano.editar e meta.editar recebem o id e SÓ os campos que mudam ("arquiva" = status abandonado no plano e cancelada na meta; "retoma" = ativo/ativa). meta.salvar (AIrton) com id: só o id e o que muda. Nas outras intenções, mande todos os campos obrigatórios.
- Dias da semana (p_dias): 1 = segunda, 2 = terça ... 6 = sábado, 7 = domingo.
- Prazo dito só com o ano ("para 2028"): use 31/12 desse ano; só com mês e ano: o último dia do mês.
Catálogo:
${linhas.join('\n')}`;
}

export function montarUsuario(texto: string, hoje: string, dow: string, turnos: Turno[], ctx: Contexto, tela: Tela | null = null): string {
  const hist = turnos.map((t) => `${t.papel === 'leo' ? 'Leo' : 'IARA'}: ${t.texto}${t.pendente ? ` [pendente: ${JSON.stringify(t.pendente).slice(0, 300)}]` : ''}`).join('\n');
  const cand = Object.fromEntries(Object.entries(ctx).filter(([, v]) => v != null && (!Array.isArray(v) || v.length)));
  return `Hoje é ${hoje} (${dow}).\n${hist ? `Turnos recentes:\n${hist}\n` : ''}Candidatos: ${JSON.stringify(cand)}\n${descreverTela(tela)}Leo disse: ${texto}`;
}
/** Bloco "Na tela" da mensagem do roteador (vazio sem tela). */
export function descreverTela(tela: Tela | null): string {
  if (!tela || !tela.itens.length) return tela?.rota ? `Na tela (${tela.rota}): nada marcado.\n` : '';
  const linhas = tela.itens.map((i, n) => `${n + 1}. ${i.tipo} id=${i.id} ${JSON.stringify(i.titulo)}${i.detalhe ? ` (${JSON.stringify(i.detalhe)})` : ''}${i.visivel ? '' : ' [fora da vista]'}`);
  return `Na tela (${tela.rota || '?'}):\n${linhas.join('\n')}\n`;
}

const ouNulo = (t: Record<string, unknown>) => ({ anyOf: [t, { type: 'null' }] });
export const ROTA_SCHEMA = {
  type: 'object',
  properties: {
    intencao: { type: 'string' },
    slots_json: { type: 'string' },
    confianca: { type: 'number' },
    pergunta_esclarecimento: ouNulo({ type: 'string' }),
    opcoes: { type: 'array', items: { type: 'string' } },
  },
  required: ['intencao', 'slots_json', 'confianca', 'pergunta_esclarecimento', 'opcoes'],
  additionalProperties: false,
};

/** Saída do modelo (qualquer lixo) -> Rota segura. Slug fora do catálogo vira 'fora'. */
export function normalizarRota(bruta: unknown, catalogo: Intencao[]): Rota {
  const b = (bruta && typeof bruta === 'object' ? bruta : {}) as Record<string, any>;
  let slots: Record<string, unknown> = {};
  try {
    const s = typeof b.slots_json === 'string' ? JSON.parse(b.slots_json || '{}') : b.slots;
    if (s && typeof s === 'object' && !Array.isArray(s)) slots = s;
  } catch { /* slots vazios: o slot obrigatório faltando vira pergunta */ }
  const slug = String(b.intencao ?? '').trim();
  const valida = catalogo.some((c) => c.slug === slug) || (ROTAS_ESPECIAIS as readonly string[]).includes(slug);
  const conf = Number(b.confianca);
  const opcoes = (Array.isArray(b.opcoes) ? b.opcoes : []).map((o) => String(o).trim().slice(0, 40)).filter(Boolean).slice(0, 3);
  const p = typeof b.pergunta_esclarecimento === 'string' ? b.pergunta_esclarecimento.trim().slice(0, 200) : '';
  return { intencao: valida ? slug : 'fora', slots, confianca: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0, pergunta: p || null, opcoes };
}

// ---------- validação de slots (spec do catálogo: "bigint", "text(a|b)?", "jsonb{id?:bigint,...}", "text[]") ----------

type Spec = { tipo: string; lista: boolean; enumer: string[] | null; campos: string | null; opcional: boolean };
export function parseSpec(spec: string): Spec {
  const m = /^([a-z]+)(\[\])?(?:\((.*?)\)|\{(.*)\})?(\?)?$/s.exec(spec.trim());
  if (!m) return { tipo: 'text', lista: false, enumer: null, campos: null, opcional: false };
  return { tipo: m[1], lista: !!m[2], enumer: m[3] != null ? m[3].split('|') : null, campos: m[4] ?? null, opcional: !!m[5] };
}
function camposDe(corpo: string): Record<string, string> {
  const out: Record<string, string> = {};
  let nivel = 0, atual = '';
  const fecha = () => { const i = atual.indexOf(':'); if (i > 0) out[atual.slice(0, i).trim()] = atual.slice(i + 1).trim(); atual = ''; };
  for (const ch of corpo) {
    if (ch === '{' || ch === '(') nivel++;
    if (ch === '}' || ch === ')') nivel--;
    if (ch === ',' && nivel === 0) fecha(); else atual += ch;
  }
  fecha();
  return out;
}

const NUMEROS_UNIDADES = [['milhões', 1e6], ['milhão', 1e6], ['mil', 1e3]] as const;
/** Números que aparecem no texto ("82,4", "R$ 1.200", "80 mil" -> 80 e 80000): barra valor que o modelo inventou. */
export function numerosDoTexto(texto: string): number[] {
  const out: number[] = [];
  for (const m of texto.toLowerCase().matchAll(/(\d[\d.]*(?:,\d+)?)(\s*(?:milhões|milhão|mil)\b)?/g)) {
    let s = m[1];
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    if (!Number.isFinite(n)) continue;
    out.push(n);
    const u = NUMEROS_UNIDADES.find(([w]) => (m[2] ?? '').includes(w));
    if (u) out.push(n * u[1]);
  }
  return out;
}

type Ctx = { numeros: number[]; faltando: string[]; invalidos: string[]; edicao: boolean };
/** UX-23: intenções cuja RPC mantém o que não veio (coalesce por campo): com id, só o id é obrigatório.
 *  hub_compromisso_salvar NÃO entra: exige título e data e grava os campos direto. */
export const EDICAO_PARCIAL = new Set(['meta.salvar_plano', 'meta.salvar']);
function validarValor(spec: Spec, v: unknown, nome: string, c: Ctx, guardaNumero: boolean): { ok: boolean; valor?: unknown } {
  if (spec.lista) {
    if (!Array.isArray(v) || !v.length) return { ok: false };
    const itens = v.map((x) => validarValor({ ...spec, lista: false, tipo: spec.tipo === 'jsonb' ? 'jsonb' : spec.tipo }, x, nome, c, guardaNumero));
    return itens.every((i) => i.ok) ? { ok: true, valor: itens.map((i) => i.valor) } : { ok: false };
  }
  switch (spec.tipo) {
    case 'bigint': case 'int': case 'integer': {
      const n = typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isInteger(n)) return { ok: false };
      if (spec.enumer && !spec.enumer.includes(String(n))) return { ok: false };
      if (guardaNumero && !c.numeros.includes(n)) return { ok: false };
      return { ok: true, valor: n };
    }
    case 'numeric': case 'number': {
      const n = typeof v === 'string' ? Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false };
      if (!c.numeros.some((x) => Math.abs(x - n) < 1e-9)) return { ok: false }; // valor/peso nunca adivinhado
      return { ok: true, valor: n };
    }
    case 'boolean': return typeof v === 'boolean' ? { ok: true, valor: v } : { ok: false };
    case 'date': return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true, valor: v } : { ok: false };
    case 'time': return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? { ok: true, valor: v } : { ok: false };
    case 'text': {
      if (typeof v === 'number' && spec.lista) v = String(v);
      if (typeof v !== 'string' || !v.trim()) return { ok: false };
      const t = v.trim().slice(0, 500);
      if (spec.enumer) {
        if (spec.enumer.length === 1 && spec.enumer[0] === 'HH:MM') return /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? { ok: true, valor: t } : { ok: false };
        return spec.enumer.includes(t) ? { ok: true, valor: t } : { ok: false };
      }
      return { ok: true, valor: t };
    }
    case 'jsonb': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false };
      if (spec.campos == null) return { ok: true, valor: v };
      const campos = camposDe(spec.campos);
      const obj = v as Record<string, unknown>;
      // UX-23: com id (editar algo que já existe), só o id é obrigatório; a RPC mantém o que não veio (coalesce).
      const edicao = c.edicao && 'id?' in campos && obj.id != null && obj.id !== '';
      const r = validarObjeto(edicao ? Object.fromEntries(Object.entries(campos).map(([k, t]) => [k.endsWith('?') ? k : `${k}?`, t])) : campos, obj, c, nome + '.');
      return r ? { ok: true, valor: r } : { ok: false };
    }
    default: return { ok: false };
  }
}
function validarObjeto(campos: Record<string, string>, obj: Record<string, unknown>, c: Ctx, prefixo: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  let ok = true;
  for (const [k, specTxt] of Object.entries(campos)) {
    const opcional = k.endsWith('?');
    const nome = k.replace(/\?$/, '');
    const spec = parseSpec(specTxt);
    const v = obj[nome];
    if (v == null || v === '') { if (!opcional) { c.faltando.push(prefixo + nome); ok = false; } continue; }
    const r = validarValor(spec, v, prefixo + nome, c, false);
    if (!r.ok) { c.invalidos.push(prefixo + nome); ok = false; } else out[nome] = r.valor;
  }
  return ok ? out : null;
}

/** Valida e normaliza os slots contra a spec do catálogo. Só passam os nomes que o catálogo declara. */
export function validarSlots(spec: Record<string, string>, slots: Record<string, unknown>, textoLeo: string, edicao = false):
  { ok: true; args: Record<string, unknown> } | { ok: false; faltando: string[]; invalidos: string[] } {
  const c: Ctx = { numeros: numerosDoTexto(textoLeo), faltando: [], invalidos: [], edicao };
  const args: Record<string, unknown> = {};
  for (const [nome, txt] of Object.entries(spec)) {
    const s = parseSpec(txt);
    const v = slots[nome];
    if (v == null || v === '') { if (!s.opcional) c.faltando.push(nome); continue; }
    const r = validarValor(s, v, nome, c, nome === 'p_pagina');
    if (!r.ok) c.invalidos.push(nome); else args[nome] = r.valor;
  }
  return c.faltando.length || c.invalidos.length ? { ok: false, faltando: c.faltando, invalidos: c.invalidos } : { ok: true, args };
}

// ---------- ids que o modelo cita: só valem se estiverem nos candidatos ----------

const IDS: Record<string, { slot: string; lista?: boolean; tela?: string; semCand?: string; cand: (c: Contexto) => (string | number)[]; daTela?: (i: ItemTela, c: Contexto) => boolean }> = {
  'casa.item_status': { slot: 'p_id', tela: 'item', cand: (c) => (c.itens ?? []).map((i) => i.id) },
  'sabia.item': { slot: 'p_id', cand: (c) => (c.trilha ?? []).map((i) => i.id) },
  'agenda.compromisso_cancelar': { slot: 'p_id', tela: 'compromisso', cand: (c) => (c.compromissos ?? []).map((i) => i.id) },
  'semana.confirmar': { slot: 'p_plano', cand: (c) => (c.semana ? [c.semana.id] : []) },
  'semana.responder': { slot: 'p_plano', cand: (c) => (c.semana ? [c.semana.id] : []) },
  'plano.confirmar': { slot: 'p_id', tela: 'plano', cand: (c) => (c.planos ?? []).map((i) => i.id) },
  'plano.editar': { slot: 'p_id', tela: 'plano', cand: (c) => (c.planos ?? []).map((i) => i.id) },
  // só rascunho: plano da tela que não é rascunho (pelo status do servidor ou pelo detalhe da tela) não vale; ativo se arquiva por plano.editar
  'plano.descartar': { slot: 'p_id', tela: 'plano', semCand: 'Não há rascunho de plano agora. Para tirar um plano ativo, diga "arquiva o plano".',
    cand: (c) => (c.planos ?? []).filter((i) => i.status === 'rascunho').map((i) => i.id),
    daTela: (i, c) => { const s = (c.planos ?? []).find((p) => String(p.id) === i.id)?.status; return s ? s === 'rascunho' : !i.detalhe || i.detalhe.startsWith('rascunho'); } },
  'meta.editar': { slot: 'p_id', tela: 'meta', cand: (c) => (c.metas ?? []).map((i) => i.id) },
  'meta.adicionar': { slot: 'p_plano', tela: 'plano', cand: (c) => (c.planos ?? []).map((i) => i.id) },
  'decisao.decidir': { slot: 'p_id', tela: 'decisao', semCand: 'Abra Planos e me diga de novo: assim eu vejo de qual decisão você fala.', cand: (c) => (c.decisoes ?? []).map((i) => i.id) },
  'decisao.painel': { slot: 'decisao_id', tela: 'decisao', semCand: 'Não há decisão aberta agora.', cand: (c) => (c.decisoes ?? []).map((i) => i.id) },
  'proposta.decidir': { slot: 'p_id', tela: 'proposta', semCand: 'Abra Planos e me diga de novo: assim eu vejo de qual proposta você fala.', cand: (c) => (c.propostas ?? []).map((i) => i.id) },
  'lancamento.categorizar': { slot: 'p_ids', lista: true, cand: (c) => (c.lancamentos ?? []).map((i) => i.id) },
  'lancamento.confirmar': { slot: 'p_ids', lista: true, cand: (c) => (c.lancamentos ?? []).map((i) => i.id) },
};
/** Edição por id dentro de `p` (jsonb{id?:...}): o id só vale se estiver na tela; sem ele, `p` é um item novo. */
const IDS_P: Record<string, { tela: string; cand: (c: Contexto) => (string | number)[] }> = {
  'meta.salvar_plano': { tela: 'meta', cand: () => [] },
  'meta.salvar': { tela: 'meta_financeira', cand: () => [] },
  'agenda.compromisso_salvar': { tela: 'compromisso', cand: (c) => (c.compromissos ?? []).map((i) => i.id) },
};
const idsTela = (tela: Tela | null | undefined, tipo: string | undefined, ctx?: Contexto, filtro?: (i: ItemTela, c: Contexto) => boolean) =>
  (tipo && tela ? tela.itens.filter((i) => i.tipo === tipo && (!filtro || !ctx || filtro(i, ctx))).map((i) => i.id) : []);

/** Completa o id quando só há um candidato; descarta id que o modelo inventou (vira slot faltando -> pergunta).
 *  UX-23: os ids da tela entram como candidatos (de contexto do servidor + tela). */
export function conferirIds(slug: string, slots: Record<string, unknown>, ctx: Contexto, tela: Tela | null = null): Record<string, unknown> {
  const tipoP = IDS_P[slug];
  if (tipoP && slots.p && typeof slots.p === 'object' && !Array.isArray(slots.p)) {
    const p = { ...(slots.p as Record<string, unknown>) };
    // id que não está na tela nem no contexto do servidor: não edita às cegas (vira item novo, que pede os campos obrigatórios).
    if (p.id != null && ![...tipoP.cand(ctx).map(String), ...idsTela(tela, tipoP.tela)].includes(String(p.id))) delete p.id;
    if (p.id != null && tipoP.tela !== 'meta_financeira' && /^\d+$/.test(String(p.id))) p.id = Number(p.id);
    return { ...slots, p };
  }
  const r = IDS[slug];
  if (!r) return slots;
  const daTela = idsTela(tela, r.tela, ctx, r.daTela);
  const cand = [...new Set([...r.cand(ctx).map(String), ...daTela])];
  const out = { ...slots };
  const dado = out[r.slot];
  if (r.lista) {
    const ids = (Array.isArray(dado) ? dado : dado != null ? [dado] : []).map(String).filter((x) => cand.includes(x));
    if (ids.length) out[r.slot] = ids; else delete out[r.slot];
  } else if (dado == null || !cand.includes(String(dado))) {
    if (cand.length === 1) out[r.slot] = Number(cand[0]); else delete out[r.slot];
  } else if (typeof dado === 'string' && /^\d+$/.test(dado)) out[r.slot] = Number(dado);
  return out;
}
export function idCandidatos(slug: string, ctx: Contexto, tela: Tela | null = null): number {
  return IDS[slug] ? new Set([...IDS[slug].cand(ctx).map(String), ...idsTela(tela, IDS[slug].tela, ctx, IDS[slug].daTela)]).size : 1;
}

// ---------- destino, plano de ação e risco ----------

export function resolverDestino(rpc: string): Destino {
  if (rpc.startsWith('fn:')) { const [funcao, acao = ''] = rpc.slice(3).split('/'); return { via: 'fn', funcao, acao }; }
  const [a, b] = rpc.split('.');
  return b ? { via: 'rpc', schema: a === 'public' ? null : a, nome: b } : { via: 'rpc', schema: null, nome: a };
}
/** Corpo da chamada a uma Edge Function do catálogo (cada função tem seu estilo: acao/action). */
export function corpoFn(destino: { funcao: string; acao: string }, args: Record<string, unknown>, textoLeo: string, canal = 'hub'): Record<string, unknown> {
  // UX-18: no canal que fala, o airton-ai usa o system de voz (contrato §3.6, cacheado); no hub segue o chat em texto.
  if (destino.funcao === 'airton-ai') return { action: destino.acao, message: String(args.pergunta ?? textoLeo), channel: canalFala(canal) ? 'voice' : 'chat' };
  if (destino.funcao === 'iara-agenda') return { action: destino.acao, ...args }; // UX-24: a agenda usa `action`
  return { acao: destino.acao, ...args };
}

/** Política (UX-16): risco alto ou confirmacao 'sim' só executa depois de "sim" (linha confirmada em core.acoes_pendentes). */
export const exigeSim = (i: Pick<Intencao, 'risco' | 'confirmacao'>) => i.risco === 'alto' || i.confirmacao === 'sim';
/** Intenções só de leitura: não geram ação registrada. */
export const SO_LEITURA = new Set(['planos.status', 'metas.status', 'decisoes.status', 'propostas.status', 'semana.ouvir']);

export type Plano =
  | { tipo: 'resposta'; resposta: Resposta }
  | { tipo: 'confirmar'; resposta: Resposta }
  | { tipo: 'executar'; intencao: Intencao; args: Record<string, unknown>; destino: Destino };

const ROTULO: Record<string, string> = {
  p_pagina: 'a página', p_kg: 'o peso', p_id: 'qual item', p_ids: 'quais lançamentos', p_category: 'a categoria', p_plano: 'qual plano',
  p_status: 'o status', p_data: 'a data', p_titulo: 'o nome', p_horizonte: 'o horizonte (curto, médio ou longo prazo)', p_nome: 'o nome do lugar',
  decisao_id: 'qual decisão', p_hora: 'a hora', p: 'os detalhes', titulo: 'o título', data: 'a data', 'p.titulo': 'o título', 'p.data': 'a data',
  pergunta: 'a pergunta', frase: 'a frase',
};
const rotulo = (s: string) => ROTULO[s] ?? 'um dado que faltou';

const pergunta = (fala: string, opcoes: string[] = [], extra: Record<string, unknown> = {}): Plano =>
  ({ tipo: 'resposta', resposta: { fala: limparFala(fala), tela: null, pendente: { tipo: 'pergunta', pergunta: fala, opcoes: opcoes.slice(0, 3), ...extra } } });

/** Slug final: 'pergunta' vira a intenção do catálogo do domínio; sem correspondência vira 'fora'. */
export function resolverSlug(rota: Rota, catalogo: Intencao[]): string {
  let slug = rota.intencao;
  if (slug === 'pergunta') {
    const dom = String(rota.slots.dominio ?? '');
    slug = dom === 'dinheiro' ? 'financas.quanto_posso_gastar' : dom === 'planos' ? 'planos.status' : 'fora';
  }
  return catalogo.some((c) => c.slug === slug) ? slug : 'fora';
}

/** Decide o que fazer com a rota: perguntar, pedir "sim" (risco alto) ou executar (baixo/médio). Nunca lança. */
export function planejar(rota: Rota, catalogo: Intencao[], ctx: Contexto, textoLeo: string, textosAnteriores: string[] = [], tela: Tela | null = null): Plano {
  let slots = rota.slots;
  const intencao = catalogo.find((c) => c.slug === resolverSlug(rota, catalogo));
  if (!intencao) return pergunta(rota.pergunta ?? MENU_FORA, rota.pergunta ? rota.opcoes : []);
  if (rota.confianca < LIMIAR) {
    const op = rota.opcoes.length ? rota.opcoes : [];
    return pergunta(rota.pergunta ?? `Quer dizer "${intencao.exemplos[0] ?? intencao.slug}"? Me conte de outro jeito.`, op);
  }
  if (intencao.slots.pergunta && slots.pergunta == null) slots = { ...slots, pergunta: textoLeo };
  slots = conferirIds(intencao.slug, slots, ctx, tela);
  const v = validarSlots(intencao.slots, slots, [textoLeo, ...textosAnteriores].join(' '), EDICAO_PARCIAL.has(intencao.slug));
  if (!v.ok) {
    const alvo = v.faltando[0] ?? v.invalidos[0];
    const aviso = !v.faltando.length && v.invalidos.length ? ` Não achei ${rotulo(alvo)} com segurança.` : '';
    const semCand = idCandidatos(intencao.slug, ctx, tela) === 0;
    const q = semCand && IDS[intencao.slug]?.semCand ? IDS[intencao.slug].semCand! : rota.pergunta ?? (semCand ? `Não achei ${rotulo(alvo)} aberto agora. Pode dizer qual?` : `Qual é ${rotulo(alvo)}?${aviso}`);
    return pergunta(q, rota.opcoes);
  }
  if (exigeSim(intencao)) {
    const q = `Vou ${descreverAcao(intencao.slug, v.args, tela, ctx)}. Confirma?`;
    return { tipo: 'confirmar', resposta: { fala: q, tela: { intencao: intencao.slug, risco: intencao.risco, executou: false }, pendente: { tipo: 'confirmacao', intencao: intencao.slug, slots: v.args, pergunta: q } } };
  }
  return { tipo: 'executar', intencao, args: v.args, destino: resolverDestino(intencao.rpc) };
}

// ---------- fala (contrato §3.6: até 2 frases, conclusão primeiro, sem markdown, valores arredondados) ----------

export { arredondarReais, limparFala };

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const diaSemana = (data: string) => DIAS[new Date(`${data}T12:00:00Z`).getUTCDay()];
const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const horaBR = (h: string) => (h.endsWith(':00') || /:00$/.test(h) ? `${Number(h.slice(0, 2))}h` : h.replace(':', 'h'));
const nomeKg = (n: unknown) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

const tituloTela = (tela: Tela | null | undefined, tipo: string, id: unknown) => tela?.itens.find((i) => i.tipo === tipo && i.id === String(id))?.titulo;
const STATUS_META: Record<string, string> = { pausada: 'pausar', ativa: 'retomar', concluida: 'concluir', cancelada: 'cancelar' };
const HORIZONTE: Record<string, string> = { curto: 'curto prazo', medio: 'médio prazo', longo: 'longo prazo' };
/** "mudar o prazo para 31/12/2028 e o dono para AIrton" a partir dos campos que vieram numa edição. */
function mudancas(p: Record<string, any>): string {
  const m: string[] = [];
  if (p.titulo) m.push(`o nome para "${p.titulo}"`);
  if (p.prazo) m.push(`o prazo para ${dataBR(String(p.prazo))}/${String(p.prazo).slice(0, 4)}`);
  if (p.horizonte) m.push(`o horizonte para ${HORIZONTE[p.horizonte] ?? p.horizonte}`);
  if (p.dono) m.push(`o dono para ${p.dono}`);
  if (p.cadencia) m.push(`a cadência para ${p.cadencia}`);
  if (p.medida && typeof p.medida === 'object' && p.medida.alvo != null) m.push(`o alvo para ${p.medida.alvo}`);
  return m.length ? `mudar ${m.join(' e ')}` : '';
}

const STATUS_PLANO: Record<string, string> = { pausado: 'pausar', ativo: 'retomar', concluido: 'concluir', abandonado: 'arquivar' };
const DONO_NOME: Record<string, string> = { iara: 'IARA', claudia: 'ClaudIA', airton: 'AIrton', sabia: 'SabIA' };
const reais = (n: unknown) => `R$ ${Number(n).toLocaleString('pt-BR')}`;
const dataLonga = (d: unknown) => `${dataBR(String(d))}/${String(d).slice(0, 4)}`;
const nomePlano = (a: Record<string, unknown>, ctx: Contexto, tela: Tela | null, slot = 'p_id') =>
  tituloTela(tela, 'plano', a[slot]) ?? ctx.planos?.find((x) => String(x.id) === String(a[slot]))?.titulo ?? 'esse plano';
const nomeMeta = (a: Record<string, unknown>, ctx: Contexto, tela: Tela | null) =>
  tituloTela(tela, 'meta', a.p_id) ?? ctx.metas?.find((x) => String(x.id) === String(a.p_id))?.titulo ?? 'essa meta';
/** UX-24: "pausar o plano "Violão" e mudar o nome para …" com os campos que vieram. `alvo` = 'o plano "X"' ou 'a meta "X"'. */
function descreverEdicao(alvo: string, st: string | null, m: string[]): string {
  const mud = m.length ? `mudar ${m.join(' e ')}` : '';
  if (st && mud) return `${st} ${alvo} e ${mud}`;
  if (st) return `${st} ${alvo}`;
  return mud ? `${mud} ${alvo.startsWith('a ') ? 'da' : 'do'} ${alvo.slice(2)}` : `salvar ${alvo}`;
}

export function descreverAcao(slug: string, a: Record<string, unknown>, tela: Tela | null = null, ctx: Contexto = {}): string {
  const p = (a.p ?? {}) as Record<string, any>;
  if (slug === 'plano.editar') {
    const m: string[] = [];
    if (a.p_titulo) m.push(`o nome para "${a.p_titulo}"`);
    if (a.p_alvo_valor) m.push(`o alvo para ${reais(a.p_alvo_valor)}`);
    if (a.p_alvo_data) m.push(`a data para ${dataLonga(a.p_alvo_data)}`);
    if (a.p_porque) m.push('o porquê');
    if (a.p_tipo) m.push(`o tipo para ${a.p_tipo}`);
    return descreverEdicao(`o plano "${nomePlano(a, ctx, tela)}"`, a.p_status ? STATUS_PLANO[String(a.p_status)] ?? null : null, m);
  }
  if (slug === 'meta.editar') {
    const m: string[] = [];
    if (a.p_titulo) m.push(`o nome para "${a.p_titulo}"`);
    if (a.p_prazo) m.push(`o prazo para ${dataLonga(a.p_prazo)}`);
    if (a.p_horizonte) m.push(`o horizonte para ${HORIZONTE[String(a.p_horizonte)] ?? a.p_horizonte}`);
    if (a.p_dono) m.push(`o dono para ${DONO_NOME[String(a.p_dono)] ?? a.p_dono}`);
    if (a.p_alvo) m.push(`o valor para ${reais(a.p_alvo)}`);
    if (a.p_cadencia) m.push(`a cadência para ${a.p_cadencia}`);
    const st = a.p_status ? ({ ...STATUS_META, cancelada: 'arquivar' } as Record<string, string>)[String(a.p_status)] ?? null : null;
    return descreverEdicao(`a meta "${nomeMeta(a, ctx, tela)}"`, st, m);
  }
  if (slug === 'meta.adicionar') {
    const extra = [a.p_alvo ? `de ${reais(a.p_alvo)}` : null, a.p_prazo ? `até ${dataLonga(a.p_prazo)}` : null, a.p_horizonte ? `no ${HORIZONTE[String(a.p_horizonte)] ?? a.p_horizonte}` : null].filter(Boolean).join(' ');
    return `adicionar a meta "${a.p_titulo}"${extra ? ` ${extra}` : ''} ao plano "${nomePlano(a, ctx, tela, 'p_plano')}"`;
  }
  if (slug === 'plano.descartar') return `descartar o rascunho "${nomePlano(a, ctx, tela)}"`;
  if (slug === 'meta.salvar_plano' && p.id != null) {
    const nome = tituloTela(tela, 'meta', p.id) ?? p.titulo ?? 'essa meta';
    const st = p.status ? STATUS_META[p.status] : null;
    const mud = mudancas(p);
    if (st && mud) return `${st} a meta "${nome}" e ${mud}`;
    if (st) return `${st} a meta "${nome}"`;
    return mud ? `${mud} da meta "${nome}"` : `salvar a meta "${nome}"`;
  }
  if (slug === 'meta.salvar' && p.id != null && !p.name) {
    const nome = tituloTela(tela, 'meta_financeira', p.id) ?? 'essa meta';
    if (p.status === 'cancelada') return `cancelar a meta "${nome}"`;
    const m: string[] = [];
    if (p.target_date) m.push(`o prazo para ${dataBR(String(p.target_date))}/${String(p.target_date).slice(0, 4)}`);
    if (p.target_amount) m.push(`o valor para R$ ${Number(p.target_amount).toLocaleString('pt-BR')}`);
    return m.length ? `mudar ${m.join(' e ')} da meta "${nome}"` : `salvar a meta "${nome}"`;
  }
  switch (slug) {
    case 'semana.confirmar': return 'confirmar o plano da semana';
    case 'plano.salvar': return `salvar o plano "${p.titulo ?? ''}"${p.status ? ` como ${p.status}` : ''}`;
    case 'plano.confirmar': return 'ativar esse plano';
    case 'meta.salvar': return `salvar a meta "${p.name ?? ''}"${p.target_amount ? ` de R$ ${Number(p.target_amount).toLocaleString('pt-BR')}` : ''}`;
    case 'meta.salvar_plano': return `salvar a meta "${p.titulo ?? ''}" no plano`;
    case 'decisao.decidir': return `decidir pela opção "${a.p_escolha ?? ''}"`;
    case 'proposta.decidir': return a.p_aceitar ? 'aceitar a proposta de ajuste' : 'recusar a proposta de ajuste';
    default: return `executar "${slug}"`;
  }
}

/** Fala depois da execução: repete o que entendeu (risco baixo/médio) usando só dados já validados e o retorno da RPC. */
export function falaExecucao(intencao: Intencao, args: Record<string, unknown>, resultado: unknown, ctx: Contexto): string {
  const r = (resultado ?? {}) as Record<string, any>;
  const p = (args.p ?? {}) as Record<string, any>;
  switch (intencao.slug) {
    case 'peso.registrar': return `Anotei ${nomeKg(args.p_kg)} kg.`;
    case 'leitura.registrar': return typeof r.fala === 'string' && r.fala ? r.fala : `Anotei: página ${args.p_pagina}.`;
    case 'pratica.registrar': return typeof r.fala === 'string' && r.fala ? r.fala : `Anotei: ${args.p_minutos} min${args.p_habilidade ? ` de ${args.p_habilidade}` : ''}.`;
    case 'casa.item_status': {
      const t = ctx.itens?.find((i) => i.id === args.p_id)?.titulo ?? 'o item';
      return args.p_status === 'adiado' ? `Adiei "${t}"${args.p_adiar_para ? ` para ${dataBR(String(args.p_adiar_para))}` : ' para amanhã'}.` : `Marquei "${t}" como ${args.p_status}.`;
    }
    case 'sabia.item': return `Marquei "${ctx.trilha?.find((i) => i.id === args.p_id)?.titulo ?? 'o item da trilha'}" como ${args.p_status}.`;
    case 'agenda.compromisso_salvar':
      return `Marquei "${p.titulo}" ${diaSemana(p.data)}, ${dataBR(p.data)}${p.inicio ? ` às ${horaBR(p.inicio)}` : ''}${p.local ? `, ${p.local}` : ''}.`;
    case 'agenda.compromisso_cancelar': return `Cancelei "${ctx.compromissos?.find((i) => i.id === args.p_id)?.titulo ?? 'o compromisso'}".`;
    case 'semana.confirmar': return typeof resultado === 'number' && resultado > 0 ? `Confirmei a semana: ${resultado} ${resultado === 1 ? 'item entrou' : 'itens entraram'} no seu dia.` : 'A semana já estava confirmada.';
    case 'semana.ouvir': {
      // UX-22: a fala inteira (60 palavras) é da tela; no comando entra a primeira decisão, uma pergunta só.
      const prox = (r.proxima ?? null) as { pergunta?: string } | null;
      if (!r.plano_id) return 'Ainda não há plano da semana para revisar.';
      return prox?.pergunta ? limparFala(`Tenho ${r.pendentes} ${r.pendentes === 1 ? 'decisão' : 'decisões'} para a semana. ${prox.pergunta}`) : 'A semana está sem conflitos. Confirma a semana?';
    }
    case 'semana.responder': return typeof r.fala === 'string' && r.fala ? limparFala(r.fala) : 'Anotei.';
    case 'semana.item': return args.p_incluido ? 'Voltei o item para o plano da semana.' : 'Tirei o item do plano da semana.';
    case 'semana.item_editar': return `Passei o item para ${dataBR(String(args.p_data))} às ${horaBR(String(args.p_hora))}.`;
    case 'lancamento.categorizar': return `Categorizei ${(args.p_ids as unknown[]).length} lançamento(s) como ${ctx.categorias?.find((c) => c.id === args.p_category)?.nome ?? args.p_category}.`;
    case 'lancamento.confirmar': return `Confirmei ${(args.p_ids as unknown[]).length} lançamento(s).`;
    case 'plano.editar': return r.mudou === false ? 'Nada mudou no plano.' : `Pronto, atualizei o plano${r.titulo ? ` "${r.titulo}"` : ''}.`;
    case 'plano.descartar': return `Descartei o rascunho "${r.titulo ?? ''}".`;
    case 'meta.editar': return r.mudou === false ? 'Nada mudou na meta.'
      : `Pronto, atualizei a meta${r.titulo ? ` "${r.titulo}"` : ''}.${Array.isArray(r.goals_criadas) && r.goals_criadas.length ? ' Criei também a meta em Finanças.' : ''}`;
    case 'meta.adicionar': return r.ja_existia ? `A meta "${r.titulo ?? ''}" já estava no plano.`
      : `Adicionei a meta "${r.titulo ?? ''}".${Array.isArray(r.goals_criadas) && r.goals_criadas.length ? ' Criei também a meta em Finanças.' : ''}`;
    case 'expediente.definir': return `Expediente salvo: ${r.inicio ?? ''} às ${r.fim ?? ''}.`;
    case 'lugar.salvar': return `Salvei o lugar "${args.p_nome}".`;
    case 'lugar.remover': return resultado === false ? `Não achei o lugar "${args.p_nome}".` : `Tirei "${args.p_nome}" dos seus lugares.`;
    case 'semana.gerar': return 'Pedi o plano da semana. Se ela ainda não foi confirmada, fica pronto em cerca de 1 minuto em Semana.';
    case 'agenda.sincronizar': return r.ok !== false ? 'Agenda sincronizada.'
      : /secret|não conectada/i.test(String(r.motivo ?? '')) ? 'Sua agenda ainda não está conectada ao app.' : 'Não consegui sincronizar a agenda agora.';
    case 'meta.salvar_plano': return p.id != null ? 'Pronto, atualizei a meta.' : `Criei a meta "${p.titulo ?? ''}".`;
    case 'livro.salvar': return `Salvei o livro "${p.titulo ?? ''}".`;
    case 'financas.quanto_posso_gastar': return limparFala(String(r.reply ?? 'Não consegui calcular agora.'));
    case 'planos.status': {
      const lista = (Array.isArray(resultado) ? resultado : []) as { titulo?: string; status?: string }[];
      const ativos = lista.filter((x) => x.status === 'ativo');
      if (!lista.length) return 'Você ainda não tem planos. Quer criar o primeiro?';
      return limparFala(`Você tem ${lista.length} plano${lista.length > 1 ? 's' : ''}, ${ativos.length} ativo${ativos.length === 1 ? '' : 's'}: ${lista.slice(0, 3).map((x) => x.titulo).join(', ')}.`);
    }
    default: return typeof r.fala === 'string' && r.fala ? limparFala(r.fala) : 'Pronto, feito.';
  }
}

// ---------- resposta a uma confirmação pendente e "desfaz" (UX-16) ----------

export function respostaCurta(texto: string): 'sim' | 'nao' | null {
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, '').trim();
  if (/^(sim|pode|pode sim|confirmo|confirma|isso|ok|claro|manda ver)$/.test(t)) return 'sim';
  if (/^(nao|nao pode|cancela|deixa|esquece)$/.test(t)) return 'nao';
  return null;
}
/** "desfaz" reconhecido em código, antes do roteador (nenhuma IA). */
export function pedidoDesfazer(texto: string): boolean {
  const t = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z ]/g, '').trim();
  return /^(desfaz|desfazer|desfaz isso|desfaz essa|desfaz ai|pode desfazer|volta atras|anula|anula isso)$/.test(t);
}
export function ultimoPendente(turnos: Turno[], agora = Date.now()): Record<string, any> | null {
  const t = [...turnos].reverse().find((x) => x.papel === 'iara');
  if (!t?.pendente) return null;
  if (t.at && agora - Date.parse(t.at) > JANELA_MIN * 60_000) return null;
  return t.pendente;
}

// ---------- custo (rota <= US$ 0,001 por comando de escrita) ----------

/** Haiku 5.5: US$ 0,10 entrada / 0,50 saída por MTok; leitura de cache = 0,1 x entrada; ~3,5 caracteres por token. */
export function estimarRotaUsd(systemChars: number, usuarioChars: number, saidaTokens = 120, cacheado = true): number {
  const sys = systemChars / 3.5, usr = usuarioChars / 3.5;
  return ((cacheado ? sys * 0.1 : sys) * 0.10 + usr * 0.10 + saidaTokens * 0.50) / 1e6;
}

// ---------- orquestração com dependências injetadas (testável sem IA/banco) ----------

export type Deps = {
  catalogo: Intencao[]; turnos: Turno[]; contexto: Contexto; hoje: string;
  /** UX-23: o que o Leo vê na tela do hub (null fora do hub). */
  tela?: Tela | null;
  rotear: (system: string, usuario: string) => Promise<unknown>;
  chamar: (destino: Destino, args: Record<string, unknown>, textoLeo: string, intencao: string) => Promise<unknown>;
  acoes: Acoes;
};
export type Saida = Resposta & { intencao: string | null; slots: Record<string, unknown> | null; rota?: Rota };

const MSG_ERRO = 'Não consegui fazer isso agora. Tente de novo ou abra a tela do módulo.';
const MSG_EXPIROU = 'Essa confirmação expirou, quer refazer?';

/** Retorno de hub_acao_pedir (acao_id + status) ou de uma RPC comum: separa resultado, desfazer e pendência. */
export function desempacotar(r: unknown): { resultado: unknown; desfazer: Desfazer | null; acao: AcaoInfo | null } {
  if (r && typeof r === 'object' && !Array.isArray(r) && 'acao_id' in r && 'status' in r) {
    const a = r as AcaoInfo;
    if (a.status === 'erro') throw new Error(a.erro ?? 'erro');
    return { resultado: a.resultado ?? null, desfazer: a.desfazer ?? null, acao: a };
  }
  return { resultado: r, desfazer: null, acao: null };
}

function pendenteConfirmacao(intencao: string, slots: Record<string, unknown>, pergunta: string, acao?: AcaoInfo | null): Record<string, unknown> {
  return { tipo: 'confirmacao', intencao, slots, pergunta, ...(acao?.acao_id != null ? { acao_id: acao.acao_id, expira_em: acao.expira_em } : {}) };
}

export async function processar(texto: string, d: Deps, opts: { dryRun?: boolean } = {}): Promise<Saida> {
  // "desfaz": desfaz a última ação executada nos últimos 10 min (sem IA).
  if (!opts.dryRun && pedidoDesfazer(texto)) {
    const r = await d.acoes.desfazerUltima();
    return { fala: limparFala(r.fala), tela: { intencao: 'acao.desfazer', executou: r.ok }, pendente: null, desfazer: null, intencao: 'acao.desfazer', slots: null };
  }
  const pend = ultimoPendente(d.turnos);
  const curta = respostaCurta(texto);
  if (!opts.dryRun && pend?.tipo === 'confirmacao' && curta) {
    const id = Number(pend.acao_id);
    const base = { intencao: pend.intencao ?? null, slots: pend.slots ?? null };
    if (!Number.isFinite(id)) return { fala: MSG_EXPIROU, tela: null, pendente: null, ...base };
    try {
      if (curta === 'nao') {
        await d.acoes.cancelar(id);
        return { fala: 'Certo, não fiz nada.', tela: null, pendente: null, intencao: null, slots: null };
      }
      const r = await d.acoes.confirmar(id);
      if (r.status !== 'executada') {
        const fala = r.status === 'erro' ? MSG_ERRO : r.status === 'expirada' ? MSG_EXPIROU : (r.fala ?? MSG_EXPIROU);
        return { fala: limparFala(fala), tela: r.status === 'erro' ? { intencao: pend.intencao, executou: false, erro: String(r.erro ?? '').slice(0, 200) } : null, pendente: null, ...base };
      }
      const intencao = d.catalogo.find((c) => c.slug === (r.intencao ?? pend.intencao));
      const args = (r.args ?? pend.slots ?? {}) as Record<string, unknown>;
      const fala = intencao ? falaExecucao(intencao, args, r.resultado, d.contexto) : 'Pronto, feito.';
      return { fala, tela: { intencao: intencao?.slug, risco: intencao?.risco, executou: true, resultado: r.resultado }, pendente: null, desfazer: r.desfazer ?? null, ...base, slots: args };
    } catch (e) {
      console.error('iara-comando confirmar', e);
      return { fala: MSG_ERRO, tela: { intencao: pend.intencao, executou: false, erro: String((e as Error).message ?? e).slice(0, 200) }, pendente: null, ...base };
    }
  }
  const system = montarSystem(d.catalogo);
  const usuario = montarUsuario(texto, d.hoje, diaSemana(d.hoje), d.turnos, d.contexto, d.tela ?? null);
  const rota = normalizarRota(await d.rotear(system, usuario), d.catalogo);
  const plano = planejar(rota, d.catalogo, d.contexto, texto, d.turnos.filter((t) => t.papel === 'leo').map((t) => t.texto), d.tela ?? null);
  const base = { intencao: resolverSlug(rota, d.catalogo), slots: rota.slots };
  if (plano.tipo === 'confirmar') {
    // Grava a ação pendente (expira em 10 min); o "sim" seguinte executa a ação GRAVADA, não o que o modelo disser de novo.
    const p = plano.resposta.pendente as { intencao: string; slots: Record<string, unknown>; pergunta: string };
    if (opts.dryRun) return { ...plano.resposta, ...base, rota };
    try {
      const acao = await d.acoes.criar(p.intencao, p.slots, p.pergunta);
      return { ...plano.resposta, pendente: pendenteConfirmacao(p.intencao, p.slots, p.pergunta, acao), ...base, rota };
    } catch (e) {
      console.error('iara-comando criar acao', e);
      return { fala: MSG_ERRO, tela: { intencao: p.intencao, executou: false }, pendente: null, ...base, rota };
    }
  }
  if (plano.tipo !== 'executar') return { ...plano.resposta, ...base, rota };
  if (exigeSim(plano.intencao)) throw new Error(`risco alto sem confirmação: ${plano.intencao.slug}`); // nunca executa sem "sim" gravado
  if (opts.dryRun) return { fala: '(simulação)', tela: { destino: plano.destino, args: plano.args }, pendente: null, ...base, rota };
  try {
    const bruto = await d.chamar(plano.destino, plano.args, texto, plano.intencao.slug);
    const { resultado, desfazer, acao } = desempacotar(bruto);
    if (acao?.status === 'pendente') { // o banco exigiu "sim" (política única): vira confirmação, não execução
      const q = acao.pergunta ?? `Vou ${descreverAcao(plano.intencao.slug, plano.args, d.tela ?? null, d.contexto)}. Confirma?`;
      return { fala: limparFala(q), tela: { intencao: plano.intencao.slug, risco: plano.intencao.risco, executou: false }, pendente: pendenteConfirmacao(plano.intencao.slug, plano.args, q, acao), ...base, slots: plano.args, rota };
    }
    const fala = falaExecucao(plano.intencao, plano.args, resultado, d.contexto);
    return { fala, tela: { intencao: plano.intencao.slug, risco: plano.intencao.risco, executou: true, resultado }, pendente: null, desfazer, ...base, slots: plano.args, rota };
  } catch (e) {
    console.error('iara-comando executar', plano.intencao.slug, e);
    return { fala: MSG_ERRO, tela: { intencao: plano.intencao.slug, executou: false, erro: String((e as Error).message ?? e).slice(0, 200) }, pendente: null, ...base, rota };
  }
}

// ---------- UX-25: pelo Atalho "IARA", a pergunta ao AIrton é respondida por push ----------
// (só ela: as outras falas já cabem no contrato de voz; o corte do hub e o da voz dão ~40 palavras, então não há "resto" a mandar.)

export type EstadoPush = 'agora' | 'silencio' | 'sem_vaga' | 'nao_membro';
export const FALA_AIRTON_PUSH: Record<Exclude<EstadoPush, 'nao_membro'>, string> = {
  agora: 'Vou ver com o AIrton e te mando a resposta no push.',
  silencio: 'Vou ver com o AIrton. A resposta chega por push quando acabar o seu horário de silêncio.',
  sem_vaga: 'Hoje já usei todos os seus avisos, então não consigo mandar por push. Pergunte pelo app.',
};
