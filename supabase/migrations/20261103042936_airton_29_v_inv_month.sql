create or replace view airton.v_inv_month with (security_invoker = on) as
with r as (
  select user_id, mes,
         sum(saldo * rent_mes) filter (where rent_mes is not null) / nullif(sum(saldo) filter (where rent_mes is not null), 0) as rent_w,
         sum(saldo) filter (where rent_mes is not null) / nullif(sum(saldo), 0) as cov
  from airton.inv_position group by 1, 2
), f as (
  select user_id, to_char(date, 'YYYY-MM') mes,
         sum(case when upper(type) = 'BUY' then abs(amount) when upper(type) = 'SELL' then -abs(amount) else 0 end) as net_flow,
         sum(case when upper(type) = 'BUY' then abs(amount) else 0 end) as aportes,
         sum(case when upper(type) = 'SELL' then abs(amount) else 0 end) as resgates,
         count(*) n_mov
  from airton.inv_movements group by 1, 2
), b as (
  select s.user_id, s.mes, s.patrimonio, s.source, s.ref,
         lag(s.patrimonio) over (partition by s.user_id order by s.mes) as prev,
         r.rent_w, r.cov, f.net_flow, f.aportes, f.resgates, f.n_mov
  from airton.inv_snapshot s
  left join r on r.user_id = s.user_id and r.mes = s.mes
  left join f on f.user_id = s.user_id and f.mes = s.mes
)
select *, case
    when cov >= 0.6 then rent_w
    when net_flow is not null and prev > 0 and source <> 'estimado' then (patrimonio - prev - net_flow) / prev * 100
  end as ret_pct
from b;
grant select on airton.v_inv_month to authenticated, service_role;;
