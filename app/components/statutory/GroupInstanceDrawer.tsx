import { useState } from "react";
import { Button, Drawer, Input, Banner } from "@core/shared-ui";
import type { EditorGroup } from "~/lib/editor/statutory-groups";
import { m } from "~/paraglide/messages";

/**
 * Recording one instance of a repeated block the authority's page cannot print.
 *
 * -- WHY A DRAWER AND NOT A ROW IN THE LIST ----------------------------------
 * A printed slot is a run of ordinary template items and it renders as one. An
 * instance past capacity has no items at all -- there is nothing on the page for
 * an item to correspond to -- so there is nothing for the list to show. Its
 * fields come from the group's own declaration, and a drawer is where a short
 * declared set of fields already lives in this product.
 *
 * -- IT SAYS WHERE THE VALUE GOES, BEFORE ANYTHING IS TYPED ------------------
 * The one thing an inspector must not discover late is that this panel has no
 * box on the form. He learns it as he adds it, with the destination named, so
 * the choice to write it here or in the narrative report is his and is made
 * while he is still standing at the panel.
 *
 * -- EMPTY IS NOT AN ANSWER --------------------------------------------------
 * A field left blank is omitted rather than sent as "". On a statutory form an
 * empty box reads as an inspector who did not answer, and storing an empty
 * string would make that indistinguishable from one who did and said nothing.
 */
export interface GroupInstanceDrawerProps {
    open: boolean;
    group: EditorGroup;
    /** 0-based position. At or past `group.capacity` -- printed slots are items. */
    index: number;
    onClose: () => void;
    /** Called with only the fields that were filled in. */
    onSave: (fields: Record<string, string>) => void;
    saving?: boolean;
}

/** `total_amps` -> `Total amps`. The declaration is our vocabulary, not a label. */
function humanise(field: string): string {
    const spaced = field.replace(/_/g, " ");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function GroupInstanceDrawer({
    open, group, index, onClose, onSave, saving = false,
}: GroupInstanceDrawerProps) {
    const [values, setValues] = useState<Record<string, string>>({});

    // Every field this group declares, taken from the printed slots -- they all
    // carry the same field set, which is what makes them one group.
    const fields = Array.from(new Set(group.slots.flatMap((slot) => Object.keys(slot.fields))));

    const submit = () => {
        const filled: Record<string, string> = {};
        for (const [field, value] of Object.entries(values)) {
            if (value.trim() !== "") filled[field] = value.trim();
        }
        onSave(filled);
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            title={`${group.label} ${index + 1}`}
            footer={(
                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>
                        {m.statutory_group_instance_cancel()}
                    </Button>
                    <Button onClick={submit} disabled={saving}>
                        {m.statutory_group_instance_save()}
                    </Button>
                </div>
            )}
        >
            <Banner tone="warn">
                {/* One child, stacked inside it. Banner's own layout classes beat
                    anything passed as className, so two sibling spans run
                    together on one line -- "…one more.It will be written…" --
                    and no gate sees a missing space. */}
                <div className="flex flex-col gap-1">
                    <span>
                        {m.statutory_group_instance_no_slot({
                            count: String(group.capacity),
                            group: group.label,
                        })}
                    </span>
                    {group.overflowTo ? (
                        <span className="text-xs">
                            {m.statutory_group_instance_goes_to({
                                destination: humanise(group.overflowTo),
                            })}
                        </span>
                    ) : null}
                </div>
            </Banner>

            <div className="mt-4 flex flex-col gap-3">
                {fields.map((field) => (
                    <Input
                        key={field}
                        // `Input` associates its label with `htmlFor={props.id}`,
                        // so a field without an id gets a label pointing at
                        // nothing -- silently, and only a screen reader notices.
                        id={`${group.id}-${index}-${field}`}
                        label={humanise(field)}
                        value={values[field] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
                    />
                ))}
            </div>
        </Drawer>
    );
}
