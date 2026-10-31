/**
 * Early decline (auto-decline) — client helpers, docs/25.
 *
 * The tab is gated by the COMPANY feature flag the GET answers with, so the flag
 * is read once, shared module-wide and re-read when the signed-in driver changes.
 */
import { useEffect, useSyncExternalStore } from "react";
import { api, type AutoDeclineRules } from "@/lib/api";
import { toAsciiDigits } from "@/lib/format";

export const RULE_KEYS = ["min_fare", "reject_cities", "max_pickup_distance", "max_trip_distance"] as const;
export type AutoDeclineRuleKey = (typeof RULE_KEYS)[number];

let featureEnabled = false;
let loadedFor: number | null = null;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (next === featureEnabled) return;
  featureEnabled = next;
  listeners.forEach((fn) => fn());
}

/** The screen reports what the server just said, so the tab follows without a refetch. */
export function setAutoDeclineFeature(enabled: boolean): void {
  publish(enabled);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Whether the signed-in DRIVER's company has Early decline. Owners and signed-out
 * sessions are always false: the endpoints are driver-scoped (see the owner gap in
 * the PR), so there is nothing for an owner to open yet.
 */
export function useAutoDeclineFeature(driverId: number | null, isOwner: boolean): boolean {
  const on = useSyncExternalStore(subscribe, () => featureEnabled);

  useEffect(() => {
    if (driverId === null || isOwner) {
      loadedFor = null;
      publish(false);
      return;
    }
    if (loadedFor === driverId) return;
    loadedFor = driverId;
    api
      .autoDecline()
      .then((r) => publish(r.data.feature_enabled === true))
      .catch(() => {
        // Unknown is "off": a tab that leads nowhere is worse than a late one.
        loadedFor = null;
      });
  }, [driverId, isOwner]);

  return driverId !== null && !isOwner && on;
}

/** "9,50" / "9.5" / Arabic-keyboard digits to integer cents; null when not a number. */
export function eurosToCents(input: string): number | null {
  const clean = toAsciiDigits(input).trim().replace(/\s/g, "").replace(",", ".");
  if (clean === "" || !/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}

/** Cents to the text a driver edits, always two decimals, Latin digits ("9,50"). */
export function centsToEuros(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** "8" / "8,5" / "8.5" to km as a number; null when not a number. */
export function parseKm(input: string): number | null {
  const clean = toAsciiDigits(input).trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  return parseFloat(clean);
}

export function kmToText(km: number): string {
  return String(km).replace(".", ",");
}

/** A rule that is switched on but has nothing to compare against is not savable. */
export function invalidRules(rules: AutoDeclineRules): AutoDeclineRuleKey[] {
  const bad: AutoDeclineRuleKey[] = [];
  if (rules.min_fare.enabled && rules.min_fare.value_e2 <= 0) bad.push("min_fare");
  if (rules.reject_cities.enabled && rules.reject_cities.cities.length === 0) bad.push("reject_cities");
  if (rules.max_pickup_distance.enabled && rules.max_pickup_distance.km <= 0) bad.push("max_pickup_distance");
  if (rules.max_trip_distance.enabled && rules.max_trip_distance.km <= 0) bad.push("max_trip_distance");
  return bad;
}
