# Progresso do IARA HQ (fila de trabalho do executor autônomo)

Atualize este arquivo ao fim de cada etapa e antes de parar. Formato: marque `[x]`, anote a data,
o PR e o que foi conferido em produção. "Próximo passo" sempre preenchido.

**Próximo passo (10/11, 10:40 UTC):**
1. Depois do merge de `feat/semana-input-agenda`: conferir a migration `20261110130000`, os jobs `iara-agenda-sync` e `iara-semana`,
   o feed (`GET /functions/v1/iara-agenda?t=<token>` responde `text/calendar`) e o /semana sem erro no Vercel.
2. Quando o Leo colar o link iCal no secret `IARA_AGENDA_ICS_URLS`: ver `core.agenda_eventos` enchendo de hora em hora.
3. **12/11 depois das 09:30 UTC:** trilha com structured outputs (`fix/json-estruturado`): run ok, cartão da SabIA em
   `core.itens` (`trilha:<data>:diaria`) e `minutos_total` entre 35 e 45. A de 11/11 falhou (JSON livre inválido).
4. Domingo 15/11: 18:00 SP a sugestão + crítica, 19:30 o push (`kind` `semana`), 20:00 o push de custo.
5. Etapa 2, próximo publicador: `iara-briefing` (cartão `lembrete`); depois AIrton e ClaudIA.

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
- [x] 4. Merge do PR #2 (claudia-v2) e virada do domínio para o projeto `hub` (reversível).
      **09/11:** o conteúdo do #2 entrou pelo #17 (o #2 foi fechado como incorporado). O hub publica da `main` em
      `iara-agents-hq.vercel.app` (login com senha, só o Leo). As 9 `claudia-*` foram republicadas a partir do repo:
      7 pelo deploy do #17 e `claudia-photo-review`/`claudia-strava` pelo disparo manual com `funcoes` (#18).
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

## Etapa 5 — Planejamento da semana (domingo à noite) e orquestração da IARA (Fase 5)
- [ ] **10/11, `feat/iara-semana`:** migration `20261110110000_core_planos_semana` (`core.planos_semana` + itens, `core.coletar_semana`,
      `public.hub_semana`/`hub_semana_hoje`/`hub_semana_item`/`hub_semana_confirmar`, `airton.semana_push`, cron `iara-semana` dom 21:00 UTC),
      função `iara-semana` (Sonnet, `effort: low`), tela `/semana` (link "Semana →" na Hoje), push `semana` (dom 19:30 SP) no `airton-notify`,
      briefing lendo o plano do dia. Pedido do Leo (10/11): planejar **tudo junto** — carga de treino adaptada à semana (mover/encurtar;
      completar com o padrão recente se o plano da ClaudIA acabar), dieta de cada dia casada com a carga (calibrada por `food_logs` e peso),
      compras derivadas do cardápio. Ao confirmar, as adaptações de treino vão para `public.plan_sessions` (mover dia/duração; sessão nova
      no plano ativo). Testada em PGlite.
- [ ] **10/11, `feat/semana-input-agenda` (pedido do Leo):** o planejamento parte dele. Migration `20261110130000_semana_input_agenda`:
      `core.compromissos` (jantares, bares, dates...; cancelar = flag), `core.agenda_eventos`, `core.fixos()` (expediente +
      compromissos + agenda), expediente e lugares em `core.perfil.config` (`expediente`, `lugares` com minutos de casa),
      `planos_semana.critica`, RPCs `hub_semana_painel`, `hub_compromisso_salvar/cancelar`, `hub_expediente_salvar`,
      `hub_lugares_salvar`, `hub_semana_item_editar`; `hub_semana_hoje` com os fixos do dia; token do feed; cron `iara-agenda-sync` (:07).
      Função `iara-agenda`: lê a agenda pelo link iCal secreto (secret `IARA_AGENDA_ICS_URLS`, Google e/ou iCloud; recorrência,
      exceções e fusos pelo ical.js) e serve o feed iCal (`GET ?t=`) com compromissos do hub + plano confirmado para assinar no
      iPhone/Google. `iara-semana`: fixos nunca são sobrepostos, deslocamento reservado (minutos informados ou Google Routes se houver
      `IARA_GOOGLE_MAPS_KEY` e endereço de casa) e saída com **crítica**. Tela /semana: entrada do Leo + sugestão + crítica, mover/tirar.
