-- UX-25: pelo Atalho "IARA", a pergunta ao AIrton (que demora e precisa de ferramentas) é respondida por push. Aditivo e idempotente.
-- A resposta entra na fila core.avisos com origem 'resposta' e prioridade 95. O envio é o do UX-20 (core.avisos_reservar): conta
-- no máximo diário e respeita o silêncio. Para chegar em até 1 min, quem grava já dispara um tick do airton-notify (pg_net, assíncrono)
-- quando há vaga e não é silêncio; o tick é idempotente (diária/semanal travadas em notify_log, avisos limitados por max_dia).

-- 1) Nova origem na fila (amplia o check; nenhuma linha existente muda)
alter table core.avisos drop constraint if exists avisos_origem_check;
alter table core.avisos add constraint avisos_origem_check
  check (origem in ('plano', 'decisao', 'proposta', 'conta', 'habito', 'resposta'));

-- 2) Estado do envio agora: {silencio, vagas, agora}. Mesmas regras do avisos_reservar.
create or replace function core.push_estado(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_cfg jsonb := core.interrupcoes_de(p_user); v_silencio boolean; v_vagas int;
begin
  v_silencio := core.aviso_em_silencio((now() at time zone 'America/Sao_Paulo')::time, v_cfg ->> 'silencio_inicio', v_cfg ->> 'silencio_fim');
  v_vagas := core.aviso_vagas((v_cfg ->> 'max_dia')::int, core.avisos_enviados_hoje(p_user, now()));
  return jsonb_build_object('silencio', v_silencio, 'vagas', v_vagas, 'agora', not v_silencio and v_vagas > 0);
end $$;
revoke all on function core.push_estado(uuid) from public, anon, authenticated;
grant execute on function core.push_estado(uuid) to service_role;

-- 3) Grava a resposta como aviso e, se puder enviar agora, chama o tick. Retorna {aviso_id, agora, silencio, vagas}.
--    Sem vaga hoje, não enfileira (senão sairia amanhã cedo gastando o teto de amanhã): aviso_id null.
--    Mesma resposta no mesmo minuto (Atalho repetido) não duplica.
create or replace function core.resposta_por_push(p_user uuid, p_texto text, p_titulo text default 'IARA') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_est jsonb; v_id bigint; v_txt text := btrim(coalesce(p_texto, ''));
begin
  if not exists (select 1 from core.members m where m.user_id = p_user) then raise exception 'sem acesso'; end if;
  if v_txt = '' then raise exception 'texto vazio'; end if;
  v_est := core.push_estado(p_user);
  if (v_est ->> 'vagas')::int <= 0 then return v_est || jsonb_build_object('aviso_id', null); end if;
  insert into core.avisos (user_id, origem, chave, prioridade, titulo, corpo, pergunta, opcoes, link)
  values (p_user, 'resposta', 'resposta:' || md5(v_txt || date_trunc('minute', now())::text), 95,
          left(coalesce(nullif(btrim(p_titulo), ''), 'IARA'), 140), left(v_txt, 600), '', '["entendi"]'::jsonb, null)
  on conflict (user_id, chave) do nothing
  returning id into v_id;
  if v_id is not null and (v_est ->> 'agora')::boolean then
    perform airton_private.call_function('airton-notify');
  end if;
  return v_est || jsonb_build_object('aviso_id', v_id);
end $$;
revoke all on function core.resposta_por_push(uuid, text, text) from public, anon, authenticated;
grant execute on function core.resposta_por_push(uuid, text, text) to service_role;

-- Wrapper para o airton-ai (service role, schema public; core não é exposto na API).
create or replace function public.iara_resposta_push(p_user uuid, p_texto text, p_titulo text default 'IARA') returns jsonb
language sql security definer set search_path = '' as $$ select core.resposta_por_push(p_user, p_texto, p_titulo) $$;
revoke all on function public.iara_resposta_push(uuid, text, text) from public, anon, authenticated;
grant execute on function public.iara_resposta_push(uuid, text, text) to service_role;

-- 4) Pergunta ao AIrton pela Siri (sem JWT): dispara o airton-ai como cron (pg_net, assíncrono), que responde por push.
--    Retorna o estado para a fala ser honesta: 'agora' | 'silencio' (chega quando acabar o silêncio) | 'sem_vaga' (não chama a IA)
--    | 'nao_membro' (não usa o AIrton).
create or replace function core.pergunta_airton_por_push(p_user uuid, p_pergunta text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_est jsonb;
begin
  if not exists (select 1 from core.members m where m.user_id = p_user) then raise exception 'sem acesso'; end if;
  if not exists (select 1 from airton.members m where m.user_id = p_user) then return 'nao_membro'; end if;
  v_est := core.push_estado(p_user);
  if (v_est ->> 'vagas')::int <= 0 then return 'sem_vaga'; end if;
  perform airton_private.call_function('airton-ai', jsonb_build_object('action', 'chat_push', 'user_id', p_user,
    'message', left(btrim(coalesce(p_pergunta, '')), 600)));
  return case when (v_est ->> 'silencio')::boolean then 'silencio' else 'agora' end;
end $$;
revoke all on function core.pergunta_airton_por_push(uuid, text) from public, anon, authenticated;
grant execute on function core.pergunta_airton_por_push(uuid, text) to service_role;
