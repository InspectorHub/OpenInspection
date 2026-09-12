import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import type { AddressSelection, PlaceSuggestion } from "~/routes/resources/places";
import { useAnchoredDropdown } from "~/hooks/useAnchoredDropdown";
import { m } from "~/paraglide/messages";

/**
 * What the suggestion list is not allowed to cover (F1).
 *
 * The host page marks the element the list must not land on — on the
 * new-inspection wizard that is the navigation footer carrying Next/Create. The
 * hook walks UP from the field and budgets the list against that element's top
 * edge, flipping above the field when nothing usable is left below. A host that
 * marks nothing keeps the plain viewport behaviour, so every other place this
 * input is mounted needs no change.
 *
 * A data attribute rather than a ref because the footer lives in `WizardLayout`,
 * several components away from the field — threading a ref through
 * PropertyStep would put the plumbing in files with no other reason to know.
 */
export const ADDRESS_DROPDOWN_OBSTACLE_ATTR = "data-address-dropdown-obstacle";
const OBSTACLE_SELECTOR = `[${ADDRESS_DROPDOWN_OBSTACLE_ATTR}]`;

/**
 * Address autocomplete input (Spec 5D B4, #198). Debounced suggestions from the
 * `/resources/places` BFF, keyboard-navigable listbox, and a per-typing-session
 * token so Google bills the whole autocomplete→details sequence once.
 *
 * Controlled: `value`/`onValueChange` own the free-text address (so a user can
 * still type a free-form address the API can't match and submit it). `onSelect`
 * fires only when a suggestion is resolved to a structured `AddressSelection`.
 *
 * Fail-soft: when GOOGLE_PLACES_API_KEY is unset the BFF returns no suggestions,
 * so the dropdown simply never opens and this behaves as a plain text input.
 */
export function AddressAutocomplete({
  value,
  onValueChange,
  onSelect,
  id = "property-address",
  placeholder,
}: {
  value: string;
  onValueChange: (v: string) => void;
  onSelect: (sel: AddressSelection) => void;
  id?: string;
  placeholder?: string;
}) {
  const suggestFetcher = useFetcher<{ suggestions: PlaceSuggestion[] }>();
  const detailsFetcher = useFetcher<{ address: AddressSelection | null }>();

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const sessionRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set the moment a suggestion is clicked; the details effect below consumes it
  // so onSelect fires exactly once per resolved place (not on every re-render).
  const pendingSelectRef = useRef(false);

  const suggestions = suggestFetcher.data?.suggestions ?? [];

  function ensureSession(): string {
    if (!sessionRef.current) sessionRef.current = crypto.randomUUID();
    return sessionRef.current;
  }

  function handleChange(next: string) {
    onValueChange(next);
    setActive(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (next.trim().length < 2) {
      setOpen(false);
      return;
    }
    const session = ensureSession();
    debounceRef.current = setTimeout(() => {
      suggestFetcher.load(
        `/resources/places?q=${encodeURIComponent(next.trim())}&session=${encodeURIComponent(session)}`,
      );
      setOpen(true);
    }, 250);
  }

  function choose(s: PlaceSuggestion) {
    onValueChange(s.description);
    setOpen(false);
    setActive(-1);
    pendingSelectRef.current = true;
    const session = ensureSession();
    detailsFetcher.load(
      `/resources/places?placeId=${encodeURIComponent(s.placeId)}&session=${encodeURIComponent(session)}`,
    );
  }

  // When the details load settles, emit the structured selection once and start
  // a fresh billing session for the next lookup.
  useEffect(() => {
    if (detailsFetcher.state !== "idle") return;
    if (!pendingSelectRef.current) return;
    const address = detailsFetcher.data?.address;
    if (address) {
      pendingSelectRef.current = false;
      sessionRef.current = ""; // terminate the Google session token
      onSelect(address);
    }
    // onSelect is a stable-enough callback from the caller; excluding it keeps
    // this from re-firing on unrelated parent renders (RR fetcher convention).
  }, [detailsFetcher.state, detailsFetcher.data]);

  // The dropdown is portaled to <body> as position:fixed so it floats above the
  // panel's overflow-y-auto box instead of being clipped by it. Placement (and
  // the flip-when-cramped rule) is shared with the template and contact
  // typeaheads — this measurement used to be a local copy here, and the two later
  // typeaheads were written without it and clipped.
  //
  // Escaping the clip box stopped the list being truncated and let it land ON
  // the controls underneath instead (F1): in the new-inspection wizard the list
  // covered the footer, so the inspector reaching for Next picked a suggestion
  // and silently replaced the address they had just chosen. The viewport had
  // room to spare, so only the obstacle's own top edge can say otherwise.
  const dropdownOpen = open && suggestions.length > 0;
  const { anchorRef: inputRef, style: dropdownStyle } = useAnchoredDropdown<HTMLInputElement>(
    dropdownOpen,
    { obstacleSelector: OBSTACLE_SELECTOR },
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  const listboxId = `${id}-listbox`;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => value.trim().length >= 2 && suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none"
      />
      {dropdownOpen && dropdownStyle && createPortal(
        <ul
          id={listboxId}
          role="listbox"
          style={dropdownStyle}
          className="z-50 overflow-y-auto rounded-md border border-ih-border bg-ih-bg-card shadow-ih-popover py-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={i === active}
              // onMouseDown (not onClick) so it fires before the input's onBlur —
              // this still holds across the portal, so the click resolves the
              // suggestion before the 120ms blur-close runs.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 cursor-pointer text-[13px] ${i === active ? "bg-ih-primary-tint text-ih-primary-text" : "text-ih-fg-2"}`}
            >
              <span className="font-medium">{s.mainText}</span>
              {s.secondaryText && <span className="text-ih-fg-4"> {s.secondaryText}</span>}
            </li>
          ))}
        </ul>,
        document.body,
      )}
      {detailsFetcher.state === "loading" && (
        <p className="mt-1 text-[11px] text-ih-fg-3">{m.common_loading()}</p>
      )}
    </div>
  );
}
