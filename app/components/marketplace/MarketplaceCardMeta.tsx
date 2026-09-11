import { Pill } from "@core/shared-ui";
import { m } from "~/paraglide/messages";
import type { MarketplaceEntry } from "./marketplace-entry";

/**
 * Everything a browse card says about an entry other than its name and its
 * buttons — which, until this component existed, was nothing.
 *
 * The card is the only screen between "I have no content" and "I installed
 * something", so it has to answer one question: what am I about to put in my
 * workspace. Each line below is here because the response already carried it
 * and no pixel did:
 *
 *   description   the pack's own sentence (248 comments across these sections…)
 *   itemCount     how much arrives — the difference between two comment packs
 *   semver        which version, so an install can be talked about afterwards
 *   changelog     what changed in it, shown when there is no description
 *   downloadCount whether anyone else uses it
 *   featured      the catalogue's own recommendation, which sorts it first
 *
 * `jurisdiction` / `propertyType` / `inspectionKind` are the three browse axes
 * and ARE rendered, as pills: they are the only honest replacement for the
 * single `category` the old card tried to print, which is not a column any more
 * precisely because it could express only one of the three at a time.
 *
 * The install/update/uninstall buttons stay on the page — they own fetchers and
 * confirmations; this component is text.
 */
export function MarketplaceCardMeta({ entry }: { entry: MarketplaceEntry }) {
  // The release note is shown INSTEAD of the description, never as well: on a
  // three-across grid two paragraphs turn a card into a wall, and a pack that
  // has both is describing itself twice.
  const blurb = entry.description ?? entry.changelog;
  const axes = [entry.jurisdiction, entry.propertyType, entry.inspectionKind].filter(
    (v): v is string => v !== null,
  );
  // An item count of 0 is not "no items" for a 1:1 kind — one catalogue row
  // becomes one template, and `countLibrarySchemaItems` counts comment entries.
  // Printing "0 items" under a template would be false, so the count renders
  // only where it counted something.
  const items = entry.itemCount !== null && entry.itemCount > 0 ? entry.itemCount : null;

  return (
    <>
      {blurb && (
        <p className="text-[13px] text-ih-fg-3 mt-1 line-clamp-3">{blurb}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-ih-fg-3">
        {items !== null && <span>{m.marketplace_card_items({ count: items })}</span>}
        {entry.semver && <span>{m.marketplace_card_version({ semver: entry.semver })}</span>}
        {entry.downloadCount !== null && entry.downloadCount > 0 && (
          <span>{m.marketplace_card_installs({ count: entry.downloadCount })}</span>
        )}
      </div>
      {(entry.featured || axes.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {entry.featured && <Pill tone="primary">{m.marketplace_card_featured()}</Pill>}
          {axes.map((axis) => (
            <Pill key={axis} tone="gen">{axis}</Pill>
          ))}
        </div>
      )}
    </>
  );
}