- [x] Planejamento semanal aos domingos à noite (pedido do Leo, 09/11; #26, #28), ver ROADMAP Fase 5:
      1. Migration `core.planos_semana` (semana, status rascunho/confirmado, insumos, texto) + itens do plano (dia, área, título, minutos, valor).
      2. Função `iara-semana` (Sonnet, `effort: low`): junta ClaudIA (plano de treino da semana, metas de dieta), SabIA (temas, imersão,
         livro), AIrton (`month_plan.upcoming` da semana, livre por semana), Casa (quando migrar) e agenda (Fase 4). Cron domingo 21:00 UTC (18:00 SP).
      3. Hub `/semana`: revisar, mover e confirmar; confirmar publica em `core.itens` por dia (`chave_origem` = `semana:<data>:<n>`).
      4. Push "Plano da semana pronto" pelo `airton-notify` (tipo novo `semana`).
      5. Briefing diário passa a ler o plano da semana.
- [x] Briefing único da manhã (09/11, #21) com linha do tempo "Seu dia" (`hub_dia`) e insumo real do AIrton (`briefing_airton` lendo `month_plan`).

## Etapa 6 — Módulos no hub (Fase 6)
- [ ] `/financas`, `/aprender`, `/casa`; IARA migrada; aposentar Vercel `airton`, `iara`, `shyrlai`
      **09/11 (pedido do Leo: "tudo em um site único"):** primeira versão de `/financas` (plano do mês, semana,
      próximos lançamentos, últimos gastos, revisão pendente) e `/casa` (fila de `core.itens` com Feito/Amanhã/Ignorar
      e os briefings). Falta trazer: Open Finance/Pluggy, chat e investimentos do AIrton; casa/compras da IARA (dados no
      Supabase antigo, inacessível); `/aprender` da SabIA. Os apps antigos seguem linkados no fim de cada módulo.
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
| 09/11 | 1.4 | #18 + disparo manual | `claudia-photo-review` v4 e `claudia-strava` v4 publicadas do repo; hub em produção com o tema novo | GitHub teve "Partial System Outage" ~18:15 UTC e a API do Supabase deu 502 ~18:53 UTC: reruns resolveram |
| 09/11 | 6 (início) | `feat/hub-site-unico` | — (conferir após o merge) | Site único: `/financas`, `/casa`, barra com 5 ícones (Hoje, ClaudIA, AIrton, Casa, Perfil); Hoje lúdica com órbita; camada futurista (vidro/brilho); migration `20261109200000_hub_casa` |
| 09/11 | 6 (superapp) | `feat/hub-superapp` | — (conferir após o merge) | Pedido do Leo: briefing único do dia na Hoje (sai o job `iara-noite`; manhã cobre o dia, `effort: low`); SabIA na órbita (vermelho) e `/aprender`; IARA House só com a casa; barra fixa + abas por módulo. Para trazer casa/compras: precisa do Supabase antigo da IARA reativado (pedido ao Leo) |
| 09/11 | 6 (superapp) | #21 + `feat/hub-orbe-cerebro` | deploy do #21 ok | Centro da órbita: orbe de vidro neutro com ícone de cérebro (IARA HQ centralizando), sem contador nem cor (pedido do Leo) |
| 09/11 | SabIA (pedido do Leo) | `feat/sabia-pilulas` | — (conferir após o merge e na trilha de 10/11) | Trilha diária ~40 min (5–7 itens; migration ajusta `core.perfil.config.minutos_trilha`), pílula de 120–180 palavras por item + "Para ir além" com até 2 links extras (URLs só dos workers), workers devolvem 3–5 candidatos; sábado vira imersão de ~60 min no tema mais quente da semana, com síntese de 250–400 palavras. Conferir custo em `core.ai_usage` (feature `trilha-orquestrador`) |
| 09/11 | 5 (início) | `feat/hub-dia-semana` | — (conferir após o merge e no briefing de 10/11) | Linha do tempo "Seu dia" no topo do briefing (rotina + treino + contas do dia); `core.briefing_airton` lê `month_plan` (antes vinha vazio); rotina: sem fechamento da noite, trilha 40 min, imersão 60 min, "Planejamento da semana (IARA)" dom 20:00; prompt da IARA não repete a agenda. Planejamento semanal desenhado no ROADMAP Fase 5 |
| 10/11 | 2 + SabIA | `fix/sabia-cartao-40min` | — (conferir na trilha de 11/11) | Cron de 10/11: trilha ok (7 itens com pílula e "Para ir além", US$ 0,052), mas (a) o cartão não entrou em `core.itens` (`erro_item`: o postgres.js mandou `JSON.stringify(...)::jsonb` como string JSON escalar; agora `sql.json`) e (b) deu 28 min em vez de 40 (fontes curtas). Agora o tempo da pílula conta no item e o prompt exige a soma entre 35 e 45 min (até 8 itens, prefere peças longas) |
| 10/11 | Conferência | — | trilha 09:30 ok; briefing 07:00 ok | Trilha: 7 itens com pílula, US$ 0,052 (cartão falhou, corrigido no #25). Briefing único: estrutura nova ok, US$ 0,0095; valores saíam "-252.55" (ajustado para R$ no `feat/iara-semana`) |
| 10/11 | 5 | #26 | deploy ok: migration `20261110110000`, cron `iara-semana` dom 21:00 UTC, `coletar_semana` com dados reais | Planejamento da semana integrado (treino → dieta → compras, estudo, contas), `/semana` para revisar e confirmar, confirmação aplica as adaptações de treino na ClaudIA |
| 10/11 | 6 (pedido do Leo) | #27 | deploy do Vercel ok, sem erros de runtime | Desktop e iPad em paisagem (≥ 900 px): barra vira trilho à esquerda (com nomes a partir de 1280 px), Hoje em colunas (briefing à esquerda; órbita e blocos à direita), semana em quadro de dias; botão de claro/escuro no topo; modo claro com sombra real nos cartões |
| 10/11 | 5 | `fix/semana-de-hoje` | — (conferir após o merge) | Pedido "monte a semana agora" (terça): no meio da semana a `iara-semana` planeja só de hoje até domingo. Disparo pelo botão de /semana (o conector do Supabase é só leitura) |
| 10/11 | 5 | #28 | deploy ok | Semana atual planejada de hoje até domingo |
| 10/11 | 5 (pedido do Leo) | `feat/semana-input-agenda` | — (conferir após o merge) | Planejamento como input do Leo: expediente, compromissos pessoais, lugares com deslocamento, agenda Google/iPhone por iCal (leitura de hora em hora + feed para assinar), sugestão inicial + crítica, mover itens. Depende do Leo: link iCal no secret `IARA_AGENDA_ICS_URLS`; opcional `IARA_GOOGLE_MAPS_KEY` |
| 11/11 | Conferência + SabIA | `fix/json-estruturado` | — (conferir na trilha de 12/11) | Trilha de 11/11 falhou: o orquestrador devolveu JSON livre inválido (aspas sem escape numa pílula; US$ 0,069 perdidos, sem trilha). Agora a orquestradora e o recap da SabIA e o plano da semana usam structured outputs (`output_config.format` com JSON Schema; se a API recusar o schema, repete uma vez sem ele); corte por `max_tokens`/recusa vira erro claro. Botão "Gerar a trilha de hoje" no /aprender quando a do dia não saiu. Vercel sem erros em 24h; agenda/compromissos ainda vazios (aguardando o Leo) |
