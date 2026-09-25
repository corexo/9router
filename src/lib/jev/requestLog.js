/**
 * In-memory log of recent Jev requests for debugging.
 * Stores last N requests with their criteria to show in dashboard.
 *
 * Next.js bundles each route separately, so a plain module-level array would
 * give the chat handler and the /api/debug/jev route two distinct instances.
 * Pinning the store on globalThis keeps a single shared log across bundles.
 *
 * Each entry can carry the full 4-stage flow of one request:
 * 1. incoming  — request body as received from the client (Pi)
 * 2. fullPayload/modelCriteria — request sent to the Jev SystemOne API
 * 3. jevResponse — raw response from Jev
 * 4. outgoing — response streamed back to the client (capped preview)
 * Stages 1 and 4 are capped to keep the store bounded even with 128k contexts.
 */

const MAX_REQUESTS = 50;
const STORE = Symbol.for("9router.jevRequestLog");

// Payload caps per stage (chars). Large Pi contexts must not blow up memory:
// worst case ~= 50 entries x ~130 KB ~= 6.5 MB.
const INCOMING_CAP = 48 * 1024;
const RESPONSE_CAP = 32 * 1024;
const OUTGOING_PREVIEW_CAP = 32 * 1024;

let nextTraceId = 1;

function store() {
	if (!globalThis[STORE]) globalThis[STORE] = [];
	return globalThis[STORE];
}

function byteLength(text) {
	return typeof Buffer !== "undefined" ? Buffer.byteLength(text) : text.length;
}

function capped(text, cap) {
	if (text == null) return undefined;
	const bytes = byteLength(text);
	return bytes <= cap ? { text, bytes, truncated: false } : { text: text.slice(0, cap), bytes, truncated: true };
}

function findById(id) {
	if (!id) return undefined;
	return store().find((entry) => entry.id === id);
}

/**
 * Open a trace for one client request. Returns the trace id used to attach
 * later stages. `incoming` is stored capped ({text, bytes, truncated}).
 */
export function startJevTrace(incoming = {}) {
	const id = nextTraceId++;
	const log = store();
	log.unshift({
		id,
		timestamp: new Date().toISOString(),
		incoming: capped(typeof incoming.body === "string" ? incoming.body : JSON.stringify(incoming.body ?? null), INCOMING_CAP),
		requestedModel: incoming.model ?? null,
	});
	if (log.length > MAX_REQUESTS) log.length = MAX_REQUESTS;
	return id;
}

export function logJevRequest(payload, numModels, meta = {}) {
	const log = store();
	const existing = meta.id ? findById(meta.id) : undefined;
	if (existing) {
		Object.assign(existing, { numModels, ...payload });
		return;
	}
	log.unshift({
		timestamp: new Date().toISOString(),
		numModels,
		...payload,
	});
	if (log.length > MAX_REQUESTS) log.length = MAX_REQUESTS;
}

export function updateLastJevRequest(result) {
	const log = store();
	if (log.length > 0) Object.assign(log[0], result);
}

/**
 * Patch a trace by id (race-safe: concurrent requests must not patch
 * each other's entry, which updateLastJevRequest would do).
 */
export function patchJevTrace(id, patch) {
	const entry = findById(id);
	if (entry) Object.assign(entry, patch);
}

/**
 * Capture stage 4: wrap the outgoing Response in a pass-through stream that
 * records status, byte count and a capped text preview on the trace.
 * The client still receives the untouched body.
 *
 * Optional `meta` ({cacheId, cacheActive, model}) exposes 9Router session-cache
 * state to the client WITHOUT breaking strict SSE parsers:
 * - text/event-stream: one comment line ": 9router-meta {...}" before the first
 *   data chunk. Comments are spec-conform and ignored by every EventSource parser
 *   (a real extra event was tried before and reverted in f63034 for breaking
 *   OpenAI-compatible clients).
 * - other content types (e.g. JSON): response headers x-9router-cache-id /
 *   x-9router-cache-active.
 */
export function tapJevResponse(response, traceId, meta = null) {
	if (!traceId) return response;
	// Callers return the async handler promises unawaited — resolve first.
	if (response instanceof Promise) return response.then((res) => tapJevResponse(res, traceId, meta));
	if (!response?.body) return response;

	const isSse = String(response.headers?.get?.("content-type") || "").includes("text/event-stream");
	const comment = meta
		? `: 9router-meta ${JSON.stringify({ cacheId: meta.cacheId, cacheActive: !!meta.cacheActive, model: meta.model || null })}\n\n`
		: "";
	let headers = response.headers;
	if (meta && !isSse) {
		headers = new Headers(response.headers);
		if (meta.cacheId) headers.set("x-9router-cache-id", String(meta.cacheId));
		headers.set("x-9router-cache-active", String(!!meta.cacheActive));
	}

	let bytes = 0;
	let cappedPreview = false;
	let injected = false;
	const parts = [];
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();

	const stream = response.body.pipeThrough(new TransformStream({
		transform(chunk, controller) {
			if (meta && isSse && !injected) {
				injected = true;
				controller.enqueue(encoder.encode(comment));
			}
			bytes += chunk.byteLength ?? chunk.length ?? 0;
			if (!cappedPreview) {
				parts.push(decoder.decode(chunk, { stream: true }));
				if (parts.join("").length >= OUTGOING_PREVIEW_CAP) cappedPreview = true;
			}
			controller.enqueue(chunk);
		},
		flush() {
			if (!traceId) return;
			const preview = parts.join("") + decoder.decode();
			patchJevTrace(traceId, {
				outgoing: { status: response.status, bytes, preview, truncated: cappedPreview, completedAt: new Date().toISOString() },
			});
		},
	}));

	return new Response(stream, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function getJevRequestLog() {
	return store();
}

export function clearJevRequestLog() {
	store().length = 0;
}

export const JEV_TRACE_CAPS = { INCOMING_CAP, RESPONSE_CAP, OUTGOING_PREVIEW_CAP };
