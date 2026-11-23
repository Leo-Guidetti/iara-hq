-- Casa, segunda volta (pedido do Leo, 23/11 à tarde). Aditiva.
-- 1) Recorrência = dias da semana + "a cada N semanas" (casa_recorrencias.intervalo passa a valer também no semanal, em semanas).
-- 2) Mercado mais inteligente: corredor (categoria) por item, faixa de preço (mín–máx) e sugestões do que o Leo costuma
--    comprar. O texto livre ("2 kg de arroz, leite, 1 dúzia de ovos") é lido pelo iara-mercado, que usa core.mercado_incluir.

-- ── 1) Recorrência semanal com intervalo em semanas ────────────────────────────────────────────────
create or replace function core.casa_rec_cai(p_freq text, p_dias int[], p_dia_mes int, p_intervalo int, p_inicio date, p_d date)
returns boolean language sql immutable set search_path = '' as $$
  select p_d >= p_inicio and case p_freq
    when 'diaria' then true
    -- semanal: dia da semana marcado e, com intervalo N, só nas semanas 0, N, 2N... contadas da semana do início
    when 'semanal' then extract(isodow from p_d)::int = any (p_dias)
                        and (p_intervalo is null
                             or ((date_trunc('week', p_d)::date - date_trunc('week', p_inicio)::date) / 7) % p_intervalo = 0)
    when 'mensal' then extract(day from p_d)::int
                       = least(p_dia_mes, extract(day from (date_trunc('month', p_d) + interval '1 month - 1 day'))::int)
    when 'intervalo' then (p_d - p_inicio) % p_intervalo = 0
    else false end
$$;

create or replace function core.casa_dias_txt(p_dias int[]) returns text
language sql immutable set search_path = '' as $$
  select case when cardinality(p_dias) = 7 then 'todos os dias'
              when p_dias = array[1,2,3,4,5] then 'dias úteis'
              else (select string_agg((array['seg','ter','qua','qui','sex','sáb','dom'])[d], ', ' order by d) from unnest(p_dias) d) end
$$;

-- Nova tarefa: repetir = {freq:'semanal', dias:[1..7], semanas:N} (o hub manda sempre semanal; diária/mensal seguem aceitas).
create or replace function public.hub_tarefa_salvar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_u uuid := auth.uid(); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tit text := nullif(btrim(p ->> 'titulo'), ''); v_data date := coalesce(nullif(p ->> 'data', '')::date, v_hoje);
  v_hora time := nullif(p ->> 'hora', '')::time; v_rep jsonb := p -> 'repetir'; v_freq text; v_dias int[]; v_id bigint;
  v_quando text; v_sem int; v_txt text;
