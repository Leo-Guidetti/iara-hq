# Progresso do IARA HQ (fila de trabalho do executor autônomo)

Atualize este arquivo ao fim de cada etapa e antes de parar. Formato: marque `[x]`, anote a data,
o PR e o que foi conferido em produção. "Próximo passo" sempre preenchido.

**Próximo passo:** depois do merge do PR `fix/sabia-trilha-effort`, conferir o run do `deploy-supabase` (deve
publicar só a `sabia-trilha`, v7 → v8; é o 1º deploy de função pelo CI) e fazer uma chamada real
(`core_private.call_function('sabia-trilha', ...)` como o cron) para gerar a trilha de 09/11, que falhou;
conferir `core.agent_runs` e o custo em `core.ai_usage`. Depois: 0.5 (custo semanal) e 0.2 (tipar aos poucos).
**Execução (09/11):** sessões de Claude Code na nuvem com o repo `Leo-Guidetti/iara-hq` (push, PR e
auto-merge funcionam). A fonte da verdade é o GitHub. Secrets do Actions e proteção da `main` com checks
obrigatórios já estão configurados (o PR fica `blocked` até o CI ficar verde).
**CLI do Supabase:** fixo na 3.0.0 nos workflows (PR #4). Na v3 todo comando de banco precisa de
`--remote` (sem ele, mira o banco local) e mudança em projeto hospedado exige `--yes`.

## Como trabalhar cada entrega
1. Branch `<tipo>/<tema>` → commits pequenos.
2. PR com descrição curta → `gh pr merge --auto --squash` (ou o equivalente no conector do GitHub).
3. Esperar o CI e o merge. CI vermelho: corrigir na mesma branch. Nunca desligar um check.
4. Depois do merge: conferir o deploy (GitHub Actions), os logs das funções tocadas e uma chamada real
   quando houver; custo em `<schema>.v_ai_cost_month` quando houver IA.
5. Marcar aqui e seguir para o próximo item, sem esperar o Leo.

## Quando chamar o Leo (e só nesses casos)
Junte tudo o que precisa dele numa única mensagem, com passo a passo e links, e continue com o que
não depende disso enquanto espera.
- Criar ou revogar chave de API, ou cadastrar valor de secret (Anthropic, Google, OpenAI, Strava,
  GitHub, Supabase).
- Configuração em site de terceiro (app da Strava, Google Cloud, ajustes do GitHub que exigem dono).
- Ação irreversível: apagar projeto, chave, bucket ou dados.
- Custo de IA projetado acima do teto do app.
- Algo que exige quebrar um guardrail.

## Etapa 0 — Base (uma vez)
- [x] 0. **09/11, PR #3.** PR `chore/base-ci`: CLAUDE.md, docs/, `.gitattributes` (LF; o checkout
      no Windows deixava 46 arquivos "modificados" só por CRLF), workflows `ci`, `deploy-supabase` e
      `sincroniza-producao`, script `check:functions` e `supabase/functions/deno.json` (iguais aos do PR #2,
      para o merge dele não conflitar). Validado na nuvem em 09/11: `pnpm install --frozen-lockfile`,
      `turbo typecheck build` e `check:functions` verdes na main e na claudia-v2.
