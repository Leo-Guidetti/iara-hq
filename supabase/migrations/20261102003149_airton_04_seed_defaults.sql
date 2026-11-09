
create or replace function airton.seed_defaults() returns int
language plpgsql security invoker set search_path = '' as $$
declare v_user uuid := airton._uid(null); n int;
begin
  if exists (select 1 from airton.categories where user_id = v_user) then return 0; end if;
  insert into airton.categories (id, user_id, name, parent_id, icon, color, nature, sort) values
    ('cat_renda', v_user, 'Renda', null, 'wallet', '#22c55e', 'renda', 1),
    ('cat_moradia', v_user, 'Moradia', null, 'home', '#3b82f6', 'fixo', 2),
    ('cat_alimentacao', v_user, 'Alimentação', null, 'utensils', '#f59e0b', 'variavel', 3),
    ('cat_transporte', v_user, 'Transporte', null, 'car', '#8b5cf6', 'variavel', 4),
    ('cat_saude', v_user, 'Saúde', null, 'heart-pulse', '#ef4444', 'variavel', 5),
    ('cat_assinaturas', v_user, 'Assinaturas', null, 'repeat', '#a855f7', 'fixo', 6),
    ('cat_lazer', v_user, 'Lazer', null, 'gamepad-2', '#ec4899', 'eventual', 7),
    ('cat_compras', v_user, 'Compras', null, 'shopping-bag', '#f97316', 'eventual', 8),
    ('cat_viagem', v_user, 'Viagem', null, 'plane', '#0ea5e9', 'eventual', 9),
    ('cat_educacao', v_user, 'Educação', null, 'graduation-cap', '#06b6d4', 'fixo', 10),
    ('cat_tarifas', v_user, 'Tarifas e impostos', null, 'receipt', '#737373', 'variavel', 11),
    ('cat_outros', v_user, 'Outros', null, 'circle', '#737373', 'variavel', 12),
    ('cat_investimentos', v_user, 'Investimentos', null, 'trending-up', '#10b981', 'investimento', 13),
    ('cat_transferencias', v_user, 'Transferências', null, 'arrow-left-right', '#737373', 'transferencia', 14);
  get diagnostics n = row_count;
  insert into airton.settings (user_id, key, value) values
    (v_user, 'savings_target', '{"pct": 0.2}'),
    (v_user, 'notify', '{"dailyEnabled": true, "dailyTime": "22:00", "weeklyEnabled": true, "weeklyDow": 0, "weeklyTime": "19:00"}')
  on conflict do nothing;
  return n;
end $$;
grant execute on function airton.seed_defaults() to authenticated;
;
