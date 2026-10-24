// The receipt form's steps, and the single rule behind both the step gate and
// the final send.
//
// The property that matters most is the LAST test: every refusal the send
// makes is a refusal some step already made. Two copies of that list would
// drift the first time one changed, and the driver would reach the last screen
// to be told about a field two steps back.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  stepsFor,
  stepProblem,
  submitProblem,
  detailsProblem,
  fuelProblem,
  odometerProblem,
  photoProblem,
  toWireAmount,
  toWireDecimal,
} = await import("../src/lib/receipt-steps.ts");

const goodDetails = {
  amount: "41,47",
  category: "Tanken",
  description: "",
  merchant: "ARAL Tankstelle",
  city: "Berlin",
  plz: "10179",
  receiptTime: "14:32",
  unconfirmed: false,
};

const goodFuel = {
  litres: "41,47",
  pricePerLitre: "1,789",
};

const goodOdo = {
  hasOdoPhoto: true,
  odometerKm: "25382",
};

const good = {
  photo: { hasPhoto: true, scanning: false },
  details: goodDetails,
  fuel: goodFuel,
  odometer: goodOdo,
};

test("a refuel has a fuel step and an odometer step; nothing else does", () => {
  // The odometer got its own step on 13.10.2026: the photo is of a different
  // object, taken at a different moment, and burying a camera button under two
  // number fields made a MANDATORY capture read as optional.
  assert.deepEqual(stepsFor("Tanken"), ["photo", "details", "fuel", "odometer", "confirm"]);
  assert.deepEqual(stepsFor("Autowäsche"), ["photo", "details", "confirm"]);
  // `Other` clears the category; the free text is then the subject.
  assert.deepEqual(stepsFor(null), ["photo", "details", "confirm"]);
});

test("the photo step waits for the read rather than refusing it", () => {
  assert.equal(photoProblem({ hasPhoto: false, scanning: false }), "receipt.photoRequired");
  // Being stopped by "take a photo" while the photo is visibly being read is
  // how a driver learns to distrust the screen.
  assert.equal(photoProblem({ hasPhoto: true, scanning: true }), "receipt.scanning");
  assert.equal(photoProblem({ hasPhoto: true, scanning: false }), null);
});

test("German typing is converted once, and nonsense is refused not zeroed", () => {
  assert.equal(toWireAmount("41,47"), "41.47");
  assert.equal(toWireDecimal("1,789", 3), "1.789");
  // The other side reads `1.234` as 1.23 and answers 0 for what it cannot
  // read. Neither may happen to a figure that reaches a driver's balance.
  assert.equal(toWireAmount("1.234,56"), null);
  assert.equal(toWireAmount("vierzig"), null);
  assert.equal(toWireAmount("-5,00"), null);
  assert.equal(toWireDecimal("1,7891", 3), null);
});

test("the details step names the first thing a driver would look at", () => {
  assert.equal(detailsProblem(goodDetails), null);
  assert.equal(detailsProblem({ ...goodDetails, amount: "" }), "receipt.amountInvalid");
  assert.equal(detailsProblem({ ...goodDetails, merchant: "  " }), "receipt.merchantRequired");
  assert.equal(detailsProblem({ ...goodDetails, city: "" }), "receipt.cityRequired");
  assert.equal(
    detailsProblem({ ...goodDetails, category: null, description: "" }),
    "receipt.subjectRequired",
  );
  // A category-less receipt is fine when the free text carries the subject.
  assert.equal(detailsProblem({ ...goodDetails, category: null, description: "Parken" }), null);
});

test("the hour of the time is checked, not just its shape", () => {
  // `25:00` parses to 1500 minutes in a naive reader and walks the entry into
  // the next day.
  assert.equal(detailsProblem({ ...goodDetails, receiptTime: "25:00" }), "receipt.timeInvalid");
  assert.equal(detailsProblem({ ...goodDetails, receiptTime: "14:60" }), "receipt.timeInvalid");
  assert.equal(detailsProblem({ ...goodDetails, receiptTime: "23:59" }), null);
});

test("an empty PLZ is allowed and a malformed one is not", () => {
  assert.equal(detailsProblem({ ...goodDetails, plz: "" }), null);
  assert.equal(detailsProblem({ ...goodDetails, plz: "101" }), "receipt.plzInvalid");
});

