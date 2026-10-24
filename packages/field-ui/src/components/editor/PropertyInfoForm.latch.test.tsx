// @vitest-environment happy-dom
// Property-facts autofill is a billed public-records lookup: two clicks dispatched in ONE act()
// reach the data source once. The pending button only goes inert after a render, too late for the
// second click.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";
import { FieldDataSourceProvider } from "../../context";
import { createEmptyEditorData, createFakeDataSource } from "../../testing/fake-data-source";
import { PropertyInfoForm } from "./PropertyInfoForm";

afterEach(cleanup);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

function mount() {
  const fake = createFakeDataSource({ data: createEmptyEditorData() });
  fake.respondWith("autofill-property-facts", { facts: null, reason: "NO_API_KEY" });
  const inspection = { id: "insp-1", propertyType: "single_family", propertyAddress: "123 Main St, Austin, TX 78701" };
  render(
    <FieldDataSourceProvider dataSource={fake}>
      <PropertyInfoForm inspection={inspection} />
    </FieldDataSourceProvider>,
  );
  return fake;
}

describe("PropertyInfoForm autofill latch", () => {
  it("looks the address up ONCE for two same-frame clicks", async () => {
    const fake = mount();
    const btn = screen.getByRole("button", { name: /fetch property details/i });
    act(() => { btn.click(); btn.click(); });
    await settle();
    expect(fake.commands.filter((c) => c.cmd.type === "autofill-property-facts")).toHaveLength(1);
  });

  it("CONTROL - a later click goes through after the first settles", async () => {
    const fake = mount();
    const btn = screen.getByRole("button", { name: /fetch property details/i });
    act(() => { btn.click(); });
    await settle();
    act(() => { btn.click(); });
    await settle();
    expect(fake.commands.filter((c) => c.cmd.type === "autofill-property-facts")).toHaveLength(2);
  });
});
