export function countdown(date, now) {
  if (!date) return "Kein Zeitfenster gemeldet";
  const milliseconds = new Date(date).getTime() - now;
  if (!Number.isFinite(milliseconds)) return "Zeitfenster unbekannt";
  if (milliseconds <= 0) return "Abgelaufen / Reset fällig";
  const minutes = Math.ceil(milliseconds / 60000);
  if (minutes < 60) return `Reset in ${minutes} Min.`;
  if (minutes < 1440) return `Reset in ${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.`;
  return `Reset in ${Math.floor(minutes / 1440)} Tg. ${Math.floor(minutes % 1440 / 60)} Std.`;
}
