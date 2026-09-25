import { describe, expect, it, beforeEach } from "vitest";
import {
	startJevTrace,
	logJevRequest,
	patchJevTrace,
	updateLastJevRequest,
	tapJevResponse,
	getJevRequestLog,
	clearJevRequestLog,
} from "../../src/lib/jev/requestLog.js";

describe("Jev request trace log", () => {
	beforeEach(() => clearJevRequestLog());

	it("starts a trace with a capped incoming body and binds later stages by id", () => {
		const id = startJevTrace({ model: "jev", body: { messages: [{ role: "user", content: "hi" }] } });
		expect(id).toBeTypeOf("number");

		logJevRequest({ fullPayload: { q: 1 } }, 3, { id });
		const [entry] = getJevRequestLog();
		expect(entry.id).toBe(id);
		expect(entry.numModels).toBe(3);
		expect(entry.fullPayload).toEqual({ q: 1 });
		expect(entry.incoming.truncated).toBe(false);
		expect(JSON.parse(entry.incoming.text).messages).toHaveLength(1);
	});

	it("keeps logJevRequest backward compatible without a trace id", () => {
		logJevRequest({ fullPayload: { legacy: true } }, 2);
		const [entry] = getJevRequestLog();
		expect(entry.fullPayload).toEqual({ legacy: true });
		expect(entry.id).toBeUndefined();
	});

	it("patches by id so concurrent traces do not overwrite each other", () => {
		const first = startJevTrace({ body: "a" });
		const second = startJevTrace({ body: "b" });
		patchJevTrace(first, { selectedModel: "m1" });
		patchJevTrace(second, { selectedModel: "m2" });

		const [secondEntry, firstEntry] = getJevRequestLog();
		expect(secondEntry.selectedModel).toBe("m2");
		expect(firstEntry.selectedModel).toBe("m1");
	});

	it("updateLastJevRequest still patches the newest entry", () => {
		startJevTrace({ body: "a" });
		updateLastJevRequest({ error: "boom" });
		expect(getJevRequestLog()[0].error).toBe("boom");
	});

	it("caps large incoming bodies and reports the original size", () => {
		startJevTrace({ body: "x".repeat(200 * 1024) });
		const [entry] = getJevRequestLog();
		expect(entry.incoming.truncated).toBe(true);
		expect(entry.incoming.text.length).toBeLessThan(200 * 1024);
		expect(entry.incoming.bytes).toBe(200 * 1024);
	});

	it("keeps the store bounded", async () => {
		const { JEV_TRACE_CAPS } = await import("../../src/lib/jev/requestLog.js");
		expect(JEV_TRACE_CAPS.INCOMING_CAP).toBeLessThan(100 * 1024);
	});

	it("tapJevResponse passes the body through untouched and captures a capped preview", async () => {
		const id = startJevTrace({ body: "req" });
		const chunks = ["data: hello\n\n", "data: world\n\n"];
		const source = new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
				controller.close();
			},
		});
		const original = new Response(source, { status: 200, headers: { "content-type": "text/event-stream" } });
		const tapped = tapJevResponse(original, id);

		expect(tapped).not.toBe(original);
		const text = await tapped.text();
		expect(text).toBe(chunks.join(""));
		expect(tapped.headers.get("content-type")).toBe("text/event-stream");

		const [entry] = getJevRequestLog();
		expect(entry.outgoing.preview).toBe(chunks.join(""));
		expect(entry.outgoing.status).toBe(200);
		expect(entry.outgoing.truncated).toBe(false);
		expect(entry.outgoing.bytes).toBe(chunks.join("").length);
	});

	it("tapJevResponse resolves async handler promises before tapping", async () => {
		const id = startJevTrace({ body: "req" });
		const tapped = tapJevResponse(Promise.resolve(new Response("stream-body", { status: 200 })), id);
		const response = await tapped;
		expect(await response.text()).toBe("stream-body");
		expect(getJevRequestLog()[0].outgoing.preview).toBe("stream-body");
	});

	it("tapJevResponse is a no-op without a trace id", () => {
		const response = new Response("ok");
		expect(tapJevResponse(response, null)).toBe(response);
	});
});
