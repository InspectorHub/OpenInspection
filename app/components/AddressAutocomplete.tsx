import { useState, useRef, useCallback, useEffect } from "react";

interface Suggestion {
  placeId: string;
  label: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface AddressAutocompleteProps {
  name?: string;
  placeholder?: string;
  required?: boolean;
  initial?: string;
  apiEndpoint?: string;
  onSelect?: (suggestion: Suggestion) => void;
  onChange?: (value: string) => void;
}

export function AddressAutocomplete({
  name = "address",
  placeholder = "Start typing the property address",
  required = true,
  initial = "",
  apiEndpoint = "/api/public/geocode",
  onSelect,
  onChange,
}: AddressAutocompleteProps) {
  const [value, setValue] = useState(initial);
  const [results, setResults] = useState<Suggestion[]>([]);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [selected, setSelected] = useState<Suggestion | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (query: string) => {
    if (query.length < 3) {
      setResults([]);
      return;
    }
    try {
      const res = await fetch(`${apiEndpoint}?q=${encodeURIComponent(query)}`, { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { data: Suggestion[] };
        setResults(data.data || []);
        setFocusIdx(-1);
      }
    } catch {
      setResults([]);
    }
  }, [apiEndpoint]);

  function handleInput(newValue: string) {
    setValue(newValue);
    setSelected(null);
    onChange?.(newValue);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(newValue), 250);
  }

  function handleSelect(suggestion: Suggestion) {
    setValue(suggestion.label);
    setSelected(suggestion);
    setResults([]);
    onSelect?.(suggestion);
  }

  function moveFocus(dir: number) {
    setFocusIdx((prev) => Math.max(-1, Math.min(results.length - 1, prev + dir)));
  }

  function selectFocused() {
    if (focusIdx >= 0 && focusIdx < results.length) {
      handleSelect(results[focusIdx]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
    else if (e.key === "Enter") { e.preventDefault(); selectFocused(); }
    else if (e.key === "Escape") { setResults([]); }
  }

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <div className="relative">
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">Site address</span>
        <input
          ref={inputRef}
          type="text"
          name={name}
          value={value}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (value && results.length === 0) search(value); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls="address-listbox"
          aria-expanded={results.length > 0}
          className="mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[14px] font-medium text-ih-fg-1 transition-colors"
        />
      </label>

      {results.length > 0 && (
        <ul id="address-listbox" role="listbox" className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto rounded-md bg-ih-bg-card border border-ih-border shadow-ih-popover">
          {results.map((r, idx) => (
            <li
              key={`${r.placeId}-${idx}`}
              role="option"
              aria-selected={idx === focusIdx}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setFocusIdx(idx)}
              className={`px-3 py-2 text-[13px] cursor-pointer transition-colors ${idx === focusIdx ? "bg-ih-primary-tint text-ih-primary" : "text-ih-fg-3"}`}
            >
              {r.label}
            </li>
          ))}
        </ul>
      )}

      {/* Hidden fields for form submit */}
      <input type="hidden" name="addressCity" value={selected?.city || ""} />
      <input type="hidden" name="addressState" value={selected?.state || ""} />
      <input type="hidden" name="addressZip" value={selected?.zip || ""} />
      <input type="hidden" name="addressPlaceId" value={selected?.placeId || ""} />
    </div>
  );
}
