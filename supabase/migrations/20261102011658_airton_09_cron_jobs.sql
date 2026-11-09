
-- notificações: confere a cada 15 min se é hora da diária/semanal
select cron.schedule('airton-notify-tick', '*/15 * * * *', $$select airton_private.call_function('airton-notify')$$);
-- Open Finance: 07:30 e 21:15 (São Paulo = UTC-3), antes da diária das 22h
select cron.schedule('airton-pluggy-morning', '30 10 * * *', $$select airton_private.call_function('airton-pluggy', '{"action":"sync"}'::jsonb)$$);
select cron.schedule('airton-pluggy-evening', '15 0 * * *', $$select airton_private.call_function('airton-pluggy', '{"action":"sync"}'::jsonb)$$);
;
