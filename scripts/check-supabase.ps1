param([string]$Origin = 'http://127.0.0.1:5501')
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$config = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $workspace 'assets/supabase-config.js')
$projectUrl = [regex]::Match($config, "supabaseUrl:\s*'([^']+)'").Groups[1].Value
$publicKey = [regex]::Match($config, "supabasePublishableKey:\s*'([^']+)'").Groups[1].Value
if (!$projectUrl -or !$publicKey.StartsWith('sb_publishable_')) { throw 'Public Supabase configuration is invalid.' }
$headers = @{ apikey = $publicKey; Origin = $Origin; 'x-app-name' = 'the-indian-skills' }
$checks = @(
  @{ Name = 'Auth settings / public key'; Path = '/auth/v1/settings'; Method = 'GET' },
  @{ Name = 'Auth user / request headers (no user token)'; Path = '/auth/v1/user'; Method = 'GET'; AuthProbe = $true },
  @{ Name = 'Auth CORS preflight'; Path = '/auth/v1/user'; Method = 'OPTIONS' },
  @{ Name = 'Referral migration function'; Path = '/rest/v1/rpc/tis_resolve_referral?p_code=tis-connection-probe-nonexistent'; Method = 'GET' },
  @{ Name = 'Protected enrollment read (no records requested)'; Path = '/rest/v1/Enrollments?select=id&limit=0'; Method = 'GET' },
  @{ Name = 'Student migration function (anonymous request)'; Path = '/rest/v1/rpc/tis_my_enrollments'; Method = 'GET' },
  @{ Name = 'CORS preflight'; Path = '/rest/v1/rpc/tis_my_enrollments'; Method = 'OPTIONS' }
)
foreach ($check in $checks) {
  $requestHeaders = $headers.Clone()
  if ($check.AuthProbe) {
    $requestHeaders['Authorization'] = 'Bearer tis-connection-check-not-a-user-token'
    $requestHeaders['x-client-info'] = 'supabase-js-web/2.116.0'
  }
  if ($check.Method -eq 'OPTIONS') {
    $requestHeaders['Access-Control-Request-Method'] = if ($check.Path.StartsWith('/auth/')) { 'GET' } else { 'POST' }
    $requestHeaders['Access-Control-Request-Headers'] = 'apikey,authorization,content-type,x-client-info,x-app-name'
  }
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri ($projectUrl + $check.Path) -Headers $requestHeaders -Method $check.Method -TimeoutSec 20
    $details = if ($check.Method -eq 'OPTIONS') { 'Allowed origin: ' + $response.Headers['Access-Control-Allow-Origin'] } else { 'Request succeeded' }
    if ($check.Path -eq '/auth/v1/settings') {
      $settings = $response.Content | ConvertFrom-Json
      $details = 'Public key accepted; email signup=' + $settings.external.email + '; email autoconfirm=' + $settings.mailer_autoconfirm
    }
    [pscustomobject]@{ Check = $check.Name; HTTP = [int]$response.StatusCode; Details = $details }
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    $details = switch ($status) {
      401 { 'Authentication required; anonymous access denied' }
      403 { if ($check.AuthProbe) { 'Auth endpoint responded; invalid diagnostic token rejected (expected)' } else { 'Permission denied' } }
      404 { 'Endpoint or database function is missing' }
      0 { 'Network connection failed or timed out' }
      default { 'Request failed' }
    }
    [pscustomobject]@{ Check = $check.Name; HTTP = $status; Details = $details }
  }
}
