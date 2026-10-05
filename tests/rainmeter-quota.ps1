$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '../windows/rainmeter/PiRouterQuota/Quota.ps1'
$output = & $root -FixtureDir (Join-Path $PSScriptRoot 'fixtures')
foreach ($expected in @('codex - Work', 'session: 75% remaining', 'weekly: 50% remaining', 'claude - Personal', 'five_hour: 80% remaining', 'glm - Coding', 'Session (5h): 70% remaining', 'glm-cn - Backup', 'unavailable', 'reset unknown')) {
    if (-not $output.Contains($expected)) { throw "Missing expected quota output: $expected`n$output" }
}
if ($output.Contains('Inactive')) { throw 'Inactive account shown' }
Write-Output 'Rainmeter quota fixtures: OK'
