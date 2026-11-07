"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n/context";
import type { AutoDeclineManagedDriver, AutoDeclineRules } from "@/lib/api/auto-decline";

const MAX_VALUE_E2 = 100000;

const inputClass =
  "w-28 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-line-strong disabled:opacity-50";

/** Parses a user-typed decimal ("12,5" or "12.5"); null when not a non-negative number. */
function parseNumber(v: string): number | null {
  const n = Number(v.trim().replace(",", "."));
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** A money rule needs a positive amount within the server cap (value_e2 <= 100000). */
function validCents(euros: number | null): boolean {
  return euros !== null && euros > 0 && Math.round(euros * 100) <= MAX_VALUE_E2;
}

function RuleRow({ label, on, onToggle, children, className = "" }: {
  label: string; on: boolean; onToggle: () => void; children: React.ReactNode; className?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={`space-y-2 rounded-lg border border-line p-3 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-ink">{label}</span>
        <Switch checked={on} onChange={onToggle} label={`${label} — ${t("screens.autoDecline.ruleEnabled")}`} />
      </div>
      {children}
    </div>
  );
}

export function RulesModal({ driver, cities, saving, onClose, onSave }: {
  driver: AutoDeclineManagedDriver;
  cities: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (rules: AutoDeclineRules) => void;
}) {
  const { t } = useI18n();
  const c = (k: string) => t(`screens.autoDecline.${k}`);
  const r = driver.rules;
  const [fareOn, setFareOn] = useState(r.min_fare.enabled);
  const [fare, setFare] = useState(String(r.min_fare.value_e2 / 100));
  const [perKmOn, setPerKmOn] = useState(r.min_price_per_km.enabled);
  const [perKm, setPerKm] = useState(String(r.min_price_per_km.value_e2 / 100));
  const [mode, setMode] = useState<"and" | "or">(r.min_price_per_km.mode);
  const [citiesOn, setCitiesOn] = useState(r.reject_cities.enabled);
  const [picked, setPicked] = useState<string[]>(r.reject_cities.cities);
  const [invalid, setInvalid] = useState(false);

  // Keep cities already on the rule selectable even if no longer in the company's list.
  const options = Array.from(new Set([...cities, ...r.reject_cities.cities]));

  function submit() {
    const f = parseNumber(fare);
    // A value only has to be valid while its rule is on.
    if (fareOn && !validCents(f)) {
      setInvalid(true);
      return;
    }
    const k = parseNumber(perKm);
    if (perKmOn && !validCents(k)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    // Criteria hidden from the UI (distance) are sent back exactly as stored.
    onSave({
      ...r,
      min_fare: { enabled: fareOn, value_e2: Math.round((f ?? r.min_fare.value_e2 / 100) * 100) },
      min_price_per_km: { enabled: perKmOn, value_e2: Math.round((k ?? r.min_price_per_km.value_e2 / 100) * 100), mode },
      reject_cities: { enabled: citiesOn, cities: picked },
    });
  }

  const toggleCity = (city: string) =>
    setPicked((cur) => (cur.includes(city) ? cur.filter((x) => x !== city) : [...cur, city]));

  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      title={c("editTitle").replace("{v}", driver.name)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{c("cancel")}</Button>
          <Button onClick={submit} disabled={saving}>{c("save")}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        <RuleRow label={c("minFareLabel")} on={fareOn} onToggle={() => setFareOn((v) => !v)}>
          <input dir="ltr" inputMode="decimal" className={inputClass} value={fare} onChange={(e) => setFare(e.target.value)} disabled={!fareOn} />
        </RuleRow>
        <RuleRow label={c("perKmLabel")} on={perKmOn} onToggle={() => setPerKmOn((v) => !v)}>
          <input dir="ltr" inputMode="decimal" className={inputClass} value={perKm} onChange={(e) => setPerKm(e.target.value)} disabled={!perKmOn} />
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span>{c("modeLabel")}</span>
            <select
              className={inputClass}
              value={mode}
              disabled={!perKmOn}
              onChange={(e) => setMode(e.target.value === "or" ? "or" : "and")}
            >
              <option value="and">{c("modeAnd")}</option>
              <option value="or">{c("modeOr")}</option>
            </select>
          </div>
          <p className="text-xs text-ink-subtle">{c(mode === "or" ? "modeOrHint" : "modeAndHint")}</p>
        </RuleRow>
        <RuleRow label={c("citiesLabel")} on={citiesOn} onToggle={() => setCitiesOn((v) => !v)} className="md:col-span-2">
          {options.length === 0 ? (
            <p className="text-xs text-ink-subtle">{c("citiesEmpty")}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {options.map((city) => (
                <button
                  key={city}
                  type="button"
                  disabled={!citiesOn}
                  aria-pressed={picked.includes(city)}
                  onClick={() => toggleCity(city)}
                  className={
                    "rounded-full border px-2.5 py-1 text-xs disabled:opacity-50 " +
                    (picked.includes(city) ? "border-primary bg-primary text-primary-ink" : "border-line text-ink-muted hover:bg-surface-2")
                  }
                >
                  {city}
                </button>
              ))}
            </div>
          )}
        </RuleRow>
        {invalid && <p className="text-xs text-danger-fg md:col-span-2">{c("invalidValue")}</p>}
      </div>
    </Modal>
  );
}
