// The note form's rules. The property that matters: an incident type without a
// plate is refused HERE, so it never travels to El-Professor to be refused
// there with `vehicle_required`.

import { test } from "node:test";
import assert from "node:assert/strict";

const { NOTE_TYPES, INCIDENT_TYPES, vehicleRequired, noteProblem, platePayload } = await import("../src/lib/note-rules.ts");

const car = { id: 1, license_plate: "B-XX 1234", make: "VW", model: "Touran" };
const ready = { status: "ready", vehicles: [car] };
const base = { type: "general", text: "x", fullDay: true, from: "", to: "", plate: null, vehicles: ready };

test("all ten types are offered, the three absence types included", () => {
  assert.equal(NOTE_TYPES.length, 10);
  for (const t of ["sick", "vacation", "off"]) assert.ok(NOTE_TYPES.includes(t));
});

test("exactly the five incident types need a vehicle", () => {
  assert.deepEqual([...INCIDENT_TYPES].sort(), ["accident", "blitzer", "breakdown", "kontrolle", "wait"]);
  for (const t of NOTE_TYPES) assert.equal(vehicleRequired(t), INCIDENT_TYPES.includes(t));
});

test("an incident without a plate is refused, for every incident type", () => {
  assert.equal(noteProblem({ ...base, type: "wait", plate: "M-ZZ 9" })?.key, "note.vehicleRequired");
  for (const type of INCIDENT_TYPES) {
    assert.equal(noteProblem({ ...base, type })?.key, "note.vehicleRequired");
    assert.equal(noteProblem({ ...base, type, plate: "  " })?.key, "note.vehicleRequired");
    assert.equal(noteProblem({ ...base, type, plate: "B-XX 1234" }), null);
  }
});

test("the other five types send with no plate", () => {
  for (const type of ["general", "other", "sick", "vacation", "off"]) {
    assert.equal(noteProblem({ ...base, type }), null);
  }
});

test("a failed or pending load is not an empty list, and an empty list is not a failure", () => {
  const inc = { ...base, type: "blitzer", plate: null };
  assert.equal(noteProblem({ ...inc, vehicles: { status: "failed" } })?.key, "note.vehiclesFailed");
  assert.equal(noteProblem({ ...inc, vehicles: { status: "loading" } })?.key, "note.vehiclesLoading");
  assert.equal(noteProblem({ ...inc, vehicles: { status: "ready", vehicles: [] } })?.key, "note.vehiclesNone");
  // An absence note needs no list, so a failed load must not block it.
  assert.equal(noteProblem({ ...base, type: "sick", vehicles: { status: "failed" } }), null);
});

test("an unknown type, empty text and a bad hour are refused", () => {
  assert.equal(noteProblem({ ...base, type: "krank" })?.key, "note.rejectedByServer");
  assert.equal(noteProblem({ ...base, text: " " })?.key, "note.textRequired");
  assert.equal(noteProblem({ ...base, fullDay: false, from: "25:00" })?.key, "note.timeInvalid");
  assert.equal(noteProblem({ ...base, fullDay: false, from: "08:00", to: "10:30" }), null);
});

test("the plate on the wire is absent unless picked from the list", () => {
  assert.equal(platePayload(null, ready), undefined);
  assert.equal(platePayload("", ready), undefined);
  assert.equal(platePayload("null", ready), undefined);
  assert.equal(platePayload("M-ZZ 9", ready), undefined);
  assert.equal(platePayload("B-XX 1234", ready), "B-XX 1234");
  assert.equal(platePayload("B-XX 1234", { status: "failed" }), undefined);
});

test("every incident the gate accepts carries a plate on the wire (parity)", () => {
  for (const type of INCIDENT_TYPES) {
    const f = { ...base, type, plate: "B-XX 1234" };
    assert.equal(noteProblem(f), null);
    assert.equal(platePayload(f.plate, f.vehicles), "B-XX 1234");
  }
});
