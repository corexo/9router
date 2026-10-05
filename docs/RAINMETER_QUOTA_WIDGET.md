# Rainmeter quota widget

Windows Rainmeter skin for active Codex, Claude, GLM and GLM-China accounts. Uses PiRouter's existing `/api/providers/client` and `/api/usage/{connectionId}` endpoints; quotas stay normalized as returned by the provider API. No credentials are stored in the skin.

## Install

1. Start PiRouter on this Windows PC. Default URL: `http://127.0.0.1:20128`.
2. Copy `windows/rainmeter/PiRouterQuota` into `%USERPROFILE%\Documents\Rainmeter\Skins\`.
3. In Rainmeter, Refresh all; load `PiRouterQuota\PiRouterQuota.ini`.
4. Click the widget to fetch fresh values. It refreshes every 10 minutes; this deliberately respects Claude's minimum quota refresh interval.
5. If PiRouter uses another local URL, edit `BaseUrl` in the skin's INI and refresh it.

## LAN access

Remote dashboard APIs require dashboard authentication even when dashboard login is disabled: the local-request exception only applies to loopback. Do not point this skin at a LAN URL expecting anonymous API access; it will show unavailable/401. Use localhost on the PiRouter host. Remote access needs an explicitly designed authenticated route/client first; do not put session credentials or API keys in Rainmeter files.

## Troubleshooting

- `unavailable`: verify PiRouter is running and `BaseUrl` is correct; the widget does not expose server error bodies or secrets.
- `no quota data`: provider may not report quotas, account may be unsupported, or usage endpoint returned an empty result.
- Reset values render in Windows local time; missing/invalid resets show `reset unknown`.
- Click the skin to refresh before the next 10-minute interval.

## Fixture check

Run from repository root in Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/rainmeter-quota.ps1
```

This uses fixture JSON only; no server, credentials, Rainmeter install, or network access required.
