import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFetcher } from "react-router";
import type { AddressSelection, PlaceSuggestion } from "~/routes/resources/places";
import { m } from "~/paraglide/messages";

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
  // Dropdown is portaled to <body> as position:fixed so it floats above the
  // modal's overflow-y-auto box instead of extending it (which grew a scrollbar).
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
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

  // Position the portaled dropdown against the input. Re-measure on scroll
  // (capture:true so we also catch the modal's own scroll container, not just
  // window) and on resize. pos stays null until measured, so SSR renders no
  // portal (never touches document).
  const dropdownOpen = open && suggestions.length > 0;
  useEffect(() => {
    if (!dropdownOpen) { setPos(null); return; }
    const measure = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [dropdownOpen]);

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
      {dropdownOpen && pos && createPortal(
        <ul
          id={listboxId}
          role="listbox"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 max-h-64 overflow-y-auto rounded-md border border-ih-border bg-ih-bg-card shadow-ih-popover py-1"
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
              className={`px-3 py-2 cursor-pointer text-[13px] ${i === active ? "bg-ih-primary-tint text-ih-primary" : "text-ih-fg-2"}`}
            >
              <span className="font-medium">{s.mainText}</span>
              {s.secondaryText && <span className="text-ih-fg-4"> {s.secondaryText}</span>}
            </li>
          ))}
        </ul>,
        document.body,
      )}
      {detailsFetcher.state === "loading" && (
        <p className="mt-1 text-[11px] text-ih-fg-4">{m.common_loading()}</p>
      )}
    </div>
  );
}
