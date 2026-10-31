/**
 * The low-confidence fallback: when the phone's ML Kit read of a receipt is
 * not good enough, the photo goes to OUR server's vision model and its fields
 * are merged over the on-device ones.
 *
 * ML Kit stays the instant first pass and the only path for a clean receipt;
 * this is the tail. Owner's decision (31.10.2026): automatic, no consent
 * prompt (the privacy policy says so), photo deleted server-side after parse.
 *
 * Merge rule: a vision value (already sanitised and cross-checked on the
 * server) replaces the on-device one. When the two readers DISAGREE on a date
 * or amount the driver confirms it by tap, like any other uncertain field.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { api, type PickedPhoto, type VisionFields } from './api';

/** Receipts need no more; fewer pixels is much faster on the server's CPU. */
export const VISION_MAX_EDGE = 1000;
export const VISION_QUALITY = 0.8;
export const POLL_MS = 3000;
export const GIVE_UP_MS = 150_000;

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function shrink(uri: string, size: { width: number; height: number } | null): Promise<PickedPhoto> {
  const resize = visionResizeFor(size?.width, size?.height);
  const out = await ImageManipulator.manipulateAsync(uri, resize ? [{ resize }] : [], {
    compress: VISION_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: out.uri, name: 'beleg.jpg', type: 'image/jpeg' };
}

/**
 * Upload the photo, then poll until the model has answered. Returns null on
 * ANY failure (feature off, offline, model error, timeout, superseded) - the
 * caller then just keeps what ML Kit read. `isCurrent` lets a removed or
 * replaced photo stop the polling.
 */
export async function readWithVision(
  uri: string,
  size: { width: number; height: number } | null,
  isCurrent: () => boolean,
): Promise<VisionFields | null> {
  try {
    const started = await api.receiptVisionStart(await shrink(uri, size));
    const deadline = Date.now() + GIVE_UP_MS;
    while (isCurrent() && Date.now() < deadline) {
      await sleep(POLL_MS);
      const { data } = await api.receiptVisionResult(started.data.id);
      if (data.status === 'done') return data.fields ?? null;
      if (data.status === 'failed') return null;
    }
  } catch {
    // Offline, 503, 404 (expired), network: the on-device result stands.
  }
  return null;
}
