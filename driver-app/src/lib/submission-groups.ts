/**
 * Grouping a driver's submissions into months, and each month into weeks.
 *
 * ## The week belongs to the month containing its MONDAY
 *
 * This is not a formatting choice. El-Professor's whole monthly aggregation —
 * the Abrechnung, the salaries, the Stundennachweise — is built on that one
 * rule (`utils/weekCalculations.ts` there), and the fleet week on this side
 * starts on Monday too. So a week that straddles the turn of the month belongs
 * to the month its Monday falls in, and **1 April on a Tuesday is March's**.
 *
 * Grouping the driver's own list any other way would make him and his company
 * disagree about which month a receipt is in, which is exactly the kind of
 * disagreement nobody notices until a payslip is wrong.
 *
 * ## Why `created_at` and not the receipt's date
 *
 * The list answers "what did I send, and when". A note carries a date RANGE and
 * a receipt carries the date printed on it, so neither is a single instant the
 * two kinds share; `created_at` is, and it is the question the driver is
 * actually asking. The receipt's own date is on the receipt.
 *
 * ## Numbering
 *
 * `weekNo` counts the business weeks of that month from 1, in calendar order,
 * so week 1 is the one whose Monday is the first Monday of the month. That is
 * the same convention `IncomeManagement` writes into `income.description` as
 * `Woche N` on the other side.
 */

/** The shape this module needs. The screen's row type is a superset. */
export type GroupableSubmission = {
  id: string;
  created_at: string | null;
};

export type WeekGroup<T> = {
  /** 1-based, counted within the month. */
  weekNo: number;
  /** The week's Monday, `YYYY-MM-DD`. */
  mondayIso: string;
  /** The week's Sunday, `YYYY-MM-DD` — inclusive. */
  sundayIso: string;
  items: T[];
};

export type MonthGroup<T> = {
  /** `YYYY-MM` of the month the weeks' Mondays fall in. */
  monthKey: string;
  year: number;
  /** 1-based, so 9 is September. The caller formats the name. */
  month: number;
  weeks: WeekGroup<T>[];
  /** Every item in the month, so a header can count without flattening. */
  count: number;
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The Monday of the week containing `d`, at local midnight.
 *
 * `getDay()` is 0 for Sunday, so Sunday is six days after its Monday and not
 * one day before the next — the off-by-one that quietly moves every Sunday
 * into the following week.
 */
export function mondayOf(d: Date): Date {
  const day = d.getDay();
  const back = day === 0 ? 6 : day - 1;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Months newest first, and the weeks inside each month newest first.
 *
 * A row with no `created_at` is kept rather than dropped — it is something the
 * driver sent, and a list that silently loses an entry is worse than one with
 * an entry in an odd place. Such rows land in a group of their own, which the
 * caller recognises by `monthKey === ''`, and that group sorts last.
 */
export function groupSubmissions<T extends GroupableSubmission>(rows: T[]): MonthGroup<T>[] {
  const byMonday = new Map<string, T[]>();
  const undated: T[] = [];

  for (const row of rows) {
    if (row.created_at === null) {
      undated.push(row);
      continue;
    }
    const at = new Date(row.created_at);
    if (Number.isNaN(at.getTime())) {
      undated.push(row);
      continue;
    }
    const key = iso(mondayOf(at));
    const bucket = byMonday.get(key);
    if (bucket === undefined) byMonday.set(key, [row]);
    else bucket.push(row);
  }

  // One pass to the months, keyed on the MONDAY's month, which is the rule.
  const months = new Map<string, { year: number; month: number; mondays: string[] }>();
  for (const mondayIso of byMonday.keys()) {
    const [y, m] = mondayIso.split('-').map(Number);
    const key = `${y}-${pad(m)}`;
    const entry = months.get(key);
    if (entry === undefined) months.set(key, { year: y, month: m, mondays: [mondayIso] });
    else entry.mondays.push(mondayIso);
  }

  const out: MonthGroup<T>[] = [];
  for (const [monthKey, { year, month, mondays }] of months) {
    // Ascending first, because the NUMBER is calendar order: week 1 is the
    // month's first week whichever way the list is then shown.
    const ascending = [...mondays].sort();
    const weeks: WeekGroup<T>[] = ascending.map((mondayIso, index) => {
      const [y, m, d] = mondayIso.split('-').map(Number);
      const sunday = new Date(y, m - 1, d + 6);
      const items = [...(byMonday.get(mondayIso) ?? [])].sort(byNewest);
      return { weekNo: index + 1, mondayIso, sundayIso: iso(sunday), items };
    });
    weeks.reverse();
    out.push({
      monthKey,
      year,
      month,
      weeks,
      count: weeks.reduce((sum, w) => sum + w.items.length, 0),
    });
  }

  out.sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0));

  if (undated.length > 0) {
    out.push({
      monthKey: '',
      year: 0,
      month: 0,
      weeks: [{ weekNo: 0, mondayIso: '', sundayIso: '', items: undated }],
      count: undated.length,
    });
  }
  return out;
}

function byNewest(a: GroupableSubmission, b: GroupableSubmission): number {
  const x = a.created_at ?? '';
  const y = b.created_at ?? '';
  return x < y ? 1 : x > y ? -1 : 0;
}

/** `13.10` — the day and month of a `YYYY-MM-DD`, for a week's range label. */
export function shortDay(isoDate: string): string {
  const [, m, d] = isoDate.split('-');
  return `${d}.${m}`;
}
