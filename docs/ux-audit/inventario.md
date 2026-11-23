# Inventário do IARA HQ (auditoria somente leitura, 10/11/2026)

Fontes: código na `main` (`8d5a73f`, PR #29) e o Supabase `wrtrhdrohabspbaxpbeu`, consultado às ~15:20 UTC
pelo conector, só leitura (`list_edge_functions`, contagens, `cron.job`/`job_run_details`, `core.agent_runs`,
`core.v_ai_cost_all`, `*.ai_usage`). Nenhuma linha com dado pessoal foi lida: só contagens, datas e colunas técnicas.
Horários em BRT (UTC−3). Nada foi alterado no repo além desta pasta, e nada em produção.

Legenda das quebras: 🔴 quebra visível para o Leo · 🟡 inconsistência ou dívida · ⚪ conhecido / aguardando verificação.

---

## Hub (apps/hub): navegação, /hoje, Perfil, notificações

**Rotas**

| Rota | O que o usuário faz | Dados |
| --- | --- | --- |
| `/` | Redireciona para `/hoje` | — |
| `/login`, `/cadastro` | Entra com e-mail e senha; o cadastro define a senha com um código (`hub-senha`) | `auth`, função `hub-senha` |
| `/sem-acesso` | Só o botão de sair (qualquer conta que não seja a do Leo, ou sem `claudia.members` em `/saude`) | — |
| `/hoje` | Saudação, card "Briefing do dia · IARA" com a linha do tempo "Seu dia" + "O que importa" (texto do briefing, 7 linhas e "ver inteiro"), órbita com 4 planetas (badge = pendências) e um bloco por app (ClaudIA, AIrton, SabIA, IARA House). Link "Semana →" | `plan_sessions`, `lib/alerts.ts` (9 consultas da ClaudIA), `airton.review_counts`, `airton.month_plan`, `hub_casa`, `hub_sabia`, `hub_dia`, `hub_semana_hoje` |
| `/semana` | Marca expediente, compromissos e lugares; pede a sugestão + crítica da IARA; inclui/exclui/edita itens; confirma o plano; vê o link do feed iCal e sincroniza a agenda | `hub_semana_painel`, `hub_semana`, `hub_compromisso_*`, `hub_expediente_salvar`, `hub_lugares_salvar`, `hub_semana_item*`, `hub_semana_confirmar`; funções `iara-semana`, `iara-agenda` |
| `/perfil` | Tema claro/escuro, dados do perfil (nome, sexo, nascimento, altura, objetivo), tokens do Atalho do iPhone, custo de IA, sair | `public.profiles`, `public.ingest_tokens`, `claudia_ai_cost` |
| `/saude`, `/financas`, `/aprender`, `/casa` | Módulos (seções abaixo) | — |

**Navegação.** `components/AppShell.tsx`: barra de baixo fixa com 5 itens (Hoje, ClaudIA, AIrton, SabIA, Casa), que
vira trilho à esquerda a partir de 900 px; cabeçalho com o nome do app atual, botão rápido de tema e avatar "L" →
`/perfil`. Abas no topo só existem na ClaudIA (`saude/layout.tsx`). `/semana` não está na barra: só se chega pelo link
em `/hoje` (o cabeçalho mostra "IARA HQ · Semana").

**Acesso.** `middleware.ts`: sem sessão → `/login`; e-mail diferente do fixo no código → `/sem-acesso`; `/saude` exige
`claudia_is_member()`.

**Notificações.** O hub não tem manifest, service worker nem tela de inscrição de push (`apps/hub/public` só tem
`icon.svg`). O push existe só no lado do AIrton: `airton-notify` (job a cada 15 min) decide diária 22:00, semanal
dom 19:00, custo de IA dom 20:00 e "Sua semana" dom 19:30 (link para `/semana` do hub) e envia para
`airton.push_subscriptions`.

**Quebras**
- 🔴 **Nenhum push chega.** `airton.push_subscriptions` tem 0 linhas; `airton.notify_log` tem 10 envios (9 `daily`,
  1 `weekly`), todos com `sent = 0`. O hub não oferece inscrição (`apps/hub/app/layout.tsx` sem manifest;
  `apps/hub/middleware.ts:57` exclui `manifest.webmanifest`, que não existe). Os avisos combinados para domingo
  (plano da semana 19:30, custo 20:00) não vão chegar a lugar nenhum.
- 🟡 `/hoje` faz 8 consultas + 9 da `lib/alerts.ts` a cada carga (`force-dynamic`); cada falha vira "Não consegui
  carregar agora" sem detalhe (`hoje/page.tsx:27-35`).
- 🟡 O bloco "IARA House" e a tela `/casa` filtram `core.itens` por `origem = 'iara'`
  (`hoje/page.tsx:78`, `casa/page.tsx:13`), mas ninguém publica com essa origem ainda e `core.itens` está vazia:
  os dois ficam sempre vazios.
- 🟡 `/perfil` é na prática o perfil da ClaudIA: formulário de `public.profiles` (antigo da ClaudIA), tokens do
  `claudia-ingest` e custo só de `claudia_ai_cost` (`perfil/page.tsx:12-16`). Custo do AIrton, SabIA e IARA não aparece.
  O título da seção diz "Custo de IA" e mostra "Nenhuma chamada registrada" porque `claudia.ai_usage` está vazia.
- 🟡 `lib/functions.ts:5`: o comentário diz "claudia-*", mas é usado para `iara-semana` e `iara-agenda` também.
- 🟡 O e-mail permitido está fixo no código (`middleware.ts:8`), enquanto `private.allowed_emails` existe com 1 linha.

---

## IARA (orquestradora: briefing, semana, agenda)

**Telas.** Não tem aba própria: aparece em `/hoje` (briefing + "Seu dia"), em `/semana` e na `/casa` (IARA House).

**Edge functions e crons**

| Função | O que entrega | IA | Cron (BRT) |
| --- | --- | --- | --- |
| `iara-briefing` | `core.coletar_briefings` (um bloco por agente) + `core.rotina` + itens do plano confirmado + `core.fixos` → texto em `core.briefings` | Sonnet 5.5, `briefing-manha` | `iara-manha` diário 07:00 |
| `iara-semana` | Rascunho dia a dia em `core.planos_semana(_itens)` com sugestão e crítica; ao confirmar, adaptações de treino vão para a ClaudIA | Sonnet 5.5, `plano-semana` | `iara-semana` dom 18:00 (ainda não rodou) |
| `iara-agenda` | `sync`: lê links iCal (secret `IARA_AGENDA_ICS_URLS`) e grava 21 dias em `core.agenda_eventos`; `GET ?t=` serve feed iCal com compromissos + plano confirmado | — | `iara-agenda-sync` toda hora, minuto 07 |
| `hub-senha` | Define a senha do Leo com código (`HUB_CADASTRO_CODIGO`) | — | — |

`iara-noite` (21:30) saiu em 09/11; `iara-briefing` ainda aceita `tipo: 'noite'`.

**Contato com outros agentes.** Lê ClaudIA (`core.briefing_claudia`, treinos em `public.plan_sessions`), AIrton
(`core.briefing_airton`, contas do mês), SabIA (trilha) e a casa (`core.briefing_casa`). O plano da semana escreve
treinos de volta em `public.plan_sessions` (valores validados contra os checks da tabela, `iara-semana/index.ts:17-20`).

**Quebras**
- ⚪ `core.agent_runs` 08/11 15:38 UTC: `briefing_noite` com erro "API usage limits… until 2026-12-01". Limite conhecido
  da `ANTHROPIC_API_KEY`; não é bug. As execuções seguintes deram `ok`.
- 🟡 `core.agenda_eventos` vazia: o job roda de hora em hora sem fonte (secret do iCal ainda não cadastrado pelo Leo,
  item 2 do PROGRESSO). O hub mostra o botão de sincronizar mesmo assim.
- 🟡 `core.compromissos`, `core.planos_semana` e `core.planos_semana_itens` vazias: `/semana` entrou no ar hoje
  (#29) e ainda não foi usada.
- 🟡 Projeto antigo da IARA (`xwqsxhfcznnlqgkzcycr`, listas de compras, tarefas e rotina da casa) segue fora do HQ;
  `/casa` mostra um aviso "Em migração" (`casa/page.tsx:21-28`).
- 🟡 As funções do HQ estão com `// @ts-nocheck` (fonte baixado da produção; PROGRESSO 0.2).

---

## ClaudIA (/saude)

**Telas** (abas em `saude/layout.tsx`)

| Aba | O que o usuário faz | Funções |
| --- | --- | --- |
| Resumo `/saude` | Tendência de peso 7d, composição, comida do dia vs meta, treino de hoje e da semana, passos/sono/FC, último check-in | — |
| Peso `/saude/peso` | Registra e apaga pesagens; gráfico com média 7d | — |
| Corpo `/saude/corpo` | Medidas de fita, estimativa de composição, envio de fotos (bucket `progress-photos`), análise de fotos por IA | `claudia-photo-review` |
| Treino `/saude/treino` | Semana de sessões e atividades; gerar/estender plano; revisão semanal com propostas aceitar/descartar; check-in semanal; conectar/sincronizar/desconectar Strava | `claudia-coach` (`plan`, `extend`), `claudia-coach-review` (`review`, `apply`), `claudia-checkin`, `claudia-strava` |
| Sessão `/saude/treino/[id]` | Séries registradas, histórico do exercício, chat sobre a sessão e aplicar mudança | `claudia-coach-session` (`chat`, `apply`) |
| Perfil de treino `/saude/treino/perfil` | Formulário de `training_profiles` | — |
| Callback Strava `/saude/treino/strava` | Troca o `code` e importa atividades | `claudia-strava` (`exchange`) |
| Dieta `/saude/dieta` | Registro de comida em texto livre (IA estima, Leo confirma), apagar, plano de dieta, registro de medicação | `claudia-food-parse`, `claudia-diet` |

Fora das telas: `claudia-ingest` (Atalho do iPhone com token `cla_…`, peso e dados de saúde → `daily_activity`/`activities`).

**IA.** Todas via `_shared/claudia/ai.ts` (Haiku/Sonnet 5.5, teto e log em `claudia.ai_usage`). **Sem crons**: tudo é
disparado por botão. Os alertas de `/hoje` são determinísticos (`lib/alerts.ts`).

**Contato com outros agentes.** `/hoje` lê sessões e alertas; a IARA lê `core.briefing_claudia` e escreve treinos via
plano da semana.

**Quebras**
- 🔴 Uso parado desde o fim de outubro: `food_logs` último em 03/10, `progress_photos` 03/10, `measurements` e
  `medication_logs` 10/10, `weekly_checkins` 01/10, `workout_logs` 22/10, `weight_entries` 29/10. Só `plan_sessions`
  recebe linhas (07/11, materialização de plano). `claudia.ai_usage` tem 0 linhas: nenhuma chamada de IA da ClaudIA
  desde a virada para o hub (o último registro em `public.ai_usage` é de 28/10).
- 🔴 `public.daily_activity` vazia: o Resumo mostra passos/sono/FC que nunca chegam (o Atalho não está enviando, apesar de
  2 tokens criados).
- 🟡 Strava: `private.strava_tokens` com 1 linha e `public.activities` com 4 (última 10/10). O código exige
  `STRAVA_CLIENT_ID`/`SECRET` (`claudia-strava/index.ts:115-116`); pendência conhecida.
- 🟡 Tabelas ainda em `public` (migração para o schema `claudia` pendente) e `public.ai_usage` antigo (sem custo, 39
  linhas) fora de `core.v_ai_cost_all`, que hoje não lista a ClaudIA.
- 🟡 `lib/alerts.ts:39` e `:54` disparam "Check-in da última semana ainda não feito" e "Medidas com mais de 14 dias" todo dia,
  porque os dados estão parados: os badges da órbita ficam sempre acesos.

---

## AIrton (/financas)

**Tela.** `/financas` é uma página única, só leitura: livre no mês e por dia, KPIs (entradas previstas, comprometido,
semana vs normal, para revisar), próximos lançamentos do mês e últimos 8 gastos. Botão para o "AIrton completo"
(`https://airton-gray.vercel.app`) para Open Finance, chat e investimentos (`financas/page.tsx:8`, `:87`). Não há
revisão/categorização de lançamentos no hub, mas `/hoje` cobra "N lançamentos precisam de você".

**Edge functions e crons**

| Função | Ações / o que entrega | IA | Cron (BRT) |
| --- | --- | --- | --- |
| `airton-pluggy` | `connect_token`, `add_item`, `remove_item`, `sync` (Open Finance → `transactions`, categorização) | Haiku (`categorize`) | 07:30 e 21:15 diários |
| `airton-market` | `refresh` (preços), `history`, `news`, `plan` (plano semanal) | Haiku + busca (`news`), Sonnet (`plan`) | refresh 13:35, 18:05, 19:20 dias úteis; history 07:50 diário; news dom/qua/sex 08:20; plan dom 07:00 |
| `airton-ai` | `chat`, `reset_chat`, `categorize`, ferramentas (`month_plan`, `week_summary`, `search_transactions`…) | Sonnet (`chat`) | — |
| `airton-notify` | Push diário 22:00, semanal dom 19:00, custo dom 20:00, semana dom 19:30; `vapid`, `test`, `preview` | — | a cada 15 min |

**Contato com outros agentes.** `/hoje` e `core.briefing_airton` leem `review_counts` e `month_plan`; o plano da semana
da IARA puxa contas do mês; o push "Sua semana" e o de custo de todos os apps saem pelo `airton-notify`.

**Quebras**
- 🔴 Push sem destino (ver Hub): 10 notificações geradas, 0 enviadas.
- 🟡 `categorize` registrou `claude-haiku-4-5` em 03/11 (22 chamadas, US$ 0,19, a feature mais cara do mês). O cliente
  atual mapeia `fast` para Haiku 5.5 (`airton-ai/_shared/ai.ts:6`); vale confirmar na próxima sincronização.
- 🟡 `airton-ai`, `airton-pluggy` e `airton-market` no ar têm `entrypoint_path` `source/index.ts`, diferente das demais
  (`source/supabase/functions/...`): sinal de que não foram publicadas pelo workflow do repo (última atualização
  10/11 ~10:14 UTC). Conferir se a versão do ar bate com o repo.
- 🟡 Tabelas vazias: `goals`, `installment_plans`, `inv_alerts`, `push_subscriptions`. `chat_messages` tem 2 (chat
  usado uma vez, 09/11).
- 🟡 O cliente de IA está copiado três vezes (`airton-ai/_shared/ai.ts`, `airton-market/ai.ts`,
  `airton-pluggy/_shared/ai.ts`), assim como `common.ts`.

---

## SabIA (/aprender)

**Tela.** `/aprender`, página única: título conforme o tipo (Trilha do dia, Imersão do sábado, Recap), minutos e
quantos itens foram vistos, "Fio condutor" (resumo da IA) e cartões por item com ✓ Lido / Pular / Desfazer e reação
(gostei/não gostei) via `hub_sabia_item`.

**Edge function e crons**

| Peça | O que entrega | IA | Cron (BRT) |
| --- | --- | --- | --- |
| `sabia-trilha` | Trilha diária (~40 min), imersão de sábado (~60 min) ou recap de domingo em `sabia.trilhas/itens`; publica um cartão em `core.itens` | Haiku por tema (`trilha-worker`), busca (`trilha-search`), Sonnet (`trilha-orquestrador`, `trilha-recap`); feeds RSS de `sabia.fontes` | diário 06:30 |
| `sabia.ajustar_pesos` (SQL) | Reajusta o peso dos temas pelas reações | — | seg 23:00 (dom) |

**Contato com outros agentes.** `/hoje` (bloco e "Seu dia" usam `hub_sabia`), `core.rotina` (horário da trilha),
briefing da IARA e cartão em `core.itens`.

**Quebras**
- ⚪ 09/11 06:30: run com erro "Resposta sem `<trilha>`" (US$ 0,034 descartados); refeita às 09:28 com sucesso.
- ⚪ 10/11 06:30: trilha ok, mas o cartão falhou (`erro_item`: "publicar_item: user_id, origem… obrigatórios").
  O conserto (#25) foi publicado às 06:56 BRT, depois do cron; verificação marcada para 11/11 no PROGRESSO.
- 🟡 `sabia.livros` (3 linhas) não tem tela no hub; `sabia.leituras` e `sabia.anotacoes` (0 linhas) não têm tela nem
  quem escreva nelas.
- 🟡 Nenhuma reação ou status em `sabia.itens` foi atualizado ainda (1 update em 12 itens): o `ajustar_pesos` de segunda
  roda sem sinal.

---

## Dados de uso

### Tabelas vazias ou paradas

| Situação | Tabelas |
| --- | --- |
| Vazias, sem escritor no código | `sabia.leituras`, `sabia.anotacoes` |
| Vazias, feature ainda sem uso | `airton.goals`, `airton.installment_plans`, `airton.inv_alerts`, `airton.push_subscriptions`, `core.agenda_eventos`, `core.compromissos`, `core.itens`, `core.planos_semana`, `core.planos_semana_itens`, `public.daily_activity`, `claudia.ai_usage` |
| Paradas há mais de 2 semanas | `public.food_logs` (03/10), `public.progress_photos` (03/10), `public.weekly_checkins` (01/10), `public.diet_recommendations` (30/09), `public.measurements`, `public.medication_logs`, `public.photo_reviews`, `public.activities` (10/10) |
| Paradas há 1–2 semanas | `public.workout_logs` (22/10), `public.coach_reviews` (28/10), `public.weight_entries` (29/10) |
| Ativas | `airton.transactions` (5.353; sync 2×/dia), `airton.inv_prices` (7.346), `airton.inv_position` (603), `airton.inv_news` (178), `core.briefings` (3), `sabia.trilhas` (2) / `itens` (12), `public.plan_sessions` (44) |

Contagens completas: `airton` 26 tabelas (`rules` 289, `categories` 64, `sync_runs` 65, `inv_movements` 115…),
`airton_private.tx_backup` 1.485 e `tx_deleted` 406 (backups de 03/11), `core.rotina` 7, `core.agents` 4,
`sabia.fontes` 28, `sabia.temas` 4.

### Frequência real de uso

| Execução | Últimos 30 dias |
| --- | --- |
| `core.agent_runs` iara | 4 (3 ok, 1 erro de limite da chave, 08/11) |
| `core.agent_runs` sabia | 3 (2 ok, 1 erro de formato, 09/11) |
| `airton-notify-tick` | 824 execuções, 0 falhas no cron, 0 push entregue |
| `airton-pluggy` manhã/noite | 9 / 8 |
| `airton-market` refresh (3 jobs) | 5 cada; history 8; news 1; plan 1 |
| `iara-manha` | 2; `sabia-trilha` 2; `iara-agenda-sync` 5; `sabia-pesos` 1; `iara-semana` 0 (primeiro em 15/11) |
| Uso humano | chat do AIrton 2 mensagens (09/11); ClaudIA sem registro desde 29/10; SabIA sem nenhum item marcado |

O `cron.job_run_details` só mede o disparo HTTP (`net.http_post`), não o resultado da função: "0 falhas" não garante
que a função funcionou.

### Custo por feature (novembro, `core.v_ai_cost_all` + `airton.ai_usage`)

| App | Feature | Modelo | Chamadas | US$ |
| --- | --- | --- | --- | --- |
| airton | categorize | claude-haiku-4-5 | 22 | 0,1913 |
| sabia | trilha-orquestrador | claude-sonnet-5-5 | 3 | 0,0994 |
| airton | news | claude-haiku-5-5 | 2 | 0,0472 |
| airton | plan | claude-sonnet-5-5 | 1 | 0,0375 |
| airton | chat | claude-sonnet-5-5 | 2 | 0,0237 |
| iara | briefing-manha | claude-sonnet-5-5 | 2 | 0,0159 |
| iara | briefing-noite | claude-sonnet-5-5 | 1 | 0,0111 |
| sabia | trilha-worker | claude-haiku-5-5 | 12 | 0,0100 |
| **Total** | | | **45** | **0,4361** |

A ClaudIA não entra na view: `claudia.ai_usage` está vazia e o histórico antigo (`public.ai_usage`, 39 chamadas de
25/09 a 28/10: food-parse 12, coach 10, coach-session 5, coach-review 4, checkin 3, photo-review 3, diet 2) não tem
custo. A SabIA custou US$ 0,023 (09/11) e US$ 0,052 (10/11) por trilha, dentro da estimativa de US$ 0,04–0,07/dia.
