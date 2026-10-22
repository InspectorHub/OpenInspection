// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/session.server", () => ({ requireToken: vi.fn() }));
vi.mock("~/lib/api-client.server", () => ({ createApi: vi.fn() }));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { action as pageAction } from "../inspection-edit/action.server";
import { action as commandAction } from "./inspection-editor-command";

describe("inspection-editor-command resource route", () => {
    it("exposes the same function as the editor page action", () => {
        expect(commandAction).toBe(pageAction);
    });

    it("is registered under a path with an id param", () => {
        const routes = readFileSync(resolve(__dirname, "../../routes.ts"), "utf8");
        expect(routes).toContain('route("resources/inspection-editor-command/:id", "routes/resources/inspection-editor-command.ts")');
    });
});
