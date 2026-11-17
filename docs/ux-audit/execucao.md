# Execução do plano de UX (diário)

Execução autônoma de `docs/ux-audit/plano.md`, onda por onda, um PR por item (branch `ux-NN-slug`).
Status: **feito** (mergeado com CI verde), **pulado** (bloqueado por regra; motivo ao lado), **parado** (reprovado 2x pelo verificador).
Verificação de produção: "pendente: chave" = IA falha pelo limite da `ANTHROPIC_API_KEY` até 01/12;
"pendente: produção" = só dá para conferir depois do deploy ou do cron; "pendente: Leo" = depende de ação dele.

Teste local de migration: Postgres 16 com `supabase/schema/producao.sql` + todas as migrations do repo, aplicando a nova 2 vezes.

| Item | Onda | Status | PR | Motivo / verificação |
| --- | --- | --- | --- | --- |
| UX-01 | 1 | feito | ux-01-intencoes | `core.intencoes` com 7 intenções semente (rpc e desfazer conferidos em `pg_proc`); `authenticated` só lê. Teste local: idempotente, 7 linhas, slots = `proargnames`. |
