# Sincronização produção → repo

Gerado por .github/workflows/sincroniza-producao.yml em 2026-11-09T12:21:18Z. Produção vence.

## Funções
- `airton-notify` v8, verify_jwt=false
- `airton-pluggy` v10, verify_jwt=false
- `airton-ai` v10, verify_jwt=false
- `airton-market` v13, verify_jwt=false
- `iara-briefing` v5, verify_jwt=false
- `sabia-trilha` v7, verify_jwt=false
- `claudia-food-parse` v3, verify_jwt=false
- `claudia-ingest` v2, verify_jwt=false
- `claudia-strava` v2, verify_jwt=false
- `claudia-diet` v2, verify_jwt=false
- `claudia-photo-review` v2, verify_jwt=false
- `claudia-coach` v2, verify_jwt=false
- `claudia-coach-session` v2, verify_jwt=false
- `claudia-coach-review` v2, verify_jwt=false
- `claudia-checkin` v2, verify_jwt=false

## Arquivos compartilhados divergentes entre funções
Nenhum.

## Diferenças em relação à main
     supabase/SINCRONIZACAO.md                          |   25 +
     supabase/config.toml                               |   42 +
     supabase/functions/_shared/claudia/ai.ts           |  208 +-
     supabase/functions/_shared/claudia/common.ts       |   94 +-
     supabase/functions/_shared/claudia/training.ts     |  202 +
     supabase/functions/_shared/claudia/validate.ts     |   36 +
     supabase/functions/airton-ai/_shared/ai.ts         |  270 +
     supabase/functions/airton-ai/_shared/categorize.ts |  218 +
     supabase/functions/airton-ai/_shared/common.ts     |  100 +
     supabase/functions/airton-ai/index.ts              |  330 +
     supabase/functions/airton-market/ai.ts             |  270 +
     supabase/functions/airton-market/common.ts         |  100 +
     supabase/functions/airton-market/extra.ts          |  454 ++
     supabase/functions/airton-market/index.ts          |  538 ++
     supabase/functions/airton-market/webpush.ts        |  173 +
     supabase/functions/airton-notify/_shared/common.ts |  100 +
     .../functions/airton-notify/_shared/webpush.ts     |  173 +
     supabase/functions/airton-notify/index.ts          |  246 +
     supabase/functions/airton-pluggy/_shared/ai.ts     |  270 +
     .../functions/airton-pluggy/_shared/categorize.ts  |  218 +
     supabase/functions/airton-pluggy/_shared/common.ts |  100 +
     supabase/functions/airton-pluggy/index.ts          |  530 ++
     supabase/functions/claudia-checkin/index.ts        |  142 +
     supabase/functions/claudia-coach-review/index.ts   |  285 +
     supabase/functions/claudia-coach-session/index.ts  |  168 +
     supabase/functions/claudia-coach/index.ts          |  148 +
     supabase/functions/claudia-diet/index.ts           |  214 +
     supabase/functions/claudia-food-parse/index.ts     |  147 +-
     supabase/functions/claudia-ingest/index.ts         |  115 +
     supabase/functions/claudia-photo-review/index.ts   |  176 +
     supabase/functions/claudia-strava/index.ts         |  238 +
     supabase/functions/iara-briefing/_shared/ai.ts     |  177 +
     supabase/functions/iara-briefing/_shared/common.ts |  106 +
     supabase/functions/iara-briefing/index.ts          |   82 +
     supabase/functions/sabia-trilha/_shared/ai.ts      |  296 +
     supabase/functions/sabia-trilha/_shared/common.ts  |  106 +
     supabase/functions/sabia-trilha/index.ts           |  403 ++
     supabase/migrations/20260923152747_core_schema.sql |  223 +
     supabase/migrations/20260923152756_rls.sql         |   34 +
     .../migrations/20260923152817_views_and_rpc.sql    |  121 +
     supabase/migrations/20260923152826_storage.sql     |   13 +
     .../20260923152929_tighten_ingest_grant.sql        |    1 +
     .../migrations/20260923153851_signup_allowlist.sql |   18 +
     .../20260925141544_open_signups_and_ai_usage.sql   |   25 +
     .../migrations/20260925150931_weekly_checkins.sql  |   20 +
     supabase/migrations/20260925190119_multisport.sql  |  145 +
     supabase/migrations/20260925204605_strava.sql      |   66 +
     ...20260925210921_0011_session_logging_history.sql |   32 +
     .../20260925211619_0012_food_parse_route.sql       |    4 +
     .../20260925212600_0013_encryption_support.sql     |    7 +
     .../migrations/20261102002958_airton_01_schema.sql |  253 +
     .../20261102003010_airton_02_rls_grants.sql        |   37 +
     .../20261102003132_airton_03_views_engine.sql      |  296 +
     .../20261102003149_airton_04_seed_defaults.sql     |   30 +
     .../20261102010015_airton_05_expose_schema.sql     |    3 +
     .../20261102010042_airton_06_cron_infra.sql        |   21 +
     .../20261102010144_airton_07_actions.sql           |   77 +
     .../migrations/20261102010553_airton_08_kv_rpc.sql |   16 +
     .../20261102011658_airton_09_cron_jobs.sql         |    7 +
     .../20261102013124_airton_10_deploy_bucket_tmp.sql |    2 +
     .../20261102124421_airton_12_year_series.sql       |   73 +
     .../20261102125239_airton_13_deploy_bundle_v2.sql  |    1 +
     .../20261102233353_airton_14_income_and_events.sql |  286 +
     ...airton_15_fix_xp_account_and_income_history.sql |   98 +
     ...233829_airton_16_month_plan_variable_income.sql |  299 +
     .../20261102234017_airton_17_vtx_planned_event.sql |   16 +
     .../20261102234539_airton_18_deploy_bundle_v3.sql  |    1 +
     ...0261102234613_airton_19_revoke_anon_helpers.sql |    4 +
     .../20261103021621_airton_21_deploy_bundle_v4.sql  |    1 +
     ...airton_20_employer_reclass_trip_and_mirrors.sql |  151 +
     ...airton_21_employer_skip_investment_accounts.sql |   98 +
     ...023748_airton_22_fix_xp_checking_type_again.sql |   11 +
     ...807_airton_23_employment_strict_range_first.sql |   15 +
     ...20261103030628_airton_25_family_help_income.sql |  231 +
     ...20261103041402_airton_27b_inv_news_backfill.sql |   74 +
     ...20261103042805_airton_28_inv_plan_movements.sql |   43 +
     .../20261103042936_airton_29_v_inv_month.sql       |   27 +
     ...61103043358_airton_30_oct_from_nov_and_view.sql |   53 +
     ...61107144549_airton_ai_usage_instrumentation.sql |   22 +
     .../migrations/20261108153456_iara_hq_core.sql     |  216 +
     .../migrations/20261108153535_iara_hq_sabia.sql    |  193 +
     .../migrations/20261108220737_sabia_fontes_rss.sql |   22 +
     .../migrations/20261108223838_claudia_ai_usage.sql |   22 +
     .../20261109012945_claudia_is_member.sql           |   12 +
     .../migrations/20261109031226_claudia_ai_cost.sql  |   18 +
     supabase/schema/producao.sql                       | 6288 ++++++++++++++++++++
     86 files changed, 17097 insertions(+), 129 deletions(-)
