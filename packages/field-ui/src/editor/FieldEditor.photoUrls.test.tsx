// @vitest-environment happy-dom
/**
 * `FieldUrls.photo` is synchronous, but a host may only be able to produce a photo's address later (a download that
 * finishes, a signed address that is renewed). `FieldUrls.subscribe` lets it say "an address may have changed": the editor
 * asks `photo()` again and the thumbnails show the new one. Without `subscribe` nothing is asked again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../context";
import type { FieldUrls } from "../data-source";
import { createEmptyEditorData, createFakeDataSource } from "../testing/fake-data-source";
import { RATING_DATA } from "./FieldEditor.rating.fixtures";
import { stubCamera, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

const DATA = createEmptyEditorData({ ...RATING_DATA, results: { "_default:s1:i1": { photos: [{ key: "t/insp-1/a.jpg" }] } } as typeof RATING_DATA.results });

function host(withSubscribe: boolean) {
  let current = "blob:first";
  const listeners = new Set<() => void>();
  const urls: Partial<FieldUrls> = {
    photo: () => current,
    ...(withSubscribe ? { subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; } } : {}),
  };
  const fake = createFakeDataSource({ data: DATA, urls });
  stubViewport(1280);
  stubCamera(true);
  const ui = render(
    <FieldDataSourceProvider dataSource={fake} slots={{ humanCheck: "not-required" }}>
      <FieldEditor data={DATA} />
    </FieldDataSourceProvider>,
  );
  return {
    ui,
    listeners,
    change: (next: string) => { current = next; },
    notify: () => act(() => { for (const l of [...listeners]) l(); }),
  };
}

async function thumbSrc() {
  const thumb = await screen.findByTestId("thumb-0");
  return (thumb.querySelector("img") as HTMLImageElement).getAttribute("src");
}

describe("photo addresses that change after the first render", () => {
  it("shows the new address once the host says it changed", async () => {
    const h = host(true);
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    expect(await thumbSrc()).toBe("blob:first");
    h.change("blob:second");
    h.notify();
    expect(await thumbSrc()).toBe("blob:second");
  });

  it("the viewer opens on the new address too", async () => {
    const h = host(true);
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await thumbSrc();
    h.change("blob:second");
    h.notify();
    fireEvent.click(await screen.findByTestId("thumb-0"));
    await waitFor(() => expect(document.querySelector(".yarl__slide img")).not.toBeNull());
    expect((document.querySelector(".yarl__slide img") as HTMLImageElement).getAttribute("src")).toBe("blob:second");
  });

  it("stops listening when the editor goes away", async () => {
    const h = host(true);
    await screen.findAllByText("Flashing condition");
    expect(h.listeners.size).toBeGreaterThan(0);
    h.ui.unmount();
    expect(h.listeners.size).toBe(0);
  });

  it("CONTROL - a host without subscribe: nothing is asked again, the thumbnail is left alone", async () => {
    const h = host(false);
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    expect(await thumbSrc()).toBe("blob:first");
    h.change("blob:second");
    expect(h.listeners.size).toBe(0);
    expect(await thumbSrc()).toBe("blob:first");
  });
});
