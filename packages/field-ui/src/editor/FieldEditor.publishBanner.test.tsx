// @vitest-environment happy-dom
/**
 * The editor's part in "a published report takes no edits":
 *
 *   - the host's publish-state banner is rendered (in every layout), with the editor's own publish entry;
 *   - when the live document is closed because the report was published elsewhere (`collab.locked`), the editor
 *     turns read-only and the banner is told.
 *
 * Every claim has a control on the same mount: the banner slot absent shows nothing, and an unlocked connection stays editable.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FieldDataSourceProvider } from "../context";
import { m } from "../i18n";
import { createFakeDataSource } from "../testing/fake-data-source";
import { stubCamera, stubViewport } from "./FieldEditor.capabilities.fixtures";
import { FieldEditor } from "./FieldEditor";
import { RATING_DATA } from "./FieldEditor.rating.fixtures";
import type { FieldHostSlots } from "../data-source";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

interface BannerCall { locked: boolean }

function mount(width: number, { locked = false, slots }: { locked?: boolean; slots?: FieldHostSlots } = {}) {
  stubViewport(width);
  stubCamera(true);
  const fake = createFakeDataSource({ data: RATING_DATA, session: { collabEditing: true, tenantSlug: null }, platform: "web" });
  const connect = fake.collab.connect.bind(fake.collab);
  // The connection the server closed with 4409 reports itself locked.
  fake.collab.connect = (id, opts) => Object.assign(connect(id, opts), { locked: () => locked });
  render(
    <FieldDataSourceProvider dataSource={fake} slots={{ humanCheck: "not-required", ...slots }}>
      <FieldEditor data={RATING_DATA} />
    </FieldDataSourceProvider>,
  );
}

describe.each<[number, string]>([[390, "phone"], [834, "tablet"], [1280, "desktop"]])("the publish banner slot (%i px, %s)", (width) => {
  it("is rendered with the editor's own publish entry, and opens the publish dialog", async () => {
    const calls: BannerCall[] = [];
    mount(width, {
      slots: {
        renderPublishBanner: ({ openPublish, locked }) => {
          calls.push({ locked });
          return <button data-testid="banner-publish" onClick={openPublish}>banner</button>;
        },
      },
    });
    await screen.findAllByText("Flashing condition");
    const button = await screen.findByTestId("banner-publish");
    expect(calls.at(-1)).toEqual({ locked: false });
    expect(screen.queryByText(m.editor_publish_title())).toBeNull();
    fireEvent.click(button);
    expect(await screen.findByText(m.editor_publish_title())).toBeTruthy();
  });

  it("(control) shows nothing when the host supplies none", async () => {
    mount(width);
    await screen.findAllByText("Flashing condition");
    expect(screen.queryByTestId("banner-publish")).toBeNull();
  });
});

describe("a report published from another tab or device", () => {
  const slots: FieldHostSlots = { renderPublishBanner: ({ locked }) => <div data-testid="banner">{locked ? "locked" : "open"}</div> };

  it("turns the editor read-only and tells the banner", async () => {
    mount(1280, { locked: true, slots });
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await waitFor(() => expect(screen.getByTestId("banner").textContent).toBe("locked"));
    // Read-only: the rating is not a control any more, and the structural controls are gone.
    await waitFor(() => expect(screen.queryByRole("radiogroup", { name: m.editor_rating_aria() })).toBeNull());
    expect(screen.queryByRole("button", { name: m.editor_shared_add_section() })).toBeNull();
  });

  it("(control) an unlocked connection stays editable and the banner is told so", async () => {
    mount(1280, { locked: false, slots });
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await waitFor(() => expect(screen.getByTestId("banner").textContent).toBe("open"));
    expect(screen.queryByRole("radiogroup", { name: m.editor_rating_aria() })).not.toBeNull();
    expect(screen.queryByRole("button", { name: m.editor_shared_add_section() })).not.toBeNull();
  });
});

describe("reopening a published report for editing (Edit and republish)", () => {
  const slots: FieldHostSlots = { renderPublishBanner: ({ locked }) => <div data-testid="banner">{locked ? "locked" : "open"}</div> };

  /** A data source whose connections are scripted: each `connect` call takes the next `locked` answer. */
  function scripted(answers: boolean[]) {
    const fake = createFakeDataSource({ data: RATING_DATA, session: { collabEditing: true, tenantSlug: null }, platform: "web" });
    const connect = fake.collab.connect.bind(fake.collab);
    let calls = 0;
    fake.collab.connect = (id, opts) => {
      const locked = answers[calls] ?? false;
      calls += 1;
      return Object.assign(connect(id, opts), { locked: () => locked });
    };
    return { fake, connects: () => calls };
  }

  const tree = (fake: ReturnType<typeof scripted>["fake"], readOnly: boolean) => (
    <FieldDataSourceProvider dataSource={fake} slots={{ humanCheck: "not-required", ...slots }}>
      <FieldEditor data={RATING_DATA} readOnly={readOnly} liveWhenReadOnly={false} />
    </FieldDataSourceProvider>
  );
  const ratingEditable = () => screen.queryByRole("radiogroup", { name: m.editor_rating_aria() }) !== null;

  it("a read-only page opens no socket, and turning editable opens a fresh one: editable, not locked", async () => {
    stubViewport(1280);
    stubCamera(true);
    const { fake, connects } = scripted([false]);
    const view = render(tree(fake, true));
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await waitFor(() => expect(screen.getByTestId("banner").textContent).toBe("open"));
    expect(connects()).toBe(0);
    expect(ratingEditable()).toBe(false);

    view.rerender(tree(fake, false));
    await waitFor(() => expect(connects()).toBe(1));
    await waitFor(() => expect(ratingEditable()).toBe(true));
    expect(screen.getByTestId("banner").textContent).toBe("open");
  });

  it("a lock seen while editable is cleared by the report going read-only and back (edit-again)", async () => {
    stubViewport(1280);
    stubCamera(true);
    // 1st connection: the server closed it with 4409 (published elsewhere). 2nd: the fresh one after edit-again.
    const { fake, connects } = scripted([true, false]);
    const view = render(tree(fake, false));
    fireEvent.click((await screen.findAllByText("Flashing condition"))[0]);
    await waitFor(() => expect(screen.getByTestId("banner").textContent).toBe("locked"));
    await waitFor(() => expect(ratingEditable()).toBe(false));

    // The loader revalidates: the report is published, so the page is read-only; then the inspector edits again.
    view.rerender(tree(fake, true));
    view.rerender(tree(fake, false));
    await waitFor(() => expect(connects()).toBe(2));
    await waitFor(() => expect(screen.getByTestId("banner").textContent).toBe("open"));
    await waitFor(() => expect(ratingEditable()).toBe(true));
  });

  it("(control) a host that keeps the live read-only view still connects, and still gets a fresh connection on the way back", async () => {
    stubViewport(1280);
    stubCamera(true);
    const { fake, connects } = scripted([false, false]);
    const live = (readOnly: boolean) => (
      <FieldDataSourceProvider dataSource={fake} slots={{ humanCheck: "not-required", ...slots }}>
        <FieldEditor data={RATING_DATA} readOnly={readOnly} />
      </FieldDataSourceProvider>
    );
    const view = render(live(true));
    await screen.findAllByText("Flashing condition");
    await waitFor(() => expect(connects()).toBe(1));
    view.rerender(live(false));
    await waitFor(() => expect(connects()).toBe(2));
  });
});
