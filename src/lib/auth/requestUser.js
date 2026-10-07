import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "./dashboardSession.js";

export async function getRequestUsername() {
  const claims = await verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null);
  return claims?.username || null;
}
