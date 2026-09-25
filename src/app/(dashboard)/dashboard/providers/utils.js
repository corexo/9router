export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All (configured)" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

// noAuth providers (e.g. free proxies) are always usable even though they
// never have a stored connection record, so they never fall into "none".
// "all" now means "every configured provider" (active or inactive); providers
// without any connection live in the "Provider einrichten" modal instead.
export function matchesStatusFilter(statusFilter, stats, isNoAuth = false) {
  if (statusFilter === "all") return isNoAuth || (!!stats && stats.total > 0);
  return getConnectionStatus(stats, isNoAuth) === statusFilter;
}
