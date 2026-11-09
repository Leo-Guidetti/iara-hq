create table if not exists airton.inv_news (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  ticker text not null,
  published date,
  kind text not null default 'noticia',
  title text not null,
  summary text,
  url text,
  source text,
  impact text not null default 'baixa',
  sentiment text not null default 'neutro',
  created_at timestamptz not null default now(),
  unique (user_id, ticker, title)
);
alter table airton.inv_news enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='airton' and tablename='inv_news' and policyname='owner_all') then
    create policy owner_all on airton.inv_news for all to authenticated using (user_id = auth.uid() and airton.is_member()) with check (user_id = auth.uid() and airton.is_member());
  end if;
end $$;
grant all on airton.inv_news to authenticated, service_role;
grant usage, select on sequence airton.inv_news_id_seq to authenticated, service_role;
create index if not exists inv_news_user_pub on airton.inv_news (user_id, published desc);

-- Backfill dos meses sem extrato (estimado): interpola entre vizinhos; ações pelo preço de fim de mês
do $$
declare
  u uuid; m text; pm text; nm text; mi int; pi int; ni int; w numeric; mend date; fx numeric; tot numeric;
begin
  for u in select distinct user_id from airton.inv_snapshot loop
    for m in select to_char(d, 'YYYY-MM') from generate_series(
        (select to_date(min(mes),'YYYY-MM') from airton.inv_snapshot where user_id=u),
        (select to_date(max(mes),'YYYY-MM') from airton.inv_snapshot where user_id=u), interval '1 month') d loop
      continue when exists (select 1 from airton.inv_snapshot where user_id=u and mes=m);
      select max(mes) into pm from airton.inv_snapshot where user_id=u and mes<m;
      select min(mes) into nm from airton.inv_snapshot where user_id=u and mes>m;
      continue when pm is null or nm is null;
      mi := split_part(m,'-',1)::int*12 + split_part(m,'-',2)::int;
      pi := split_part(pm,'-',1)::int*12 + split_part(pm,'-',2)::int;
      ni := split_part(nm,'-',1)::int*12 + split_part(nm,'-',2)::int;
      w := (mi-pi)::numeric/(ni-pi);
      mend := (to_date(m,'YYYY-MM') + interval '1 month' - interval '1 day')::date;
      select close into fx from airton.inv_prices where ticker='USDBRL' and date<=mend order by date desc limit 1;

      insert into airton.inv_position (user_id, mes, produto, estrategia, tipo, indexador, saldo, aloc, rent_mes, moeda, valor_orig, manual)
      select u, m, x.produto, x.estrategia, x.tipo, x.indexador, round(x.saldo,2), null, null, x.moeda,
             case when x.usd is not null then round(x.usd,2) else null end, false
      from (
        select k.produto,
               coalesce(n.estrategia,p.estrategia) estrategia, coalesce(n.tipo,p.tipo) tipo, coalesce(n.indexador,p.indexador) indexador, coalesce(n.moeda,p.moeda) moeda,
               case when h.quantity is not null and px.close is not null then
                      h.quantity*px.close*case when h.currency='USD' then coalesce(fx,5.4) else 1 end
                    else coalesce(p.saldo,0) + w*(coalesce(n.saldo,0)-coalesce(p.saldo,0)) end saldo,
               case when h.currency='USD' and h.quantity is not null and px.close is not null then h.quantity*px.close end usd
        from (select produto from airton.inv_position where user_id=u and mes in (pm,nm) group by produto) k
        left join airton.inv_position p on p.user_id=u and p.mes=pm and p.produto=k.produto
        left join airton.inv_position n on n.user_id=u and n.mes=nm and n.produto=k.produto
        left join airton.inv_holdings h on h.user_id=u and h.ticker=k.produto and h.active
        left join lateral (select close from airton.inv_prices where ticker=k.produto and date<=mend and date>mend-10 order by date desc limit 1) px on true
      ) x
      where x.saldo > 0.5
      on conflict (user_id, mes, produto) do nothing;

      select sum(saldo) into tot from airton.inv_position where user_id=u and mes=m;
      update airton.inv_position set aloc = round(saldo/nullif(tot,0)*100,2) where user_id=u and mes=m;
      insert into airton.inv_snapshot (user_id, mes, ref, patrimonio, source, updated_at)
      values (u, m, to_char(mend,'DD/MM/YYYY'), round(tot,2), 'estimado', now())
      on conflict (user_id, mes) do nothing;
    end loop;
  end loop;
end $$;

select mes, s.source, s.patrimonio, count(p.*) from airton.inv_snapshot s join airton.inv_position p using (user_id, mes) where mes>='2026-05' group by 1,2,3 order by 1;;
