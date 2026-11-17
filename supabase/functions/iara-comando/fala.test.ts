// UX-18: contrato de fala. Rodar: cd supabase/functions && DENO_NO_PACKAGE_JSON=1 npx -y deno@2 test --allow-read iara-comando/fala.test.ts
import { arredondarReais, canalFala, limparFala, limparFalaHub, MAX_PALAVRAS_COMANDO, SUFIXO_FALA } from './_shared/fala.ts';

const ok = (c: boolean, m: string) => { if (!c) throw new Error('FALHOU: ' + m); };
const n = (s: string) => s.split(' ').length;
const limpo = (s: string) => !/[*#_`>|\n]/.test(s) && !/^\s*(?:[-•+]|\d+[.)])\s/m.test(s);

Deno.test('limparFala: exemplos ruins saem limpos, <= 2 frases e 40 palavras', () => {
  const ruins = [
    '**Você pode gastar R$ 85,40 hoje.**\n- Mercado: R$ 30,00\n- Lazer: R$ 55,40\nQuer o resto?',
    '# Resumo\n1. Sobra R$ 1.234,56\n2. Meta ok\n* detalhe\nTexto final.',
    'Pelo AIrton, `R$ 2.340,99` livres. Tem mais. Muito mais. Mesmo mais.',
    Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(' '),
    '| a | b |\n|---|---|\n| 1 | 2 |',
    'Veja [o painel](https://x.y/z) agora. Depois ```codigo``` fim.',
  ];
  for (const r of ruins) {
    const f = limparFala(r);
    ok(limpo(f), `markdown/lista: ${f}`);
    ok(n(f) <= MAX_PALAVRAS_COMANDO, `palavras: ${f}`);
    ok((f.match(/[.!?](\s|$)/g) ?? []).length <= 2 || /R\$/.test(f), `frases: ${f}`);
  }
  ok(limparFala(ruins[0]).startsWith('Você pode gastar R$ 85 hoje.'), limparFala(ruins[0]));
  ok(limparFala('Uma. Duas. Três.') === 'Uma. Duas.', 'duas frases');
  const longa = limparFala('Primeira frase com algumas palavras agora. ' + ['Muito', ...Array(44).fill('muito')].join(' ') + '.');
  ok(longa === 'Primeira frase com algumas palavras agora.', 'derruba a frase que estoura: ' + longa);
  ok(limparFala(null as unknown as string) === '', 'vazio');
});

Deno.test('limparFala: mantém a pergunta final (conclusão + pergunta)', () => {
  const f = limparFala('Você pode gastar R$ 85,40 por dia. O mês fecha com R$ 2.340,80 livres. Quer o resto?');
  ok(f === 'Você pode gastar R$ 85 por dia. Quer o resto?', f);
  const longa = limparFala(Array(60).fill('palavra').join(' ') + '. Meio qualquer. Quer o resto?');
  ok(longa.endsWith('Quer o resto?') && n(longa) <= MAX_PALAVRAS_COMANDO && limpo(longa), longa);
  const dupla = limparFala('Sobram R$ 120 por dia. ' + Array(50).fill('Mais').join(' ') + '. Quer o resto?');
  ok(dupla === 'Sobram R$ 120 por dia. Quer o resto?', dupla);
});

Deno.test('limparFalaHub: sem limite de palavras, corte em 240 caracteres (UX-15/16)', () => {
  const f = limparFalaHub('Uma frase ' + Array(100).fill('ab').join(' ') + '. Outra.');
  ok(f.length <= 240 && f.endsWith('...') && n(f) > MAX_PALAVRAS_COMANDO, f + ' ' + n(f));
  ok(limparFalaHub('# Título\n**Uma.** Duas. Três.') === 'Título Uma. Duas.', 'duas frases');
});

Deno.test('arredondarReais: padrão = reais inteiros; erro <= 5% (menos de R$ 100 só se couber)', () => {
  ok(arredondarReais('R$ 1.234,56') === 'R$ 1.235', 'milhar');
  ok(arredondarReais('R$ 2.340,49') === 'R$ 2.340', 'baixo');
  ok(arredondarReais('R$ 12,40') === 'R$ 12', '<100 ok');
  ok(arredondarReais('R$ 1,50') === 'R$ 1,50', '<100 sem arredondar quando passa de 5%');
  ok(arredondarReais('R$ 0,40') === 'R$ 0,40', 'zero');
  ok(arredondarReais('sobram R$ 85,40 e R$ 1.200 fixos') === 'sobram R$ 85 e R$ 1.200 fixos', 'sem centavos intacto');
  for (const v of [3.2, 7.9, 12.4, 99.5, 100.6, 1234.56, 98765.43, 0.99, 45.5]) {
    const txt = `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const m = arredondarReais(txt).match(/R\$ ([\d.]+)(?:,(\d+))?/)!;
    const falado = Number(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
    ok(Math.abs(falado - v) / v <= 0.05, `${txt} -> ${falado}`);
  }
});

Deno.test('canal e sufixo', () => {
  ok(canalFala('voz') && canalFala('atalho') && canalFala('voice') && !canalFala('hub') && !canalFala('chat'), 'canais');
  ok(SUFIXO_FALA.length < 600, `sufixo curto (~${Math.round(SUFIXO_FALA.length / 3.5)} tokens)`);
  ok(!/\$\{|Date|\d{4}-\d{2}/.test(SUFIXO_FALA), 'sufixo fixo, sem parte variável (cache)');
});

Deno.test('fala.ts idêntico em iara-comando, airton-ai e iara-plano', async () => {
  const ler = (f: string) => Deno.readTextFile(new URL(`../${f}/_shared/fala.ts`, import.meta.url));
  const base = await ler('iara-comando');
  ok(base === await ler('airton-ai'), 'airton-ai difere');
  ok(base === await ler('iara-plano'), 'iara-plano difere');
});
