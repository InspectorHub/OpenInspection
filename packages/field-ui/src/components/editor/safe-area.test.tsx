// @vitest-environment happy-dom
/**
 * A native shell with a notch or rounded corners reports left and right insets in landscape. The fixed and edge-hugging
 * shells keep their content clear of them; with the insets at 0 the `max()` forms resolve to the old padding.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { TabletTree } from "../../editor/TabletTree";
import { MobileBottomDrawer } from "../MobileBottomDrawer";
import { AppBar } from "./AppBar";
import { FooterBar } from "./FooterBar";
import { MobileDrawerTriggers } from "./MobileDrawerTriggers";

afterEach(cleanup);

const withDs = (ui: React.ReactNode) => (
  <FieldDataSourceProvider dataSource={createFakeDataSource({ data: createEmptyEditorData() })}>{ui}</FieldDataSourceProvider>
);
const has = (el: Element | null, ...classes: string[]) => expect((el as HTMLElement).className.split(/\s+/)).toEqual(expect.arrayContaining(classes));

describe("left and right safe-area insets", () => {
  it("the footer bar", () => {
    const { container } = render(withDs(<FooterBar status="connected" />));
    has(container.firstElementChild, "pl-[max(1rem,env(safe-area-inset-left))]", "pr-[max(1rem,env(safe-area-inset-right))]");
  });

  it("the bottom drawer sheet", () => {
    render(<MobileBottomDrawer open onClose={vi.fn()} title="Sheet"><div /></MobileBottomDrawer>);
    has(screen.getByRole("dialog"), "pl-[env(safe-area-inset-left)]", "pr-[env(safe-area-inset-right)]");
  });

  it("the phone and tablet app bar", () => {
    render(<AppBar platform="android" sectionTitle="s" itemLabel="i" onBack={vi.fn()} onMore={vi.fn()} tablet />);
    has(screen.getByRole("banner"), "pl-[max(0.5rem,env(safe-area-inset-left))]", "pr-[max(0.5rem,env(safe-area-inset-right))]");
  });

  it("the phone bottom tabs", () => {
    render(<MobileDrawerTriggers onOpen={vi.fn()} showTheme={false} />);
    has(screen.getByRole("navigation"), "pl-[env(safe-area-inset-left)]", "pr-[env(safe-area-inset-right)]");
  });

  it("the tablet list pane and editor pane", () => {
    render(<TabletTree appBar={<div />} listHeader={<div />} sectionTitle="s" list={<div />} main={<div />} emptyTemplate={null} tools={null} batchBar={null} footer={null} collabSynced />);
    has(screen.getByTestId("tablet-list-pane"), "pl-[env(safe-area-inset-left)]");
    has(screen.getByTestId("tablet-editor-pane"), "pr-[max(1.25rem,env(safe-area-inset-right))]");
  });
});
