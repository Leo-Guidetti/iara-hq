// deno test supabase/functions/iara-semana/semana-lib.test.ts  (sem banco, sem IA, sem rede)
import { falaSemana, idsParaApagar, MAX_DECISOES, normalizarDecisoes, resolverIds, semDuplicarEditados, validarMetaId } from './semana-lib.ts';

const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const METAS = [{ id: 10 }, { id: '11' }];

Deno.test('meta_id: só vale se pertence às metas enviadas', () => {
  ok(validarMetaId(10, METAS) === 10, 'número válido');
  ok(validarMetaId('11', METAS) === 11, 'string numérica válida');
  ok(validarMetaId(99, METAS) === null, 'id de fora vira null');
  ok(validarMetaId(null, METAS) === null && validarMetaId(undefined, METAS) === null, 'null');
  ok(validarMetaId('abc', METAS) === null && validarMetaId(10.5, METAS) === null && validarMetaId(10, []) === null, 'lixo');
});

Deno.test('refazer o rascunho: item editado (movido/tirado) sobrevive', () => {
  const apagar = idsParaApagar([{ id: 1, editado: false }, { id: 2, editado: true }, { id: 3, editado: false }]);
  ok(apagar.join() === '1,3', `apagar: ${apagar}`);
  ok(!apagar.includes(2), 'o item que o Leo moveu fica');
  ok(idsParaApagar([]).length === 0, 'vazio');
});

Deno.test('itens novos não duplicam o que o Leo já decidiu', () => {
  const ed = [{ area: 'saude', titulo: 'Corrida leve', ref: 'treino:5' }, { area: 'casa', titulo: 'Compras  da semana', ref: null }];
  const novos = [
    { area: 'saude', titulo: 'Corrida (outro título)', ref: 'treino:5' },
    { area: 'casa', titulo: 'compras da semana', ref: null },
    { area: 'aprender', titulo: 'Trilha', ref: null },
  ];
  const r = semDuplicarEditados(novos, ed);
  ok(r.length === 1 && r[0].titulo === 'Trilha', `restou: ${JSON.stringify(r)}`);
});

// ---------- UX-22 ----------
const JAN = { desde: '2026-11-23', fim: '2026-11-29' };
const VAL = new Set([0, 1, 2, 3]);
const dec = (o: Record<string, unknown> = {}) => ({
  pergunta: 'Mover a corrida de terça para quinta ou manter?', opcoes: ['Mover', 'Manter'], padrao: 'Manter',
  efeito: { tipo: 'mover', item_idx: [1], data: '2026-11-26', hora: null, opcao: 'Mover' }, ...o,
});

