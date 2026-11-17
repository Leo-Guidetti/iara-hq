// deno test supabase/functions/iara-semana/semana-lib.test.ts  (sem banco, sem IA, sem rede)
import { idsParaApagar, semDuplicarEditados, validarMetaId } from './semana-lib.ts';

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
