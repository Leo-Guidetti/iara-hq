# Plano de UX do IARA HQ: planos de vida e voz (auditoria, 10/11/2026)

Só auditoria: nada de código, banco, cron ou segredo foi alterado. Base: `docs/ux-audit/inventario.md` (PR #31),
`CLAUDE.md` e o código na `main` (`8d5a73f`). Os executores citados (`supabase-dev`, `hub-ui`) são os subagentes do PR #30.

**Como ler.** **[F]** = fato, com arquivo, tabela ou função que comprova. **[H]** = hipótese, ainda sem medição.
Preços de modelo vêm do `CLAUDE.md` (fato); volumes de uso são sempre hipótese.

## 0. Resumo

| # | Achado | Tipo |
| --- | --- | --- |
| 1 | Nenhum dos 5 planos de teste completa a jornada. Não existe a entidade "plano" nem meta com horizonte: cada agente guarda um pedaço sem ligação (`airton.goals`, `profiles.goal`, `workout_plans.goal`, `sabia.livros`). | F |
| 2 | O sistema só enxerga o curto prazo: o horizonte mais longo que algum agente planeja é 7 dias (`iara-semana`) ou o mês corrente (`airton.month_plan`). | F |
| 3 | O plano mais perto de funcionar é a leitura diária, e ele para num ponto só: nada escreve em `sabia.leituras`, então o progresso está congelado para o briefing, a semana e o recap. | F |
| 4 | De 15 interações principais, 1 funciona sem tela (peso pelo Atalho), 4 têm o backend numa chamada só e falta a porta, 4 dependem de formulário e 6 não existem. | F |
| 5 | Proatividade entregue é zero: os crons geram texto em tabela e o único canal de aviso tem 0 inscritos. | F |
| 6 | No texto a IARA já fala por todos (briefing e semana); na navegação e no chat o Leo ainda escolhe o agente. A Fase 7 do ROADMAP manteria essa divisão na voz (`ask_airton`, `ask_claudia`, `ask_iara`). | F |
| 7 | O caminho mais barato para voz é reaproveitar o que já existe: Atalho do iPhone com token (`claudia-ingest`) apontando para uma porta única em texto. Custo de IA adicional do plano inteiro: cerca de US$ 5/mês, dos quais US$ 3 são voz em tempo real. | H |

---

## 1. Diagnóstico: os 5 planos de teste com o que existe hoje

### 1.1 Matriz da jornada

✅ funciona · 🟡 existe pela metade · ❌ não existe

| Plano | Criar | Quebrar por horizonte | Acompanhar | Replanejar | Onde para primeiro |
| --- | --- | --- | --- | --- | --- |
| Comprar imóvel | 🟡 | ❌ | 🟡 | ❌ | Criar: a tabela existe, a porta não |
| Comprar carro | 🟡 | ❌ | 🟡 | ❌ | Criar, e depois a disputa com o imóvel pela mesma poupança |
| Mudar de carreira | ❌ | ❌ | ❌ | ❌ | Criar: nenhum agente é dono de "carreira" |
| Aprender um instrumento | ❌ | ❌ | ❌ | ❌ | Criar: `hobby` é só um valor de check |
| Leitura diária, meta de livros/ano | 🟡 | 🟡 | ❌ | ❌ | Acompanhar: não há como registrar página lida |

### 1.2 Jornada por plano

**Comprar imóvel (longo prazo) e comprar carro (médio prazo)**

| Etapa | O que existe hoje | Onde quebra | Evidência | Tipo |
| --- | --- | --- | --- | --- |
| Criar | `airton.goals` (nome, valor alvo, prazo, valor atual) | Tabela vazia e sem porta: `/financas` é só leitura e o chat do AIrton tem 7 ferramentas, todas de consulta | `20261102002958_airton_01_schema.sql:135-144`; `airton-ai/index.ts:7-99`; inventário (AIrton) | F |
| Criar | App antigo do AIrton pode ter tela de metas | Não verificado; mesmo que tenha, fica fora do hub | `financas/page.tsx:8` (link para o app antigo) | H |
| Quebrar | `month_plan` reserva uma % global de poupança (`savings_target`, padrão 20%) | A poupança não está ligada a nenhuma meta; não há aporte mensal necessário, marco nem prioridade entre metas | `20261102003132_airton_03_views_engine.sql:91` | F |
| Quebrar | Parcelas e eventos previstos (`installment_plans`, `planned_events`) | Servem para o carro financiado, mas ninguém simula "à vista ou financiado" nem o custo fixo novo (IPVA, seguro) | `airton_01_schema.sql:114-133`; `installment_plans` vazia (inventário) | F |
| Acompanhar | `core.briefing_airton` lê `airton.goals` | Só repassa os campos; `current_amount` é digitado à mão, sem ligação com `inv_position`; nenhum cartão em `core.itens` | `20261108153456_iara_hq_core.sql:137-139` | F |
| Acompanhar | Plano semanal de investimentos (`airton-market`, ação `plan`) | Não lê metas: o código não cita `goals` | `airton-market/index.ts` (busca por `goal` sem resultado) | F |
| Replanejar | Nada | Mudança de renda, juros ou um segundo objetivo não dispara nada; carro e imóvel disputam a mesma poupança sem que alguém perceba | `airton.goals` sem coluna de prioridade | F |

**Mudar de carreira (longo prazo, atravessa todos os agentes)**

| Etapa | O que existe hoje | Onde quebra | Evidência | Tipo |
| --- | --- | --- | --- | --- |
| Criar | Nada | `core.agents` tem 4 domínios (rotina e casa, saúde, finanças, estudos); carreira não é de ninguém | `iara_hq_core.sql:34-38` | F |
| Quebrar | 4 temas fixos da SabIA | Tema novo (a habilidade da carreira nova) só entra por migration; não há tela nem RPC de temas | `20261108153535_iara_hq_sabia.sql:9-14` | F |
| Quebrar | Renda prevista a partir dos vínculos em `airton.employments` | Não há cenário "quantos meses aguento sem salário" nem meta de reserva | `20261102233353_airton_14_income_and_events.sql:4-7`; ferramentas do chat (`airton-ai/index.ts:7-99`) | F |
| Acompanhar | `core.rotina` (7 linhas) | Bloco de estudo não tem como entrar: o hub não edita a rotina | busca por `rotina` em `apps/hub/app` (só leitura em `hoje/page.tsx:91`) | F |
| Replanejar | Nada | — | — | F |

**Aprender um instrumento (médio prazo, hábito)**

| Etapa | O que existe hoje | Onde quebra | Evidência | Tipo |
| --- | --- | --- | --- | --- |
| Criar | `sabia.trilhas.tipo` aceita `hobby` e `/aprender` tem o rótulo "Hobby" | Nada gera trilha `hobby`; não existe habilidade, currículo nem nível | `iara_hq_sabia.sql:41`; `aprender/page.tsx:9`; `sabia-trilha/index.ts` sem `hobby` | F |
| Quebrar | Plano da semana tem a área `aprender` | O prompt só conhece trilha, imersão e livro | `iara-semana/index.ts:150-151` | F |
| Acompanhar | `sabia.leituras` | É só para livro; não há registro de prática (minutos, o que treinou) | `iara_hq_sabia.sql:98-103` | F |
| Replanejar | Nada | Semana cheia não reduz a prática; compra do instrumento não passa pelo AIrton | — | F |

**Leitura diária com meta de livros/ano (curto prazo repetido, o mais maduro)**

| Etapa | O que existe hoje | Onde quebra | Evidência | Tipo |
| --- | --- | --- | --- | --- |
| Criar | `sabia.livros` (3 linhas: status, páginas, página atual) | Não há tela de livros no hub nem campo para a meta do ano | inventário (SabIA); `iara_hq_sabia.sql:84-94` | F |
| Quebrar | A semana pede "meta de páginas da semana" e o recap de domingo propõe páginas | A meta é inventada pelo modelo a cada vez: os insumos não trazem alvo anual nem ritmo necessário | `iara-semana/index.ts:151`; `core.coletar_semana` (`aprender.livros`); `sabia-trilha/index.ts:428` | F |
| Acompanhar | Trigger `sabia.tg_leitura` atualiza página, status e datas sozinho | Nada escreve em `sabia.leituras` (0 linhas, sem tela e sem função): o progresso nunca muda | `iara_hq_sabia.sql:105-117`; inventário (tabelas vazias sem escritor) | F |
| Acompanhar | O lembrete de leitura com meta de páginas estava no fechamento da noite | O job `iara-noite` saiu em 09/11; sobrou uma linha genérica "À noite" no briefing da manhã | `iara-briefing/index.ts:58-61` | F |
| Replanejar | Nada | Semana sem leitura não recalcula páginas/dia nem troca o livro | — | F |

### 1.3 Quem deveria colaborar e não colabora

Papel esperado de cada agente no plano. **Negrito** = dono natural. Entre parênteses, o que existe hoje.

| Plano | AIrton | IARA (casa, rotina) | SabIA | ClaudIA |
| --- | --- | --- | --- | --- |
| Imóvel | **Entrada, reserva, simulação de financiamento** (só `goals` vazia) | Visitas na agenda, mudança, casa (nada) | Trilha temática sobre financiamento e bairros (temas fixos) | Neutra por padrão |
| Carro | **À vista ou financiado, custo fixo novo** (nada) | Novo tempo de deslocamento em `core.perfil.config.lugares` (cadastro manual) | Pesquisa de modelos (nada) | Neutra |
| Carreira | Reserva e meses de fôlego (nada) | **Guarda o plano**; blocos de estudo na rotina (rotina sem edição) | **Habilidades e currículo** (temas fixos) | Sono e carga em fase de estudo intenso (`daily_activity` vazia) |
| Instrumento | Compra e aulas no orçamento (nada) | Encaixe na semana (prompt não conhece prática) | **Currículo e registro de prática** (nada) | Neutra |
| Leitura | — | Horário na rotina e lembrete (lembrete saiu com o `iara-noite`) | **Livros, páginas, meta do ano** (sem escritor) | — |

Colaboração que já existe **[F]**: só no horizonte de 7 dias. `iara-semana` cruza treino, dieta, contas, estudo e casa numa
única chamada e devolve uma crítica (`iara-semana/index.ts:158`); ao confirmar, escreve treinos na ClaudIA
(`hub_semana_confirmar`). O painel "a favor, contra, neutro" da skill `iara-hq` não existe em código: a crítica é uma voz só.

### 1.4 Trabalho que o Leo faz e um agente deveria fazer

| Trabalho manual hoje | Agente que deveria fazer | Evidência | Tipo |
| --- | --- | --- | --- |
| Calcular quanto guardar por mês para uma meta e conferir se cabe | AIrton | `month_plan` só tem % global | F |
| Atualizar o valor acumulado da meta | AIrton (ler de `inv_position` ou de conta) | `goals.current_amount` sem escritor | F |
| Decidir qual plano cede quando dois disputam dinheiro ou tempo | IARA (painel) | Sem prioridade nem detecção de conflito | F |
| Lembrar a página do livro e a meta de páginas | SabIA | `sabia.leituras` sem escritor | F |
| Escolher o agente (aba) antes de pedir qualquer coisa | IARA (roteamento) | 5 abas em `AppShell.tsx`; `/hoje` sem campo de entrada | F |
| Resolver "N lançamentos precisam de você" saindo do hub | AIrton dentro do hub | `hoje/page.tsx:43` cobra; `/financas` sem revisão; as RPCs `airton.set_category` e `airton.confirm` já existem | F |
| Refazer os próprios ajustes quando pede um rascunho novo da semana | IARA (preservar edições) | `iara-semana/index.ts:202` apaga o rascunho anterior | F |
| Ignorar todo dia os mesmos alertas | ClaudIA (alerta com estado) | `lib/alerts.ts:39`, `:54` | F |

---

## 2. Prontidão para voz

### 2.1 Interações principais

Escala: **0** não existe · **1** existe, mas depende de tela · **2** uma chamada resolve, falta a porta por frase e a resposta
falável · **3** já funciona sem tela.

| Interação | Nota | Como é hoje | O que falta para uma frase | Evidência |
| --- | --- | --- | --- | --- |
| Registrar peso | 3 | Atalho do iPhone → `claudia-ingest` com token | Resposta falada de confirmação | `claudia-ingest/index.ts:1-6` |
| "Quanto posso gastar hoje?" | 2 | Chat do AIrton, só no app antigo | Porta no hub; resposta sem lista nem markdown | `airton-ai/index.ts:182-185`, `:302` |
| Marcar item da trilha (lido, pular, reação) | 2 | Botões; RPC única `hub_sabia_item` | Resolver "o segundo", "esse último" | `20261109210000_hub_sabia_briefing_unico.sql:30` |
| Criar compromisso ("jantar quinta às 20h") | 2 | Formulário em `/semana`; RPC `hub_compromisso_salvar(jsonb)` | Extrair data, hora e lugar da frase | `semana/Entrada.tsx` (12 campos) |
| Feito ou adiar um item | 2 | Botões; RPC `hub_item_status` | Referência ao item por nome | `20261109200000_hub_casa.sql:29` |
| Ouvir o dia (briefing) | 1 | Markdown de ~200 palavras em `/hoje` | Versão curta e autocontida; hoje o prompt manda não listar a agenda "porque o app já mostra" | `iara-briefing/index.ts:12`, `:56` |
| Registrar comida | 1 | Texto livre → estimativa da IA → confirmação em formulário | Confirmação falada do que foi entendido | `saude/dieta/FoodEntry.tsx`; `claudia-food-parse` |
| Marcar treino feito, registrar séries | 1 | Tela da sessão | Registro por ditado, uma série por frase | `saude/treino/[id]` |
| Planejar e confirmar a semana | 1 | Formulário + rascunho + crítica de 4 a 7 itens + botão único | Resumo falado com exceções e até 3 decisões | `iara-semana/index.ts:158`; `semana/Plano.tsx:104` |
| Registrar páginas lidas | 0 | — | Tudo (UX-02) | `sabia.leituras` sem escritor |
| Registrar prática de instrumento | 0 | — | Tudo (UX-17) | — |
| Criar meta ou plano | 0 | — | Tudo (UX-03, UX-11) | — |
| "Como estão meus planos?" | 0 | — | Tudo (UX-09, UX-10) | — |
| Categorizar um lançamento | 0 no hub | App antigo | Pergunta proativa: "o Pix de R$ 80 é o quê?" | `financas/page.tsx:87` |
| Decidir um conflito entre agentes | 0 | — | Tudo (UX-13) | — |

Fora do alvo de voz, com razão: conectar Strava e Open Finance (OAuth), fotos de progresso, medidas de fita.

### 2.2 Os cinco critérios

| Critério | Nota (0–3) | Fatos | Hipóteses |
| --- | --- | --- | --- |
| Confirmação | 1 | Só visual: `confirm()` do navegador (`perfil/client.tsx:48`, `saude/peso/DeleteButton.tsx`) e botões. A maior ação do sistema, confirmar a semana, publica até 49 itens e altera treinos em `plan_sessions` num toque, sem desfazer (`hub_semana_confirmar`; "plano já confirmado nunca é refeito", `iara-semana/index.ts:6`). | O fluxo da comida (fala livre → estimativa → confirmar) é o molde certo para voz. |
| Ambiguidade | 0 | Não há roteador nem pergunta de esclarecimento: quem desambigua é o Leo, escolhendo a aba. Não existe lista do que pode ser pedido. | Um catálogo de intenções com exemplos resolve mais de 90% das frases do dia a dia com o tier `fast`. |
| Proatividade | 0 entregue | Os agentes produzem na hora certa (trilha 06:30, briefing 07:00, semana dom 18:00), mas o resultado espera numa tabela. Push: 0 inscritos, 10 envios com `sent = 0`, hub sem manifest nem service worker. Avisos são 4 tipos fixos do AIrton (`airton-notify/index.ts:287`), sem limite diário, sem pergunta respondível. Alertas repetem todo dia sem memória. | 2 a 3 interrupções por dia é o teto antes de o Leo silenciar tudo. |
| Interrupção | 0 | Toda chamada é pedido e resposta únicos; trabalho longo responde 202 e continua (`EdgeRuntime.waitUntil`). Não há estado de conversa da IARA nem ação pendente: um "sim" na frase seguinte não tem a que se prender. Só o AIrton guarda histórico (`airton.chat_messages`). | Chat com ferramentas no tier `smart` leva de 5 a 15 s, lento demais para voz sem uma fala de espera; medir em `core.agent_runs`. |
| Persona única | 1 | Texto: sim. Briefing e semana usam "Você fala pelos especialistas" (`iara-briefing/index.ts:7`, `iara-semana/index.ts:23`). Navegação e conversa: não. São 5 abas, uma cor por app, chat só por agente, e a Fase 7 prevê uma ferramenta por agente, sem a SabIA e só para perguntas (`ROADMAP.md:66-69`). | Com uma ferramenta por agente, o modelo de voz vira o roteador e a troca aparece na fala ("vou perguntar ao AIrton"). |

---

## 3. Modelo-alvo

### 3.1 Requisitos e restrições

| Tipo | Requisito |
| --- | --- |
| Funcional | Um plano nasce de uma frase, vira metas em 3 horizontes, cada meta com um dono; o progresso é medido sem o Leo digitar; mudança relevante gera proposta de ajuste; conflito gera decisão com posições explícitas. |
| Funcional | Toda ação principal cabe numa frase, por texto ou voz, pela IARA. O Leo nunca escolhe o agente. |
| Custo | Tiers do `CLAUDE.md`: `smart` só planeja e sintetiza; leitura e classificação em `fast`; acompanhamento em SQL, sem IA. Orçamento por execução em `core.agent_runs`. |
| Latência (voz) | Escrita: até 4 s da frase à confirmação. Pergunta com dados: até 8 s, com fala de espera. **[H]**, a medir. |
| Restrições | Um usuário. Migrations só aditivas: o CI bloqueia `drop`, `rename`, `truncate` e `delete from`, inclusive dentro de função (`ci.yml:26`), então desfazer e cancelar são sempre marcação, nunca remoção. Nenhum check existente é alterado. Produção só muda por merge. |

### 3.2 Componentes e fluxo

```
 Leo: barra no hub · Atalho/Siri · voz em tempo real · resposta a um aviso
        │ frase
        ▼
 ┌─────────────────────── IARA, única persona (iara-comando) ───────────────────────┐
 │ 1 roteia (fast) com core.intencoes                                               │
 │ 2 escrita ─► RPC determinística, com confirmação por risco (core.acoes_pendentes)│
 │   pergunta ─► especialista (smart)        plano ─► iara-plano                    │
 │ 3 responde sempre {fala, tela, pendente}                                         │
 └────────┬──────────────────┬──────────────────┬──────────────────┬───────────────┘
          ▼                  ▼                  ▼                  ▼
    AIrton (airton)    ClaudIA (public)    SabIA (sabia)     IARA casa/rotina (core)
    goals, month_plan  plan_sessions,      livros, leituras, itens, compromissos,
                       peso                praticas          planos_semana
          └───────── progresso_fn por agente (SQL diário, sem IA) ─────────┘
                                      ▼
      core.planos ──► core.plano_metas (horizonte, dono, medida, demanda, ref)
           │               ├──► core.v_conflitos ──► core.decisoes + posições (painel)
           │               └──► planos_semana_itens.meta_id ──► core.itens ──► /hoje, avisos
           └──► core.plano_eventos (histórico: progresso, gatilho, ajuste, decisão)
```

### 3.3 O plano de vida como entidade compartilhada em `core`

O plano mora em `core` porque atravessa agentes; o dado de domínio continua no schema do agente e a meta só aponta para ele (`ref`).

| Tabela | Campos principais | Regra |
| --- | --- | --- |
| `core.planos` | `titulo`, `tipo` (imovel, carro, carreira, habilidade, habito, outro), `status` (rascunho, ativo, pausado, concluido, abandonado), `prioridade` (ordem dada pelo Leo), `alvo` jsonb (valor, data), `porque` (motivação, usada nas falas), `proxima_revisao` | Dono do registro: IARA. Quem decide: Leo. |
| `core.plano_metas` | `plano_id`, `parent_id`, `horizonte` (curto, medio, longo), `dono` (FK `core.agents.slug`), `titulo`, `medida` jsonb (tipo valor, contagem, habito ou marco; unidade; alvo; início), `prazo`, `cadencia`, `demanda` jsonb (`reais_mes`, `minutos_semana`), `ref` (ex.: `airton.goals:goal_x`), `progresso`, `ritmo` (no_ritmo, atrasada, adiantada, sem_dados) | Exatamente um dono por meta. `demanda` é o que permite detectar conflito sem IA. |
| `core.plano_eventos` | `plano_id`, `meta_id`, `tipo` (criado, progresso, gatilho, ajuste, decisao, pausa), `origem` (leo, agente, sistema), `dados`, `at` | Só acrescenta. É a memória que a IARA usa para explicar "por que mudou". |
| `core.decisoes` | `plano_id`, `pergunta`, `gatilho` (chave única), `opcoes`, `sintese` (concordância, divergência, recomendação), `escolha`, `status` | Uma decisão aberta por gatilho. |
| `core.decisao_posicoes` | `decisao_id`, `agent`, `posicao` (favor, contra, neutro), `confianca` 0–10, `argumento`, `condicao` | Formato da skill `iara-hq`. |
| `core.intencoes` | `slug`, `agent`, `exemplos`, `rpc`, `slots`, `risco`, `confirmacao`, `desfazer_rpc` | Catálogo do que pode ser dito. É o "registro de intenções de voz" que o `hub-ui` procura. |
| `core.acoes_pendentes`, `core.conversas` | intenção, payload, status, `expira_em`; turnos da última meia hora | Dão ao "sim", ao "desfaz" e ao "o segundo" algo a que se prender. |

Colunas aditivas em tabelas existentes: `core.agents.progresso_fn` (mesmo padrão de `briefing_fn`),
`core.planos_semana_itens.meta_id`, `core.briefings.fala`, `airton.goals.priority` e `kind`.

### 3.4 Quem é dono de cada horizonte

| Horizonte | Janela | Onde mora | Quem propõe | Dono da meta | Quem revisa | IA |
| --- | --- | --- | --- | --- | --- | --- |
| Longo | mais de 1 ano | `core.planos` + metas `longo` | IARA, a partir da frase do Leo | Leo decide, IARA guarda; AIrton dá parecer de viabilidade sempre que houver dinheiro | IARA, a cada trimestre | `smart`, 1 chamada por trimestre |
| Médio | trimestre a 1 ano | metas `medio` + objeto do domínio | Agente do domínio | Agente do domínio, um só | IARA, 1º domingo do mês | SQL diário + `smart` 1 vez por mês |
| Curto | semana e mês | `planos_semana_itens`, `core.itens` | IARA, no plano da semana | Agente do item | IARA, domingo e briefing diário | O que já roda hoje |

Os 5 planos de teste no modelo:

| Plano | Longo (IARA guarda) | Médio (dono) | Curto (dono) |
| --- | --- | --- | --- |
| Imóvel | Apartamento até a data alvo | AIrton: entrada e reserva. SabIA: entender financiamento. IARA: bairros visitados | AIrton: aporte do mês. IARA: visitas na agenda |
| Carro | Carro até a data alvo | AIrton: valor e forma de pagamento. IARA: deslocamento novo | AIrton: aporte. IARA: test drives |
| Carreira | Nova função até a data alvo | SabIA: habilidades e portfólio. AIrton: meses de fôlego. IARA: conversas e candidaturas | SabIA: estudo da semana. IARA: blocos na rotina |
| Instrumento | Tocar um repertório definido | SabIA: nível e minutos por semana. AIrton: instrumento e aulas | SabIA: prática do dia. IARA: encaixe |
| Leitura | N livros por ano | SabIA: livros do trimestre | SabIA: páginas do dia. IARA: horário e lembrete |

### 3.5 Como os agentes negociam conflitos

Regras fixas primeiro, painel só para o que as regras não resolvem. É isso que mantém o custo baixo.

| Ordem | Regra | Quem aplica | IA |
| --- | --- | --- | --- |
| 1 | Blocos fixos do Leo e sono não são sobrepostos (já vale em `iara-semana`) | SQL | não |
| 2 | Contas e reserva de emergência vêm antes de qualquer meta | SQL (`month_plan`) | não |
| 3 | Entre planos, vale a prioridade que o Leo deu | SQL (`core.planos.prioridade`) | não |
| 4 | Sobrou conflito (soma das demandas maior que a capacidade, ou meta atrasada que só anda tirando de outra): abre decisão | `core.v_conflitos` | não |
| 5 | Painel: cada agente com interesse dá posição, confiança 0–10, argumento e condição, olhando só o resumo do próprio domínio | 1 chamada `fast` por agente (2 a 4) | sim |
| 6 | IARA sintetiza concordância, divergência e recomendação, em versão de tela e de fala | 1 chamada `smart` | sim |
| 7 | Leo decide numa frase; uma RPC aplica e registra em `plano_eventos` | SQL | não |

Quem vota: AIrton sempre que `reais_mes > 0`; ClaudIA quando a mudança mexe em sono ou treino; SabIA quando mexe em tempo de
estudo; IARA pela rotina e pela casa. Agente sem interesse não é chamado.

Exemplo ilustrativo (números inventados, só para mostrar o formato):

| Agente | Posição | Confiança | Argumento | Condição |
| --- | --- | --- | --- | --- |
| AIrton | Contra | 8 | O carro em 2027 atrasa a entrada do imóvel em 14 meses | A favor se o carro custar até R$ 60 mil |
| IARA | A favor | 6 | Corta 40 min por dia de deslocamento nos dias de escritório | — |
| ClaudIA | Neutra | 3 | Menos caminhada diária, compensável no treino | — |
| **Síntese** | | | Todos concordam que cabe um carro mais barato; a divergência é o prazo do imóvel. Recomendação: carro até R$ 60 mil em 2027 e imóvel em 2031. | |

### 3.6 Contrato de fala

| Risco | Exemplos | Comportamento | Como soa |
| --- | --- | --- | --- |
| Baixo (reversível, sem dinheiro) | Registrar leitura, peso, prática; marcar feito; adiar | Executa e confirma repetindo o que entendeu; "desfaz" vale por 10 min | "Anotei: página 150. Faltam 12 por dia para fechar a meta." |
| Médio | Criar compromisso, mover treino, categorizar lançamento | Repete o entendido e executa; "não, …" corrige | "Jantar quinta às 20h no Bar X. Marquei." |
| Alto (dinheiro, plano, semana inteira) | Confirmar a semana, criar ou mudar plano e meta, decidir um painel | Lê de volta o essencial e só executa com "sim" | "Confirmo a semana com 4 treinos e o longo no domingo?" |

| Tema | Regra |
| --- | --- |
| Formato | Até 2 frases, conclusão primeiro, sem markdown, valores arredondados, no máximo 1 pergunta, oferta de detalhe ("quer o resto?"). |
| Ambiguidade | Padrões pelo contexto (livro em leitura, hoje, última lista falada). Na dúvida, 1 pergunta fechada com até 3 opções. Valor em dinheiro nunca é adivinhado. |
| Interrupção | Cada turno é uma RPC atômica. "Para", "depois" e "desfaz" valem sempre. Pergunta em aberto fica guardada por 30 min. |
| Persona | Só a IARA fala. O especialista aparece como origem do dado, nunca como passagem de conversa. |
| Proatividade | Um canal, teto diário e horário de silêncio definidos pelo Leo. Todo aviso traz uma pergunta que se responde com uma palavra. |

### 3.7 Trade-offs

| Decisão | Escolha | Alternativa | Por que | O que se perde |
| --- | --- | --- | --- | --- |
| Onde mora o plano | `core`, com `ref` para o domínio | Cada agente com o seu; ou copiar dados para `core` | Uma visão só, sem duplicar dado financeiro ou de saúde | `ref` por texto não tem chave estrangeira; o adapter precisa tolerar referência quebrada |
| Progresso | SQL diário por adapter | IA lendo tabelas | Custo zero, repetível, auditável | Meta qualitativa (carreira) vira marco manual |
| Painel | N chamadas `fast` isoladas + 1 `smart` (cerca de US$ 0,014) | 1 chamada `smart` fazendo os três papéis (cerca de US$ 0,012) | Posições independentes de verdade e registradas por agente | Algumas chamadas a mais e um pouco mais de latência |
| Porta única | Roteador `fast` + RPC determinística | Um agente `smart` com todas as ferramentas | Escrita custa cerca de US$ 0,0002 em vez de US$ 0,012 e responde em 1 a 2 s | Pedido composto ("registra e me diz como estou") precisa cair no `smart` quando a confiança é baixa |
| Primeira voz | Atalho do iPhone → porta única | Ir direto ao modelo em tempo real | Custo zero, testa o contrato de fala antes de pagar por minuto | Sem falar por cima, latência da Siri |
| Ferramentas da voz em tempo real | Uma só, `iara(texto)` | `ask_airton`, `ask_claudia`, `ask_iara` (ROADMAP) | Persona única e as mesmas confirmações em todo canal | Um salto a mais de latência **[H]** |

**O que revisitar quando crescer:** segundo usuário (hoje vários pontos assumem só o Leo, como o e-mail fixo no
`middleware.ts`); mais de ~10 planos ativos (a revisão mensal numa chamada só deixa de caber); migração da ClaudIA para o
schema `claudia` (os `ref` e adapters que apontam para `public` mudam); casa migrada do Supabase antigo; latência de dois
saltos na voz acima de 3 s.

---

## 4. Plano em ondas

Sequência: **Onda 1** conserta o que já existe e não cria arquitetura. **Onda 2** cria o plano de vida e a porta única em
texto. **Onda 3** troca o teclado pela voz sobre a mesma porta. Cada item é um PR; "ambos" significa `supabase-dev` primeiro,
`hub-ui` depois.

```
UX-01 ─┬─► UX-15 ─► UX-16 ─► UX-18 ─► UX-19
       │                  └────────► UX-21
UX-02 ─┼─► UX-09 ─► UX-10
UX-03 ─┘      │
UX-08 ────────┴─► UX-11, UX-12 ─► UX-13 ─► UX-14 ─► UX-22
UX-04 ───────────────────────────────────► UX-20 (com UX-14, UX-15, UX-16)
UX-05, UX-06, UX-07: independentes        UX-17: depois de UX-08 e UX-09
```

Itens com IA nova (UX-05, 11, 13, 14, 15, 17, 18, 21, 22) podem ficar "pendente: chave" na verificação até 01/12.
Antes de editar `airton-ai` (UX-03, UX-18): comparar a versão no ar com o repo (regra de ouro 5; o inventário aponta
`entrypoint_path` diferente).

### Onda 1 — Quick wins

**Problema, evidência e mudança**

| ID | Problema | Evidência | Mudança |
| --- | --- | --- | --- |
| UX-01 | Não existe lista do que pode ser pedido; cada ação mora num componente de tela. | 10 arquivos com `<input>` ou `confirm(` em `apps/hub/app/(app)`; nenhuma tabela de intenções; `.claude/agents/hub-ui.md` (PR #30) já manda registrar a ação "se o plano definir um registro". | Migration `core.intencoes` (§3.3), leitura para `authenticated`. Semente com as ações que já são uma RPC só: `hub_item_status`, `hub_sabia_item`, `hub_compromisso_salvar`, `hub_compromisso_cancelar`, `hub_semana_item`, `hub_semana_item_editar`, `hub_semana_confirmar`. Regra daqui em diante: ação nova = uma RPC com parâmetros nomeados + uma linha no catálogo. |
| UX-02 | A meta de livros/ano não tem onde morar e não há como registrar página lida: briefing, semana e recap leem um progresso congelado. | `sabia.leituras` com 0 linhas e sem escritor (inventário); trigger pronto em `20261108153535_iara_hq_sabia.sql:105-117`; `/aprender` não mostra `sabia.livros`. | `supabase-dev`: meta em `core.perfil.config.livros_ano`; RPCs `hub_livros()` (livro atual, fila, lidos no ano, meta, páginas/dia necessárias), `hub_leitura_registrar(p_pagina, p_livro default null, p_minutos default null)` (sem livro = o que está em leitura) e `hub_livro_salvar(jsonb)`; `sabia.briefing_hoje` passa a devolver meta e páginas/dia. `hub-ui`: bloco "Livros" em `/aprender` (progresso, "X de N no ano", "Li até a página…", fila). |
| UX-03 | Imóvel e carro só cabem em `airton.goals`, vazia e sem porta; não há aporte necessário nem prioridade entre metas. | `airton_01_schema.sql:135-144`; `/financas` só leitura; `airton-ai/index.ts:7-99` (7 ferramentas de consulta); `airton_03_views_engine.sql:91` (% global). | `supabase-dev`: colunas aditivas `priority` e `kind`; RPC `airton.goals_status()` (por meta: quanto falta, meses até o prazo, aporte mensal necessário, poupança média real de 3 meses, ritmo; e `conflito` quando a soma dos aportes passa da poupança prevista); ferramenta de leitura `goals` no chat. `hub-ui`: seção "Metas" em `/financas`, criar e editar, com a linha "precisa de R$ X/mês; você guarda R$ Y". |
| UX-04 | Nenhum aviso chega: a proatividade entregue é zero. | `airton.push_subscriptions` com 0 linhas; `airton.notify_log` com 10 envios e `sent = 0`; `apps/hub/public` só tem `icon.svg`; `airton-notify` já expõe `vapid` e `test` (`index.ts:4`, `:29`). | `manifest.webmanifest`, service worker (push e toque abrindo a rota do `link`), e em Perfil a seção "Avisos" (ativar, testar, desativar) gravando em `airton.push_subscriptions` (a policy `owner_all` já permite). |
| UX-05 | O briefing é um texto para ler: markdown, ~200 palavras, e manda não listar a agenda "porque o app já mostra". | `iara-briefing/index.ts:12`, `:56`. | `supabase-dev`: coluna aditiva `core.briefings.fala`; a mesma chamada devolve também a versão falável (até 70 palavras, sem markdown, autocontida: primeiro compromisso, 1 prioridade, 1 número, no máximo 1 pergunta); a RPC que alimenta `/hoje` expõe `fala`. `hub-ui`: botão "Ouvir" no cartão do briefing, com a síntese de voz do próprio navegador (sem serviço pago), marcando `lido_em`. |
| UX-06 | Os alertas são recalculados a cada carga, sem memória: repetem todo dia e os badges nunca apagam. | `lib/alerts.ts:39`, `:54`; inventário (badges sempre acesos). | `supabase-dev`: as regras de `lib/alerts.ts` viram uma função SQL que publica em `core.itens` (origem `claudia`, tipo `alerta`, `chave_origem` = regra + semana), em job diário sem IA; é o publicador da ClaudIA previsto na Etapa 2. `hub-ui`: `/hoje` e a órbita leem `core.itens` com Feito, Amanhã e Ignorar (`hub_item_status`) no lugar de `lib/alerts.ts`. |
| UX-07 | `/hoje` cobra "N lançamentos precisam de você" e o hub não tem onde resolver. | `hoje/page.tsx:43` (`review_counts`); `financas/page.tsx:8`, `:87` (link para o app antigo); `airton.set_category` e `airton.confirm` já existem (`airton_07_actions.sql`). | `supabase-dev`: RPC de leitura `airton.review_list(p_limit)` com a categoria sugerida; registrar as intenções. `hub-ui`: lista de revisão em `/financas`, um toque por lançamento (aceitar a sugestão ou trocar). |

**Execução e aceite**

| ID | Executor | Deps | Critérios de aceite | Esforço | Impacto | Métrica de sucesso | IA/mês |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UX-01 | supabase-dev | — | (1) CI verde, migration só aditiva. (2) `core.intencoes` tem ≥ 7 linhas e todo `rpc` existe em `pg_proc`. (3) `authenticated` só tem `select`. | P | Médio (habilita a onda 2) | % das ações principais do hub com linha no catálogo; alvo 100% ao fim da onda 2 | US$ 0 |
| UX-02 | ambos | UX-01 | (1) `hub_leitura_registrar(120)` cria 1 linha em `sabia.leituras` e o livro em leitura fica com `pagina_atual = 120`. (2) `hub_livros()` devolve `meta_ano`, `lidos_ano` e `paginas_dia`. (3) `/aprender` mostra o bloco, com estados vazio e erro. (4) Intenções `leitura.registrar` e `livro.salvar` no catálogo. | M | Alto (fecha o plano 5 no curto prazo) | Dias por semana com linha em `sabia.leituras`; alvo ≥ 5 | US$ 0 |
| UX-03 | ambos | UX-01 | (1) Criar meta pela tela grava em `airton.goals`. (2) `goals_status()` devolve aporte = (alvo − atual) ÷ meses. (3) Duas metas cuja soma de aportes passa da poupança prevista vêm com `conflito = true`. (4) "Como estão minhas metas?" no chat usa a ferramenta `goals` (linha em `airton.ai_usage`). | M | Alto (imóvel e carro saem do zero) | Metas ativas com prazo e aporte calculado; alvo ≥ 2 | US$ 0 novo (chat já existente) |
| UX-04 | hub-ui | — (o Leo precisa instalar o app no iPhone e permitir avisos) | (1) `/manifest.webmanifest` responde 200. (2) Ativar avisos cria 1 linha em `airton.push_subscriptions`. (3) `airton-notify` com `action: 'test'` gera linha em `notify_log` com `sent ≥ 1`. (4) Tocar no aviso abre a rota do `link`. | M | Alto (pré-requisito de toda proatividade) | `sent` ÷ envios em `notify_log` ≥ 90% em 7 dias | US$ 0 |
| UX-05 | ambos | — | (1) Depois do cron, `core.briefings.fala` do dia não é nulo, não tem `*` nem `#` e tem até 70 palavras. (2) Custo de `briefing-manha` ≤ US$ 0,015 por execução em `core.ai_usage`. (3) "Ouvir" lê o texto, para no segundo toque e preenche `lido_em`. | P | Médio (primeira saída falada) | Dias por semana com `lido_em` preenchido; alvo ≥ 5 | ~US$ 0,04 (≈ 120 tokens de saída `smart` por dia) |
| UX-06 | ambos | — | (1) Rodar o job duas vezes não duplica item. (2) Ignorar um alerta tira o item da contagem do badge até a janela seguinte. (3) `/hoje` deixa de fazer as 9 consultas de `lib/alerts.ts`. | M | Médio | Badge da ClaudIA zerado em ≥ 3 dias por semana | US$ 0 |
| UX-07 | ambos | UX-01 | (1) Categorizar pela tela reduz `review_counts`. (2) O número de `/hoje` bate com o tamanho da lista. (3) Intenção `lancamento.categorizar` no catálogo. | M | Médio | Pendentes em `review_counts` ≤ 5 ao fim de cada semana | US$ 0 (usa a sugestão que o `categorize` já grava) |

### Onda 2 — Fundação

**Problema, evidência e mudança**

| ID | Problema | Evidência | Mudança |
| --- | --- | --- | --- |
| UX-08 | Não existe "plano" nem meta com horizonte; cada agente guarda um pedaço sem ligação. | `airton.goals`; `public.profiles.goal`, `training_profiles.goal` e `event`, `workout_plans.goal` (`20260923152747_core_schema.sql:8`, `:152`; `20260925190119_multisport.sql:4-5`); `sabia.livros`. | Migration `core.planos`, `core.plano_metas`, `core.plano_eventos` (§3.3); leitura só do dono, escrita só por RPC `security definer` (`core.plano_salvar`, `core.meta_salvar`); `public.hub_planos()`; coluna aditiva `core.planos_semana_itens.meta_id`. |
| UX-09 | O progresso é digitado ou não existe; ninguém sabe se está no ritmo. | `airton.goals.current_amount` sem escritor; `core.briefing_airton` só repassa campos (`iara_hq_core.sql:137-139`). | Coluna aditiva `core.agents.progresso_fn`; um adapter SQL por agente (AIrton: saldo da meta; SabIA: livros no ano, páginas, minutos de prática; ClaudIA: tendência de peso e sessões feitas; IARA: marcos feitos); `core.planos_atualizar(p_user)` calcula `progresso` e `ritmo` (esperado linear, tolerância de 10%) e grava evento quando o ritmo muda; job diário 06:00 SP, sem IA. |
| UX-10 | Não há onde ver um plano inteiro nem a ligação longo → médio → curto. | Rotas do hub no inventário; `/hoje` organizada por app, não por objetivo. | Rota `/planos` (link em `/hoje`, ao lado de "Semana →"): um cartão por plano com os 3 horizontes, ritmo por meta, agente dono na cor do app e o próximo passo da semana. Em `/hoje`, uma linha "Planos" só com o que saiu do ritmo. |
| UX-11 | Quebrar um plano em metas é 100% trabalho do Leo. | §1.2: nenhum dos 5 planos tem decomposição. | `supabase-dev`: função `iara-plano`, ação `criar` {frase}: (a) `fast` extrai tipo, alvo e prazo e, se faltar algo essencial, devolve 1 pergunta fechada (até 3 rodadas); (b) SQL junta o resumo de cada agente, sem IA; (c) 1 chamada `smart` (`effort: low`) propõe metas por horizonte com dono, medida, prazo, demanda e o primeiro passo da semana; grava como rascunho. Ação `confirmar` ativa e cria o objeto de domínio (ex.: `airton.goals`). Orçamento de US$ 0,10 por execução. `hub-ui`: campo "Novo plano" em `/planos`, rascunho editável, confirmar. |
| UX-12 | Dois planos disputam o mesmo dinheiro ou tempo e nada percebe. | `airton.goals` sem prioridade; a crítica da semana olha 7 dias e é uma voz só (`iara-semana/index.ts:158`). | Views `core.v_recursos` (capacidade: poupança prevista por mês de `airton.month_plan`; minutos livres por semana a partir de `core.fixos` e `core.rotina`) e `core.v_conflitos` (soma das `demanda` das metas ativas acima da capacidade, respeitando `prioridade`). Sem IA. |
| UX-13 | O painel a favor, contra e neutro da skill não existe em código. | Busca por `painel`, `posicao` e `confianca` em `supabase/functions` sem resultado de orquestração; skill `iara-hq`, item 5. | `supabase-dev`: `core.decisoes` e `core.decisao_posicoes`; `core.abrir_decisoes()` a partir de `v_conflitos` (uma por gatilho); `iara-plano`, ação `painel`: 1 chamada `fast` por agente com interesse (§3.5) e 1 `smart` de síntese, com versão de tela e de fala; `public.hub_decidir(p_id, p_escolha)` aplica e registra. `hub-ui`: cartão "Decisão" em `/planos` e `/hoje` (posições com confiança, recomendação, opções). |
| UX-14 | Quando algo muda, nada reage: metas não chegam à semana, refazer o rascunho apaga os ajustes do Leo e plano confirmado não tem volta. | `iara-semana/index.ts:6`, `:202`; `core.coletar_semana` não traz metas. | `supabase-dev`: (a) gatilhos determinísticos em `planos_atualizar` (meta atrasada em 2 checagens seguidas; renda prevista ±10%; fixo novo que tira mais de 120 min por semana; prazo alterado; 14 dias sem registro); (b) `coletar_semana` passa a trazer as metas ativas e `iara-semana` grava `meta_id` nos itens; (c) rascunho refeito preserva o que o Leo moveu ou tirou (coluna aditiva `editado`); (d) `iara-plano`, ação `revisar`, no 1º domingo do mês: 1 chamada `smart` para todos os planos, saída em propostas de ajuste aceitáveis uma a uma; a cada trimestre inclui o horizonte longo. `hub-ui`: propostas em `/planos` (aceitar ou recusar) e etiqueta do plano nos itens de `/semana`. |
| UX-15 | Não há onde falar com a IARA: o Leo escolhe a aba ou o agente antes de agir. | `/hoje` sem campo de entrada; chat só em `airton-ai` (app antigo) e `claudia-coach-session`; `ROADMAP.md:66-69`. | `supabase-dev`: função `iara-comando` {texto, canal}: `fast` roteia com o catálogo e devolve intenção, slots e confiança; escrita vai para a RPC (sem IA para executar); pergunta vai ao especialista (`airton-ai` com `channel`, `iara-plano`); confiança baixa devolve 1 pergunta fechada; resposta sempre `{fala, tela, pendente}`; `core.conversas` guarda 30 min de contexto. `hub-ui`: barra "Peça à IARA" fixa em `/hoje` (o microfone do teclado do iPhone já dita), resposta em cartão. |
| UX-16 | Confirmação é `confirm()` do navegador ou botão; a maior ação do sistema não tem desfazer. | `semana/Plano.tsx:104`; `hub_semana_confirmar`; `perfil/client.tsx:48`. | `supabase-dev`: `core.acoes_pendentes`; política por `core.intencoes.confirmacao` (§3.6); "desfaz" por 10 min para toda intenção com `desfazer_rpc`, sempre por marcação; `hub_semana_desconfirmar`. `hub-ui`: cartão de confirmação com as mesmas palavras da `fala` e botão Desfazer no retorno. |
| UX-17 | Instrumento e habilidade de carreira não têm onde morar. | `iara_hq_sabia.sql:41` (`hobby` só no check); `aprender/page.tsx:9`; `sabia-trilha/index.ts` não gera `hobby`. | `supabase-dev`: `sabia.habilidades` (nome, tipo, nível, objetivo, currículo) e `sabia.praticas` (habilidade, data, minutos, nota); RPC `hub_pratica_registrar`; adapter de progresso (minutos por semana, sequência); no recap de domingo, 1 chamada `fast` por habilidade ativa gera o plano de prática como trilha `hobby`; `coletar_semana` passa a trazer as habilidades. `hub-ui`: bloco "Prática" em `/aprender`. |

**Execução e aceite**

| ID | Executor | Deps | Critérios de aceite | Esforço | Impacto | Métrica de sucesso | IA/mês |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UX-08 | supabase-dev | Decisão D1 | (1) CI verde, só aditiva. (2) `authenticated` só lê o que é seu. (3) `core.plano_salvar` é idempotente por usuário e título. (4) Toda meta tem `dono` em `core.agents` e `horizonte` válido (checks). | M | Alto (base de tudo) | Planos ativos com ≥ 1 meta em cada horizonte; alvo: os 5 de teste | US$ 0 |
| UX-09 | supabase-dev | UX-08, UX-02, UX-03 | (1) Rodar 2 vezes no dia não duplica evento. (2) Meta ligada à leitura reflete `sabia.leituras` em até 1 dia. (3) Adapter com erro vira `sem_dados` sem derrubar os outros (padrão de `coletar_briefings`). (4) O job aparece em `cron.job`. | M | Alto | % das metas ativas com `ritmo` diferente de `sem_dados`; alvo ≥ 80% | US$ 0 |
| UX-10 | hub-ui | UX-08, UX-09 | (1) `/planos` lista o que `hub_planos()` devolve, com estados vazio e erro. (2) Meta atrasada aparece em `/hoje`; meta no ritmo, não. (3) Cada meta mostra o agente dono. (4) Typecheck e build verdes. | M | Alto | Aberturas de `/planos` por semana; alvo ≥ 2 | US$ 0 |
| UX-11 | ambos | UX-08, UX-09, UX-03, D2 | (1) "Quero comprar um apartamento de 800 mil até 2030" gera rascunho com ≥ 1 meta por horizonte, todas com dono. (2) `core.agent_runs` tipo `plano_criar` com custo ≤ US$ 0,10 e `core.ai_usage` com os papéis `worker` e `orquestrador`. (3) Confirmar cria a `airton.goals` ligada por `ref`. (4) Rascunho não confirmado não publica nada em `core.itens`. | G | Alto | Planos criados só com a frase e até 3 respostas; alvo 4 de 5 | ≤ US$ 0,10 em regime (US$ 0,04 a 0,08 por plano criado) |
| UX-12 | supabase-dev | UX-08, UX-09 | (1) Duas metas cuja soma de `reais_mes` passa da poupança prevista aparecem em `v_conflitos`. (2) Conflito resolvido some da view. (3) As views não leem dado fora do usuário (`security_invoker`). | M | Médio | Conflitos detectados antes de o Leo notar; alvo: o caso carro × imóvel aparece sozinho | US$ 0 |
| UX-13 | ambos | UX-08, UX-12, D2 | (1) Decisão aberta tem de 2 a 4 posições, cada uma com confiança de 0 a 10. (2) `agent_runs` tipo `painel` com custo ≤ US$ 0,03. (3) Decidir altera as metas afetadas e fecha a decisão; repetir não reaplica. (4) O mesmo gatilho não abre duas decisões. | G | Alto | Decisões fechadas em até 7 dias; alvo ≥ 80% | ≤ US$ 0,15 (≈ US$ 0,014 por decisão, até 10 por mês) |
| UX-14 | ambos | UX-08, UX-09, UX-12, UX-13 | (1) Com meta ativa, o rascunho da semana traz item com `meta_id`. (2) Refazer o rascunho mantém um item que o Leo moveu. (3) A revisão mensal gera até 5 propostas, com `agent_runs` tipo `plano_revisar` ≤ US$ 0,08. (4) Gatilho repetido não duplica evento. | G | Alto | % dos gatilhos que viram proposta em até 7 dias; alvo ≥ 90% | ~US$ 0,07 |
| UX-15 | ambos | UX-01 (UX-02 e UX-03 para ter o que executar), D5 | (1) "Li até a página 150" cria linha em `sabia.leituras` sem abrir `/aprender`. (2) "Quanto posso gastar hoje?" responde com o número de `month_plan`; `ai_usage` com `comando-rota` (`fast`) e `chat` (`smart`). (3) Frase fora do catálogo devolve pergunta, não erro. (4) Bateria de 20 frases no repo com ≥ 18 roteadas certo. (5) Custo médio de comando de escrita ≤ US$ 0,001. | G | Alto (primeira porta única) | Comandos pela barra por dia; alvo ≥ 5. Ações feitas pela barra ÷ pelas telas | ~US$ 2,00 (900 rotas `fast` ≈ US$ 0,20; 150 perguntas `smart` a US$ 0,012 ≈ US$ 1,80) |
| UX-16 | ambos | UX-01, UX-15, D3 | (1) Intenção de risco alto nunca executa sem linha `confirmada` em `acoes_pendentes`. (2) "Desfaz" depois de registrar leitura anula o registro e o progresso volta. (3) Pendente expira em 10 min; "sim" depois disso não executa nada. (4) Toda intenção ativa tem `confirmacao` definida. | M | Alto (segurança da voz) | Ações desfeitas ÷ executadas; alvo < 5% | US$ 0 |
| UX-17 | ambos | UX-08, UX-09 (UX-15 para registrar por frase), D1 | (1) "Pratiquei violão 20 minutos" cria linha em `sabia.praticas`. (2) Depois do recap, existe trilha `hobby` da semana em `sabia.trilhas`. (3) Os minutos da semana aparecem na meta do plano. (4) Custo de `trilha-hobby` ≤ US$ 0,002 por semana. | M | Médio (fecha instrumento e parte de carreira) | Semanas com ≥ 3 práticas registradas | ~US$ 0,01 |

### Onda 3 — Voz

**Problema, evidência e mudança**

| ID | Problema | Evidência | Mudança |
| --- | --- | --- | --- |
| UX-18 | As respostas são escritas para tela; o modo `voice` do AIrton só troca a chave. | `airton-ai/index.ts:182-185` ("use listas"), `:214`, `:302`; crítica da semana em 4 a 7 itens. | Sufixo de sistema compartilhado para o canal voz (§3.6), aplicado em `iara-comando`, `airton-ai` e `iara-plano`; bateria de 20 frases reais do Leo no repo, com checagem automática de tamanho, ausência de markdown e número correto; tempo de resposta gravado em `core.agent_runs`. |
| UX-19 | Voz hoje é zero, mas já existe um canal sem tela no padrão certo, usado só para peso. | `claudia-ingest/index.ts:1-6`; `public.ingest_tokens`; seção "Atalho do iPhone" em `/perfil`. | `supabase-dev`: `iara-comando` aceita o token de ingestão (coluna aditiva de escopo) e responde `{fala}` em texto puro; limite de chamadas por minuto. `hub-ui`: em Perfil, "Falar com a IARA pela Siri", com o passo a passo do Atalho (ditar → enviar → falar a resposta). |
| UX-20 | Os agentes esperam o Leo abrir o app; os avisos são 4 tipos fixos, sem limite diário nem pergunta respondível. | `airton-notify/index.ts:287`; "um único canal de push com limite diário" na Fase 3 do ROADMAP, não feito. | `supabase-dev`: `core.perfil.config.interrupcoes` (máximo por dia, horário de silêncio); fila `core.avisos` (origem, prioridade, pergunta, intenção da resposta); o tick que já roda escolhe os N mais prioritários do dia (gatilho de plano > conta vencendo > hábito). `hub-ui`: limites em Perfil; ações no aviso e abertura da barra com a pergunta pronta. |
| UX-21 | A Fase 7 prevê uma ferramenta por agente: a troca aparece na fala e não há confirmação nem desfazer. | `ROADMAP.md:66-69`. | `supabase-dev`: função `iara-voz` emite sessão efêmera do provedor (chave só no Supabase) com uma única ferramenta `iara(texto)`, que chama `iara-comando`; teto `IARA_AI_BUDGET_USD_VOZ`; minutos em `core.ai_usage`. `hub-ui`: microfone na barra, legenda ao vivo, estados ouvindo, pensando e falando, falar por cima interrompe. Começa pelo protótipo de 1 dia nos dois provedores, com as 20 frases da UX-18. |
| UX-22 | Revisar a semana exige ler rascunho, crítica e até 49 itens. | `iara-semana/index.ts:158`; `semana/Plano.tsx:104`. | `supabase-dev`: `iara-semana` devolve também `fala` (até 60 palavras) e até 3 decisões fechadas; intenções `semana.ouvir`, `semana.responder` e `semana.confirmar`; a revisão mensal (UX-14) usa o mesmo formato. `hub-ui`: modo "Revisar falando" em `/semana` e `/planos`, uma decisão por vez. |

**Execução e aceite**

| ID | Executor | Deps | Critérios de aceite | Esforço | Impacto | Métrica de sucesso | IA/mês |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UX-18 | supabase-dev | UX-15 | (1) 20 de 20 respostas sem `*`, `#` nem lista, com até 40 palavras. (2) Número falado bate com o dado (arredondamento de até 5%). (3) Mediana ≤ 4 s para escrita e ≤ 8 s para pergunta com dados. (4) Custo por resposta ≤ o do modo texto. | M | Alto | % das respostas dentro do contrato; alvo 100% | US$ 0 em regime; ~US$ 0,25 por rodada da bateria |
| UX-19 | ambos | UX-15, UX-16, UX-18, D4 (o Leo monta o Atalho no iPhone) | (1) POST com token e "registra 82,4 quilos" cria linha em `weight_entries` e devolve `fala`. (2) Token revogado devolve 401. (3) Ação de risco alto devolve a pergunta e só executa com "sim" na chamada seguinte. (4) Sem token ou sessão, nada executa. | M | Alto (primeira voz de verdade) | Comandos por voz por dia; alvo ≥ 3 | US$ 0 novo (usa a UX-15) |
| UX-20 | ambos | UX-04, UX-14, UX-15, UX-16, D3 | (1) Nunca mais que o máximo diário de linhas enviadas em `core.avisos`. (2) Nada enviado no horário de silêncio. (3) Responder ao aviso executa a intenção. (4) Aviso de meta atrasada sai em até 24 h do gatilho. | M | Alto | % dos avisos respondidos; alvo ≥ 50% | US$ 0 |
| UX-21 | ambos | UX-15, UX-16, UX-18, D4 | (1) Das 20 frases, ≥ 18 concluídas sem tocar na tela. (2) Falar por cima interrompe a resposta em até 500 ms. (3) Minutos e custo do dia em `core.ai_usage` (feature `voz`); acima do teto a sessão é recusada. (4) Nenhuma chave no cliente (check de vazamento do CI verde). | G | Alto | Minutos de voz por dia e % de tarefas concluídas só por voz; alvo ≥ 80% | ~US$ 3,00 **[H]** (5 min por dia a US$ 0,02/min, estimativa do ROADMAP, não medida) |
| UX-22 | ambos | UX-14, UX-16, UX-18 (UX-19 ou UX-21 para a voz) | (1) Depois do cron de domingo, o plano tem `fala` e até 3 decisões. (2) Responder as decisões e dizer "confirma" deixa o plano `confirmado` sem editar item nenhum. (3) Revisão completa em até 3 min (tempo entre a 1ª pergunta e a confirmação em `core.conversas`). (4) Custo adicional de `plano-semana` ≤ US$ 0,005 por semana. | M | Médio | Semanas confirmadas no domingo; alvo 4 de 4 | ~US$ 0,02 |

### Custo de IA do plano inteiro

| Onda | Itens com IA | US$/mês em regime | Observação |
| --- | --- | --- | --- |
| 1 | UX-05 | ~0,04 | O resto é SQL e tela |
| 2 | UX-11, 13, 14, 15, 17 | ~2,33 | Cerca de 85% é a porta única (UX-15); cai se as perguntas ao especialista forem menos de 5 por dia |
| 3 | UX-21, 22 | ~3,02 | Quase tudo é voz em tempo real, a única estimativa não medida |
| **Total** | | **~5,40** | Somado ao gasto atual (US$ 0,44 nos 10 primeiros dias de novembro), fica dentro do teto padrão de US$ 10 por app |

Planeje grande, execute pequeno, na prática: `smart` aparece em 5 pontos, todos de planejamento ou síntese (criar plano,
síntese do painel, revisão mensal, resposta de especialista, plano da semana); roteamento, posições do painel, extração e
plano de prática ficam em `fast`; progresso, conflito, gatilhos, avisos e toda escrita são SQL.

---

## Decisões do Leo

| # | Decisão que só o Leo pode tomar | Recomendação | Bloqueia |
| --- | --- | --- | --- |
| D1 | **Quem é dono do que não tem agente** (carreira, hobbies). Opções: a IARA guarda o plano e a SabIA cuida das habilidades; ou um agente novo. | IARA guarda, SabIA executa habilidades e prática, AIrton cuida do fôlego financeiro. Sem agente novo. | UX-08, UX-17 |
| D2 | **Alvos reais e ordem de prioridade** dos planos que disputam o mesmo dinheiro e o mesmo tempo (imóvel, carro, instrumento, carreira): valor, prazo e quem cede primeiro. | Informar valor e prazo dos 5 planos de teste e uma ordem de 1 a 5; o painel só entra onde a ordem não resolve. | UX-11, UX-13 |
| D3 | **Autonomia e interrupções**: o que a IARA executa sem perguntar, o que exige "sim", quantos avisos por dia e em que horário não falar. | Registros sem perguntar, com desfazer; dinheiro, treino e plano sempre com "sim"; 3 avisos por dia; silêncio das 22h às 7h. | UX-16, UX-20 |
| D4 | **Canal e provedor de voz**: começar pelo Atalho/Siri (custo zero) antes da voz em tempo real? Qual provedor, com criação de chave e teto mensal? | Atalho primeiro; protótipo de 1 dia nos dois provedores só depois de a UX-19 estar em uso; teto de US$ 5/mês para voz. | UX-19, UX-21 |
| D5 | **Persona única**: a IARA passa a ser a única voz e os especialistas viram origem do dado, ou cada agente mantém voz própria e chat próprio? | IARA única em todo canal de conversa; as abas por app continuam como telas de consulta. | UX-15 |
