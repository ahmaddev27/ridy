/**
 * The receipt form as steps, and the one place its rules live.
 *
 * ## Why steps
 *
 * The owner, 13.10.2026: "مابدنا نظهر الفورم الفاضي — الأزرار تبع الكاميرا أو
 * المعرض، ثم الفورم بعد الصورة معبّى، والتأكيد." A single page showed a driver
 * fifteen empty fields before anything had been read, which is the opposite of
 * what the OCR is for: the phone reads the receipt, so the driver should be
 * correcting a filled form, not filling an empty one.
 *
 * ## Why the rules are here and not in the screen
 *
 * Each step has to refuse to advance for exactly the reasons the final send
 * refuses, or the driver reaches the last screen and is told about a field two
 * steps back. Two copies of that list would drift the first time one of them
 * changed — a rule enforced in one place is lost silently by the next writer —
 * so there is one copy and both the step gate and `submit()` ask it.
 *
 * Nothing here touches React, the camera or the network, so it is all testable.
 */

/** The steps in order. `fuel` exists only on a refuel. */
export type ReceiptStep = 'photo' | 'details' | 'fuel' | 'odometer' | 'confirm';

/** The four the company stores literally; `Other` is never stored as a word. */
export const FUEL_CATEGORY = 'Tanken';

/**
 * German typing to one wire shape, with a given number of decimal places.
 *
 * A litre count has two (`41,47`) and a unit price three (`1,789`), and both
 * reach a figure an accountant reads. A comma from the keyboard is converted
 * ONCE, here, and anything that is not a plain decimal is refused by name
 * rather than coerced to zero — El-Professor's own display parser reads
 * `1.234` as 1.23 and answers 0 for what it cannot read, and neither may
 * happen to money.
 */
export function toWireDecimal(input: string, places: number): string | null {
  const cleaned = input.trim().replace(/\s/g, '').replace(',', '.');
  const shape = new RegExp(`^\\d{1,8}(\\.\\d{1,${places}})?$`);
  if (!shape.test(cleaned)) return null;
  return cleaned;
}

export function toWireAmount(input: string): string | null {
  const cleaned = input.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * The steps this receipt has.
 *
 * A car wash has no litres and no cluster, so it has no fuel step at all —
 * showing one would invite numbers that mean nothing.
 *
 * A company may also switch the odometer step off. It defaults to ON, so an
 * absent flag (older server) keeps the step; the range goes with it, being
 * only ever collected inside that step.
 */
export function stepsFor(category: string | null, odometerRequired = true): ReceiptStep[] {
  if (category !== FUEL_CATEGORY) return ['photo', 'details', 'confirm'];
  return odometerRequired
    ? ['photo', 'details', 'fuel', 'odometer', 'confirm']
    : ['photo', 'details', 'fuel', 'confirm'];
}

export type PhotoState = { hasPhoto: boolean; scanning: boolean };

/** Everything step 2 is responsible for. */
export type DetailsState = {
  amount: string;
  category: string | null;
  description: string;
  merchant: string;
  city: string;
  plz: string;
  receiptTime: string;
  /** A field the reading rules were unsure about and nobody has confirmed. */
  unconfirmed: boolean;
};

/** The two figures printed on the fuel receipt itself. */
export type FuelState = {
  litres: string;
  pricePerLitre: string;
};

/**
 * The cluster, which is a different act from reading the receipt.
 *
 * It got its own step on 13.10.2026 (owner): the photo is of a different
 * object, taken at a different moment, and burying a camera button under two
 * number fields made it read as optional — which it is not.
 */
export type OdometerState = {
  hasOdoPhoto: boolean;
  odometerKm: string;
};

/**
 * What is wrong with the photo step, as a translation key, or null.
 *
 * Scanning is a reason to wait rather than a reason to refuse, so it has its
 * own key: a driver stopped by "take a photo" while the photo is visibly being
 * read learns to distrust the screen.
 */
export function photoProblem(v: PhotoState): string | null {
  if (!v.hasPhoto) return 'receipt.photoRequired';
  if (v.scanning) return 'receipt.scanning';
  return null;
}

/**
 * What is wrong with the details, as a translation key, or null.
 *
 * The order is the order a driver reads the form in, so the first thing they
 * are told about is the first thing they would look at.
 */
export function detailsProblem(v: DetailsState): string | null {
  if (toWireAmount(v.amount) === null) return 'receipt.amountInvalid';
  if (v.category === null && v.description.trim() === '') return 'receipt.subjectRequired';
  if (v.merchant.trim() === '') return 'receipt.merchantRequired';
  if (v.city.trim() === '') return 'receipt.cityRequired';
  // `HH:MM`, and the HOUR is checked: `25:00` is not a time, and a reader that
  // accepts it shifts the entry into the next day.
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.receiptTime.trim())) return 'receipt.timeInvalid';
  if (v.plz.trim() !== '' && !/^\d{5}$/.test(v.plz.trim())) return 'receipt.plzInvalid';
  // Last, because it is not about a field being empty: the photo does not
  // travel, so a figure the rules were unsure about can never be checked
  // against anything afterwards. This is the wall, not a reminder.
  if (v.unconfirmed) return 'receipt.mustConfirm';
  return null;
}

/** What is wrong with the two figures on the fuel receipt, or null. */
export function fuelProblem(v: FuelState): string | null {
  if (toWireDecimal(v.litres, 2) === null) return 'receipt.litresInvalid';
  if (toWireDecimal(v.pricePerLitre, 3) === null) return 'receipt.priceInvalid';
  return null;
}

/**
 * What is wrong with the odometer, as a translation key, or null.
 *
 * The cluster photo is required because the odometer is read FROM it: without
 * one there is nothing to read, and a number typed with no photo behind it is
 * the case the owner said he does not trust ("مفش ثقة بالسائقين").
 */
export function odometerProblem(v: OdometerState): string | null {
  if (!v.hasOdoPhoto) return 'receipt.odoPhotoRequired';
  if (!/^\d{4,7}$/.test(v.odometerKm.trim())) return 'receipt.odoInvalid';
  return null;
}

/**
 * The problem that stops a given step, or null when it may be left.
 *
 * `confirm` has none of its own: everything it shows was already checked by
 * the step that collected it, and inventing a new refusal on the last screen
 * is how a driver ends up stuck with no field to fix.
 */
export function stepProblem(step: ReceiptStep, state: FormState): string | null {
  if (step === 'photo') return photoProblem(state.photo);
  if (step === 'details') return detailsProblem(state.details);
  if (step === 'fuel') return fuelProblem(state.fuel);
  if (step === 'odometer') return odometerProblem(state.odometer);
  return null;
}

/** Everything the steps and the send both read. */
export type FormState = {
  photo: PhotoState;
  details: DetailsState;
  fuel: FuelState;
  odometer: OdometerState;
};

/**
 * Every problem the send must refuse, in step order.
 *
 * This is what `submit()` asks, so the last wall and the step gates can never
 * disagree about what a valid receipt is. The fuel figures are checked only on
 * a refuel, exactly as `stepsFor` decides whether that step exists.
 */
export function submitProblem(state: FormState, odometerRequired = true): string | null {
  for (const step of stepsFor(state.details.category, odometerRequired)) {
    const problem = stepProblem(step, state);
    if (problem !== null) return problem;
  }
  return null;
}
