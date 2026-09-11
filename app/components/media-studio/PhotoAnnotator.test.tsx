// @vitest-environment happy-dom
/**
 * N6 — a photo the studio cannot load rendered as a blank canvas.
 *
 * `PhotoAnnotator` set `img.crossOrigin`, `img.onload` and `img.src` and had no
 * `onerror` anywhere, so a URL that 403s, 404s or dies on the network simply
 * never resolved: `image` stayed null and the component fell through to the
 * "No photo selected" placeholder. That placeholder is a statement about the
 * INSPECTOR's action ("you have not picked a photo"), and it was being made
 * about a photo they had picked and the studio had failed to fetch.
 *
 * Same shape as the photo drawer (F57, `PhotoGallery.test.tsx`): the states are
 * separated, and the confident claim is only made on an answer that came back.
 * Here that is four states, not three, because the annotator can also be opened
 * with no photo at all:
 *
 *   no photoUrl        -> "No photo selected"   (a fact about the selection)
 *   photoUrl, in flight-> "Loading photo…"      (no claim yet)
 *   photoUrl, onerror  -> "could not be loaded" + retry
 *   photoUrl, onload   -> the canvas
 *
 * Both directions are pinned: a failure must show the error, and a success must
 * not. `react-konva` is swapped for the SSR stub the vite build already uses —
 * these tests are about which state the studio is in, not about canvas output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { PhotoAnnotator } from "./PhotoAnnotator";

vi.mock("react-konva", () => import("./react-konva.ssr-stub"));

/** Every `new window.Image()` the component builds, in construction order. */
interface FakeImage {
  crossOrigin: string;
  naturalWidth: number;
  naturalHeight: number;
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}
let images: FakeImage[] = [];
let realImage: typeof window.Image;

beforeEach(() => {
  images = [];
  realImage = window.Image;
  class StubImage {
    crossOrigin = "";
    naturalWidth = 800;
    naturalHeight = 600;
    src = "";
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      images.push(this as unknown as FakeImage);
    }
  }
  window.Image = StubImage as unknown as typeof window.Image;
});

afterEach(() => {
  window.Image = realImage;
});

const NOOP = () => {};

function open(photoUrl: string | null) {
  return render(
    <PhotoAnnotator open photoUrl={photoUrl} onSave={NOOP} onClose={NOOP} />,
  );
}

/** The studio requests the image inside an effect, so wait for the request. */
async function latestImage(): Promise<FakeImage> {
  await vi.waitFor(() => {
    expect(images.length).toBeGreaterThan(0);
  });
  return images[images.length - 1];
}

const SELECTION_CLAIM = /No photo selected/;
const FAILURE_CLAIM = /could not be loaded/i;
const LOADING_CLAIM = /Loading photo/i;

describe("PhotoAnnotator image load", () => {
  it("never claims no photo was selected while the photo is still loading", async () => {
    open("/p/a.jpg");
    await latestImage(); // requested, nothing came back yet

    expect(await screen.findByText(LOADING_CLAIM)).toBeTruthy();
    expect(screen.queryByText(SELECTION_CLAIM)).toBeNull();
    expect(screen.queryByText(FAILURE_CLAIM)).toBeNull();
  });

  it("says the photo failed, and offers a retry, instead of a blank canvas", async () => {
    open("/p/a.jpg");
    const img = await latestImage();

    await act(async () => {
      img.onerror?.();
    });

    expect(await screen.findByText(FAILURE_CLAIM)).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    // The whole point: a fetch that failed must not be reported as a fact about
    // what the inspector did or did not pick.
    expect(screen.queryByText(SELECTION_CLAIM)).toBeNull();
    expect(screen.queryByText(LOADING_CLAIM)).toBeNull();
  });

  it("shows none of the three text states once the photo loads", async () => {
    open("/p/a.jpg");
    const img = await latestImage();

    await act(async () => {
      img.onload?.();
    });

    await vi.waitFor(() => {
      expect(screen.queryByText(LOADING_CLAIM)).toBeNull();
    });
    expect(screen.queryByText(FAILURE_CLAIM)).toBeNull();
    expect(screen.queryByText(SELECTION_CLAIM)).toBeNull();
  });

  it("retry re-requests the photo, and clears the error when it loads", async () => {
    open("/p/a.jpg");
    const first = await latestImage();
    await act(async () => {
      first.onerror?.();
    });

    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    await vi.waitFor(() => {
      expect(images.length).toBeGreaterThan(1);
    });
    const second = images[images.length - 1];
    expect(second.src).toBe("/p/a.jpg");

    await act(async () => {
      second.onload?.();
    });

    await vi.waitFor(() => {
      expect(screen.queryByText(FAILURE_CLAIM)).toBeNull();
    });
    expect(screen.queryByText(LOADING_CLAIM)).toBeNull();
  });

  it("still says no photo is selected when there genuinely is none", async () => {
    open(null);

    expect(await screen.findByText(SELECTION_CLAIM)).toBeTruthy();
    expect(screen.queryByText(FAILURE_CLAIM)).toBeNull();
    expect(screen.queryByText(LOADING_CLAIM)).toBeNull();
    expect(images).toHaveLength(0);
  });
});
