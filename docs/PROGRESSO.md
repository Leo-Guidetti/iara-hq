# Progresso do IARA HQ (fila de trabalho do executor autônomo)

Atualize este arquivo ao fim de cada etapa e antes de parar. Formato: marque `[x]`, anote a data,
o PR e o que foi conferido em produção. "Próximo passo" sempre preenchido.

**Próximo passo (parada segura em 09/11, 12:40 UTC):**
1. **10/11 depois das 09:30 UTC:** conferir o 1º cartão publicado pela SabIA (PR #11, `sabia-trilha` v9):
   `select * from core.itens where origem = 'sabia' order by id desc limit 1;` e, no run do dia,
   `core.agent_runs.output->>'item_id'` preenchido e `erro_item` nulo. Se `erro_item` vier preenchido,
   corrigir a chamada em `sabia-trilha/index.ts` (bloco "Núcleo de itens").
2. Etapa 2, próximo publicador: `iara-briefing` (manhã/noite → cartão `lembrete`, chave `briefing:<data>:<tipo>`),
   depois AIrton (plano semanal, contas a vencer) e ClaudIA (treino do dia, pesagem).
3. Domingo 15/11, 20:00 SP: conferir o 1º push de custo (`airton.notify_log`, kind `custo`).
4. Etapa 1 espera o Leo (pedido de 09/11, ver "Pedido aberto ao Leo" abaixo).

**Pedido aberto ao Leo (09/11, revisto 2):** Strava fica para depois. Bucket apagado. Domínio
`iara-agents-hq.vercel.app` no projeto `hub`. **Login (decisão do Leo):** sem link por e-mail; e-mail e senha, só
para `leonardoguidettic@gmail.com`. A conta dele já existe (com os dados), então a senha é definida pela função
`hub-senha` (PR `feat/hub-senha`), que só aceita o e-mail dele e o código do secret `HUB_CADASTRO_CODIGO`, que o
Leo cria no painel. No hub (branch `claudia-v2`, PR #2): tela de entrar com senha, `/cadastro` e o middleware
barrando qualquer outro e-mail. **Falta o Leo:** criar o secret, cadastrar a senha em `/cadastro`, apagar o
secret e testar as telas de `/saude` (1.3). Na 1.4: depois do merge do PR #2, trocar o Production Branch
do projeto `hub` de `claudia-v2` para `main` (nada a fazer com domínio). **09/11 13:05 UTC:** `hub-senha` no ar (sem o secret, responde
"Cadastro fechado"). O `iara-agents-hq.vercel.app` foi apontado à mão (alias, a pedido do Leo) para o preview
`dpl_MuQwrFSEBVCiuWShP5oNMsiRuEjY` da `claudia-v2` (commit `d4b1fbb`, login com senha), porque o Vercel recusou
promover o preview (422). O próximo deploy de produção do `hub` retoma o domínio sozinho.

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
- [x] 3. **09/11, PRs #4, #6 e #7.** Deploy (`deploy-supabase.yml`) conferido contra `supabase/` real e validado com um deploy de verdade:
      o merge do #7 publicou só a `sabia-trilha` (v7 → v8) e a chamada real deu `ok`.
      **09/11:** secrets do Actions, auto-merge e proteção da `main` (checks obrigatórios, sem revisão) já
      existem: o `link` passou no run do merge do #3. O `db push` falhou só pela mudança da v3 do CLI, sem
      aplicar nada; corrigido no PR #4. Falta o deploy real: o merge da 0.1 é esse teste.
- [x] 4. **09/11: apagado pelo Leo (conferido: nenhum dos dois buckets existe).** Bucket `airton-deploy` (público): listar o conteúdo e pedir ao Leo para torná-lo privado
      ou apagar. **09/11:** listado (8 .tgz de 02–03/11: `airton-web-v24/25/26` e 5 `bundle-*`); pedido ao
      Leo para apagar os arquivos e o bucket (e o `deploy-bundles`, privado e vazio). Falta ele confirmar.
- [x] 5. **09/11, PR #8.** Migration aplicada; `airton.ai_cost_report(7)` responde pelo conector (sem
      execute para anon/authenticated); `airton-notify` v9. Falta só ver o 1º envio (domingo 15/11). Tarefa semanal de custo (domingo 20:00): cron no Supabase que soma os `ai_usage` e manda
      push (via migration + Edge Function, pelo fluxo normal).
      **Notas de 09/11:** fontes de custo: `airton.ai_usage`, `claudia.ai_usage`, `core.ai_usage` e a view
      `core.v_ai_cost_all`. O push existe só no AIrton (`airton.push_subscriptions` + `airton.notify_log`,
      job `airton-notify-tick` a cada 15 min chamando `airton_private.call_function('airton-notify')`).
      Fazer depois do item 1, lendo o `airton-notify` já no repo para reaproveitar o envio, em vez de
      adivinhar a API dele. Domingo 20:00 SP = `0 23 * * 0` UTC.
      **Feito assim:** sem cron novo. O `airton-notify` (tick de 15 min) ganhou o tipo `custo`
      (domingo 20:00 SP; `costEnabled/costDow/costTime` em `airton.settings` → `notify`), com dados de
      `airton.ai_cost_report(p_dias)` (security definer, só service role) sobre a view nova
      `core.v_ai_usage_all` (airton + claudia + core). O push traz semana, mês, projeção, custo por app, a
      maior funcionalidade e um alerta quando a projeção passa do teto (`AIRTON_`, `CLAUDIA_`, `IARA_AI_BUDGET_USD`).
      Prévia pelo app: `airton-notify` com `{action:'preview', kind:'custo'}`.

## Etapa 1 — Fechar a ClaudIA v2 (Fase 1 do ROADMAP)
- [x] 1. Conferir as 9 `claudia-*` contra o repo (feito na etapa 0) e testar cada uma.
      **09/11:** esbuild (sem tipos) nos dois lados: 12 de 13 arquivos idênticos entre o ar e o PR #2; a
      `claudia-strava` só muda o `redirect_uri` para `/saude/treino/strava` (rota do hub, intencional). A `main`
      foi mergeada na `claudia-v2` (merge, sem rebase), ficando as versões tipadas; build, typecheck e
      `check:functions` verdes. Logs de 24 h: nenhum 5xx; cada `claudia-*` com 200 e 401 só sem login.
      Testar com usuário logado fica na 1.3 (precisa do login do Leo).
- [ ] 2. **Adiado pelo Leo em 09/11.** Pedir ao Leo: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (secrets) e a URL de callback no app da Strava.
- [ ] 3. Testar todas as telas de `/saude` no preview; uma linha por função de IA em `claudia.v_ai_cost_month`.
- [ ] 4. Merge do PR #2 (claudia-v2) e virada do domínio para o projeto `hub` (reversível).
- [ ] 5. Sete dias depois: pedir ao Leo a limpeza (apagar Vercel `claudia` e `claudia-v2`,
      `ANTHROPIC_API_KEY` antiga, chave `claudia-provisoria`).

## Etapa 2 — Núcleo de itens (Fase 2)
- [ ] `core.itens` + `core.publicar_item()`; AIrton, SabIA, ClaudIA e briefing da IARA publicando.
      **09/11:** migration `20261109140000_core_itens` em PR (`feat/core-itens`): tabela `core.itens`
      (origem, tipo, titulo, detalhe, data/hora/janela, prioridade, minutos, acao, status, adiado_para,
      retorno, chave_origem; único por user+origem+chave), RLS (dono lê; muda só status/adiado_para/retorno)
      e `core.publicar_item(jsonb)` (service role; idempotente e nunca desfaz o status escolhido pelo Leo).
      Testada em PGlite. Ordem dos publicadores: SabIA (trilha) → IARA (briefing) → AIrton → ClaudIA.

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
| 09/11 | extra | #7 | `sabia-trilha` v8 publicada pelo CI; chamada real (como o cron): run 5 `ok`, 5 itens, US$ 0,0232 (orquestrador 1.322 tokens de saída) | Trilha de 09/11 falhou ("Resposta sem <trilha>"): orquestrador Sonnet sem `effort` esgotava os 2.500 tokens pensando. `effort: low` e teto maior no orquestrador e no recap |
| 09/11 | 0.5 | #8 | migration `20261109130000` aplicada; `ai_cost_report(7)` = semana US$ 0,37; `airton-notify` v9 | Custo do mês até 09/11: US$ 0,35 (AIrton 0,30; SabIA 0,03; IARA 0,02) |
| 09/11 | 1.1 | merge da `main` na `claudia-v2` (PR #2) | logs 24 h sem 5xx | 12/13 idênticos ao ar; `claudia-strava` só muda a rota do callback |
| 09/11 | 2 | #10, #11 | `core.itens` com RLS e 2 policies; `publicar_item` sem execute p/ anon/authenticated; `sabia-trilha` v9 | 1º cartão real sai no cron de 10/11 09:30 UTC |
| 09/11 | UX (pedido do Leo) | `feat/hub-menu-temas` | — (conferir após o merge) | `/hoje` vira menu com blocos ClaudIA/AIrton/IARA House; paleta por app (`data-app`) + modo claro/escuro (Perfil → Aparência); `/saude/treino` corrigido (patch nulo na revisão de 26/10) |
| 09/11 | 1.4 | #17 (inclui o #2, fechado como incorporado), #16 | hub em produção pela `main` (`iara-agents-hq.vercel.app`, tema novo); migrations `20261109150000` e `20261109190000` aplicadas; 7 `claudia-*` republicadas, `claudia-photo-review` e `claudia-strava` pendentes (502 da API do Supabase) | Republicar pelo disparo manual do `deploy-supabase` com `funcoes` (PR `ci/deploy-funcoes`) |
