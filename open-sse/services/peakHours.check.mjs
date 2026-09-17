// Runnable self-check for filterPeakHours. Run: node open-sse/services/peakHours.check.mjs
import assert from "node:assert/strict";
import { filterPeakHours, getPeakForCombo } from "./combo.js";

const MODELS = ["anthropic/claude-4", "openai/gpt-5", "google/gemini-3", "cursor/claude-sonnet"];
const nowHour = new Date().getHours();

// Helper: build a window that definitely contains / excludes the current hour.
const windowContainingNow = { start: nowHour, end: (nowHour + 1) % 24 || 24 };
const windowExcludingNow = (() => {
  const start = (nowHour + 1) % 24;
  const end = (nowHour + 2) % 24 || 24; // 1-hour window after now
  return { start, end };
})();

// 1. No peak config -> unchanged
assert.deepEqual(filterPeakHours(MODELS, undefined), MODELS);
assert.deepEqual(filterPeakHours(MODELS, null), MODELS);
assert.deepEqual(filterPeakHours([], { start: 0, end: 23, percent: 50 }), []);

// 2. Invalid window -> unchanged
assert.deepEqual(filterPeakHours(MODELS, { start: "x", end: 2, percent: 50 }), MODELS);

// 3. Outside window -> unchanged
const excluded = filterPeakHours(MODELS, { ...windowExcludingNow, percent: 0 });
assert.deepEqual(excluded, MODELS, `window ${JSON.stringify(windowExcludingNow)} must exclude hour ${nowHour}`);

// 4. Midnight-crossing window: start 22, end 4 active for hours 22,23,0,1,2,3
const midnight = { start: 22, end: 4, percent: 0 };
if (nowHour >= 4 && nowHour < 22) {
  assert.deepEqual(filterPeakHours(MODELS, midnight), MODELS);
} else {
  // active now -> all matching removed, non-matching kept, never empty
  const r = filterPeakHours(MODELS, midnight);
  assert.ok(!r.includes("anthropic/claude-4"));
  assert.ok(!r.includes("cursor/claude-sonnet"));
  assert.ok(r.includes("openai/gpt-5"));
}

// 5. percent 0 with all models matching -> guard returns original (never empty)
assert.deepEqual(filterPeakHours(["claude-4", "anthropic/opus"], { ...windowContainingNow, percent: 0 }), ["claude-4", "anthropic/opus"]);

// 6. percent 100 -> unchanged
assert.deepEqual(filterPeakHours(MODELS, { ...windowContainingNow, percent: 100 }), MODELS);

// 7. percent 50 statistics: 1000 runs, kept lengths vary, non-matching always kept
let anthropicKept = 0;
let sawReduction = false;
let sawFull = false;
for (let i = 0; i < 1000; i++) {
  const r = filterPeakHours(MODELS, { ...windowContainingNow, percent: 50 });
  assert.ok(r.includes("openai/gpt-5"));
  assert.ok(r.includes("google/gemini-3"));
  assert.ok(r.length > 0);
  if (r.includes("anthropic/claude-4")) anthropicKept++;
  if (r.length < MODELS.length) sawReduction = true;
  if (r.length === MODELS.length) sawFull = true;
}
assert.ok(sawReduction && sawFull, "50% should sometimes keep and sometimes drop matching models");
assert.ok(anthropicKept > 400 && anthropicKept < 600, `kept ${anthropicKept}/1000, expected ~500`);

// 8. Custom match list: only "gemini" throttled
const geminiOnly = { ...windowContainingNow, percent: 0, match: ["gemini"] };
const rg = filterPeakHours(MODELS, geminiOnly);
assert.deepEqual(rg, ["anthropic/claude-4", "openai/gpt-5", "cursor/claude-sonnet"]);

// 9. days: today NOT in days -> outside peak, unchanged
const wrongDay = { ...windowContainingNow, days: [((new Date().getDay() + 1) % 7)] };
assert.deepEqual(filterPeakHours(MODELS, { ...wrongDay, percent: 0 }), MODELS);

// 10. days: today in days -> active like before
const rightDay = { ...windowContainingNow, days: [new Date().getDay()] };
assert.deepEqual(filterPeakHours(MODELS, { ...rightDay, percent: 100 }), MODELS);
assert.deepEqual(
  filterPeakHours(MODELS, { ...rightDay, percent: 0 }),
  ["openai/gpt-5", "google/gemini-3"]
);

// 11. days default (absent) = Mon-Fri: same as passing explicit today for the window check
const today = new Date().getDay();
const expectActiveDefault = [1, 2, 3, 4, 5].includes(today);
const rDefault = filterPeakHours(MODELS, { ...windowContainingNow, percent: 0 });
assert.deepEqual(rDefault, expectActiveDefault ? ["openai/gpt-5", "google/gemini-3"] : MODELS);

// 12. empty days array falls back to Mon-Fr default
const rEmpty = filterPeakHours(MODELS, { ...windowContainingNow, days: [], percent: 0 });
assert.deepEqual(rEmpty, expectActiveDefault ? ["openai/gpt-5", "google/gemini-3"] : MODELS);

// 13. getPeakForCombo: global off -> null, combo opt-out -> null, percent override
const SETTINGS = { peakHours: { days: [1, 2, 3, 4, 5], start: 12, end: 18, percent: 20 }, comboStrategies: {} };
assert.deepEqual(getPeakForCombo(SETTINGS, "any"), { days: [1, 2, 3, 4, 5], start: 12, end: 18, percent: 20 });
assert.equal(getPeakForCombo({}, "any"), null);
assert.deepEqual(getPeakForCombo({ peakHours: { start: 12, end: 18 } }, "any"), { start: 12, end: 18, percent: undefined });
const optOut = { ...SETTINGS, comboStrategies: { A: { peakHours: { enabled: false, percent: 50 } } } };
assert.equal(getPeakForCombo(optOut, "A"), null);
assert.deepEqual(getPeakForCombo(optOut, "B"), { ...SETTINGS.peakHours, percent: 20 });
const pctOverride = { ...SETTINGS, comboStrategies: { A: { peakHours: { enabled: true, percent: 0 } } } };
assert.deepEqual(filterPeakHours(MODELS, getPeakForCombo(pctOverride, "A")),
  filterPeakHours(MODELS, { ...SETTINGS.peakHours, percent: 0 }));

console.log("peakHours.check: all assertions passed");