- [x] 1. **09/11, PR #5.** O merge aplicou a `20261109120000_claudia_is_member` (sem efeito, igual à do ar).
      Sincronizar produção → repo: baixar todas as Edge Functions no ar (airton-*, sabia-trilha,
      iara-briefing, claudia-*) e o schema; produção vence nas divergências; migration de baseline
      que não altera nada. PR `chore/sincroniza-producao`.
      **Como (decidido em 09/11):** pelo workflow `sincroniza-producao` (workflow_dispatch, só leitura), que
      precisa do item 0 na main e dos secrets do item 3. Ele baixa as 15 funções (`supabase functions download`),
      o histórico das 48 migrations (`supabase migration fetch`), um dump do schema sem dados
      (`supabase/schema/producao.sql`) e grava `supabase/SINCRONIZACAO.md`; empurra a branch e o agente abre
      o PR. Motivo: baixar ~275 mil caracteres de migrations e 15 funções pelo conector custaria muitos
      tokens e arriscaria truncar. O CI ignora o check destrutivo para versões ≤ 20261109031226
      (histórico já aplicado). Conferido pelo conector em 09/11: as migrations antigas não têm segredo
      literal (o `cron_secret` é gerado com `gen_random_bytes`). Depois do merge, conferir as 9
      `claudia-*` contra o PR #2 (a `claudia-food-parse` v2 do ar já bate com a claudia-v2) e rebasear o PR #2.
      Atenção: `20261109120000_claudia_is_member` (repo) e `20261109150000_claudia_ai_cost` (PR #2) são as
      mesmas de produção (`20261109012945` e `20261109031226`) com outra versão; são `create or replace`,
      então o `db push` reaplica sem efeito.
- [ ] 2. CI (`.github/workflows/ci.yml`): ajustar à estrutura real (scripts do pnpm, nomes dos
      pacotes) até ficar verde numa branch de teste. **09/11:** verde nos PRs #3 e #4. O fonte baixado
      da produção vem sem tipos (o Supabase guarda transpilado) e dava 646 erros no `deno check` estrito;
      os 35 arquivos levam `// @ts-nocheck` na 1ª linha. Falta: tipar e tirar a marca, função por função
      (tarefa própria; correção pequena numa função não precisa esperar por isso). As 9 `claudia-*` têm a versão tipada no PR #2 (claudia-v2): no rebase
      dele, ficar com a tipada se for equivalente à do ar.
- [ ] 3. Deploy (`deploy-supabase.yml`) conferido contra `supabase/` real e validado com um deploy de verdade.
      **09/11:** secrets do Actions, auto-merge e proteção da `main` (checks obrigatórios, sem revisão) já
      existem: o `link` passou no run do merge do #3. O `db push` falhou só pela mudança da v3 do CLI, sem
      aplicar nada; corrigido no PR #4. Falta o deploy real: o merge da 0.1 é esse teste.
- [ ] 4. Bucket `airton-deploy` (público): listar o conteúdo e pedir ao Leo para torná-lo privado
      ou apagar. **09/11:** listado (8 .tgz de 02–03/11: `airton-web-v24/25/26` e 5 `bundle-*`); pedido ao
      Leo para apagar os arquivos e o bucket (e o `deploy-bundles`, privado e vazio). Falta ele confirmar.
- [ ] 5. Tarefa semanal de custo (domingo 20:00): cron no Supabase que soma os `ai_usage` e manda
      push (via migration + Edge Function, pelo fluxo normal).
      **Notas de 09/11:** fontes de custo: `airton.ai_usage`, `claudia.ai_usage`, `core.ai_usage` e a view
      `core.v_ai_cost_all`. O push existe só no AIrton (`airton.push_subscriptions` + `airton.notify_log`,
      job `airton-notify-tick` a cada 15 min chamando `airton_private.call_function('airton-notify')`).
      Fazer depois do item 1, lendo o `airton-notify` já no repo para reaproveitar o envio, em vez de
      adivinhar a API dele. Domingo 20:00 SP = `0 23 * * 0` UTC.

## Etapa 1 — Fechar a ClaudIA v2 (Fase 1 do ROADMAP)
- [ ] 1. Conferir as 9 `claudia-*` contra o repo (feito na etapa 0) e testar cada uma.
- [ ] 2. Pedir ao Leo: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (secrets) e a URL de callback no app da Strava.
- [ ] 3. Testar todas as telas de `/saude` no preview; uma linha por função de IA em `claudia.v_ai_cost_month`.
- [ ] 4. Merge do PR #2 (claudia-v2) e virada do domínio para o projeto `hub` (reversível).
- [ ] 5. Sete dias depois: pedir ao Leo a limpeza (apagar Vercel `claudia` e `claudia-v2`,
      `ANTHROPIC_API_KEY` antiga, chave `claudia-provisoria`).

## Etapa 2 — Núcleo de itens (Fase 2)
- [ ] `core.itens` + `core.publicar_item()`; AIrton, SabIA, ClaudIA e briefing da IARA publicando.

## Etapa 3 — Tela Hoje (Fase 3)
- [ ] Linha do tempo, caixa, ações rápidas, push único com limite diário, PWA.

## Etapa 4 — Fontes externas (Fase 4)
- [ ] Google Calendar e digest do Gmail como itens.

## Etapa 5 — Orquestração da IARA (Fase 5)
- [ ] Manhã 07:00, noite 21:00, domingo (plano da semana).

## Etapa 6 — Módulos no hub (Fase 6)
- [ ] `/financas`, `/aprender`, `/casa`; IARA migrada; aposentar Vercel `airton`, `iara`, `shyrlai`
      (apagar = pedir ao Leo).

## Etapa 7 — Voz (Fase 7)
- [ ] Protótipo gpt-realtime-2.1-mini vs. Gemini 3.8 Live; implementação no hub.

## Registro
| Data | Etapa | PR | Conferido em produção | Observações |
| --- | --- | --- | --- | --- |
| 09/11 | 0.0–0.4 | — (sem push) | ANTHROPIC_API_KEY voltou: `briefing_noite` de 08/11 00:30 UTC ok (US$ 0,0111) | Branch local `chore/base-ci`; pedido único ao Leo: acesso de push, secrets do Actions, auto-merge, ruleset, bucket, Strava |
| 09/11 | 0.0 | #3 | CI verde; deploy do merge falhou no `db push` (flag da v3), nada aplicado | Secrets do Actions e ruleset da `main` confirmados |
| 09/11 | 0.3 | #4 | só `.github/`, sem deploy | CLI fixo na 3.0.0, `--remote`/`--yes` |
| 09/11 | 0.1 | #5 | `list_migrations` com `20261109120000`; funções não publicadas (faltava `--yes`, nada mudou) | 15 funções, 48 migrations de histórico, `schema/producao.sql`; sem conflitos em `_shared` |
| 09/11 | 0.3 | #6 | só `.github/`, sem deploy | `--yes` no `functions deploy` |
| 09/11 | extra | `fix/sabia-trilha-effort` | — (conferir após o merge) | Trilha de 09/11 falhou ("Resposta sem <trilha>"): orquestrador Sonnet sem `effort` esgotava os 2.500 tokens pensando. `effort: low` e teto maior no orquestrador e no recap |