begin
  if not exists (select 1 from core.members m where m.user_id = v_u) then raise exception 'sem acesso'; end if;
  if v_tit is null or length(v_tit) > 200 then raise exception 'Escreva a tarefa em até 200 caracteres.'; end if;
  if v_data < v_hoje then raise exception 'A data não pode ser no passado.'; end if;
  v_quando := case when v_hora is null then '' else ' às ' || to_char(v_hora, 'HH24:MI') end;

  if jsonb_typeof(v_rep) = 'object' and coalesce(v_rep ->> 'freq', '') <> '' then
    v_freq := v_rep ->> 'freq';
    if v_freq not in ('diaria', 'semanal', 'mensal', 'intervalo') then raise exception 'Escolha como a tarefa se repete.'; end if;
    select coalesce(array_agg(distinct x::int order by x::int), '{}') into v_dias
      from jsonb_array_elements_text(case when jsonb_typeof(v_rep -> 'dias') = 'array' then v_rep -> 'dias' else '[]'::jsonb end) x
     where x ~ '^[1-7]$';
    if v_freq = 'semanal' and cardinality(v_dias) = 0 then v_dias := array[extract(isodow from v_data)::int]; end if;
    v_sem := least(12, greatest(1, coalesce(nullif(v_rep ->> 'semanas', '')::int, 1)));
    insert into core.casa_recorrencias (user_id, titulo, freq, dias, dia_mes, intervalo, inicio, hora)
    values (v_u, v_tit, v_freq, case when v_freq = 'semanal' then v_dias else '{}' end,
            case when v_freq = 'mensal' then coalesce(nullif(v_rep ->> 'dia_mes', '')::int, extract(day from v_data)::int) end,
            case when v_freq = 'intervalo' then greatest(2, least(365, coalesce(nullif(v_rep ->> 'intervalo', '')::int, 2)))
                 when v_freq = 'semanal' and v_sem >= 2 then v_sem end,
            v_data, v_hora)
    returning id into v_id;
    perform core.casa_gerar(v_u);
    perform core.casa_lembretes_agendar(v_u);
    v_txt := case v_freq
      when 'diaria' then 'todo dia'
      when 'semanal' then core.casa_dias_txt(v_dias) || case when v_sem >= 2 then ', a cada ' || v_sem || ' semanas' else ', toda semana' end
      when 'mensal' then 'todo mês'
      else 'a cada ' || coalesce(nullif(v_rep ->> 'intervalo', ''), '2') || ' dias' end;
    return jsonb_build_object('recorrencia_id', v_id, 'fala', 'Anotei: ' || v_tit || ', ' || v_txt || v_quando || '.');
  end if;

  insert into core.itens (user_id, origem, tipo, titulo, data, hora, chave_origem)
  values (v_u, 'iara', 'tarefa', v_tit, v_data, v_hora, 'manual:' || pg_catalog.gen_random_uuid()::text)
  returning id into v_id;
  perform core.casa_lembretes_agendar(v_u);
  return jsonb_build_object('id', v_id, 'fala', 'Anotei: ' || v_tit
    || case when v_data = v_hoje then ', para hoje' else ', para ' || to_char(v_data, 'DD/MM') end || v_quando
    || case when v_hora is not null then '. Eu te lembro na hora.' else '.' end);
end $$;

-- ── 2) Mercado: corredor, faixa de preço e sugestões ───────────────────────────────────────────────
alter table core.mercado add column if not exists categoria text;
alter table core.mercado add column if not exists preco_min numeric(10,2);
alter table core.mercado add column if not exists preco_max numeric(10,2);
alter table core.mercado_precos add column if not exists categoria text;
alter table core.mercado_precos add column if not exists preco_min numeric(10,2);
alter table core.mercado_precos add column if not exists preco_max numeric(10,2);

-- Corredores, na ordem de uma volta no supermercado.
create or replace function core.mercado_categorias() returns text[]
language sql immutable set search_path = '' as $$
  select array['Hortifruti','Padaria','Açougue e peixaria','Frios e laticínios','Mercearia','Bebidas','Congelados','Limpeza','Higiene','Pet','Outros']
$$;

