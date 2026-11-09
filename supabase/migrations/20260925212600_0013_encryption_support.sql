-- textos cifrados (enc:v1:base64) são ~1,4× maiores + cabeçalho
alter table public.plan_changes drop constraint if exists plan_changes_summary_check;
alter table public.plan_changes drop constraint if exists plan_changes_instruction_check;
alter table public.plan_changes add constraint plan_changes_summary_check check (char_length(summary) <= 4000);
alter table public.plan_changes add constraint plan_changes_instruction_check check (char_length(instruction) <= 4000);
-- versão da criptografia dos dados do usuário (0 = texto legado; 1 = migrado)
alter table public.profiles add column if not exists enc_version smallint not null default 0;;
