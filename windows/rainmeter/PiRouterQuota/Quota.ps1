param([string]$BaseUrl = 'http://127.0.0.1:20128', [string]$FixtureDir)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Get-Percent($quota) {
    if ($null -ne $quota.remainingPercentage) { $value = [double]$quota.remainingPercentage }
    elseif ($null -ne $quota.remaining) { $value = [double]$quota.remaining }
    elseif ([double]$quota.total -gt 0) { $value = (1 - [double]$quota.used / [double]$quota.total) * 100 }
    else { return 'n/a' }
    return ('{0}%' -f [math]::Round([math]::Max(0, [math]::Min(100, $value))))
}

function Format-Quota($account, $usage) {
    $name = if ($account.name) { $account.name } elseif ($account.email) { $account.email } else { $account.id }
    $lines = @("$($account.provider) - $name")
    if ($usage.message -or $usage.error) { return @($lines + '  unavailable') }
    if (-not $usage.quotas -or @($usage.quotas.PSObject.Properties).Count -eq 0) { return @($lines + '  no quota data') }
    foreach ($row in $usage.quotas.PSObject.Properties) {
        $quota = $row.Value
        $percent = Get-Percent $quota
        $reset = 'reset unknown'
        if ($quota.resetAt) {
            try { $reset = 'reset ' + ([datetimeoffset]::Parse([string]$quota.resetAt).ToLocalTime().ToString('yyyy-MM-dd HH:mm')) }
            catch { $reset = 'reset unknown' }
        }
        $lines += "  $($row.Name): $percent remaining | $reset"
    }
    return $lines
}

function Get-Json($url) {
    Invoke-RestMethod -Uri $url -TimeoutSec 20 -ErrorAction Stop
}

try {
    if ($FixtureDir) {
        $connections = Get-Content -LiteralPath (Join-Path $FixtureDir 'connections.json') -Raw | ConvertFrom-Json
    } else {
        $connections = Get-Json ($BaseUrl.TrimEnd('/') + '/api/providers/client?pageSize=500&sort=priority')
    }
    $accounts = @($connections.connections | Where-Object { $_.provider -in @('codex', 'claude', 'glm', 'glm-cn') -and $_.isActive -ne $false })
    $output = @('PiRouter quotas  (click to refresh)')
    if ($accounts.Count -eq 0) { $output += 'No active Codex, Claude or GLM accounts' }
    foreach ($account in $accounts) {
        try {
            if ($FixtureDir) {
                $usage = Get-Content -LiteralPath (Join-Path $FixtureDir ("usage-$($account.id).json")) -Raw | ConvertFrom-Json
            } else {
                $id = [uri]::EscapeDataString([string]$account.id)
                $usage = Get-Json ($BaseUrl.TrimEnd('/') + '/api/usage/' + $id)
            }
            $output += Format-Quota $account $usage
        } catch {
            $output += "$($account.provider) - $($account.name): unavailable"
        }
    }
    $output -join "`n"
} catch {
    'PiRouter quotas: unavailable (check server / dashboard access)'
}
