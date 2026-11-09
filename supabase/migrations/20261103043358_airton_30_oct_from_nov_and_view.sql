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
select *, case when cov >= 0.6 then rent_w end as ret_pct from b;
grant select on airton.v_inv_month to authenticated, service_role;

-- Outubro: reconstruído a partir da posição de 03/11 (sem movimentações em 01–03/11); ações pelo preço de 30/10
do $$
declare u uuid; fx numeric; tot numeric;
begin
  select close into fx from airton.inv_prices where ticker='USDBRL' and date<='2026-10-31' order by date desc limit 1;
  for u in select distinct user_id from airton.inv_snapshot where mes='2026-10' and source='estimado' loop
    -- produtos que existem em novembro
    insert into airton.inv_position (user_id, mes, produto, estrategia, tipo, indexador, saldo, aloc, rent_mes, moeda, valor_orig, manual)
    select u, '2026-10', n.produto, n.estrategia, n.tipo, n.indexador, 0, null, null, n.moeda, null, false
    from airton.inv_position n where n.user_id=u and n.mes='2026-11'
    on conflict (user_id, mes, produto) do nothing;
    update airton.inv_position o set saldo = round(coalesce(
        (select h.quantity * px.close * case when h.currency='USD' then coalesce(fx,5.4) else 1 end
           from airton.inv_holdings h
           join lateral (select close from airton.inv_prices where ticker=h.ticker and date<='2026-10-31' order by date desc limit 1) px on true
          where h.user_id=u and h.ticker=o.produto and h.active and h.quantity is not null),
        n.saldo), 2),
      valor_orig = case when n.moeda='USD' then n.valor_orig else o.valor_orig end,
      estrategia = n.estrategia, tipo = n.tipo, indexador = n.indexador
    from airton.inv_position n
    where o.user_id=u and o.mes='2026-10' and n.user_id=u and n.mes='2026-11' and n.produto=o.produto;
    -- produtos que não existem mais em novembro: zera (saíram antes de 31/10)
    update airton.inv_position o set saldo = 0
    where o.user_id=u and o.mes='2026-10' and not exists (select 1 from airton.inv_position n where n.user_id=u and n.mes='2026-11' and n.produto=o.produto);
    select sum(saldo) into tot from airton.inv_position where user_id=u and mes='2026-10';
    update airton.inv_position set aloc = round(saldo/nullif(tot,0)*100,2) where user_id=u and mes='2026-10';
    update airton.inv_snapshot set patrimonio = round(tot,2), updated_at = now() where user_id=u and mes='2026-10';
  end loop;
end $$;;
