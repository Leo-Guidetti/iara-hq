-- UX-09: progresso das metas do plano medido pelos próprios agentes (sem o Leo digitar). Aditivo e idempotente.
-- Contrato do adapter (um por agente, registrado em core.agents.progresso_fn):
--   fn(p_user uuid, p_meta core.plano_metas) returns jsonb
--   {progresso numeric 0..1 | null (= sem dado), valor_atual, alvo, unidade, dados jsonb,
--    esperado? (0..1, substitui o linear), inicio? / prazo? (datas padrão quando a meta não tem)}
-- Refs: airton.goals:<id> | sabia.livros:ano | sabia.livros:<id> | claudia.peso | claudia.sessoes:semana
--       iara: medida.tipo 'marco' (1 se meta concluida) ou contagem manual medida.atual / medida.alvo.
alter table core.agents add column if not exists progresso_fn text;

create or replace function core.progresso_airton(p_user uuid, p_meta core.plano_metas) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g airton.goals;
begin
  if p_meta.ref is null or p_meta.ref not like 'airton.goals:%' then
    return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'ref desconhecida'));
  end if;
  select * into g from airton.goals x where x.id = substr(p_meta.ref, length('airton.goals:') + 1) and x.user_id = p_user;
  if not found then return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'goal não encontrada')); end if;
  return jsonb_build_object(
    'progresso', case when g.target_amount > 0 then g.current_amount / g.target_amount else null end,
    'valor_atual', g.current_amount, 'alvo', g.target_amount, 'unidade', g.target_currency,
    'inicio', g.created_at::date, 'prazo', g.target_date, 'dados', jsonb_build_object('goal', g.name));
end $$;

create or replace function core.progresso_sabia(p_user uuid, p_meta core.plano_metas) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_m jsonb; v_alvo numeric; v_lidos numeric; l sabia.livros;
begin
  if p_meta.ref = 'sabia.livros:ano' then
    v_m := sabia.livros_meta(p_user, v_hoje);
    v_alvo := coalesce(nullif(p_meta.medida ->> 'alvo', '')::numeric, (v_m ->> 'meta_ano')::numeric);
    v_lidos := (v_m ->> 'lidos_ano')::numeric;
    return jsonb_build_object(
      'progresso', case when v_alvo > 0 then v_lidos / v_alvo end, 'valor_atual', v_lidos, 'alvo', v_alvo, 'unidade', 'livros',
      'inicio', make_date(extract(year from v_hoje)::int, 1, 1), 'prazo', make_date(extract(year from v_hoje)::int, 12, 31),
      'dados', v_m);
  elsif p_meta.ref ~ '^sabia\.livros:[0-9]+$' then
    select * into l from sabia.livros x where x.id = substr(p_meta.ref, length('sabia.livros:') + 1)::bigint and x.user_id = p_user;
    if not found then return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'livro não encontrado')); end if;
    return jsonb_build_object(
      'progresso', case when l.status = 'lido' then 1 when l.paginas > 0 then coalesce(l.pagina_atual, 0)::numeric / l.paginas end,
      'valor_atual', l.pagina_atual, 'alvo', l.paginas, 'unidade', 'páginas', 'inicio', l.comecou_em,
      'dados', jsonb_build_object('livro', l.titulo, 'status', l.status));
  end if;
  -- minutos de prática (UX-17) e demais refs: ainda sem fonte
  return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'ref sem fonte ainda'));
end $$;

create or replace function core.progresso_claudia(p_user uuid, p_meta core.plano_metas) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_alvo numeric := nullif(p_meta.medida ->> 'alvo', '')::numeric;
  v_ini date := coalesce(nullif(p_meta.medida ->> 'inicio', '')::date, p_meta.created_at::date);
  v_atual numeric; v_inicial numeric; v_feitas int;
begin
  if v_alvo is null then return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'medida.alvo ausente')); end if;
  if p_meta.ref = 'claudia.peso' then
    select t.trend_7d into v_atual from public.weight_with_trend t where t.user_id = p_user order by t.local_date desc limit 1;
    if v_atual is null then return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'sem pesagens')); end if;
    v_inicial := coalesce(nullif(p_meta.medida ->> 'valor_inicial', '')::numeric,
      (select d.weight_kg from public.weight_daily d where d.user_id = p_user and d.local_date >= v_ini order by d.local_date limit 1),
      (select d.weight_kg from public.weight_daily d where d.user_id = p_user order by d.local_date limit 1));
    return jsonb_build_object(
      'progresso', case when v_inicial = v_alvo then (case when v_atual = v_alvo then 1 else 0 end)
                        else (v_inicial - v_atual) / (v_inicial - v_alvo) end,
      'valor_atual', v_atual, 'alvo', v_alvo, 'unidade', 'kg', 'inicio', v_ini,
      'dados', jsonb_build_object('peso_inicial', v_inicial, 'tendencia_7d', v_atual));
  elsif p_meta.ref = 'claudia.sessoes:semana' then
    select count(*) into v_feitas from public.plan_sessions s
     where s.user_id = p_user and s.status = 'done' and s.local_date > v_hoje - 7 and s.local_date <= v_hoje;
    return jsonb_build_object('progresso', case when v_alvo > 0 then v_feitas / v_alvo end, 'valor_atual', v_feitas, 'alvo', v_alvo,
      'unidade', 'sessões/semana', 'esperado', 1, 'dados', jsonb_build_object('janela_dias', 7));
  end if;
  return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'ref desconhecida'));
