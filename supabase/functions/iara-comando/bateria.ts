// Bateria de 20 frases da porta única. Serve a DOIS critérios:
//  UX-15: roteamento (>= 18/20 intenções certas; slots conferidos).
//  UX-18: contrato de fala nas respostas de leitura/pergunta (sem `*`, `#`, lista; <= 40 palavras; número falado a <= 5% do dado;
//         mediana de tempo <= 4 s para escrita e <= 8 s para pergunta).
// `tipo` de cada caso: escrita | leitura | pergunta | fora. Escrita e fora rodam com dry_run (não gravam nada; a fala é "(simulação)", então só
// roteamento e tempo de roteamento contam). Leitura e pergunta rodam de verdade (só leem; a pergunta grava uma linha em airton.chat_messages
// e custa ~US$ 0,02 no Sonnet). `numero_fonte` {rpc, schema?, campo} diz de onde vem o número da fala: a bateria chama a mesma RPC com o
// mesmo JWT e compara (campo 'length' = tamanho da lista).
//
// Como rodar (precisa de um JWT de usuário membro e da chave publicável do Supabase; a chave de IA fica nos secrets, não aqui):
//   export SUPABASE_URL=https://wrtrhdrohabspbaxpbeu.supabase.co
//   export SUPABASE_ANON_KEY=<publishable key>
//   export IARA_JWT=<access_token da sessão do Leo>      # ex.: supabase.auth.getSession() no navegador logado
//   deno run --allow-net --allow-env --allow-read supabase/functions/iara-comando/bateria.ts
// Variável opcional BATERIA_CANAL=voz|atalho|hub (padrão voz). Saída: uma linha por frase, placar de roteamento, de fala e medianas.
// Código de saída 1 se roteamento < 18/20, qualquer fala fora do contrato, número fora de 5% ou mediana acima da meta.
import { MAX_PALAVRAS_COMANDO } from './_shared/fala.ts';
import { avaliarFala, mediana, numerosDaFala, valorDoCampo, type Fonte } from './bateria-lib.ts';

type Caso = {
  frase: string; intencao_esperada: string; slots_esperados?: Record<string, unknown>; ambigua?: boolean;
  tipo: 'escrita' | 'leitura' | 'pergunta' | 'fora'; numero_fonte?: Fonte;
};

const url = Deno.env.get('SUPABASE_URL'), jwt = Deno.env.get('IARA_JWT'), anon = Deno.env.get('SUPABASE_ANON_KEY');
if (!url || !jwt || !anon) { console.error('Defina SUPABASE_URL, SUPABASE_ANON_KEY e IARA_JWT (ver o cabeçalho deste arquivo).'); Deno.exit(2); }
const canal = Deno.env.get('BATERIA_CANAL') ?? 'voz';
const casos: Caso[] = JSON.parse(await Deno.readTextFile(new URL('./bateria.json', import.meta.url)));

const confere = (esperado: unknown, obtido: unknown): boolean => {
  if (esperado && typeof esperado === 'object') return !!obtido && typeof obtido === 'object' && Object.entries(esperado).every(([k, v]) => confere(v, (obtido as any)[k]));
  if (typeof esperado === 'string') return String(obtido ?? '').toLowerCase().includes(esperado.toLowerCase());
  return esperado === obtido;
};

/** O dado de verdade: a mesma RPC de leitura, com o mesmo JWT. */
async function dado(f: Fonte): Promise<number | null> {
  const r = await fetch(`${url}/rest/v1/rpc/${f.rpc}`, {
    method: 'POST', body: '{}',
    headers: { Authorization: `Bearer ${jwt}`, apikey: anon!, 'content-type': 'application/json', ...(f.schema ? { 'Content-Profile': f.schema } : {}) },
  });
  if (!r.ok) return null;
  return valorDoCampo(await r.json().catch(() => null), f.campo);
}

let certas = 0, falasOk = 0, falasTotal = 0, numerosOk = 0, numerosTotal = 0;
const tempos: Record<string, number[]> = { escrita: [], pergunta: [], leitura: [] };
for (const c of casos) {
  const dry = c.tipo === 'escrita' || c.tipo === 'fora';
  const t0 = performance.now();
  const r = await fetch(`${url}/functions/v1/iara-comando`, {
    method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ texto: c.frase, canal, ...(dry ? { dry_run: true } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  const ms = Math.round(performance.now() - t0);
  tempos[c.tipo]?.push(ms);
  const slots = j.tela?.args ?? j.pendente?.slots ?? j.slots ?? {};
  const certo = j.intencao === c.intencao_esperada && (!c.slots_esperados || confere(c.slots_esperados, slots) || confere(c.slots_esperados, j.slots ?? {}));
  if (certo) certas++;
  let nota = '';
  if (!dry) {
    falasTotal++;
    const v = avaliarFala(String(j.fala ?? ''));
    const falaOk = v.ok;
    if (falaOk) falasOk++; else nota += ` FALA:${v.erros.join('+')}`;
    if (c.numero_fonte) {
      numerosTotal++;
      const esperado = await dado(c.numero_fonte);
      const falados = numerosDaFala(String(j.fala ?? ''));
      const bate = esperado !== null && (esperado === 0 ? falados.includes(0) : falados.some((n) => Math.abs(n - esperado) / Math.abs(esperado) <= 0.05));
      if (bate) numerosOk++; else nota += ` NUM:esperado ${esperado} falado [${falados.join(', ')}]`;
    }
    nota += ` | "${String(j.fala ?? '').slice(0, 90)}"`;
  }
  console.log(`${certo ? 'ok  ' : 'ERRO'} [${c.tipo}] ${ms} ms ${c.frase} -> ${j.intencao} (esperado ${c.intencao_esperada})${nota}`);
}
const medE = mediana(tempos.escrita), medP = mediana([...tempos.pergunta, ...tempos.leitura]);
console.log(`\nRoteamento: ${certas}/${casos.length} (meta >= 18/20)`);
console.log(`Fala (${canal}, ${falasTotal} respostas reais): ${falasOk}/${falasTotal} sem *, # nem lista e <= ${MAX_PALAVRAS_COMANDO} palavras`);
console.log(`Números: ${numerosOk}/${numerosTotal} a <= 5% do dado`);
console.log(`Tempo mediano: escrita ${medE} ms (meta <= 4000, dry_run = só roteamento); pergunta/leitura ${medP} ms (meta <= 8000)`);
const falhou = certas < 18 || falasOk < falasTotal || numerosOk < numerosTotal || medE > 4000 || medP > 8000;
Deno.exit(falhou ? 1 : 0);
