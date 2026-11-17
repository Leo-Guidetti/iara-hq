// IARA · semana (UX-14, UX-22): partes puras (sem banco, sem IA) para testar sem chave.
import { limparFala } from './_shared/fala.ts';

export type MetaSemana = { id: number; plano?: string; titulo?: string };
export type ItemEditado = { id: number; data: string; area: string; titulo: string; ref: string | null; incluido: boolean };

/** meta_id vindo do modelo só vale se for de uma das metas enviadas; senão null. */
export function validarMetaId(v: unknown, metas: { id: number | string }[]): number | null {
  const n = typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v)) ? Number(v) : NaN;
  return Number.isInteger(n) && metas.some((m) => Number(m.id) === n) ? n : null;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Ids do rascunho que podem ser apagados ao refazer: tudo que o Leo NÃO moveu nem tirou (editado = true fica). */
export const idsParaApagar = (itens: { id: number; editado: boolean }[]): number[] => itens.filter((i) => !i.editado).map((i) => Number(i.id));

/** Itens novos do modelo que repetem um item que o Leo já decidiu (mesmo ref, ou mesma área+título): descartados. */
export function semDuplicarEditados<T extends { area: string; titulo: string; ref: string | null }>(novos: T[], editados: { area: string; titulo: string; ref: string | null }[]): T[] {
  const refs = new Set(editados.filter((e) => e.ref).map((e) => e.ref));
  const chaves = new Set(editados.map((e) => `${e.area}|${norm(e.titulo)}`));
  return novos.filter((n) => !(n.ref && refs.has(n.ref)) && !chaves.has(`${n.area}|${norm(n.titulo)}`));
}

// ---------- UX-22: fala e decisões fechadas ----------

export const MAX_DECISOES = 3;
export const MAX_OPCOES = 3;
export const MAX_PALAVRAS_SEMANA = 60;
export type Efeito = { tipo: 'mover' | 'tirar' | 'manter'; item_idx: number[]; data: string | null; hora: string | null; opcao: string | null };
export type DecisaoBruta = { id: string; pergunta: string; opcoes: string[]; padrao: string; efeito: Efeito; escolha: null };
export type Decisao = Omit<DecisaoBruta, 'efeito'> & { efeito: Omit<Efeito, 'item_idx'> & { item_ids: number[] } };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const palavras = (s: string, n: number) => s.split(' ').slice(0, n).join(' ');
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[*_`#>|\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Fala da semana: contrato §3.6 (sem markdown, R$ arredondado) com no máximo 60 palavras. null se vier vazia. */
export const falaSemana = (v: unknown): string | null => limparFala(typeof v === 'string' ? v : '', 4, MAX_PALAVRAS_SEMANA) || null;

/**
 * Decisões do modelo: até 3, cada uma com pergunta, 2 a 3 opções curtas, padrão dentre as opções e efeito.
 * Os itens são citados pela posição (item_idx) na lista `itens` que o modelo devolveu; só valem posições em `validos`
 * (itens que de fato foram gravados). mover precisa de data dentro da semana; mover/tirar precisam de `opcao` entre as opções
 * e de ao menos um item; senão a decisão é descartada (não vira decisão sem efeito). Nunca lança por conteúdo ruim.
 */
export function normalizarDecisoes(raw: unknown, validos: Set<number>, janela: { desde: string; fim: string }): DecisaoBruta[] {
  const out: DecisaoBruta[] = [];
  for (const d of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_DECISOES) break;
    const pergunta = palavras(txt(d?.pergunta, 200), 30);
    const vistas = new Set<string>();
    const opcoes: string[] = [];
    for (const o of Array.isArray(d?.opcoes) ? d.opcoes : []) {
      const r = txt(o, 40);
      if (r && !vistas.has(r.toLowerCase())) { vistas.add(r.toLowerCase()); opcoes.push(r); }
      if (opcoes.length >= MAX_OPCOES) break;
    }
    if (!pergunta || opcoes.length < 2) continue;
    const casa = (v: unknown) => opcoes.find((o) => o.toLowerCase() === txt(v, 40).toLowerCase()) ?? null;
    const padrao = casa(d?.padrao) ?? opcoes[0];
    const tipo = d?.efeito?.tipo;
    const idx = [...new Set((Array.isArray(d?.efeito?.item_idx) ? d.efeito.item_idx : []).map(Number).filter((n: number) => Number.isInteger(n) && validos.has(n)))] as number[];
    let efeito: Efeito = { tipo: 'manter', item_idx: [], data: null, hora: null, opcao: null };
    if (tipo === 'mover' || tipo === 'tirar') {
      const opcao = casa(d.efeito.opcao);
      const data = typeof d.efeito.data === 'string' && ISO.test(d.efeito.data) && d.efeito.data >= janela.desde && d.efeito.data <= janela.fim ? d.efeito.data : null;
      const hora = typeof d.efeito.hora === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.efeito.hora) ? d.efeito.hora : null;
      if (!opcao || !idx.length || (tipo === 'mover' && !data)) continue;
      efeito = { tipo, item_idx: idx.slice(0, 5), data: tipo === 'mover' ? data : null, hora: tipo === 'mover' ? hora : null, opcao };
    }
    out.push({ id: `d${out.length + 1}`, pergunta, opcoes, padrao, efeito, escolha: null });
  }
  return out;
}

/** Troca as posições (item_idx) pelos ids gravados no banco; decisão cujo item sumiu (ex.: descartado por duplicar) é descartada. */
export function resolverIds(decisoes: DecisaoBruta[], idPorIdx: Map<number, number>): Decisao[] {
  const out: Decisao[] = [];
  for (const d of decisoes) {
    const { item_idx, ...resto } = d.efeito;
    const item_ids = item_idx.map((i) => idPorIdx.get(i)).filter((x): x is number => typeof x === 'number');
    if (d.efeito.tipo !== 'manter' && !item_ids.length) continue;
    out.push({ ...d, efeito: { ...resto, item_ids } });
  }
  return out.map((d, n) => ({ ...d, id: `d${n + 1}` }));
}
