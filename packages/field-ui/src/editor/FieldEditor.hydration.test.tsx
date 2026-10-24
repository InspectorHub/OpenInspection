// @vitest-environment happy-dom
/**
 * The first paint of the editor on a phone. The server cannot see the viewport, so before the host remembered the
 * layout band it always rendered the desktop tree; a phone hydrated that, then mounted the phone tree over it.
 * With `EditorData.initialLayout` the server render and the client's first render use the same band, so a phone
 * mounts one tree; matchMedia then corrects a wrong memory.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { FieldDataSourceProvider } from "../context";
import type { EditorData, FieldHostSlots } from "../data-source";
import { createFakeDataSource } from "../testing/fake-data-source";
import { DATA, fullResources, fullSlots, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const roots = (el: { querySelectorAll: Element["querySelectorAll"] }) => Array.from(el.querySelectorAll("[data-layout]")).map((n) => n.getAttribute("data-layout"));

function tree(data: EditorData, slots: FieldHostSlots = fullSlots()) {
  const fake = createFakeDataSource({ data, session: { collabEditing: true, tenantSlug: null }, resources: fullResources() });
  return (
    <FieldDataSourceProvider dataSource={fake} slots={slots}>
      <FieldEditor data={data} />
    </FieldDataSourceProvider>
  );
}

/** Server-render with one data set, then hydrate at `width` and report what the client did. */
async function serverThenHydrate(serverData: EditorData, clientData: EditorData, width: number, slots?: FieldHostSlots) {
  stubViewport(1400);
  const html = renderToString(tree(serverData));
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  stubViewport(width);
  const recoverable = vi.fn();
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  // Every tree that mounts is recorded, to tell one mount from a mount-then-swap.
  const mounted: Array<string | null> = [];
  const observer = new MutationObserver(() => {
    for (const r of roots(container)) if (mounted[mounted.length - 1] !== r) mounted.push(r);
  });
  observer.observe(container, { childList: true, subtree: true });
  await act(async () => {
    hydrateRoot(container, tree(clientData, slots), { onRecoverableError: recoverable });
  });
  observer.disconnect();
  const logged = errors.mock.calls.map((c) => String(c[0]));
  return { html, container, recoverable, logged, mounted };
}

describe("editor first paint with a remembered layout", () => {
  it("server-renders the remembered band instead of always the desktop tree", () => {
    stubViewport(1400);
    expect(roots(new DOMParser().parseFromString(renderToString(tree({ ...DATA, initialLayout: "phone" })), "text/html"))).toEqual(["phone"]);
    expect(roots(new DOMParser().parseFromString(renderToString(tree({ ...DATA, initialLayout: "tablet" })), "text/html"))).toEqual(["tablet"]);
    expect(roots(new DOMParser().parseFromString(renderToString(tree(DATA)), "text/html"))).toEqual(["desktop"]);
  });

  it("a phone with a phone memory hydrates the phone tree with no mismatch, and never mounts the desktop tree", async () => {
    const withPhone = { ...DATA, initialLayout: "phone" as const };
    const { html, container, recoverable, logged, mounted } = await serverThenHydrate(withPhone, withPhone, 390);
    expect(roots(new DOMParser().parseFromString(html, "text/html"))).toEqual(["phone"]);
    expect(recoverable).not.toHaveBeenCalled();
    expect(logged.filter((l) => /hydrat|did not match|mismatch/i.test(l))).toEqual([]);
    expect(roots(container)).toEqual(["phone"]);
    expect(mounted).not.toContain("desktop");
  });

  it("a desktop memory on a phone viewport still hydrates cleanly and is corrected to the phone tree after mount", async () => {
    const withDesktop = { ...DATA, initialLayout: "desktop" as const };
    const { recoverable, logged, container } = await serverThenHydrate(withDesktop, withDesktop, 390);
    expect(recoverable).not.toHaveBeenCalled();
    expect(logged.filter((l) => /hydrat|did not match|mismatch/i.test(l))).toEqual([]);
    expect(roots(container)).toEqual(["phone"]);
  });

  it("no memory (first visit) keeps today's behaviour: desktop on the server, phone after mount, no mismatch", async () => {
    const { recoverable, logged, container } = await serverThenHydrate(DATA, DATA, 390);
    expect(recoverable).not.toHaveBeenCalled();
    expect(logged.filter((l) => /hydrat|did not match|mismatch/i.test(l))).toEqual([]);
    expect(roots(container)).toEqual(["phone"]);
  });

  it("tells the host the band the browser shows once after mount, not on every render", async () => {
    const onLayoutObserved = vi.fn();
    const slots = { ...fullSlots(), onLayoutObserved };
    const withDesktop = { ...DATA, initialLayout: "desktop" as const };
    await serverThenHydrate(withDesktop, withDesktop, 390, slots);
    expect(onLayoutObserved.mock.calls).toEqual([["phone"]]);
  });
});
