// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { useEditorLayout, type EditorLayout } from "./useBreakpoint";

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

  describe("initialLayout (the host's remembered band)", () => {
    function Seeded({ initial, onObserved }: { initial?: EditorLayout; onObserved?: (l: EditorLayout) => void }) {
      return <p data-testid="layout">{useEditorLayout(initial, onObserved)}</p>;
    }
    const hydrate = async (container: HTMLElement, node: React.ReactElement) => {
      const recoverable = vi.fn();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => {
        hydrateRoot(container, node, { onRecoverableError: recoverable });
      });
      const logged = errors.mock.calls.map((c) => String(c[0]));
      errors.mockRestore();
      return { recoverable, logged };
    };

    it("is the server snapshot: the server render shows the remembered band, and 'desktop' without one", () => {
      stubWidth(1400);
      expect(renderToString(<Seeded initial="phone" />)).toContain("phone");
      expect(renderToString(<Seeded initial="tablet" />)).toContain("tablet");
      expect(renderToString(<Seeded />)).toContain("desktop");
    });

    it("a phone with a phone memory hydrates in one pass: no mismatch, and the first client render is the phone band", async () => {
      stubWidth(1400);
      const html = renderToString(<Seeded initial="phone" />);
      stubWidth(390);
      const container = document.createElement("div");
      container.innerHTML = html;
      document.body.appendChild(container);
      const seen: string[] = [];
      function Spy() {
        const l = useEditorLayout("phone");
        seen.push(l);
        return <p data-testid="layout">{l}</p>;
      }
      const { recoverable, logged } = await hydrate(container, <Spy />);
      expect(recoverable).not.toHaveBeenCalled();
      expect(logged.filter((l) => /hydrat/i.test(l))).toEqual([]);
      expect(seen[0]).toBe("phone");
      expect(new Set(seen)).toEqual(new Set(["phone"]));
      container.remove();
    });

    it("a wrong memory (desktop cookie, phone viewport) hydrates without a mismatch and is corrected after mount", async () => {
      stubWidth(1400);
      const html = renderToString(<Seeded initial="desktop" />);
      stubWidth(390);
      const container = document.createElement("div");
      container.innerHTML = html;
      document.body.appendChild(container);
      const observed = vi.fn();
      const { recoverable, logged } = await hydrate(container, <Seeded initial="desktop" onObserved={observed} />);
      expect(recoverable).not.toHaveBeenCalled();
      expect(logged.filter((l) => /hydrat/i.test(l))).toEqual([]);
      expect(container.textContent).toBe("phone");
      // Hydration renders twice (the remembered band, then the real one); the host is told once, with the real one.
      expect(observed.mock.calls).toEqual([["phone"]]);
      container.remove();
    });

    it("tells the observer the band the browser really shows, once after mount, never the remembered one", () => {
      stubWidth(390);
      const observed = vi.fn();
      render(<Seeded initial="desktop" onObserved={observed} />);
      expect(observed.mock.calls).toEqual([["phone"]]);
    });

    it("does not tell the observer again on re-renders, only when the band changes", () => {
      const viewport = stubWidth(1100);
      const observed = vi.fn();
      const { rerender } = render(<Seeded initial="desktop" onObserved={observed} />);
      expect(observed.mock.calls).toEqual([["desktop"]]);
      rerender(<Seeded initial="desktop" onObserved={observed} />);
      rerender(<Seeded initial="desktop" onObserved={observed} />);
      expect(observed).toHaveBeenCalledTimes(1);
      viewport.resize(390);
      expect(observed.mock.calls).toEqual([["desktop"], ["phone"]]);
      viewport.resize(500);
      expect(observed).toHaveBeenCalledTimes(2);
    });

    it("never calls the observer while rendering on the server", () => {
      stubWidth(390);
      const observed = vi.fn();
      renderToString(<Seeded initial="phone" onObserved={observed} />);
      expect(observed).not.toHaveBeenCalled();
    });
  });
});
