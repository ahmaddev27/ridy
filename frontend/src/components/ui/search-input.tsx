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

/** The single search field used across the app (prototype `.input-group`). */
export function SearchInput({ value, onChange, placeholder, className }: SearchInputProps) {
  return (
    <div className={cn("input-group", className)} style={{ width: "min(340px, 100%)" }}>
      <Search />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="input"
      />
    </div>
  );
}
