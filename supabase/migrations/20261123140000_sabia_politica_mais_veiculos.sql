-- Pedido do Leo (23/11): nas notícias de política, priorizar outros veículos além de Poder360, Gazeta do Povo e Nexo
-- (os únicos com feed até aqui, por isso dominavam a trilha). Mais feeds de política e os três viram secundários:
-- o worker da sabia-trilha lê no máximo 2 itens de cada secundária (5 das outras) e os põe por último.
alter table sabia.fontes add column if not exists secundaria boolean not null default false;
comment on column sabia.fontes.secundaria is 'Fonte que a trilha usa menos: poucos itens do feed, por último, e fora da lista de preferidas na busca.';

update sabia.fontes set secundaria = true where dominio in ('poder360.com.br', 'gazetadopovo.com.br', 'nexojornal.com.br');

update sabia.fontes f set rss_url = v.url from (values
  ('bbc.com', 'https://feeds.bbci.co.uk/portuguese/rss.xml'),
  ('folha.uol.com.br', 'https://feeds.folha.uol.com.br/poder/rss091.xml'),
  ('estadao.com.br', 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/')
) v(dominio, url)
where f.dominio = v.dominio and f.rss_url is null;

insert into sabia.fontes (dominio, nome, tema, idioma, paywall, rss_url) values
  ('jota.info', 'JOTA', 'politica', 'pt', false, 'https://www.jota.info/feed'),
  ('cartacapital.com.br', 'CartaCapital', 'politica', 'pt', false, 'https://www.cartacapital.com.br/politica/feed/'),
  ('g1.globo.com', 'g1 Política', 'politica', 'pt', false, 'https://g1.globo.com/rss/g1/politica/')
on conflict (dominio) do nothing;
