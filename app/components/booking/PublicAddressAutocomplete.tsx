import { useEffect, useRef, useState } from "react";
import { m } from "~/paraglide/messages";

/** One suggestion from `GET /api/public/geocode`. */
export interface PublicAddressSuggestion {
  label: string;
  line1: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  placeId: string;
}

/**
 * Address autocomplete for the UNAUTHENTICATED booking page.
 *
 * `/api/public/geocode` has existed, public and rate-limited, returning a ZIP
 * and a placeId per suggestion, for as long as the booking page has — and the
 * page never called it. Every booking arrived as free text, which is why the
 * ZIP-based service-area filter had nothing to filter on and `closest` routing
 * had no property to measure to. This component is the missing call.
 *
 * It is deliberately NOT the dashboard's `AddressAutocomplete`: that one goes
 * through the `/resources/places` BFF, which requires a session token and
 * returns `{ suggestions: [] }` to a signed-out visitor — silently, so it
 * would have looked like "Places is not configured" rather than "this endpoint
 * is not for you".
 *
 * Fail-soft: with no API key configured the endpoint returns an empty list, the
 * dropdown never opens, and this behaves as the plain text input it replaces.
 * The booking still submits; it simply carries no ZIP, which the server
 * reports rather than treating as a filter that passed.
 */
export function PublicAddressAutocomplete({
  value,
  onValueChange,
  onSelect,
  id = "booking-address",
  placeholder,
  autoFocus,
}: {
  value: string;
  onValueChange: (v: string) => void;
  /** Fires when the visitor picks a suggestion. Null clears a prior pick. */
  onSelect: (sel: PublicAddressSuggestion | null) => void;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [suggestions, setSuggestions] = useState<PublicAddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a slow earlier response overwriting a newer one.
  const seqRef = useRef(0);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  function handleChange(next: string) {
    onValueChange(next);
    // Editing after a pick invalidates it: the stored ZIP and placeId belong
    // to the address that was chosen, not to whatever is in the box now.
    onSelect(null);
    setActive(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (next.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const seq = ++seqRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/public/geocode?q=${encodeURIComponent(next.trim())}`);
        if (!res.ok) return;
        const body = (await res.json()) as { data?: PublicAddressSuggestion[] };
        if (seq !== seqRef.current) return;
        setSuggestions(body.data ?? []);
        setOpen((body.data ?? []).length > 0);
      } catch {
        // Offline or blocked: the field stays usable as free text.
      }
    }, 250);
  }

  function choose(s: PublicAddressSuggestion) {
    onValueChange(s.label);
    onSelect(s);
    setOpen(false);
    setActive(-1);
  }

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
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="street-address"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-ih-border bg-ih-bg-card shadow-ih-popover py-1"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={i === active}
              // onMouseDown so the pick lands before the input's blur closes us.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 cursor-pointer text-[13px] ${i === active ? "bg-ih-primary-tint text-ih-primary-text" : "text-ih-fg-2"}`}
            >
              <span className="font-medium">{s.line1}</span>
              {s.city && (
                <span className="text-ih-fg-4">
                  {" "}
                  {s.city}
                  {s.state ? `, ${s.state}` : ""}
                  {s.zip ? ` ${s.zip}` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[11px] text-ih-fg-3">{m.booking_field_address_hint()}</p>
    </div>
  );
}