Deno.test('fala: sem markdown, R$ arredondado, até 60 palavras', () => {
  const f = falaSemana('**Semana cheia.**\n- Sobram R$ 1.234,56 no mês.\n' + Array(80).fill('Palavra').join(' ') + '.');
  ok(f !== null && !/[*#_`\n]/.test(f) && f.split(' ').length <= 60, `fala: ${f}`);
  ok(f!.includes('R$ 1.235'), `reais: ${f}`);
  ok(falaSemana('') === null && falaSemana(null) === null, 'vazia vira null');
});

Deno.test('decisões: até 3, até 3 opções, ids só de itens existentes', () => {
  const brutas = [dec(), dec(), dec(), dec(), dec()];
  const r = normalizarDecisoes(brutas, VAL, JAN);
  ok(r.length === MAX_DECISOES && r.map((d) => d.id).join() === 'd1,d2,d3', `máx 3: ${r.length}`);
  const o = normalizarDecisoes([dec({ opcoes: ['A', 'B', 'C', 'D', 'a'], padrao: 'C', efeito: { tipo: 'tirar', item_idx: [0], opcao: 'B' } })], VAL, JAN);
  ok(o[0].opcoes.join() === 'A,B,C' && o[0].padrao === 'C', `3 opções: ${o[0].opcoes}`);
  const ids = normalizarDecisoes([dec({ efeito: { tipo: 'tirar', item_idx: [1, 1, 99, -1, 'x', 2], opcao: 'Mover' } })], VAL, JAN);
  ok(ids[0].efeito.item_idx.join() === '1,2', `só existentes e sem repetir: ${ids[0].efeito.item_idx}`);
  ok(ids[0].escolha === null, 'escolha começa null');
});

Deno.test('decisões: o que não faz sentido é descartado; sem conflito = lista vazia', () => {
  ok(normalizarDecisoes([], VAL, JAN).length === 0 && normalizarDecisoes(undefined, VAL, JAN).length === 0 && normalizarDecisoes('x', VAL, JAN).length === 0, 'vazio');
  ok(normalizarDecisoes([dec({ opcoes: ['Só uma'] })], VAL, JAN).length === 0, 'menos de 2 opções');
  ok(normalizarDecisoes([dec({ pergunta: '  ' })], VAL, JAN).length === 0, 'sem pergunta');
  ok(normalizarDecisoes([dec({ efeito: { tipo: 'mover', item_idx: [99], data: '2026-11-26', opcao: 'Mover' } })], VAL, JAN).length === 0, 'item inexistente');
  ok(normalizarDecisoes([dec({ efeito: { tipo: 'mover', item_idx: [1], data: '2026-12-30', opcao: 'Mover' } })], VAL, JAN).length === 0, 'data fora da semana');
  ok(normalizarDecisoes([dec({ efeito: { tipo: 'mover', item_idx: [1], data: '2026-11-26', opcao: 'Outra' } })], VAL, JAN).length === 0, 'opcao fora das opções');
  const m = normalizarDecisoes([dec({ efeito: { tipo: 'manter', item_idx: [], opcao: null }, padrao: 'inexistente' })], VAL, JAN);
  ok(m.length === 1 && m[0].efeito.tipo === 'manter' && m[0].padrao === 'Mover', 'manter vale; padrão inválido vira a 1ª opção');
  const h = normalizarDecisoes([dec({ efeito: { tipo: 'mover', item_idx: [1], data: '2026-11-26', hora: '25:00', opcao: 'Mover' } })], VAL, JAN);
  ok(h[0].efeito.hora === null, 'hora inválida vira null');
});

Deno.test('decisões: posições viram ids reais; item que sumiu derruba a decisão', () => {
  const br = normalizarDecisoes([dec(), dec({ efeito: { tipo: 'tirar', item_idx: [2], opcao: 'Mover' } })], VAL, JAN);
  const r = resolverIds(br, new Map([[1, 501]]));
  ok(r.length === 1 && r[0].efeito.item_ids.join() === '501' && r[0].id === 'd1', `resolvido: ${JSON.stringify(r)}`);
  ok(!('item_idx' in r[0].efeito), 'sem item_idx no banco');
});

Deno.test('custo adicional por semana <= US$ 0,005 (caso típico do pedido: fala de 50 palavras + 2 decisões; Sonnet 5.5 a US$ 2/10 por MTok)', () => {
  const fala = Array(50).fill('palavra').join(' ');
  const d = { pergunta: Array(15).fill('palavra').join(' '), opcoes: ['duas palavras', 'duas palavras', 'duas palavras'], padrao: 'duas palavras',
    efeito: { tipo: 'mover', item_idx: [10, 11], data: '2026-11-26', hora: '07:00', opcao: 'duas palavras' } };
  const tokSaida = JSON.stringify({ fala, decisoes: [d, d] }).length / 3.5; // ~3,5 caracteres por token (português + JSON)
  const tokEntrada = 1300 / 3.5; // trecho novo do pedido
  const usd = (tokSaida * 10 + tokEntrada * 2) / 1e6;
  ok(usd <= 0.005, `custo adicional estimado US$ ${usd.toFixed(4)}`);
});
