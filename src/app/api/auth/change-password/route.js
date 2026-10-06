import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getUserByUsername, setPasswordHash } from "@/lib/db/index.js";

export async function POST(request) {
  const session = await getDashboardAuthSession((await cookies()).get("auth_token")?.value);
  if (!session?.sub || !session?.username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { oldPassword, newPassword } = await request.json();
  if (typeof oldPassword !== "string" || typeof newPassword !== "string" || !newPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 400 });
  }
  const user = await getUserByUsername(session.username);
  if (!user || user.id !== session.sub || !user.isActive || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  await setPasswordHash(user.id, await bcrypt.hash(newPassword, 10));
  return NextResponse.json({ success: true });
}
