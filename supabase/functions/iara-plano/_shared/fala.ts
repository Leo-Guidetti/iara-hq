// IARA · contrato de fala do canal voz (UX-18, plano.md §3.6). ESTE ARQUIVO É IDÊNTICO em iara-comando, airton-ai e iara-plano
// (cada função tem o próprio _shared; o teste em iara-comando/fala.test.ts confere byte a byte). Mexeu aqui, copie nas três.
// Persona única: só a IARA fala; o especialista aparece como origem do dado, nunca como passagem de conversa.

/** Sufixo FIXO do system no canal voz (nada variável: o prefixo continua cacheável por canal). ~130 tokens. */
export const SUFIXO_FALA = `CANAL DE VOZ: você é a IARA e sua resposta será falada em voz alta. Use no máximo 2 frases, com a conclusão primeiro. Sem markdown, listas, emojis nem tabelas. Arredonde valores (R$ 1.234,56 vira R$ 1.235). Faça no máximo 1 pergunta. Se houver mais a dizer, termine com "Quer o resto?". Os dados vêm dos especialistas: cite-os como origem do dado ("pelo AIrton, ..."), sem passar a conversa nem trocar de voz.`;

export const MAX_PALAVRAS_COMANDO = 40;

/** Canais que falam (o hub em texto segue como está). */
export const canalFala = (canal: unknown): boolean => canal === 'voz' || canal === 'atalho' || canal === 'voice';

/**
 * Padrão de dinheiro: reais inteiros ("R$ 1.234,56" -> "R$ 1.235"). Abaixo de R$ 100 só arredonda se o erro ficar <= 5%
 * (R$ 12,40 -> R$ 12; R$ 1,50 continua R$ 1,50), então todo valor falado fica a no máximo 5% do dado.
 */
export function arredondarReais(s: string): string {
  return s.replace(/R\$\s?(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/g, (m, i: string, c: string) => {
    const v = Number(i.replace(/\./g, '')) + Number(c) / 100;
    const n = Math.round(v);
    if (v < 100 && (n === 0 || Math.abs(n - v) / v > 0.05)) return m;
    return `R$ ${n.toLocaleString('pt-BR')}`;
  });
}

/**
 * Limpa toda fala: sem markdown/lista, dinheiro arredondado, até `maxFrases` frases e `maxPalavras` palavras (corta em frase inteira).
 * Se o texto termina em pergunta ("Quer o resto?"), ela é mantida: conclusão + pergunta, e o meio é cortado.
 */
export function limparFala(s: string, maxFrases = 2, maxPalavras = MAX_PALAVRAS_COMANDO, maxChars = Infinity): string {
  const t = arredondarReais(String(s ?? '')
    .replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-•*+]|\d+[.)])\s+/gm, '').replace(/[*_`#>~|]+/g, '')
    .replace(/\s+/g, ' ').trim());
  const frases = t.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ"])/).map((f) => f.trim()); // não corta em "R$ 2.340"
  const ultima = frases[frases.length - 1] ?? '';
  const pergunta = frases.length > maxFrases && ultima.endsWith('?');
  const fs = pergunta ? [...frases.slice(0, maxFrases - 1), ultima] : frases.slice(0, maxFrases);
  const nPal = (x: string) => (x ? x.split(' ').length : 0);
  const total = () => nPal(fs.join(' '));
  if (pergunta) {
    // conclusão primeiro: encurta a conclusão (não a pergunta) até caber
    while (fs.length > 2 && total() > maxPalavras) fs.splice(fs.length - 2, 1);
    if (total() > maxPalavras) {
      const sobra = Math.max(1, maxPalavras - nPal(ultima));
      fs[0] = fs[0].split(' ').slice(0, sobra).join(' ').replace(/[,;:\s]+$/, '').replace(/[.!?…]+$/, '') + '.';
    }
  } else {
    while (fs.length > 1 && total() > maxPalavras) fs.pop();
  }
  let corte = fs.join(' ');
  if (nPal(corte) > maxPalavras) corte = corte.split(' ').slice(0, maxPalavras).join(' ').replace(/[,;:\s]+$/, '').replace(/[.!?…]+$/, '') + '.';
  return corte.length > maxChars ? corte.slice(0, maxChars - 3).replace(/\s+\S*$/, '') + '...' : corte;
}

/** Canal hub (texto): comportamento do UX-15/16 — 2 frases e corte em 240 caracteres, sem limite de palavras. */
export const limparFalaHub = (s: string): string => limparFala(s, 2, Infinity, 240);
