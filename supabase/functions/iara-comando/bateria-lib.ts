// UX-18: partes puras da bateria (testáveis sem rede): checagem do contrato de fala e extração de números.
import { MAX_PALAVRAS_COMANDO } from './_shared/fala.ts';

export type Fonte = { rpc: string; schema?: string; campo: string };

/** Contrato: sem `*`/`#`/lista/quebra de linha, até 40 palavras, não vazia. */
export function avaliarFala(fala: string): { ok: boolean; erros: string[] } {
  const erros: string[] = [];
  if (!fala.trim()) erros.push('vazia');
  if (/[*#]/.test(fala)) erros.push('markdown');
  if (/\n/.test(fala) || /(^|\s)[-•]\s/.test(fala) || /^\s*\d+[.)]\s/.test(fala)) erros.push('lista');
  if (fala.trim().split(/\s+/).length > MAX_PALAVRAS_COMANDO) erros.push('palavras');
  return { ok: erros.length === 0, erros };
}

const PALAVRAS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

/** Números ditos na fala, em reais/unidades: "R$ 1.235", "85", "2,5 mil" (= 2500), "dois". */
export function numerosDaFala(fala: string): number[] {
  const out: number[] = [];
  for (const m of fala.matchAll(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(\s*(?:mil|mi|milhões?|milhão))?/gi)) {
    let v = Number(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
    const suf = (m[3] ?? '').trim().toLowerCase();
    if (suf === 'mil') v *= 1000; else if (suf) v *= 1_000_000;
    out.push(v);
  }
  for (const w of fala.toLowerCase().split(/[^a-zçãé]+/)) if (w in PALAVRAS) out.push(PALAVRAS[w]);
  return out;
}

/** Campo do dado de verdade: 'perDay', 'committed.total' ou 'length' (tamanho da lista). */
export function valorDoCampo(dado: unknown, campo: string): number | null {
  let v: any = dado;
  if (campo === 'length') return Array.isArray(v) ? v.length : null;
  for (const k of campo.split('.')) v = v?.[k];
  const n = Number(v);
  return v === null || v === undefined || !Number.isFinite(n) ? null : n;
}

export function mediana(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
