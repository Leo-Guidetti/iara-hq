// deno test supabase/functions/iara-plano/painel-lib.test.ts  (sem banco, sem IA, sem rede)
import { dominioDe, estimarFast, falaCurta, normalizarPosicao, normalizarPosicoes, normalizarSintese, quemVota, TETO_PAINEL_USD, type Ctx } from './painel-lib.ts';
import { estimarSmart, garantirTeto } from './plano-lib.ts';

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };

const CTX: Ctx = {
  recurso: 'dinheiro',
  metas: [
    { id: 1, plano: 'Apartamento', dono: 'airton', titulo: 'Entrada', demanda: { reais_mes: 3900 } },
    { id: 2, plano: 'Carro', dono: 'airton', titulo: 'Carro novo', demanda: { reais_mes: 2500 } },
  ],
  resumo: { financas: { poupanca_base: 5000 }, saude: { peso: { tendencia_7d: 80 } }, leitura: { livros: 3 }, recursos: { poupanca_mes: 5000, minutos_livres_semana: 900 } },
  decisao: { id: 7, pergunta: 'x', opcoes: [{ id: 'adiar:2', rotulo: 'Adiar' }, { id: 'manter', rotulo: 'Manter' }] },
};

Deno.test('quem vota: 2 a 4 agentes, AIrton com dinheiro, sempre >= 2', () => {
  const v = quemVota(CTX);
  ok(v.includes('airton') && v.length >= 2 && v.length <= 4, `dinheiro: ${v}`);
  const t = quemVota({ recurso: 'tempo', metas: [{ id: 1, plano: 'a', dono: 'claudia', titulo: 't' }, { id: 2, plano: 'b', dono: 'sabia', titulo: 's' }] });
  ok(t.join() === 'claudia,sabia,iara', `tempo: ${t}`);
  ok(!t.includes('airton'), 'sem reais_mes AIrton não vota');
  const todos = quemVota({ recurso: 'tempo', metas: [
    { id: 1, plano: 'a', dono: 'claudia', titulo: 't', demanda: { reais_mes: 10 } }, { id: 2, plano: 'b', dono: 'sabia', titulo: 's' }, { id: 3, plano: 'c', dono: 'iara', titulo: 'i' }] });
  ok(todos.length === 4, 'quatro');
});

Deno.test('cada agente vê só o próprio domínio', () => {
  const a = JSON.stringify(dominioDe('airton', CTX)), c = JSON.stringify(dominioDe('claudia', CTX));
  ok(a.includes('poupanca_base') && !a.includes('tendencia_7d') && !a.includes('livros'), 'airton');
  ok(c.includes('tendencia_7d') && !c.includes('poupanca_base'), 'claudia');
  ok(!JSON.stringify(dominioDe('sabia', CTX)).includes('poupanca'), 'sabia');
  ok(!JSON.stringify(dominioDe('iara', CTX)).includes('tendencia_7d'), 'iara');
});

Deno.test('posições de exemplo: confiança 0-10 inteira, posição válida, markdown some', () => {
  ok(normalizarPosicao({ posicao: 'contra', confianca: 8 }, 'airton').confianca === 8, '8');
  ok(normalizarPosicao({ posicao: 'favor', confianca: 14 }, 'iara').confianca === 10, 'corta em 10');
  ok(normalizarPosicao({ posicao: 'favor', confianca: -3 }, 'iara').confianca === 0, 'corta em 0');
  ok(normalizarPosicao({ posicao: 'favor', confianca: 6.6 }, 'iara').confianca === 7, 'arredonda');
  ok(normalizarPosicao({ posicao: 'favor', confianca: 'oito' }, 'iara').confianca === 5, 'inválida = 5');
  ok(normalizarPosicao({ posicao: 'talvez' }, 'iara').posicao === 'neutro', 'posição inválida = neutro');
  const p = normalizarPosicao({ posicao: 'contra', confianca: 8, argumento: '**Atrasa** a entrada', condicao: '—' }, 'airton');
  ok(!/[*#_]/.test(p.argumento) && p.condicao === null, 'markdown e traço');
  const lote = normalizarPosicoes([
    { agent: 'airton', raw: { posicao: 'contra', confianca: 8, argumento: 'a' } },
    { agent: 'airton', raw: { posicao: 'favor', confianca: 1, argumento: 'duplicada' } },
    { agent: 'iara', raw: { posicao: 'favor', confianca: 6, argumento: 'b' } },
    { agent: 'robo' as any, raw: { posicao: 'favor', confianca: 6 } },
    { agent: 'claudia', raw: null },
  ]);
  ok(lote.length === 2 && lote[0].posicao === 'contra', 'dedupe e descarta inválidos');
  let falhou = false;
  try { normalizarPosicoes([{ agent: 'airton', raw: { posicao: 'favor', confianca: 1, argumento: 'só uma' } }]); } catch { falhou = true; }
  ok(falhou, 'menos de 2 posições não se grava');
  ok(normalizarPosicoes(['airton', 'claudia', 'sabia', 'iara', 'airton'].map((agent) => ({ agent: agent as any, raw: { posicao: 'neutro', confianca: 3, argumento: 'x' } }))).length === 4, 'no máximo 4');
});

Deno.test('síntese: fala até 2 frases sem markdown; opção recomendada tem de existir', () => {
  const s = normalizarSintese({
    concordancia: 'Todos concordam que cabe um carro mais barato.', divergencia: 'O prazo do **imóvel**.', recomendacao: 'Adiar o carro.',
    fala: '# Recomendo adiar o carro. O imóvel segue em 2031.\nQuer ver as opções? Posso detalhar.', opcao_recomendada: 'adiar:2',
  }, CTX.decisao.opcoes, [{ agent: 'airton', posicao: 'contra', confianca: 8, argumento: 'a', condicao: null }, { agent: 'iara', posicao: 'favor', confianca: 6, argumento: 'b', condicao: null }]);
  ok(s.fala.split(/[.?!]/).filter((x) => x.trim()).length <= 2 && !/[*#_\n]/.test(s.fala), s.fala);
  ok(s.opcao_recomendada === 'adiar:2' && !/[*#]/.test(s.divergencia), 'campos');
  ok(normalizarSintese({ opcao_recomendada: 'inventada' }, CTX.decisao.opcoes, []).opcao_recomendada === null, 'opção inventada some');
  ok(normalizarSintese({}, CTX.decisao.opcoes, []).fala.length > 0, 'fala de reserva');
  ok(!falaCurta('Um. Dois. Três.').includes('Três'), 'corta em 2');
});

Deno.test('teto de US$ 0,03 por execução cobre o pior caso (4 fast + 1 smart) e barra o excesso', () => {
  const pior = 4 * estimarFast(6000, 400) + estimarSmart(9000, 1500);
  ok(pior < TETO_PAINEL_USD, `pior caso ${pior.toFixed(4)}`);
  garantirTeto(0, pior, TETO_PAINEL_USD);
  let barrou = false;
  try { garantirTeto(0.02, estimarSmart(9000, 1500), TETO_PAINEL_USD); } catch { barrou = true; }
  ok(barrou, 'aborta antes de passar de 0,03');
});
