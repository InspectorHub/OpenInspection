// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { useEditorLayout } from "./useBreakpoint";

/** A matchMedia that answers `max-width: Npx` queries from a mutable width and fires change events. */
function stubWidth(initial: number) {
  let width = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => {
    const limit = Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? "-1");
    return {
      get matches() {
        return width <= limit;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    };
  });
  return {
    resize(next: number) {
      width = next;
      act(() => listeners.forEach((fn) => fn()));
    },
    listenerCount: () => listeners.size,
  };
}

function Probe() {
  return <p data-testid="layout">{useEditorLayout()}</p>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useEditorLayout", () => {
  it.each([
    [375, "phone"],
    [767, "phone"],
    [768, "tablet"],
    [834, "tablet"],
    [1023, "tablet"],
    [1024, "desktop"],
    [1440, "desktop"],
  ] as const)("width %i is %s", (width, expected) => {
    stubWidth(width);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("layout").textContent).toBe(expected);
  });

  it("follows a change event across both breakpoints and stops listening on unmount", () => {
    const viewport = stubWidth(1100);
    const { getByTestId, unmount } = render(<Probe />);
    expect(getByTestId("layout").textContent).toBe("desktop");
    viewport.resize(834);
    expect(getByTestId("layout").textContent).toBe("tablet");
    viewport.resize(390);
    expect(getByTestId("layout").textContent).toBe("phone");
    viewport.resize(1024);
    expect(getByTestId("layout").textContent).toBe("desktop");
    unmount();
    expect(viewport.listenerCount()).toBe(0);
  });

  it("hydrates server markup at a phone width without a recoverable error, then settles on the phone layout", async () => {
    // The server has no viewport and always renders the desktop layout: render its markup with a desktop-width
    // stub, then put the browser at a phone width for hydration.
    stubWidth(1400);
    const html = renderToString(<Probe />);
    expect(html).toContain("desktop");
    stubWidth(390);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable = vi.fn();
    await act(async () => {
      hydrateRoot(container, <Probe />, { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.textContent).toBe("phone");
    container.remove();
  });
});
