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
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-start text-sm outline-none transition-colors hover:border-slate-400 focus:border-slate-900 focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
      >
        <span className={`truncate ${selected ? "text-slate-800" : "text-slate-400"}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-300"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-400">—</li>
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
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:text-slate-300 ${
                        isActive && !opt.disabled ? "bg-slate-100" : ""
                      } ${isSelected ? "font-medium text-slate-900" : "text-slate-700"}`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {isSelected && <Check className="h-4 w-4 shrink-0 text-slate-900" />}
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
