/**
 * One template item, as it goes on the wire.
 *
 * -- WHY THIS IS ITS OWN MODULE ---------------------------------------------
 * It is the mirror `lint:item-key-parity` reads, and it is the mirror that has
 * failed most quietly: the object is built key by key, so a key this function
 * does not name is a key the editor silently never saves. `number` spent its
 * whole life on the wrong side of that line — present on the authority type,
 * in the Zod base fields, in ITEM_KEYS and in the report projection, and
 * missing here.
 *
 * It lived inside `routes/template-edit.tsx` until the route hit its size cap.
 * Out here it is a pure function a spec can call directly, which is the shape
 * a thing that decides what reaches the database should have had anyway.
 *
 * NO React, NO DB.
 */
import type { CannedComment, TemplateItem } from "~/components/template/types";

/** An information/limitations canned comment in its v2 wire shape.
 *  (Defects carry extra fields and are serialized inline below.) */
function serializeCanned(c: CannedComment): Record<string, unknown> {
  return { id: c.id, title: c.title || "", comment: c.comment || "", default: !!c.default };
}

export function serializeItemForSave(it: TemplateItem): Record<string, unknown> {
  const base: Record<string, unknown> = { id: it.id, label: it.label, type: it.type };
  if (it.description) base.description = it.description;
  if (it.icon) base.icon = it.icon;
  if (it.number) base.number = it.number;
  // Present-and-null and absent mean different things: null un-nests an item
  // that was nested, absent leaves a flat template byte-identical.
  if (it.parentId !== undefined) base.parentId = it.parentId;
  if (typeof it.required === "boolean") base.required = it.required;
  if (typeof it.isSafety === "boolean") base.isSafety = it.isSafety;
  if (it.defaultRecommendation) base.defaultRecommendation = it.defaultRecommendation;
  if (it.attributes?.length) base.attributes = it.attributes;
  if (it.source?.platform) base.source = it.source;
  if (it.type === "rich") {
    base.ratingOptions = it.ratingOptions?.length ? it.ratingOptions : ["Inspected"];
    base.tabs = {
      information: (it.tabs?.information || []).map(serializeCanned),
      limitations: (it.tabs?.limitations || []).map(serializeCanned),
      defects: (it.tabs?.defects || []).map((c) => ({
        id: c.id, title: c.title || "", category: c.category || "recommendation",
        location: c.location || "", comment: c.comment || "",
        photos: Array.isArray(c.photos) ? c.photos : [], default: !!c.default,
      })),
    };
  } else if (it.type !== "boolean" && it.type !== "date" && it.options) {
    const o: Record<string, unknown> = {};
    if (it.options.choices?.length) o.choices = it.options.choices;
    if (it.options.min != null) o.min = it.options.min;
    if (it.options.max != null) o.max = it.options.max;
    if (it.options.placeholder) o.placeholder = it.options.placeholder;
    if (Object.keys(o).length) base.options = o;
  }
  return base;
}
