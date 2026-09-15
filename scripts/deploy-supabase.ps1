param([ValidateSet('Inspect','Apply','Verify')][string]$Mode = 'Inspect')
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$projectRef = 'rhcddqqoajcejtuzaquc'
$token = $env:SUPABASE_ACCESS_TOKEN
if (!$token) { $token = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User') }
if (!$token -and (Test-Path -LiteralPath (Join-Path $workspace '.env.local'))) {
  foreach ($line in [IO.File]::ReadAllLines((Join-Path $workspace '.env.local'))) {
    if ($line -match '^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.+?)\s*$') { $token = $Matches[1].Trim().Trim('"').Trim("'") }
  }
}
if (!$token -or !$token.StartsWith('sbp_')) { throw 'A Supabase personal access token is required in SUPABASE_ACCESS_TOKEN or .env.local. The public website key cannot run migrations.' }
$headers = @{ Authorization = 'Bearer ' + $token }
function Invoke-ProjectQuery([string]$Query, [bool]$ReadOnly = $true) {
  $body = @{ query = $Query; read_only = $ReadOnly } | ConvertTo-Json -Compress
  # Do not print headers, tokens, or raw configuration responses.
  Invoke-RestMethod -Uri ('https://api.supabase.com/v1/projects/' + $projectRef + '/database/query') -Headers $headers -Method Post -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 90
}

if ($Mode -eq 'Inspect') {
  $audit = Invoke-ProjectQuery @'
select jsonb_build_object(
 'columns',(select jsonb_agg(to_jsonb(c)) from (select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name in ('profiles','Enrollments','enrollments','pending_users','user_earnings','referral_cashback_wallet','referral_cashback_transactions','cashback_withdrawals')) c),
 'policies',(select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname='public'),
 'auth_triggers',(select jsonb_agg(jsonb_build_object('name',t.tgname,'trigger',pg_get_triggerdef(t.oid),'function',pg_get_functiondef(t.tgfoid))) from pg_trigger t where t.tgrelid='auth.users'::regclass and not t.tgisinternal),
 'constraints',(select jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_get_constraintdef(c.oid))) from pg_constraint c where c.connamespace='public'::regnamespace),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tis_private') and p.prokind='f' and (p.proname like 'tis_%' or p.proname like '%admin%'))
) as schema_audit;
'@
  $localDir = Join-Path $workspace '.local'
  New-Item -ItemType Directory -Force -Path $localDir | Out-Null
  $audit | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $localDir 'supabase-schema-before.json')
  Write-Output 'Authenticated schema inspection saved to .local/supabase-schema-before.json. Review before Apply; this is a schema snapshot, not a database backup.'
  $secrets = Invoke-RestMethod -Uri ('https://api.supabase.com/v1/projects/' + $projectRef + '/secrets') -Headers $headers -TimeoutSec 20
  foreach ($name in @('RESEND_API_KEY','RESEND_FROM_EMAIL','SITE_URL')) {
    [pscustomobject]@{ SecretName = $name; Configured = [bool]($secrets | Where-Object { $_.name -eq $name }) }
  }
  return
}

if ($Mode -eq 'Apply') {
  if (!(Test-Path -LiteralPath (Join-Path $workspace '.local/supabase-schema-before.json'))) { throw 'Run Inspect and review the live schema before Apply.' }
  $migration = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $workspace 'supabase/migrations/202609130001_tis_repair.sql')
  $history = @'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key,statements text[],name text);
insert into supabase_migrations.schema_migrations(version,name) values('202609130001','tis_repair') on conflict(version) do nothing;
commit;
'@
  $migration = [regex]::Replace($migration, '(?is)commit;\s*$', $history)
  try {
    $null = Invoke-ProjectQuery $migration $false
    Write-Output 'Migration committed to project rhcddqqoajcejtuzaquc. Run Verify next.'
  } catch {
    throw 'Migration request failed. Run Verify before retrying: a disconnected client cannot determine whether the server committed. No automatic retry was attempted.'
  }
  return
}

Invoke-ProjectQuery @'
select 'migration_recorded' as check_name,exists(select 1 from supabase_migrations.schema_migrations where version='202609130001') as passed
union all select 'student_rpc',to_regprocedure('public.tis_my_enrollments()') is not null
union all select 'admin_rpc',to_regprocedure('public.tis_admin_dashboard()') is not null
union all select 'signup_trigger',exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass and tgname='tis_signup_enrollment')
union all select 'wallet_client_updates_denied',not has_table_privilege('authenticated','public.referral_cashback_wallet','UPDATE')
union all select 'enrollment_client_approval_denied',not has_table_privilege('authenticated','public."Enrollments"','UPDATE');
'@
