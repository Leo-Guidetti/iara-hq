# Tarefas agendadas no Cowork (opcionais, só leitura)

Crie no projeto IARA HQ com `/schedule`, pasta `iara-hq`, modelo Haiku 5.5, esforço baixo.
Só rodam com o computador ligado e o app de desktop aberto.

| Tarefa | Quando | Prompt |
| --- | --- | --- |
| Saúde dos crons | Todo dia, 09:00 | "Só leitura: liste erros das últimas 24 h em cron.job_run_details e nos logs das Edge Functions do IARA HQ. Sem erro, responda só 'tudo ok'." |
| Produção vs. repositório | Segunda, 09:00 | "Só leitura: alguma Edge Function no ar difere do repo? algum commit direto na main? alguma migration não aditiva? alguma chave em arquivo? Responda com uma tabela." |
| Avanço automático (opcional) | Todo dia, 22:00 | Modelo Opus 5.5 ou Sonnet 5.5, esforço alto: "Continue o IARA HQ a partir do docs/PROGRESSO.md. Se o próximo passo depender do Leo, só resuma o que falta dele." |

O custo semanal de IA vai por push, pelo cron do próprio IARA HQ (etapa 0, item 5).
