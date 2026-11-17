// Bateria de 20 frases do roteador (UX-15, critério: >= 18/20 certas). Chama a função JÁ PUBLICADA em modo dry_run
// (só roteia e valida; não executa nada, não grava conversa), então custa ~US$ 0,0002 por frase.
//
// Como rodar (precisa de um JWT de usuário membro; a chave de IA fica nos secrets do Supabase, não aqui):
//   export SUPABASE_URL=https://wrtrhdrohabspbaxpbeu.supabase.co
//   export IARA_JWT=<access_token da sessão do Leo>      # ex.: copie de supabase.auth.getSession() no navegador logado
//   deno run --allow-net --allow-env --allow-read supabase/functions/iara-comando/bateria.ts
// Saída: uma linha por frase (ok/ERRO) e o placar; código de saída 1 se < 18/20.
// Acerta quando a intenção final é a esperada e, se houver slots_esperados, cada slot confere (texto: contém, sem caixa).
// "ambigua" só documenta que a resposta esperada é a pergunta de esclarecimento (a intenção ainda é a esperada).
type Caso = { frase: string; intencao_esperada: string; slots_esperados?: Record<string, unknown>; ambigua?: boolean };

const url = Deno.env.get('SUPABASE_URL'), jwt = Deno.env.get('IARA_JWT');
if (!url || !jwt) { console.error('Defina SUPABASE_URL e IARA_JWT (ver o cabeçalho deste arquivo).'); Deno.exit(2); }
const casos: Caso[] = JSON.parse(await Deno.readTextFile(new URL('./bateria.json', import.meta.url)));

const confere = (esperado: unknown, obtido: unknown): boolean => {
  if (esperado && typeof esperado === 'object') return !!obtido && typeof obtido === 'object' && Object.entries(esperado).every(([k, v]) => confere(v, (obtido as any)[k]));
  if (typeof esperado === 'string') return String(obtido ?? '').toLowerCase().includes(esperado.toLowerCase());
  return esperado === obtido;
};

let certas = 0, custo = 0;
for (const c of casos) {
  const r = await fetch(`${url}/functions/v1/iara-comando`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ texto: c.frase, canal: 'hub', dry_run: true }),
  });
  const j = await r.json().catch(() => ({}));
  const slots = j.tela?.args ?? j.pendente?.slots ?? j.slots ?? {};
  const intencaoOk = j.intencao === c.intencao_esperada;
  const certo = intencaoOk && (!c.slots_esperados || confere(c.slots_esperados, slots) || confere(c.slots_esperados, j.slots ?? {}));
  if (certo) certas++;
  console.log(`${certo ? 'ok  ' : 'ERRO'} ${c.frase} -> ${j.intencao} (esperado ${c.intencao_esperada}) conf ${j.tela?.rota?.confianca ?? '-'}`);
}
console.log(`\nPlacar: ${certas}/${casos.length} (meta >= 18/20)`);
Deno.exit(certas >= 18 ? 0 : 1);
