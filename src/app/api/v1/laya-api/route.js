import { NextResponse } from "next/server";

import { estimateTextTokens, extractTokens, recordJevUsage } from "@/lib/jev/client.js";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";

const LAYA_API_URL = "http://localhost:9311/v1/laya-api";
const LAYA_MODEL = "laya-latest";
const DEFAULT_PROXY_TIMEOUT_MS = 5000;

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.questions || typeof body.questions !== "object") {
    return NextResponse.json({ error: "Missing 'questions' object" }, { status: 400 });
  }

  const caller = request.headers.get("x-jev-caller") || body.caller || "unknown";
  const questionType = Object.values(body.questions)[0]?.type;

  const settings = await getSettings();
  const timeoutMs = Number(settings.jevProxyTimeoutMs) > 0 ? Number(settings.jevProxyTimeoutMs) : DEFAULT_PROXY_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  const requestBody = JSON.stringify({ ...body, model: body.model || LAYA_MODEL, caller: undefined });

  try {
    const upstream = await fetch(LAYA_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    const text = await upstream.text();
    const data = safeParse(text);
    const latencyMs = Date.now() - started;
    const realTokens = extractTokens(data);

    recordJevUsage({
      endpoint: "/v1/laya-api",
      caller,
      questionType,
      status: upstream.ok ? "success" : "error",
      httpStatus: upstream.status,
      latencyMs,
      promptTokens: realTokens || estimateTextTokens(requestBody),
      completionTokens: realTokens ? 0 : estimateTextTokens(text),
      choice: firstAnswer(data),
      fallbackReason: upstream.ok ? undefined : `HTTP ${upstream.status}`,
    });

    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const aborted = error?.name === "AbortError";
    recordJevUsage({
      endpoint: "/v1/laya-api",
      caller,
      questionType,
      status: "error",
      latencyMs: Date.now() - started,
      promptTokens: estimateTextTokens(requestBody),
      fallbackReason: aborted ? "timeout" : `network: ${error?.message || error}`,
    });
    return NextResponse.json({ error: aborted ? "Laya API timeout" : "Laya API unreachable" }, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function firstAnswer(data) {
  const node = Object.values(data?.answers || data?.results || {})[0];
  if (node === undefined || node === null) return undefined;
  if (typeof node !== "object") return String(node);
  const value = node.choice ?? node.selected ?? node.answer ?? node.value ?? node.score;
  return value === undefined ? undefined : String(value);
}
