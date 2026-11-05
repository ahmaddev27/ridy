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

function RuleRow({ label, on, onToggle, children }: {
  label: string; on: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
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
  const [pickupOn, setPickupOn] = useState(r.max_pickup_distance.enabled);
  const [pickup, setPickup] = useState(String(r.max_pickup_distance.km));
  const [tripOn, setTripOn] = useState(r.max_trip_distance.enabled);
  const [trip, setTrip] = useState(String(r.max_trip_distance.km));
  const [invalid, setInvalid] = useState(false);

  // Keep cities already on the rule selectable even if no longer in the company's list.
  const options = Array.from(new Set([...cities, ...r.reject_cities.cities]));

  function submit() {
    const f = parseNumber(fare);
    const k = parseNumber(perKm);
    const p = parseNumber(pickup);
    const tr = parseNumber(trip);
    // A value only has to be valid while its rule is on.
    if ((fareOn && !validCents(f)) || (perKmOn && !validCents(k)) || (pickupOn && p === null) || (tripOn && tr === null)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onSave({
      min_fare: { enabled: fareOn, value_e2: Math.round((f ?? r.min_fare.value_e2 / 100) * 100) },
      min_price_per_km: {
        enabled: perKmOn,
        value_e2: Math.round((k ?? r.min_price_per_km.value_e2 / 100) * 100),
        mode,
      },
      reject_cities: { enabled: citiesOn, cities: picked },
      max_pickup_distance: { enabled: pickupOn, km: p ?? r.max_pickup_distance.km },
      max_trip_distance: { enabled: tripOn, km: tr ?? r.max_trip_distance.km },
    });
  }

  const toggleCity = (city: string) =>
    setPicked((cur) => (cur.includes(city) ? cur.filter((x) => x !== city) : [...cur, city]));

  return (
    <Modal
      open
      onClose={onClose}
      title={c("editTitle").replace("{v}", driver.name)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{c("cancel")}</Button>
          <Button onClick={submit} disabled={saving}>{c("save")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <RuleRow label={c("minFareLabel")} on={fareOn} onToggle={() => setFareOn((v) => !v)}>
          <input dir="ltr" inputMode="decimal" className={inputClass} value={fare} onChange={(e) => setFare(e.target.value)} disabled={!fareOn} />
        </RuleRow>
        <RuleRow label={c("perKmLabel")} on={perKmOn} onToggle={() => setPerKmOn((v) => !v)}>
          <input dir="ltr" inputMode="decimal" className={inputClass} value={perKm} onChange={(e) => setPerKm(e.target.value)} disabled={!perKmOn} />
          <p className="text-xs text-ink-subtle">{c("perKmHint").replace("{v}", perKm || "3")}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={c("modeLabel")}>
            {(["and", "or"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={!perKmOn}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={
                  "rounded-full border px-2.5 py-1 text-xs disabled:opacity-50 " +
                  (mode === m ? "border-primary bg-primary text-primary-ink" : "border-line text-ink-muted hover:bg-surface-2")
                }
              >
                {c(m === "and" ? "modeAnd" : "modeOr")}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-subtle">{c(mode === "and" ? "modeAndHint" : "modeOrHint")}</p>
        </RuleRow>
        <RuleRow label={c("citiesLabel")} on={citiesOn} onToggle={() => setCitiesOn((v) => !v)}>
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
        <RuleRow label={c("pickupLabel")} on={pickupOn} onToggle={() => setPickupOn((v) => !v)}>
          <input dir="ltr" inputMode="decimal" className={inputClass} value={pickup} onChange={(e) => setPickup(e.target.value)} disabled={!pickupOn} />
        </RuleRow>
        <RuleRow label={c("tripLabel")} on={tripOn} onToggle={() => setTripOn((v) => !v)}>
          <input dir="ltr" inputMode="decimal" className={inputClass} value={trip} onChange={(e) => setTrip(e.target.value)} disabled={!tripOn} />
        </RuleRow>
        {invalid && <p className="text-xs text-danger-fg">{c("invalidValue")}</p>}
      </div>
    </Modal>
  );
}