test("an unconfirmed reading blocks the step, and it is checked last", () => {
  // Last because it is not about an empty field: the photo does not travel, so
  // a figure the rules were unsure about can never be checked afterwards.
  assert.equal(detailsProblem({ ...goodDetails, unconfirmed: true }), "receipt.mustConfirm");
  // ...but a field that is also wrong is named first, because that is the one
  // the driver can actually see and fix.
  assert.equal(
    detailsProblem({ ...goodDetails, unconfirmed: true, amount: "" }),
    "receipt.amountInvalid",
  );
});

test("the receipt's own two figures are the fuel step's business", () => {
  assert.equal(fuelProblem(goodFuel), null);
  assert.equal(fuelProblem({ ...goodFuel, litres: "" }), "receipt.litresInvalid");
  assert.equal(fuelProblem({ ...goodFuel, pricePerLitre: "" }), "receipt.priceInvalid");
});

test("the cluster photo is required, because the odometer is read from it", () => {
  assert.equal(odometerProblem(goodOdo), null);
  assert.equal(odometerProblem({ ...goodOdo, hasOdoPhoto: false }), "receipt.odoPhotoRequired");
  // Under four digits it is a range or a trip meter, which is the exact
  // confusion the reading rule exists to refuse.
  assert.equal(odometerProblem({ ...goodOdo, odometerKm: "691" }), "receipt.odoInvalid");
  assert.equal(odometerProblem({ ...goodOdo, odometerKm: "25382,0" }), "receipt.odoInvalid");
});

test("a car wash is never asked for litres or a cluster", () => {
  // The fuel state is deliberately empty here: on a non-refuel it must not be
  // consulted at all, so a driver cannot be blocked by a field they were
  // never shown.
  const carWash = {
    photo: { hasPhoto: true, scanning: false },
    details: { ...goodDetails, category: "Autowäsche" },
    fuel: { litres: "", pricePerLitre: "" },
    odometer: { hasOdoPhoto: false, odometerKm: "" },
  };
  assert.equal(submitProblem(carWash), null);
  assert.equal(stepProblem("confirm", carWash), null);
});

test("every refusal the send makes is one a step already made", () => {
  // This is the property the module exists for. Each broken state is sent
  // through `submitProblem`, and the step that owns that field must refuse it
  // with the SAME key — so a driver is stopped where they can fix it.
  const cases = [
    ["photo", { ...good, photo: { hasPhoto: false, scanning: false } }],
    ["details", { ...good, details: { ...goodDetails, amount: "x" } }],
    ["details", { ...good, details: { ...goodDetails, city: "" } }],
    ["details", { ...good, details: { ...goodDetails, receiptTime: "25:00" } }],
    ["details", { ...good, details: { ...goodDetails, unconfirmed: true } }],
    ["fuel", { ...good, fuel: { ...goodFuel, litres: "41,473" } }],
    ["fuel", { ...good, fuel: { ...goodFuel, pricePerLitre: "x" } }],
    ["odometer", { ...good, odometer: { ...goodOdo, hasOdoPhoto: false } }],
    ["odometer", { ...good, odometer: { ...goodOdo, odometerKm: "12" } }],
  ];
  for (const [owner, state] of cases) {
    const sendSays = submitProblem(state);
    assert.notEqual(sendSays, null, `the send should refuse ${owner}`);
    assert.equal(stepProblem(owner, state), sendSays, `step ${owner} must give the same reason`);
  }
});

test("a complete receipt is refused by nothing", () => {
  assert.equal(submitProblem(good), null);
  for (const step of stepsFor(good.details.category)) {
    assert.equal(stepProblem(step, good), null, `step ${step} refused a complete receipt`);
  }
});

test("a company that switched the odometer off has a four-step refuel", () => {
  assert.deepEqual(stepsFor("Tanken", false), ["photo", "details", "fuel", "confirm"]);
  // The default is ON: an absent flag keeps today's five steps.
  assert.deepEqual(stepsFor("Tanken", true), stepsFor("Tanken"));
  // It changes nothing for a receipt that never had the step.
  assert.deepEqual(stepsFor("Autowäsche", false), ["photo", "details", "confirm"]);
});

test("with the odometer off the send does not complain about a missing one", () => {
  const noOdo = { ...good, odometer: { hasOdoPhoto: false, odometerKm: "" } };
  assert.equal(submitProblem(noOdo, false), null);
  // Still required when the company has not switched it off.
  assert.equal(submitProblem(noOdo), "receipt.odoPhotoRequired");
  assert.equal(submitProblem(noOdo, true), "receipt.odoPhotoRequired");
  // The other steps are still enforced.
  const bad = { ...noOdo, fuel: { ...goodFuel, litres: "x" } };
  assert.equal(submitProblem(bad, false), "receipt.litresInvalid");
});
