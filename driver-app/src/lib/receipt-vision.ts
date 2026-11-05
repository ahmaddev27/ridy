/**
 * Live receipt reading. The captured photo is sent to OUR server's vision
 * model, which is the authoritative reader; the parsed fields come back and
 * only those are kept. Owner's decision (13.11.2026): the image is processed
 * in memory on the server and discarded - never stored, there or here.
 *
 * `mergeVision` lays the server fields over an (empty) base so the screen
 * gets one ReceiptFacts shape plus the list of fields the model supplied.
 */

import { File } from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, type PickedPhoto, type VisionFields } from './api';

/** Receipts need no more; fewer pixels is much faster on the server's CPU. */
export const VISION_MAX_EDGE = 1000;
export const VISION_QUALITY = 0.8;

export type ReceiptFacts = {
  date?: string;
  amount?: number;
  merchant?: string;
  city?: string;
  plz?: string;
  street?: string;
  litres?: number;
  pricePerLitre?: number;
  category?: string | null;
  time?: string;
  receiptNumber?: string;
};

export type VisionKey = keyof ReceiptFacts;

/** The `ocr_meta.fields` key each merged value belongs to. */
export const VISION_META_FIELD: Record<VisionKey, string> = {
  date: 'receipt_date',
  amount: 'amount',
  merchant: 'merchant_name',
  city: 'city',
  plz: 'postal_code',
  street: 'street',
  litres: 'litres',
  pricePerLitre: 'price_per_litre',
  category: 'category',
  time: 'receipt_time',
  receiptNumber: 'receipt_number',
};

export type VisionMerge = {
  facts: ReceiptFacts;
  overridden: VisionKey[];
  /** Both readers saw the same date / amount (so no confirm-by-tap is needed). */
  dateAgrees: boolean;
  amountAgrees: boolean;
  cityFromPlz: boolean;
};

const has = (v: unknown) => v !== null && v !== undefined && v !== '';

/** The resize that brings the long edge to `VISION_MAX_EDGE`, or null (never enlarge). */
export function visionResizeFor(
  width: number | null | undefined,
  height: number | null | undefined,
): { width: number } | { height: number } | null {
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return null;
  if (Math.max(width, height) <= VISION_MAX_EDGE) return null;
  return width >= height ? { width: VISION_MAX_EDGE } : { height: VISION_MAX_EDGE };
}

/** Lay the vision fields over the on-device ones. Pure. */
export function mergeVision(ml: ReceiptFacts, v: VisionFields): VisionMerge {
  const facts: ReceiptFacts = { ...ml };
  const overridden: VisionKey[] = [];
  const take = <K extends VisionKey>(key: K, value: ReceiptFacts[K] | null) => {
    if (!has(value)) return;
    facts[key] = value as ReceiptFacts[K];
    overridden.push(key);
  };
  take('date', v.date);
  take('amount', v.amount);
  take('merchant', v.merchant_name);
  take('plz', v.postal_code);
  take('street', v.street);
  take('time', v.time);
  take('receiptNumber', v.receipt_number);
  take('category', v.category);
  // The city: the server's PLZ-authoritative town always wins; a bare guess
  // only fills a gap, never replaces what the phone already resolved.
  if (has(v.city) && (v.city_from_plz || !has(ml.city))) take('city', v.city);
  // Fuel figures travel as a pair (the server already cross-checked them).
  if (has(v.litres) && has(v.price_per_litre)) {
    take('litres', v.litres);
    take('pricePerLitre', v.price_per_litre);
  }
  return {
    facts,
    overridden,
    dateAgrees: has(ml.date) && ml.date === v.date,
    amountAgrees: has(ml.amount) && ml.amount === v.amount,
    cityFromPlz: overridden.includes('city') && v.city_from_plz,
  };
}

async function shrink(uri: string, size: { width: number; height: number } | null): Promise<PickedPhoto> {
  const resize = visionResizeFor(size?.width, size?.height);
  const out = await ImageManipulator.manipulateAsync(uri, resize ? [{ resize }] : [], {
    compress: VISION_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: out.uri, name: 'beleg.jpg', type: 'image/jpeg' };
}

/**
 * Send the captured photo to the server vision model and return its fields.
 * The server's answer is authoritative. Throws on ANY failure (feature off,
 * offline, model error) so the caller can show a retry; nothing is stored on
 * either side. The downscaled temp copy is deleted as soon as the call ends.
 */
export async function readReceipt(
  uri: string,
  size: { width: number; height: number } | null,
): Promise<VisionFields> {
  const small = await shrink(uri, size);
  try {
    const { data } = await api.receiptRead(small);
    return data.fields;
  } finally {
    discard(small.uri);
  }
}

/** Best-effort removal of a temp image; never throws. */
export function discard(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // Already gone or outside our cache: nothing to clean.
  }
}
