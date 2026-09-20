import { getJevRequestLog, clearJevRequestLog } from "@/lib/jev/requestLog.js";

export async function GET() {
  const log = getJevRequestLog();
  return Response.json({ log, count: log.length });
}

export async function DELETE() {
  clearJevRequestLog();
  return Response.json({ cleared: true });
}
