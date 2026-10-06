import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getUserByUsername, setPasswordHash } from "@/lib/db/index.js";
import { getSettings, updateSettings } from "@/lib/localDb";

export async function POST(request) {
  const session = await getDashboardAuthSession((await cookies()).get("auth_token")?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { oldPassword, newPassword } = await request.json();
  if (typeof oldPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 12) {
    return NextResponse.json({ error: "New password must be at least 12 characters" }, { status: 400 });
  }
  if (session.sub && session.username) {
    const user = await getUserByUsername(session.username);
    if (!user || user.id !== session.sub || !user.isActive || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    await setPasswordHash(user.id, await bcrypt.hash(newPassword, 10));
    return NextResponse.json({ success: true });
  }
  const settings = await getSettings();
  const valid = settings.password
    ? await bcrypt.compare(oldPassword, settings.password)
    : oldPassword === (process.env.INITIAL_PASSWORD || "123456");
  if (!valid) return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  await updateSettings({ password: await bcrypt.hash(newPassword, 10) });
  return NextResponse.json({ success: true });
}
