"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";

export type SelectOption = { value: string; label: string; disabled?: boolean };

/**
 * A styled, searchable single-select (Select2-style) that matches the app's
 * inputs. Drop-in replacement for a native <select>: string value + onChange.
 * Search appears automatically once the list is long enough. Fully keyboard
 * navigable and closes on outside click / Escape.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "—",
  disabled = false,
  searchable,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  /** Force the search box on/off. Defaults to on when there are > 7 options. */
  searchable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? options.length > 7;
  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Reset search + focus it when opening.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(Math.max(0, filtered.findIndex((o) => o.value === value)));
      if (showSearch) setTimeout(() => searchRef.current?.focus(), 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(opt: SelectOption) {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "Enter" || e.key === "ArrowDown" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) pick(opt);
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2 text-start text-sm outline-none transition-colors hover:border-line-strong focus:border-ink focus:ring-2 focus:ring-line disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-subtle"
      >
        <span className={`truncate ${selected ? "text-ink" : "text-ink-subtle"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
              <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-subtle">—</li>
            ) : (
              filtered.map((opt, i) => {
                const isSelected = opt.value === value;
                const isActive = i === active;
                return (
                  <li key={opt.value} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => pick(opt)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:text-ink-subtle ${
                        isActive && !opt.disabled ? "bg-surface-2" : ""
                      } ${isSelected ? "font-medium text-ink" : "text-ink-muted"}`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isSelected && <Check className="h-4 w-4 shrink-0 text-ink" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
