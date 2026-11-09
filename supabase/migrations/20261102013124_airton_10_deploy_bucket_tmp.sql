insert into storage.buckets (id, name, public) values ('airton-deploy', 'airton-deploy', true) on conflict (id) do nothing;
create policy airton_deploy_tmp_upload on storage.objects for insert to anon with check (bucket_id = 'airton-deploy' and name = 'bundle-01be595df15908ef.tgz');;
