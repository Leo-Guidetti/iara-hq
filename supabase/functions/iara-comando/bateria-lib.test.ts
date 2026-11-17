import { avaliarFala, mediana, numerosDaFala, valorDoCampo } from './bateria-lib.ts';
import { limparFala } from './_shared/fala.ts';
const ok = (c: boolean, m: string) => { if (!c) throw new Error('FALHOU: ' + m); };

Deno.test('bateria: avaliarFala pega *, #, lista e excesso de palavras', () => {
  ok(avaliarFala('Pelo AIrton, você pode gastar R$ 85 hoje. Quer o resto?').ok, 'boa');
  ok(avaliarFala('**Oi**').erros.includes('markdown'), 'markdown');
  ok(avaliarFala('a\n- b').erros.includes('lista'), 'lista');
  ok(avaliarFala(Array(41).fill('a').join(' ')).erros.includes('palavras'), 'palavras');
  ok(!avaliarFala('').ok, 'vazia');
});
Deno.test('bateria: número falado x dado (5%)', () => {
  ok(numerosDaFala('Você pode gastar R$ 1.235 hoje, 2,5 mil no mês e dois planos.').join() === '1235,2500,2', 'extrai');
  const dado = 1234.56, falado = numerosDaFala(limparFala(`Sobram R$ ${dado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} no mês.`));
  ok(falado.some((n) => Math.abs(n - dado) / dado <= 0.05), 'dentro de 5%');
  ok(valorDoCampo({ a: { b: 7 } }, 'a.b') === 7 && valorDoCampo([1, 2], 'length') === 2 && valorDoCampo({}, 'x') === null, 'campo');
  ok(mediana([5, 1, 3]) === 3 && mediana([1, 2, 3, 4]) === 3 && mediana([]) === 0, 'mediana');
});
