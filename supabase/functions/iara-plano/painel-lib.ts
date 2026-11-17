// IARA · painel a favor/contra/neutro (UX-13): partes puras (sem banco, sem IA) para testar sem chave.
// Quem vota (plano.md §3.5), recorte do domínio de cada agente, normalização das posições (confiança 0-10, 2 a 4 posições),
// normalização da síntese (fala até 2 frases, sem markdown) e teto por execução (US$ 0,03).
import { limparFala } from './plano-lib.ts';

export const TETO_PAINEL_USD = 0.03;
export const MAX_PAINEIS_MES = 10;
export const AGENTES = ['airton', 'claudia', 'sabia', 'iara'] as const;
export const POSICOES = ['favor', 'contra', 'neutro'] as const;
export type Agente = typeof AGENTES[number];
export type Posicao = { agent: Agente; posicao: typeof POSICOES[number]; confianca: number; argumento: string; condicao: string | null };
export type Sintese = { concordancia: string; divergencia: string; recomendacao: string; fala: string; opcao_recomendada: string | null };
export type MetaCtx = { id: number; plano: string; dono: string; titulo: string; demanda?: { reais_mes?: number; minutos_semana?: number } | null; [k: string]: unknown };
export type Ctx = {
  recurso: string; metas: MetaCtx[]; resumo: Record<string, any> | null;
  decisao: { id: number; pergunta: string; opcoes: { id: string; rotulo: string; efeito?: unknown[] }[]; [k: string]: unknown };
};

const reais = (m: MetaCtx) => Number(m.demanda?.reais_mes ?? 0);

/** §3.5: AIrton sempre que há reais_mes > 0; ClaudIA se mexe em sono/treino (meta dela); SabIA se mexe em estudo (meta dela);
 *  IARA pela rotina e pela casa (conflito de tempo ou meta dela). Sempre de 2 a 4: completa com IARA, depois AIrton. */
export function quemVota(ctx: Pick<Ctx, 'recurso' | 'metas'>): Agente[] {
  const v = new Set<Agente>();
  if (ctx.metas.some((m) => reais(m) > 0) || ctx.recurso === 'dinheiro') v.add('airton');
  if (ctx.metas.some((m) => m.dono === 'claudia')) v.add('claudia');
  if (ctx.metas.some((m) => m.dono === 'sabia')) v.add('sabia');
  if (ctx.recurso === 'tempo' || ctx.metas.some((m) => m.dono === 'iara')) v.add('iara');
  for (const a of ['iara', 'airton', 'claudia', 'sabia'] as Agente[]) if (v.size < 2) v.add(a);
  return AGENTES.filter((a) => v.has(a)).slice(0, 4);
}

/** O que cada agente enxerga: só o resumo do próprio domínio e as metas dele (nunca o resumo dos outros). */
export function dominioDe(agent: Agente, ctx: Ctx): Record<string, unknown> {
  const r = ctx.resumo ?? {};
  const metas = ctx.metas.filter((m) => (agent === 'airton' ? reais(m) > 0 || m.dono === 'airton' : m.dono === agent))
    .map(({ id, plano, titulo, prazo, demanda, medida, ritmo, progresso }) => ({ id, plano, titulo, prazo, demanda, medida, ritmo, progresso }));
  const resumo = agent === 'airton' ? { financas: r.financas ?? null, poupanca_mes: r.recursos?.poupanca_mes ?? null }
    : agent === 'claudia' ? { saude: r.saude ?? null }
    : agent === 'sabia' ? { leitura: r.leitura ?? null }
    : { minutos_livres_semana: r.recursos?.minutos_livres_semana ?? null };
  return { resumo, metas };
}

const num = (v: unknown) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** Posição de um agente: confiança vira inteiro 0-10 (fora da faixa é cortada; ausente = 5); posição inválida = neutro. */
export function normalizarPosicao(raw: any, agent: Agente): Posicao {
  const pos = (POSICOES as readonly string[]).includes(raw?.posicao) ? raw.posicao : 'neutro';
  const c = num(raw?.confianca);
  const arg = limparFala(String(raw?.argumento ?? '')).slice(0, 300);
  const cond = limparFala(String(raw?.condicao ?? '')).slice(0, 200);
  return {
    agent, posicao: pos, confianca: c === null ? 5 : Math.min(10, Math.max(0, Math.round(c))),
    argumento: arg || 'Sem argumento informado.', condicao: cond && !/^(—|-|nenhuma?|null)$/i.test(cond) ? cond : null,
  };
}

/** Garante 2 a 4 posições, uma por agente (a primeira vence). Menos de 2 válidas = erro (painel não se grava). */
export function normalizarPosicoes(brutas: { agent: Agente; raw: any }[]): Posicao[] {
  const vistos = new Set<string>(); const out: Posicao[] = [];
  for (const b of brutas) {
    if (!(AGENTES as readonly string[]).includes(b.agent) || vistos.has(b.agent) || !b.raw || typeof b.raw !== 'object') continue;
    vistos.add(b.agent); out.push(normalizarPosicao(b.raw, b.agent));
  }
  if (out.length < 2) throw new Error(`Painel precisa de pelo menos 2 posições válidas (veio ${out.length}).`);
  return out.slice(0, 4);
}

/** Fala: até 2 frases, sem markdown, sem quebra de linha. */
export function falaCurta(s: string): string {
  const t = limparFala(s);
  const frases = t.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return frases.slice(0, 2).join('').trim();
}

export function normalizarSintese(raw: any, opcoes: { id: string }[], posicoes: Posicao[]): Sintese {
  const t = (v: unknown, max: number) => limparFala(String(v ?? '')).slice(0, max);
  const contra = posicoes.filter((p) => p.posicao === 'contra').length, favor = posicoes.filter((p) => p.posicao === 'favor').length;
  const rec = t(raw?.recomendacao, 400) || 'Sem recomendação: a escolha é sua.';
  const fala = falaCurta(String(raw?.fala ?? '')) || falaCurta(`${rec} Quer ver as opções?`);
  const id = typeof raw?.opcao_recomendada === 'string' && opcoes.some((o) => o.id === raw.opcao_recomendada) ? raw.opcao_recomendada : null;
  return {
    concordancia: t(raw?.concordancia, 400) || (favor + contra === 0 ? 'Ninguém tem posição firme.' : ''),
    divergencia: t(raw?.divergencia, 400), recomendacao: rec, fala, opcao_recomendada: id,
  };
}

/** Pior caso do `fast` (Haiku 5.5: US$ 0,10/0,50 por MTok): entrada por caracteres (~3,5/token) + max_tokens inteiro de saída. */
export const estimarFast = (chars: number, maxTokens: number) => (chars / 3.5) * 0.1 / 1e6 + maxTokens * 0.5 / 1e6;
