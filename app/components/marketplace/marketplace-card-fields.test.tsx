/**
 * @vitest-environment happy-dom
 *
 * F39 — the browse card and the browse API have to agree about the row.
 *
 * A single `raw as unknown as { … description?; category?; author? }` asserted
 * three fields the response has never carried, so the card's branches for them
 * could not fire, and the six fields the response DOES carry — item count,
 * version, release note, download count, featured, and the three browse axes —
 * were read by nothing. Seventeen catalogue entries rendered as a bare name, and
 * `Starter Comment Pack` could not be told apart from
 * `Standard Residential Comments` before installing it.
 *
 * The fixture below is the row SHAPE `browseCatalogue` returns — no
 * `description` column, no `category`, no `author`, an `authorId` instead. The
 * discriminating assertions are the ones for `itemCount` and `semver`: before
 * the fix the card read neither, so a test that only checked the name passed all
 * along. The `category`/`author` assertions are the other direction — they must
 * NOT appear, because they were never real.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarketplaceCardMeta } from "./MarketplaceCardMeta";
import { narrowEntry } from "./marketplace-entry";

/** One row as `GET /api/templates/marketplace` actually answers it. */
const API_ROW = {
    id: "lib-1",
    name: "Standard Residential Comments",
    kind: "comments",
    semver: "1.0.0",
    authorId: "system",
    changelog: "Initial trial-onboarding starter library.",
    downloadCount: 42,
    featured: true,
    propertyType: null,
    jurisdiction: "TX",
    inspectionKind: null,
    createdAt: 1,
    updatedAt: 1,
    delistedAt: null,
    importedSemver: null,
    hasUpdate: false,
    itemCount: 248,
    description: "248 pre-written inspection comments spanning Electrical, Roof.",
};

describe("the browse card reads the fields the API sends", () => {
    it("renders the item count, the version and the pack's own description", () => {
        render(<MarketplaceCardMeta entry={narrowEntry(API_ROW)} />);
        expect(screen.getByText(/248 pre-written inspection comments/)).toBeInTheDocument();
        expect(screen.getByText("248 items")).toBeInTheDocument();
        expect(screen.getByText("Version 1.0.0")).toBeInTheDocument();
        expect(screen.getByText("42 installs")).toBeInTheDocument();
        expect(screen.getByText("Featured")).toBeInTheDocument();
        expect(screen.getByText("TX")).toBeInTheDocument();
    });

    it("falls back to the release note when the pack carries no description", () => {
        render(<MarketplaceCardMeta entry={narrowEntry({ ...API_ROW, description: null })} />);
        expect(screen.getByText(/Initial trial-onboarding starter library/)).toBeInTheDocument();
    });

    it("prints no item count for a 1:1 kind, where the counter counts nothing", () => {
        // "0 items" under a template would be false: one catalogue row becomes
        // one template, and the counter counts comment entries.
        render(<MarketplaceCardMeta entry={narrowEntry({ ...API_ROW, kind: "templates", itemCount: 0 })} />);
        expect(screen.queryByText(/items$/)).toBeNull();
    });

    it("narrows an ABSENT field to null instead of asserting it into existence", () => {
        // The old cast's failure mode, as a unit: a row with no `description`,
        // `category` or `author` must not claim to have them.
        const entry = narrowEntry({ id: "x", name: "Bare", kind: "templates" });
        expect(entry.description).toBeNull();
        expect(entry.changelog).toBeNull();
        expect(entry.itemCount).toBeNull();
        expect(entry.featured).toBe(false);
        expect("category" in entry).toBe(false);
        expect("author" in entry).toBe(false);
    });
});
