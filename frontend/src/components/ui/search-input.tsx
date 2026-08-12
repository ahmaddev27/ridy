"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Extra classes for the wrapper (e.g. width overrides). */
  className?: string;
};

/**
 * The single search field used across the app. Fixed, compact width so it never
 * stretches to fill its row — pass `className` only to tweak the wrapper.
 */
export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  return (
    <div className={cn("relative w-full max-w-sm", className)}>
      <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 ltr:left-3 rtl:right-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white py-2 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200 ltr:pl-9 ltr:pr-3 rtl:pr-9 rtl:pl-3"
      />
    </div>
  );
}