-- Inclui (ou soma) um item para um usuário. Preço: memória (o do Leo vale mais) > o que veio (IA) > nada.
-- Usado pelo iara-mercado (service role) e pelo hub_mercado_adicionar (usuário).
create or replace function core.mercado_incluir(p_user uuid, p_nome text, p_quantidade numeric, p_unidade text,
  p_categoria text default null, p_preco numeric default null, p_min numeric default null, p_max numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_nome text := nullif(btrim(p_nome), ''); v_q numeric := coalesce(p_quantidade, 1);
  v_un text := coalesce(nullif(btrim(p_unidade), ''), 'un'); v_cat text := p_categoria; v_id bigint; v_total numeric;
  m core.mercado_precos; v_preco numeric; v_min numeric; v_max numeric; v_fonte text;
begin
  if not exists (select 1 from core.members x where x.user_id = p_user) then raise exception 'sem acesso'; end if;
  if v_nome is null or length(v_nome) > 120 then raise exception 'Escreva o item em até 120 caracteres.'; end if;
  if v_q <= 0 or v_q > 9999 then raise exception 'Quantidade inválida.'; end if;
  if v_un not in ('un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz') then v_un := 'un'; end if;
  if v_cat is not null and not (v_cat = any (core.mercado_categorias())) then v_cat := 'Outros'; end if;
  v_nome := upper(left(v_nome, 1)) || substr(v_nome, 2);

  update core.mercado set quantidade = least(9999, quantidade + v_q), categoria = coalesce(categoria, v_cat)
   where user_id = p_user and arquivado_em is null and not comprado and core.mercado_chave(nome, unidade) = core.mercado_chave(v_nome, v_un)
  returning id, quantidade into v_id, v_total;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'nome', v_nome, 'somado', true, 'estimar', false, 'fala', v_nome || ' já estava na lista; agora são '
      || replace(regexp_replace(to_char(v_total, 'FM9999990.99'), '\.?0*$', ''), '.', ',') || case when v_un = 'un' then '' else ' ' || v_un end || '.');
  end if;

  select * into m from core.mercado_precos pr where pr.user_id = p_user and pr.chave = core.mercado_chave(v_nome, v_un);
  if m.chave is not null then
    v_preco := m.preco; v_min := coalesce(m.preco_min, m.preco); v_max := coalesce(m.preco_max, m.preco);
    v_fonte := case when m.fonte = 'leo' then 'leo' else 'historico' end; v_cat := coalesce(v_cat, m.categoria);
  elsif p_preco is not null and p_preco >= 0 and p_preco <= 5000 then
    v_preco := round(p_preco, 2); v_min := round(coalesce(p_min, p_preco), 2); v_max := round(coalesce(p_max, p_preco), 2); v_fonte := 'ia';
    insert into core.mercado_precos (user_id, chave, preco, fonte, categoria, preco_min, preco_max)
    values (p_user, core.mercado_chave(v_nome, v_un), v_preco, 'ia', v_cat, v_min, v_max)
    on conflict (user_id, chave) do nothing;
  end if;

  insert into core.mercado (user_id, nome, quantidade, unidade, categoria, preco_unit, preco_min, preco_max, preco_fonte)
  values (p_user, v_nome, v_q, v_un, v_cat, v_preco, v_min, v_max, v_fonte)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'nome', v_nome, 'somado', false, 'estimar', v_preco is null or v_cat is null,
                            'fala', 'Pus ' || v_nome || ' na lista do mercado.');
end $$;
revoke all on function core.mercado_incluir(uuid, text, numeric, text, text, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function core.mercado_incluir(uuid, text, numeric, text, text, numeric, numeric, numeric) to service_role;

-- Mesma assinatura de antes (voz e hub), agora pela função comum.
create or replace function public.hub_mercado_adicionar(p_nome text, p_quantidade numeric default null, p_unidade text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select core.mercado_incluir(auth.uid(), p_nome, p_quantidade, p_unidade)
$$;

-- Lista com corredor e faixa; totais (falta, mín, máx, carrinho) e sugestões do que o Leo costuma comprar
-- (comprado 2+ vezes nos últimos 120 dias e fora da lista agora).
create or replace function public.hub_mercado() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select m.user_id from core.members m where m.user_id = auth.uid()),
  l as (select x.* from core.mercado x, me where x.user_id = me.user_id and x.arquivado_em is null),
  hist as (
    select core.mercado_chave(x.nome, x.unidade) chave, min(x.nome) nome, min(x.unidade) unidade,
           round(avg(x.quantidade), 2) quantidade, count(*) vezes, max(x.comprado_em) ultima
      from core.mercado x, me
     where x.user_id = me.user_id and x.comprado and x.arquivado_em is not null and x.comprado_em > now() - interval '120 days'
     group by 1 having count(*) >= 2)
  select case when not exists (select 1 from me) then null else jsonb_build_object(
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'quantidade', quantidade, 'unidade', unidade,
                          'categoria', coalesce(categoria, 'Outros'), 'preco_unit', preco_unit, 'preco_fonte', preco_fonte,
                          'comprado', comprado, 'total', round(quantidade * preco_unit, 2),
                          'min', round(quantidade * coalesce(preco_min, preco_unit), 2), 'max', round(quantidade * coalesce(preco_max, preco_unit), 2))
                        order by comprado, array_position(core.mercado_categorias(), coalesce(categoria, 'Outros')), criado_em, id) from l), '[]'::jsonb),
    'falta', coalesce((select round(sum(quantidade * preco_unit), 2) from l where not comprado), 0),
    'falta_min', coalesce((select round(sum(quantidade * coalesce(preco_min, preco_unit)), 2) from l where not comprado), 0),
    'falta_max', coalesce((select round(sum(quantidade * coalesce(preco_max, preco_unit)), 2) from l where not comprado), 0),
    'carrinho', coalesce((select round(sum(quantidade * preco_unit), 2) from l where comprado), 0),
    'sem_preco', (select count(*) from l where preco_unit is null or categoria is null),
    'sugestoes', coalesce((select jsonb_agg(jsonb_build_object('nome', h.nome, 'unidade', h.unidade, 'quantidade', h.quantidade, 'vezes', h.vezes)
                                            order by h.vezes desc, h.ultima desc)
                             from (select * from hist h where not exists (select 1 from l where core.mercado_chave(l.nome, l.unidade) = h.chave)
                                   order by h.vezes desc, h.ultima desc limit 8) h), '[]'::jsonb)) end
