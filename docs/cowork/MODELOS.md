# Qual modelo e qual esforço usar

| Tipo de tarefa | Modelo | Esforço | Por quê |
| --- | --- | --- | --- |
| Sessão autônoma (o prompt único / "continue") | Opus 5.5 | Alto | Planeja, decide, corrige o próprio erro e roda por horas sem você |
| Etapa 0 (sincronizar produção, CI, deploy) | Opus 5.5 | Alto | Erro aqui afeta produção; vale o modelo mais cuidadoso |
| Implementar uma fase já planejada (telas, funções no padrão) | Sonnet 5.5 | Médio | Rápido e bom em código que segue um padrão claro |
| Bug difícil, migração de dados, arquitetura nova (voz, orquestração) | Opus 5.5 | Alto | Raciocínio longo e menos tentativa e erro |
| Atualizar docs, PROGRESSO, textos | Sonnet 5.5 | Baixo | Tarefa simples |
| Tarefas agendadas só leitura (custo, crons, produção vs. repo) | Haiku 5.5 | Baixo | Consulta e resumo; o mais barato |

Se o uso do seu plano estiver apertando, troque Opus por Sonnet 5.5 com esforço alto: perde um
pouco de autonomia em problemas difíceis, mas segue bem.
Isso vale para o Cowork (o agente que trabalha por você). A IA dentro dos apps tem os próprios
modelos, definidos no CLAUDE.md, e não muda com isto.
