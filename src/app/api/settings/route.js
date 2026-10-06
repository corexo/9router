import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { resetComboRotation } from "open-sse/services/combo.js";
import { normalizeTierPreference } from "@/sse/services/modelTiers.js";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getUserPrefs, updateUserPrefs } from "@/lib/db/repos/userPrefsRepo";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETTINGS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store"
};

// Secrets must never be mass-assigned from request body (CWE-915)
const PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"];

export async function GET() {
  try {
    const settings = await getSettings();
    const claims = await verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null);
    if (claims?.role === "moderator" && claims.username) {
      const { password, oidcClientSecret, ...safeSettings } = settings;
      const prefs = await getUserPrefs(claims.username);
      Object.assign(safeSettings, Object.fromEntries(Object.entries(prefs).filter(([key]) => key.startsWith("jev"))));
      safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
      return NextResponse.json({ ...safeSettings, enableRequestLogs: false, enableTranslator: false, hasPassword: true }, { headers: SETTINGS_RESPONSE_HEADERS });
    }
    const { password, oidcClientSecret, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    
    const enableRequestLogs = process.env.ENABLE_REQUEST_LOGS === "true";
    const enableTranslator = process.env.ENABLE_TRANSLATOR === "true";
    
    return NextResponse.json({ 
      ...safeSettings, 
      enableRequestLogs,
      enableTranslator,
      hasPassword: !!password
    }, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error getting settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const claims = await verifyDashboardAuthToken((await cookies()).get("auth_token")?.value).catch(() => null);
    if (claims?.role === "moderator" && claims.username) {
      const prefKeys = Object.keys(body).filter((key) => key.startsWith("jev") && key !== "jevApiKey");
      const prefs = await updateUserPrefs(claims.username, Object.fromEntries(prefKeys.map((key) => [key, body[key]])));
      return NextResponse.json({ success: true, userPreferences: prefs }, { headers: SETTINGS_RESPONSE_HEADERS });
    }

    // Strip protected secrets before any internal handling sets them
    for (const key of PROTECTED_SETTING_KEYS) delete body[key];

    // If updating password, hash it
    if (body.newPassword) {
      const settings = await getSettings();
      const currentHash = settings.password;

      // Verify current password if it exists
      if (currentHash) {
        if (!body.currentPassword) {
          return NextResponse.json({ error: "Current password required" }, { status: 400 });
        }
        const isValid = await bcrypt.compare(body.currentPassword, currentHash);
        if (!isValid) {
          return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      } else {
        // First time setting password, no current password needed
        // Allow empty currentPassword or default "123456"
        if (body.currentPassword && body.currentPassword !== "123456") {
           return NextResponse.json({ error: "Invalid current password" }, { status: 401 });
        }
      }

      const salt = await bcrypt.genSalt(10);
      body.password = await bcrypt.hash(body.newPassword, salt);
      delete body.newPassword;
      delete body.currentPassword;
    }

    // Empty string means "keep stored key"; only an explicit null clears it.
    if (Object.prototype.hasOwnProperty.call(body, "jevApiKey")) {
      if (body.jevApiKey === null) body.jevApiKey = "";
      else if (!String(body.jevApiKey).trim()) delete body.jevApiKey;
      else body.jevApiKey = String(body.jevApiKey).trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, "jevModelTiers")) {
      const validTiers = new Set(["low", "fast", "mid", "strong", "frontier"]);
      if (!body.jevModelTiers || typeof body.jevModelTiers !== "object" || Array.isArray(body.jevModelTiers) || Object.keys(body.jevModelTiers).length > 2000 || Object.entries(body.jevModelTiers).some(([model, tier]) => !model.includes("/") || model.length > 300 || !validTiers.has(tier))) {
        return NextResponse.json({ error: "Invalid jevModelTiers" }, { status: 400 });
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "jevPoolModels")) {
      if (!Array.isArray(body.jevPoolModels) || body.jevPoolModels.length > 1000 || body.jevPoolModels.some((id) => typeof id !== "string" || id.length > 300 || !id.includes("/"))) {
        return NextResponse.json({ error: "Invalid jevPoolModels" }, { status: 400 });
      }
      body.jevPoolModels = [...new Set(body.jevPoolModels)];
    }

    if (Object.prototype.hasOwnProperty.call(body, "jevTierDistributionEnabled") && typeof body.jevTierDistributionEnabled !== "boolean") {
      return NextResponse.json({ error: "Invalid jevTierDistributionEnabled" }, { status: 400 });
    }

    // "Modell-Klasse" slider: only known preference ids may be stored.
    if (Object.prototype.hasOwnProperty.call(body, "jevTierPreference")) {
      const normalized = normalizeTierPreference(body.jevTierPreference);
      if (!normalized) {
        return NextResponse.json({ error: "Invalid jevTierPreference" }, { status: 400 });
      }
      body.jevTierPreference = normalized;
    }

    if (Object.prototype.hasOwnProperty.call(body, "oidcClientSecret")) {
      if (!body.oidcClientSecret || !String(body.oidcClientSecret).trim()) {
        delete body.oidcClientSecret;
      }
    }

    const settings = await updateSettings(body);

    // Apply outbound proxy settings immediately (no restart required)
    if (
      Object.prototype.hasOwnProperty.call(body, "outboundProxyEnabled") ||
      Object.prototype.hasOwnProperty.call(body, "outboundProxyUrl") ||
      Object.prototype.hasOwnProperty.call(body, "outboundNoProxy")
    ) {
      applyOutboundProxyEnv(settings);
    }

    // Invalidate combo rotation state when strategy settings change
    if (
      Object.prototype.hasOwnProperty.call(body, "comboStrategy") ||
      Object.prototype.hasOwnProperty.call(body, "comboStickyRoundRobinLimit") ||
      Object.prototype.hasOwnProperty.call(body, "comboStrategies")
    ) {
      resetComboRotation();
    }

    if (
      Object.prototype.hasOwnProperty.call(body, "claudeAutoPing") ||
      Object.prototype.hasOwnProperty.call(body, "codexAutoPing")
    ) {
      // Keep the scheduler absent when no account opted in; load its provider graph only on demand.
      import("@/shared/services/quotaAutoPing")
        .then(({ configureQuotaAutoPing }) => {
          configureQuotaAutoPing(settings);
        })
        .catch((error) => console.warn("[AutoPing] settings update failed:", error.message));
    }

    const { password, oidcClientSecret, jevApiKey, ...safeSettings } = settings;
    safeSettings.oidcConfigured = !!(safeSettings.oidcIssuerUrl && safeSettings.oidcClientId && oidcClientSecret);
    safeSettings.jevConfigured = !!jevApiKey;
    return NextResponse.json(safeSettings, { headers: SETTINGS_RESPONSE_HEADERS });
  } catch (error) {
    console.log("Error updating settings:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
