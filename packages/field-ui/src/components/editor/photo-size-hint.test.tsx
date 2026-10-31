// @vitest-environment happy-dom
/** `urls.photo(inspectionId, key, size?)`: the callers say how big a picture they need; a host may ignore it. */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { FieldDataSourceProvider } from "../../context";
import type { PhotoSize } from "../../data-source";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { ReadOnlyItemView } from "./ReadOnlyItemView";
import { SideRail } from "./SideRail";

afterEach(cleanup);

type Call = { key: string; size: PhotoSize | undefined };

function mount(ui: ReactNode, photo: (inspectionId: string, key: string, size?: PhotoSize) => string) {
  const fake = createFakeDataSource({ data: createEmptyEditorData(), urls: { photo } });
  return render(<FieldDataSourceProvider dataSource={fake}>{ui}</FieldDataSourceProvider>);
}

const ITEM = { id: "i1", label: "Flashing", type: "rich" };

describe("the size hint reaches the data source", () => {
  it("the side rail preview shows a thumb and offers the original as the download", () => {
    const calls: Call[] = [];
    mount(<SideRail locale="en-US" mode="fill" initialOpen activeItem={ITEM} activeResult={{ photos: ["t/a.jpg"] }} inspectionId="i1" />, (_i, key, size) => {
      calls.push({ key, size });
      return `/p/${size ?? "none"}/${key}`;
    });
    expect(screen.getByRole("img").getAttribute("src")).toBe("/p/thumb/t/a.jpg");
    expect(document.querySelector("a[download]")?.getAttribute("href")).toContain("/p/original/t/a.jpg");
    expect(calls.every((c) => c.size === "thumb" || c.size === "original")).toBe(true);
  });

  it("the read-only item strip asks for thumbs", () => {
    const sizes: Array<PhotoSize | undefined> = [];
    mount(
      <ReadOnlyItemView item={{ id: "i1", label: "Flashing", type: "rich" } as never} sectionTitle="Roof" result={{ photos: [{ key: "t/a.jpg", mediaType: "photo" }] } as never} ratingLevels={[]} inspectionId="i1" coverKey={null} />,
      (_i, _k, size) => {
        sizes.push(size);
        return "/p/x";
      },
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((s) => s === "thumb")).toBe(true);
  });
});

describe("a host that ignores the hint", () => {
  it("still renders the same pictures (CONTROL)", () => {
    mount(<SideRail locale="en-US" mode="fill" initialOpen activeItem={ITEM} activeResult={{ photos: ["t/a.jpg"] }} inspectionId="i1" />, (i, key) => `/p/${i}/${key}`);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/p/i1/t/a.jpg");
  });
});
