// @vitest-environment happy-dom
/**
 * The poster of a video tile: an R2 clip is addressed by its media id through the host's `videoObject` address (the same one the
 * player uses) plus `/poster`; a Stream clip by its uid. A host with no object address (native) yields null, never a broken URL.
 */
import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { FieldDataSourceProvider } from "../context";
import { createEmptyEditorData, createFakeDataSource } from "../testing/fake-data-source";
import { usePhotoOps } from "./usePhotoOps";

function ctxFor(streamCustomerSubdomain: string | null) {
  const state = {
    inspection: { id: "insp1", coverPhotoId: null },
    sections: [], results: {}, currentSection: undefined,
    sectionIdForItem: () => null,
    setResults: vi.fn(), setDirty: vi.fn(),
  };
  const ctx = {
    state, findings: { getResult: () => ({}) }, streamCustomerSubdomain, collabDoc: null, activeUnitId: null,
    setPhotoStudioUrl: vi.fn(), setPhotoStudioKey: vi.fn(), setPhotoStudioIndex: vi.fn(),
    setPhotoStudioTotal: vi.fn(), setPhotoStudioOpen: vi.fn(),
  };
  return ctx as unknown as Parameters<typeof usePhotoOps>[0];
}

function poster(urls: Parameters<typeof createFakeDataSource>[0]["urls"], sub: string | null, video: Parameters<ReturnType<typeof usePhotoOps>["videoPosterUrl"]>[0]) {
  const ds = createFakeDataSource({ data: createEmptyEditorData(), urls });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(FieldDataSourceProvider, { dataSource: ds }, children);
  const { result } = renderHook(() => usePhotoOps(ctxFor(sub)), { wrapper });
  return result.current.videoPosterUrl(video);
}

describe("usePhotoOps videoPosterUrl", () => {
  const objectUrl = (inspectionId: string, ref: string) => `/api/inspections/${inspectionId}/media/video/r2-object/${ref}`;

  it("addresses an R2 clip's poster through the host's object address", () => {
    expect(poster({ videoObject: objectUrl }, null, { provider: "r2", mediaId: "pool-1" })).toBe(
      "/api/inspections/insp1/media/video/r2-object/pool-1/poster",
    );
  });

  it("is null for an R2 clip when the host has no object address (native)", () => {
    expect(poster({ videoObject: () => null }, null, { provider: "r2", mediaId: "pool-1" })).toBeNull();
  });

  it("still resolves a Stream clip by uid, and is null without a Stream subdomain", () => {
    expect(poster({ videoObject: objectUrl }, "customer-x", { provider: "stream", streamUid: "uid-1" })).toContain("customer-x.cloudflarestream.com/uid-1/");
    expect(poster({ videoObject: objectUrl }, null, { provider: "stream", streamUid: "uid-1" })).toBeNull();
  });
});
