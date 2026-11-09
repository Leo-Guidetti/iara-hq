alter table sabia.fontes add column if not exists rss_url text;
update sabia.fontes f set rss_url = v.url from (values
  ('deepmind.google','https://deepmind.google/blog/rss.xml'),
  ('huggingface.co','https://huggingface.co/blog/feed.xml'),
  ('importai.substack.com','https://importai.substack.com/feed'),
  ('latent.space','https://latent.space/feed'),
  ('openai.com','https://openai.com/news/rss.xml'),
  ('simonwillison.net','https://simonwillison.net/atom/everything/'),
  ('bloomberglinea.com.br','https://www.bloomberglinea.com.br/arc/outboundfeeds/rss.xml'),
  ('infomoney.com.br','https://www.infomoney.com.br/feed/'),
  ('federalreserve.gov','https://www.federalreserve.gov/feeds/press_all.xml'),
  ('braziljournal.com','https://braziljournal.com/feed'),
  ('lennysnewsletter.com','https://www.lennysnewsletter.com/feed'),
  ('neofeed.com.br','https://neofeed.com.br/feed/'),
  ('notboring.co','https://www.notboring.co/feed'),
  ('stratechery.com','https://stratechery.com/feed/'),
  ('techcrunch.com','https://techcrunch.com/feed/'),
  ('nexojornal.com.br','https://www.nexojornal.com.br/rss.xml'),
  ('poder360.com.br','https://www.poder360.com.br/feed/'),
  ('gazetadopovo.com.br','https://www.gazetadopovo.com.br/feed/rss/republica.xml')
) as v(dominio, url) where f.dominio = v.dominio;
comment on column sabia.fontes.rss_url is 'Feed RSS/Atom lido pelo worker da trilha antes de qualquer busca paga.';;
