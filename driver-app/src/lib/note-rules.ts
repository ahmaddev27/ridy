/**
 * The note form's rules, in one place that both the form and the send ask.
 *
 * Same reason as `receipt-steps.ts`: a rule enforced in one copy is lost
 * silently by the next writer. Nothing here touches React or the network.
 *
 * ## The vehicle
 *
 * El-Professor refuses an incident note that names no vehicle
 * (`vehicle_required`), and the backend refuses it here first so the driver is
 * told at once. The plate is PICKED from the fleet's list and never typed: a
 * picker is what stops `B-XX 1234` and `B-XX-1234` becoming two vehicles.
 *
 * The VALUES below are El-Professor's stored vocabulary and are never
 * translated. The list is an allow-list on both sides on purpose: a type nobody
 * has heard of must be refused, not waved through as an ordinary note.
 */

/** The ten that may cross. */
export const NOTE_TYPES = [
  "general", "blitzer", "accident", "kontrolle", "breakdown", "wait", "other",
  "sick", "vacation", "off",
] as const;

/** The five that plan around a vehicle, and so must name one. */
export const INCIDENT_TYPES = ["blitzer", "accident", "kontrolle", "breakdown", "wait"] as const;

/** El-Professor's own bound; longer is refused there. */
export const PLATE_MAX = 32;

export type Vehicle = { id: number; license_plate: string; make: string | null; model: string | null };

/** A failed load is not an empty list: it says "unknown", an empty one says "none". */
export type VehicleList =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; vehicles: Vehicle[] };

export type NoteProblem = { key: string; vars?: Record<string, string> };

export function vehicleRequired(type: string): boolean {
  return (INCIDENT_TYPES as readonly string[]).includes(type);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export type NoteForm = {
  type: string;
  text: string;
  fullDay: boolean;
  from: string;
  to: string;
  plate: string | null;
  vehicles: VehicleList;
};

/** The first reason the note cannot be sent, as a dictionary key, or null. */
export function noteProblem(f: NoteForm): NoteProblem | null {
  if (!(NOTE_TYPES as readonly string[]).includes(f.type)) return { key: "note.rejectedByServer" };
  if (f.text.trim() === "") return { key: "note.textRequired" };
  // An hour outside 00-23 is not a typo the other side can repair: its own
  // parser turns `25:00` into minutes and walks into the next day.
  for (const [value, label] of [[f.from, "note.from"], [f.to, "note.to"]] as const) {
    if (!f.fullDay && value.trim() !== "" && !TIME.test(value.trim())) {
      return { key: "note.timeInvalid", vars: { field: label } };
    }
  }
  return vehicleProblem(f);
}

function vehicleProblem(f: NoteForm): NoteProblem | null {
  if (!vehicleRequired(f.type)) return null;
  if (f.vehicles.status === "loading") return { key: "note.vehiclesLoading" };
  if (f.vehicles.status === "failed") return { key: "note.vehiclesFailed" };
  if (f.vehicles.vehicles.length === 0) return { key: "note.vehiclesNone" };
  if (platePayload(f.plate, f.vehicles) === undefined) return { key: "note.vehicleRequired" };
  return null;
}

/**
 * The plate to put on the wire: absent (never blank, never "null") unless the
 * driver picked one, and only a plate that is in the list and fits the bound.
 */
export function platePayload(plate: string | null, vehicles: VehicleList): string | undefined {
  if (plate === null || plate.trim() === "" || plate.length > PLATE_MAX) return undefined;
  if (vehicles.status !== "ready") return undefined;
  return vehicles.vehicles.some((v) => v.license_plate === plate) ? plate : undefined;
}
