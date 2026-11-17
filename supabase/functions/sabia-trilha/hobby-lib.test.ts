// deno test --allow-read supabase/functions/sabia-trilha/hobby-lib.test.ts  (sem banco, sem IA, sem rede)
import { estimarHobbyUsd, HOBBY_SCHEMA, HOBBY_SYSTEM, MAX_HABILIDADES, montarPromptHobby, normalizarPlano, type Habilidade } from './hobby-lib.ts';
const ok = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const H: Habilidade = { id: 1, nome: 'violão', tipo: 'instrumento', nivel: 'iniciante', objetivo: 'tocar uma música inteira', curriculo: null,
  alvo: 60, minutos_ultima_semana: 35, dias_ultima_semana: 2, notas: ['escala de dó'] };

Deno.test('custo de trilha-hobby <= US$ 0,002 por semana, mesmo no pior caso (4 habilidades, saída inteira no max_tokens)', () => {
  const p = montarPromptHobby({ ...H, curriculo: 'x'.repeat(2000), objetivo: 'y'.repeat(300) }, '2026-11-22');
  const usd = estimarHobbyUsd(10, HOBBY_SYSTEM.length, p.length);
  ok(usd <= 0.002, `US$ ${usd}`);
  ok(estimarHobbyUsd(1, HOBBY_SYSTEM.length, montarPromptHobby(H, '2026-11-22').length, 450) < 0.0004, 'caso típico');
  ok(estimarHobbyUsd(0, 1, 1) === 0, 'sem habilidade: zero');
  ok(MAX_HABILIDADES === 4, 'teto de habilidades');
});

Deno.test('normalizarPlano: saída simulada vira corpo, minutos e resumo; lixo é saneado', () => {
  const r = normalizarPlano({ resumo: 'Foco em acordes', dica: 'Metrônomo a 60', sessoes: [
    { dia: 'segunda', minutos: 20, foco: 'Acordes abertos', como: 'Troque de acorde por 5 min' },
    { dia: 'quinta', minutos: 25, foco: 'Escala de dó', como: 'Devagar' }, { dia: 'xyz', minutos: -3, foco: 'Música', como: '' }, { foco: '' }] });
  ok(r.minutos === 20 + 25 + 5, `minutos ${r.minutos}`); ok(r.corpo.includes('**segunda** · 20 min · Acordes abertos') && r.corpo.includes('Dica'), r.corpo);
  ok(r.resumo === 'Foco em acordes', 'resumo');
  let erro = false; try { normalizarPlano({ sessoes: [] }); } catch { erro = true; } ok(erro, 'plano vazio é erro');
  ok(HOBBY_SCHEMA.required.join() === 'resumo,sessoes,dica', 'schema');
});
