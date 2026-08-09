"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { dictionaries, RTL_LOCALES, type Locale } from "./dictionaries";
import { screensA } from "./screens-a";
import { screensB } from "./screens-b";
import { screensRidy } from "./screens-ridy";
import { screensAdmin } from "./screens-admin";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/** Merge the chrome dictionary with the per-screen dictionaries (separate files
 *  so screen-group agents can extend translations without touching shared state). */
function dictionaryFor(locale: Locale): Record<string, unknown> {
  return {
    ...dictionaries[locale],
    screens: { ...screensA[locale], ...screensB[locale], ...screensRidy[locale], ...screensAdmin[locale] },
  };
}

function lookup(tree: unknown, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], tree);
  return typeof value === "string" ? value : path;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // German-first (target market); persisted choice applied after hydration.
  const [locale, setLocaleState] = useState<Locale>("de");

  useEffect(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("locale") : null;
    if (saved === "en" || saved === "de" || saved === "ar") setLocaleState(saved);
  }, []);

  // Reflect the language + reading direction on <html> so RTL (Arabic) flips the
  // whole layout and native controls follow suit.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem("locale", next);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback((key: string) => lookup(dictionaryFor(locale), key), [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}
