// @vitest-environment happy-dom
// A 503 from the PDF endpoints means the deployment has no PDF renderer (or it
// is down). It is not a rate limit, so the user must not be told to wait for a
// countdown and retry. 429 and the other failures keep the busy message.
import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePdfExport } from "./usePdfExport";
import { m } from "~/paraglide/messages";

function stubFetch(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success: false }), { status })),
  );
}

async function failWith(status: number) {
  stubFetch(status);
  const { result } = renderHook(() => usePdfExport());
  await act(async () => {
    await result.current.exportPdf("/api/inspections/i1/pdf");
  });
  return result.current;
}

describe("usePdfExport failure messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a 503 says the PDF service is unavailable and starts no retry countdown", async () => {
    const state = await failWith(503);
    expect(state.error).toBe(m.helper_pdf_unavailable());
    expect(state.error).not.toBe(m.helper_pdf_rate_limit());
    expect(state.cooldown).toBe(0);
  });

  it("control: a 429 still reads as busy and starts the countdown", async () => {
    const state = await failWith(429);
    expect(state.error).toBe(m.helper_pdf_rate_limit());
    expect(state.cooldown).toBeGreaterThan(0);
  });

  it("control: any other failure keeps the busy message", async () => {
    const state = await failWith(500);
    expect(state.error).toBe(m.helper_pdf_rate_limit());
  });
});
