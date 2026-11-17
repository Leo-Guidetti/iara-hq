// IARA · semana (UX-14): partes puras (sem banco, sem IA) para testar sem chave.

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