$$;

-- Edição: preço digitado pelo Leo fecha a faixa (mín = máx = preço) e vira memória.
create or replace function public.hub_mercado_atualizar(p_id bigint, p jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_u uuid := auth.uid(); r core.mercado;
begin
  select * into r from core.mercado where id = p_id and user_id = v_u and arquivado_em is null;
  if r.id is null or not exists (select 1 from core.members m where m.user_id = v_u) then return false; end if;
  if p ? 'quantidade' then r.quantidade := greatest(0.01, least(9999, (p ->> 'quantidade')::numeric)); end if;
  if p ? 'unidade' and (p ->> 'unidade') in ('un', 'kg', 'g', 'L', 'ml', 'pct', 'cx', 'dz') then r.unidade := p ->> 'unidade'; end if;
  if p ? 'categoria' and (p ->> 'categoria') = any (core.mercado_categorias()) then r.categoria := p ->> 'categoria'; end if;
  if p ? 'comprado' then
    r.comprado := (p ->> 'comprado')::boolean;
    r.comprado_em := case when r.comprado then now() end;
  end if;
  if p ? 'preco_unit' then
    if nullif(p ->> 'preco_unit', '') is null then
      r.preco_unit := null; r.preco_min := null; r.preco_max := null; r.preco_fonte := null;
    else
      r.preco_unit := greatest(0, round((p ->> 'preco_unit')::numeric, 2)); r.preco_min := r.preco_unit; r.preco_max := r.preco_unit;
      r.preco_fonte := 'leo';
      insert into core.mercado_precos (user_id, chave, preco, fonte, categoria, preco_min, preco_max)
      values (v_u, core.mercado_chave(r.nome, r.unidade), r.preco_unit, 'leo', r.categoria, r.preco_unit, r.preco_unit)
      on conflict (user_id, chave) do update set preco = excluded.preco, fonte = 'leo', preco_min = excluded.preco_min,
        preco_max = excluded.preco_max, categoria = coalesce(excluded.categoria, core.mercado_precos.categoria), atualizado_em = now();
    end if;
  end if;
  update core.mercado set quantidade = r.quantidade, unidade = r.unidade, categoria = r.categoria, comprado = r.comprado,
         comprado_em = r.comprado_em, preco_unit = r.preco_unit, preco_min = r.preco_min, preco_max = r.preco_max, preco_fonte = r.preco_fonte
   where id = r.id;
  return true;
end $$;
