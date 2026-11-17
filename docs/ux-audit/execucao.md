# Execução do plano de UX (diário)

Execução autônoma de `docs/ux-audit/plano.md`, onda por onda, um PR por item (branch `ux-NN-slug`).
Status: **feito** (mergeado com CI verde), **pulado** (bloqueado por regra; motivo ao lado), **parado** (reprovado 2x pelo verificador).
Verificação de produção: "pendente: chave" = IA falha pelo limite da `ANTHROPIC_API_KEY` até 01/12;
"pendente: produção" = só dá para conferir depois do deploy ou do cron; "pendente: Leo" = depende de ação dele.

Teste local de migration: Postgres 16 com `supabase/schema/producao.sql` + todas as migrations do repo, aplicando a nova 2 vezes.

| Item | Onda | Status | PR | Motivo / verificação |
| --- | --- | --- | --- | --- |
| UX-01 | 1 | feito | #37 | `core.intencoes` com 7 intenções semente; `authenticated` só lê. Produção (17/11 03:03 UTC): deploy ok, 7 linhas, 0 `rpc` ausente em `pg_proc`, `authenticated` sem insert, `anon` sem select. |
| UX-04 | 1 | feito | #35 (código) + ux-04-avisos-verificacao | Sem código novo. (1) `/manifest.webmanifest` 200 `application/manifest+json` e `/sw.js` 200 em produção. (4) `sw.js` abre/foca a `url` do aviso no toque. (2) e (3) pendente: Leo — `airton.push_subscriptions` tem 0 linhas e `notify_log` 20 envios com `sent = 0`: falta instalar o hub no iPhone (Compartilhar → Adicionar à Tela de Início), abrir pelo ícone e tocar em Perfil → "Ativar notificações" e "Enviar teste". |
| UX-02 | 1 | feito | ux-02-livros-leitura | RPCs `hub_livros`, `hub_leitura_registrar`, `hub_livro_salvar` (meta em `core.perfil.config.livros_ano`), `sabia.briefing_hoje` com meta e páginas/dia, intenções `leitura.registrar` e `livro.salvar`; bloco "Livros" em `/aprender`. Teste local: registrar 120 cria 1 leitura e `pagina_atual = 120`; livro de outro usuário recusado. Tela: typecheck e build ok; uso real pendente: Leo cadastrar o livro atual e a meta. |
| UX-03 | 1 | feito | ux-03-metas-airton | `airton.goals` com `priority` (nasce vazia, D2), `kind`, `status`; `airton.goal_salvar` e `airton.goals_status` (aporte = falta ÷ meses, poupança média de 3 meses, `conflito`); ferramenta `goals` no chat `airton-ai` (versão do ar conferida = repo antes de editar); seção "Metas" em `/financas` com confirmação antes de gravar. Teste local: aporte 100.000 ÷ 24 = 4.166,67; conflito true com 2 metas acima da poupança; meta de outro usuário recusada. (4) chat: pendente: chave. |
| UX-05 | 1 | feito | ux-05-briefing-falado | `core.briefings.fala` gerada na MESMA chamada do briefing da manhã (marcador `###FALA###`, pós-processamento sem markdown e até 70 palavras); `hub_casa` devolve `fala`; `hub_briefing_lido(p_id)`; botão "Ouvir"/"Parar" em `/hoje` com a voz do navegador. Versão no ar de `iara-briefing` = repo antes de editar. Teste local: `deno test` do pós-processamento ok; `lido_em` só do dono, idempotente. (1) e (2) em produção: pendente: chave. |