end $$;

create or replace function core.progresso_iara(p_user uuid, p_meta core.plano_metas) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_alvo numeric := nullif(p_meta.medida ->> 'alvo', '')::numeric; v_atual numeric := nullif(p_meta.medida ->> 'atual', '')::numeric;
begin
  if p_meta.medida ->> 'tipo' = 'marco' then
    return jsonb_build_object('progresso', case when p_meta.status = 'concluida' then 1 else 0 end,
      'esperado', case when p_meta.prazo is not null and p_meta.prazo <= (now() at time zone 'America/Sao_Paulo')::date then 1 else 0 end,
      'dados', jsonb_build_object('tipo', 'marco'));
  elsif v_atual is not null and v_alvo > 0 then
    return jsonb_build_object('progresso', v_atual / v_alvo, 'valor_atual', v_atual, 'alvo', v_alvo,
      'unidade', p_meta.medida ->> 'unidade', 'dados', jsonb_build_object('tipo', 'contagem'));
  end if;
  return jsonb_build_object('progresso', null, 'dados', jsonb_build_object('motivo', 'sem medida'));
end $$;

revoke all on function core.progresso_airton(uuid, core.plano_metas), core.progresso_sabia(uuid, core.plano_metas),
  core.progresso_claudia(uuid, core.plano_metas), core.progresso_iara(uuid, core.plano_metas) from public, anon, authenticated;

update core.agents set progresso_fn = 'core.progresso_' || slug where slug in ('airton', 'sabia', 'claudia', 'iara');

-- Recalcula progresso e ritmo das metas ativas. Erro num adapter/meta vira sem_dados, sem derrubar as outras.
-- Evento 'progresso' só quando o ritmo muda. Retorna {metas, mudaram, erros}.
create or replace function core.planos_atualizar(p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  m core.plano_metas; x record; v_uid uuid; v_fn text; r jsonb; v_prog numeric; v_esp numeric; v_ini date; v_prazo date;
  v_ritmo text; v_erro text; n int := 0; mud int := 0; err int := 0;
begin
  for x in
    select pm as meta, pl.user_id as uid, a.progresso_fn as fn from core.plano_metas pm
      join core.planos pl on pl.id = pm.plano_id and pl.status = 'ativo'
      left join core.agents a on a.slug = pm.dono
     where pm.status in ('ativa', 'concluida') and (p_user is null or pl.user_id = p_user)
     order by pm.id
  loop
    m := x.meta; v_uid := x.uid; v_fn := x.fn;
    n := n + 1; v_erro := null; v_prog := null; v_esp := null; v_ritmo := 'sem_dados'; r := null;
    begin
      if v_fn is null then raise exception 'agente sem progresso_fn'; end if;
      execute format('select %s($1, $2)', v_fn) into r using v_uid, m;
      v_prog := (r ->> 'progresso')::numeric;
      if v_prog is not null then v_prog := least(greatest(v_prog, 0), 1); end if;
      if v_prog is not null then
        v_esp := (r ->> 'esperado')::numeric;
        if v_esp is null then
          v_ini := coalesce(nullif(m.medida ->> 'inicio', '')::date, (r ->> 'inicio')::date, m.created_at::date);
          v_prazo := coalesce(m.prazo, (r ->> 'prazo')::date);
          if v_prazo is not null then
            v_esp := case when v_prazo <= v_ini then (case when v_hoje >= v_prazo then 1 else 0 end)
                          else least(greatest((v_hoje - v_ini)::numeric / (v_prazo - v_ini), 0), 1) end;
          end if;
        end if;
        if v_esp is not null then
          v_ritmo := case when v_prog < v_esp - 0.10 then 'atrasada' when v_prog > v_esp + 0.10 then 'adiantada' else 'no_ritmo' end;
        end if;
      end if;
    exception when others then
      v_erro := sqlerrm; v_prog := null; v_ritmo := 'sem_dados'; err := err + 1;
    end;

    if m.ritmo is distinct from v_ritmo then
      insert into core.plano_eventos (plano_id, meta_id, tipo, origem, dados)
      values (m.plano_id, m.id, 'progresso', 'sistema', jsonb_build_object(
        'ritmo_anterior', m.ritmo, 'ritmo', v_ritmo, 'progresso', round(v_prog, 4), 'esperado', round(v_esp, 4),
        'valor_atual', r -> 'valor_atual', 'alvo', r -> 'alvo', 'erro', v_erro));
      mud := mud + 1;
    end if;
    update core.plano_metas pm set progresso = coalesce(round(v_prog, 4), pm.progresso), ritmo = v_ritmo, updated_at = now()
     where pm.id = m.id and (pm.progresso is distinct from coalesce(round(v_prog, 4), pm.progresso) or pm.ritmo is distinct from v_ritmo);
  end loop;
  return jsonb_build_object('metas', n, 'mudaram', mud, 'erros', err);
end $$;
revoke all on function core.planos_atualizar(uuid) from public, anon, authenticated;
grant execute on function core.planos_atualizar(uuid) to service_role;

-- Job diário 09:00 UTC (06:00 SP), sem IA.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'iara-planos-progresso') then perform cron.unschedule('iara-planos-progresso'); end if;
  perform cron.schedule('iara-planos-progresso', '0 9 * * *', $c$ select core.planos_atualizar() $c$);
end $$;
