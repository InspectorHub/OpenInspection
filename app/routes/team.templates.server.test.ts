/**
 * The Team page's relay for permission-template writes: what reaches the API,
 * and that the server's own sentence on a refusal reaches the person.
 */
import { describe, it, expect, vi } from "vitest";
import { permissionTemplateIntent } from "./team.templates.server";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

function fakeApi(response: Response) {
  const post = vi.fn().mockResolvedValue(response);
  const put = vi.fn().mockResolvedValue(response);
  const del = vi.fn().mockResolvedValue(response);
  const api = { team: { "permission-templates": { $post: post, ":id": { $put: put, $delete: del } } } };
  return { api: api as unknown as Parameters<typeof permissionTemplateIntent>[0], post, put, del };
}

const ok = () => new Response("{}", { status: 201 });

describe("permissionTemplateIntent", () => {
  it("ignores an intent that is not a template write", async () => {
    const { api, post } = fakeApi(ok());
    expect(await permissionTemplateIntent(api, "invite", fd({}))).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("create sends the name, the base role and the parsed switches", async () => {
    const { api, post } = fakeApi(ok());
    const res = await permissionTemplateIntent(api, "create-template", fd({ name: " Helper ", baseRole: "inspector", overrides: '{"publish":false}' }));
    expect(res).toEqual({ ok: true, intent: "create-template", error: null, url: null });
    expect(post).toHaveBeenCalledWith({ json: { name: "Helper", baseRole: "inspector", overrides: { publish: false } } });
  });

  it("unreadable switches are dropped, so the role's defaults are saved rather than anything wider", async () => {
    const { api, post } = fakeApi(ok());
    await permissionTemplateIntent(api, "create-template", fd({ name: "X", baseRole: "staff", overrides: "{not json" }));
    expect(post).toHaveBeenCalledWith({ json: { name: "X", baseRole: "staff", overrides: {} } });
  });

  it("a nameless template never reaches the API", async () => {
    const { api, post } = fakeApi(ok());
    const res = await permissionTemplateIntent(api, "create-template", fd({ name: "  ", baseRole: "staff" }));
    expect(res?.ok).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it("relays the server's sentence when it refuses", async () => {
    const refusal = new Response(JSON.stringify({ error: { code: "CONFLICT", message: "A permission template with this name already exists." } }), { status: 409 });
    const { api } = fakeApi(refusal);
    const res = await permissionTemplateIntent(api, "create-template", fd({ name: "Dup", baseRole: "staff" }));
    expect(res).toEqual({ ok: false, intent: "create-template", error: "A permission template with this name already exists.", url: null });
  });

  it("rename replaces the whole template, so the role and switches travel with the new name", async () => {
    const { api, put } = fakeApi(new Response("{}", { status: 200 }));
    await permissionTemplateIntent(api, "rename-template", fd({ id: "t1", name: "New", baseRole: "inspector", overrides: '{"publish":false}' }));
    expect(put).toHaveBeenCalledWith({ param: { id: "t1" }, json: { name: "New", baseRole: "inspector", overrides: { publish: false } } });
  });

  it("archive names the template id", async () => {
    const { api, del } = fakeApi(new Response("{}", { status: 200 }));
    expect((await permissionTemplateIntent(api, "archive-template", fd({ id: "t1" })))?.ok).toBe(true);
    expect(del).toHaveBeenCalledWith({ param: { id: "t1" } });
  });
});
