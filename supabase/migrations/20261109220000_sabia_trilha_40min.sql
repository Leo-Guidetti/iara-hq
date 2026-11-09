-- Pedido do Leo (09/11): até 40 min de conteúdo por dia na trilha da SabIA (antes 25).
update core.perfil
   set config = jsonb_set(coalesce(config, '{}'::jsonb), '{minutos_trilha}', '40'::jsonb)
 where coalesce((config ->> 'minutos_trilha')::int, 0) < 40;
