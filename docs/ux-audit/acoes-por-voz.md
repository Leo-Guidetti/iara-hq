# Ações de tela × intenções de voz (UX-24, 23/11/2026)

Levantamento de todos os botões e formulários que gravam algo em `/planos` (com o Novo plano), `/semana` e nas metas de
`/financas`. Cada ação tem uma intenção ativa em `core.intencoes`, então pode ser feita pela barra "Peça à IARA" ou pelo
microfone (UX-23). Pela Siri (UX-19) valem todas menos as que chamam Edge Function (`fn:`: `semana.gerar`,
`agenda.sincronizar`, `decisao.painel`), que respondem "Isso eu respondo pelo app por enquanto". Plano e meta são risco
alto e só executam depois do "sim" (D3). Dias do expediente: 1 = segunda a 7 = domingo, como a tela e o `core.fixos`.

O teste `comando-lib.test.ts` ("UX-24 levantamento") lê a coluna **Intenção** desta tabela e falha se alguma intenção
não estiver no catálogo. Ao criar um botão novo nessas telas, acrescente uma linha aqui e a intenção correspondente.

| Tela | Ação (botão ou formulário) | Chamada da tela | Intenção | Risco | Frase de exemplo |
| --- | --- | --- | --- | --- | --- |
| /planos | Novo plano (frase) | `iara-plano` criar | `plano.criar` | baixo | "quero trocar de carro em 2027" |
| /planos | Responder pergunta do Novo plano | `iara-plano` criar com respostas | `plano.criar` | baixo | "uns 80 mil" |
| /planos | Rascunho: Sim, confirmar | `iara-plano` confirmar | `plano.confirmar` | alto | "pode ativar esse plano" |
| /planos | Rascunho: Descartar | `iara-plano` descartar | `plano.descartar` | alto | "descarta esse rascunho" |
| /planos | Rascunho: Editar meta (título, prazo) | `hub_meta_salvar` | `meta.editar` | alto | "muda o prazo dessa meta para 2028" |
| /planos | Rascunho: tirar meta | `hub_meta_salvar` (status cancelada) | `meta.editar` | alto | "no rascunho, tira a meta de curto prazo" |
| /planos | Renomear plano | (só voz) | `plano.editar` | alto | "renomeia o plano do carro para Troca do carro 2027" |
| /planos | Pausar, retomar, concluir, arquivar plano | (só voz) | `plano.editar` | alto | "pausa o plano do violão" |
| /planos | Trocar alvo, data ou porquê do plano | (só voz) | `plano.editar` | alto | "muda o alvo do apartamento para 900 mil" |
| /planos | Trocar horizonte, dono, prazo, valor, cadência da meta | (só voz) | `meta.editar` | alto | "passa essa meta para médio prazo" |
| /planos | Pausar, retomar, concluir, arquivar meta | (só voz) | `meta.editar` | alto | "arquiva essa meta" |
| /planos | Adicionar meta a um plano | (só voz) | `meta.adicionar` | alto | "adiciona uma meta de juntar 10 mil até março" |
| /planos | Decisão: Ouvir os agentes | `iara-plano` painel | `decisao.painel` | baixo | "pede a opinião dos agentes sobre essa decisão" |
| /planos | Decisão: escolher opção + Sim | `hub_decidir` | `decisao.decidir` | alto | "fico com a primeira opção" |
| /planos | Proposta: Aceitar + Sim | `hub_proposta_decidir` | `proposta.decidir` | alto | "aceita a proposta" |
| /planos | Proposta: Recusar | `hub_proposta_decidir` | `proposta.decidir` | alto | "recusa essa proposta" |
| /semana | Gerar / refazer o plano | `iara-semana` | `semana.gerar` | baixo | "refaz o plano da semana" |
| /semana | Mover item (dia e hora) | `hub_semana_item_editar` | `semana.item_editar` | médio | "passa o segundo item para sexta às 18h" |
| /semana | Tirar / voltar item | `hub_semana_item` | `semana.item` | baixo | "tira o terceiro item da semana" |
| /semana | Confirmar a semana + Sim | `hub_acao_pedir`/`hub_acao_confirmar` | `semana.confirmar` | alto | "confirma a semana" |
| /semana | Voltar (cancelar a confirmação) | `hub_acao_cancelar` | "não" (código, UX-16) | — | "não" |
| /semana | Desfazer a confirmação | `hub_acao_desfazer` | `acao.desfazer` | baixo | "desfaz" |
| /semana | Revisar falando: responder decisão | `hub_semana_responder` | `semana.responder` | médio | "pode ser no sábado" |
| /semana | Revisar falando: ouvir | `hub_semana_ouvir` | `semana.ouvir` | baixo | "revisa a semana comigo" |
| /semana | Novo compromisso / editar | `hub_compromisso_salvar` | `agenda.compromisso_salvar` | médio | "marca dentista quinta às 15h" |
| /semana | Cancelar compromisso | `hub_compromisso_cancelar` | `agenda.compromisso_cancelar` | médio | "cancela o dentista" |
| /semana | Expediente (horário, dias, local) | `hub_expediente_salvar` | `expediente.definir` | médio | "meu expediente é das 9 às 18" |
| /semana | Lugares: salvar lugar | `hub_lugares_salvar` | `lugar.salvar` | médio | "a academia fica a 15 minutos de casa" |
| /semana | Lugares: tirar lugar (✕) | `hub_lugares_salvar` | `lugar.remover` | médio | "tira a academia dos meus lugares" |
| /semana | Atualizar agenda agora | `iara-agenda` sync | `agenda.sincronizar` | baixo | "sincroniza minha agenda" |
| /financas | + Meta / Editar meta | `airton.goal_salvar` | `meta.salvar` | alto | "muda o prazo da meta do carro para 2028" |
| /financas | Cancelar meta + confirmar | `airton.goal_salvar` (status cancelada) | `meta.salvar` | alto | "cancela a meta de viagem" |

Fora do escopo, porque não grava dado: copiar o link do feed de agenda em `/semana`, Ouvir/Parar e os botões de
navegação. `meta.salvar_plano` (jsonb inteiro) saiu do roteador: `meta.editar` e `meta.adicionar` cobrem as mesmas ações
com parâmetros nomeados, e a tela do Novo plano continua chamando `hub_meta_salvar`. `plano.salvar` (upsert por título)
também saiu: disputava "pausa o plano X" com `plano.editar` e ativava rascunho sem criar a meta do AIrton. Renomear um
lugar não tem intenção própria (tirar e salvar de novo).
