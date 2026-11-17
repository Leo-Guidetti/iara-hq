// IARA · versão falável do briefing: separa texto e fala e limpa a fala para a voz do aparelho.
export const MARCA_FALA = '###FALA###';
export const MAX_PALAVRAS_FALA = 70;

/** Corta no marcador: texto (para ler) e fala (bruta, ou null se o modelo não mandou). */
export function separarFala(saida: string): { texto: string; fala: string | null } {
  const i = saida.indexOf(MARCA_FALA);
  if (i < 0) return { texto: saida.trim(), fala: null };
  return { texto: saida.slice(0, i).trim(), fala: saida.slice(i + MARCA_FALA.length).trim() || null };
}

/** Sem markdown, sem marcadores, até 70 palavras, terminando na última frase completa que couber. */
export function limparFala(bruta: string | null | undefined): string | null {
  if (!bruta) return null;
  let t = bruta
    .replace(/^\s*(?:[-•*+]|\d+[.)])\s+/gm, '')
    .replace(/[*#_`>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const palavras = t.split(' ');
  if (palavras.length > MAX_PALAVRAS_FALA) {
    const corte = palavras.slice(0, MAX_PALAVRAS_FALA).join(' ');
    const m = corte.match(/^[\s\S]*[.!?…](?=\s|$)/);
    t = m ? m[0].trim() : corte.replace(/[,;:\s]+$/, '') + '.';
  }
  return t;
}
