-- UX-12: detectar quando planos disputam o mesmo dinheiro ou tempo (sem IA). Aditivo e idempotente.
-- core.recursos(p_user): capacidade do usuário. security definer porque lê airton (goals_status/month_plan) e
--   core.fixos/rotina/perfil, que o papel authenticated não lê direto. Só devolve dado do próprio auth.uid().
--   poupanca_mes         = airton.goals_status(p_user)->>'poupanca_base' (poupança prevista do mês em month_plan;
--                          sem previsão, média real dos 3 meses fechados). Mesma base do conflito de metas do AIrton.
--   minutos_livres_semana = 7*24*60 - sono (perfil.config.sono_horas, padrão 8 h/dia)
--                          - expediente (config.expediente: nº de dias x (fim - inicio))
--                          - blocos ativos de core.rotina (nº de dias x minutos, nulo = 0). Mínimo 0.
--                          Compromissos avulsos e agenda não entram (não são recorrentes). Determinístico.
create or replace function core.recursos(p_user uuid) returns table (user_id uuid, poupanca_mes numeric, minutos_livres_semana numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cfg jsonb; v_sono numeric; v_exp numeric := 0; v_rot numeric; v_poup numeric; v_ini time; v_fim time;
begin
  if p_user is null or p_user is distinct from auth.uid() then return; end if;
  if not exists (select 1 from core.members m where m.user_id = p_user) then return; end if;
  select coalesce(p.config, '{}'::jsonb) into v_cfg from core.perfil p where p.user_id = p_user;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_sono := case when jsonb_typeof(v_cfg -> 'sono_horas') = 'number' then (v_cfg ->> 'sono_horas')::numeric else 8 end;
  if jsonb_typeof(v_cfg -> 'expediente' -> 'dias') = 'array' then
    begin
      v_ini := (v_cfg -> 'expediente' ->> 'inicio')::time; v_fim := (v_cfg -> 'expediente' ->> 'fim')::time;
      v_exp := jsonb_array_length(v_cfg -> 'expediente' -> 'dias') * greatest(extract(epoch from (v_fim - v_ini)) / 60, 0);
    exception when others then v_exp := 0; end;
  end if;
  select coalesce(sum(cardinality(r.dias) * coalesce(r.minutos, 0)), 0) into v_rot
    from core.rotina r where r.user_id = p_user and r.ativo;
  begin v_poup := (airton.goals_status(p_user) ->> 'poupanca_base')::numeric;
  exception when others then v_poup := null; end;
  return query select p_user, v_poup, greatest(7 * 24 * 60 - v_sono * 60 * 7 - coalesce(v_exp, 0) - v_rot, 0);
end $$;
revoke all on function core.recursos(uuid) from public, anon;
grant execute on function core.recursos(uuid) to authenticated;

create or replace view core.v_recursos with (security_invoker = true) as
  select r.user_id, r.poupanca_mes, r.minutos_livres_semana from core.recursos(auth.uid()) r;

-- Conflitos: soma da demanda das metas ativas de planos ativos x capacidade (por usuário e recurso).
-- Regra 3 (D2): se TODOS os planos em disputa têm prioridade, aloca na ordem e reporta só as metas que não couberam
-- (precisa_painel = false). Com prioridade nula em algum, reporta o conflito inteiro (precisa_painel = true).
-- Exige >= 2 metas disputando. gatilho = chave estável (ids das metas envolvidas ordenados) para abrir 1 decisão (UX-13).
create or replace view core.v_conflitos with (security_invoker = true) as
with dem as (
  select p.user_id, rec.recurso, m.id as meta_id, p.id as plano_id, p.titulo as plano, m.titulo, p.prioridade,
         (m.demanda ->> rec.chave)::numeric as demanda,
         case rec.recurso when 'dinheiro' then r.poupanca_mes else r.minutos_livres_semana end as capacidade
    from core.plano_metas m
    join core.planos p on p.id = m.plano_id and p.status = 'ativo'
    join core.v_recursos r on r.user_id = p.user_id
   cross join (values ('dinheiro', 'reais_mes'), ('tempo', 'minutos_semana')) rec (recurso, chave)
   where m.status = 'ativa' and jsonb_typeof(m.demanda -> rec.chave) = 'number' and (m.demanda ->> rec.chave)::numeric > 0
), acc as (
  select d.*,
         sum(d.demanda) over w as acum,
         sum(d.demanda) over (partition by d.user_id, d.recurso) as total,
         count(*) over (partition by d.user_id, d.recurso) as n,
         bool_and(d.prioridade is not null) over (partition by d.user_id, d.recurso) as todas_com_prioridade
    from dem d
  window w as (partition by d.user_id, d.recurso order by d.prioridade, d.meta_id)
), env as (
  select * from acc
   where capacidade is not null and total > capacidade and n >= 2
     and (not todas_com_prioridade or acum > capacidade)
)
select e.user_id, e.recurso, max(e.total) as demanda_total, max(e.capacidade) as capacidade,
       max(e.total) - max(e.capacidade) as excesso,
       jsonb_agg(jsonb_build_object('meta_id', e.meta_id, 'plano_id', e.plano_id, 'plano', e.plano, 'titulo', e.titulo,
                                    'demanda', e.demanda) order by e.meta_id) as metas,
       'conflito:' || e.recurso || ':' || string_agg(e.meta_id::text, ',' order by e.meta_id) as gatilho,
       not bool_and(e.todas_com_prioridade) as precisa_painel
  from env e
 group by e.user_id, e.recurso;

revoke all on core.v_recursos, core.v_conflitos from public, anon, authenticated;
grant select on core.v_recursos, core.v_conflitos to authenticated;

-- Leitura para o hub e a IARA: conflitos do usuário (só membro). [] quando não há; null se não for membro.
create or replace function public.hub_conflitos() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_u uuid := auth.uid();
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then return null; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.recurso) from core.v_conflitos c where c.user_id = v_u), '[]'::jsonb);
end $$;
revoke all on function public.hub_conflitos() from public, anon;
grant execute on function public.hub_conflitos() to authenticated;
