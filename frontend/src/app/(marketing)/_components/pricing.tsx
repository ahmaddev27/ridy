import Link from "next/link";
import { Check } from "lucide-react";

type Plan = { id: number; name: string; price: number; duration_days: number };

// Every plan unlocks the full platform; they differ only in price and term, so
// the included-features list is shared (honest: there are no feature tiers).
const INCLUDED = [
  "Vollständiges Dashboard",
  "Mobile Fahrer-App",
  "Echtzeit-Benachrichtigungen",
  "Live-Karte deiner Fahrer",
  "Mehrsprachig (DE / EN / AR)",
  "E-Mail-Support",
];

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

function term(days: number): string {
  if (days % 365 === 0) return days === 365 ? "pro Jahr" : `für ${days / 365} Jahre`;
  if (days === 30 || days === 31) return "pro Monat";
  if (days === 90) return "pro Quartal";
  if (days === 7) return "pro Woche";
  return `für ${days} Tage`;
}

async function fetchPlans(): Promise<Plan[]> {
  // Server-side fetch needs an absolute URL. When the client bundle is built
  // same-origin (empty NEXT_PUBLIC_API_URL), fall back to the canonical domain,
  // which the frontend container can reach through Caddy.
  const base = process.env.NEXT_PUBLIC_API_URL || "https://reidey.de";
  try {
    const res = await fetch(`${base}/api/v1/plans`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Plan[] };
    return body.data ?? [];
  } catch {
    return [];
  }
}

export async function Pricing() {
  const plans = await fetchPlans();

  // Primary plan = cheapest active plan. The API returns plans cheapest-first,
  // so the first item is the one we present.
  const plan = plans[0];

  return (
    <section id="preise" className="scroll-mt-20 border-t border-line bg-surface">
      <div className="mx-auto max-w-[1200px] px-4 py-20 lg:py-28">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Einfache, faire Preise
          </h2>
          <p className="mt-4 text-lg text-ink-muted">
            Ein Abonnement, voller Funktionsumfang. Wähle die Laufzeit, die zu deiner Flotte passt.
          </p>
        </div>

        {!plan ? (
          <div className="mx-auto mt-12 max-w-md rounded-xl border border-line bg-canvas p-8 text-center">
            <p className="text-ink-muted">
              Preise auf Anfrage. Erstelle ein Konto, um loszulegen.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90"
            >
              Kostenlos starten
            </Link>
          </div>
        ) : (
          <div className="mx-auto mt-12 flex max-w-md flex-col rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-8 ring-1 ring-emerald-500/20">
            <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>

            <div className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-bold tracking-tight text-ink">
                {euro.format(plan.price)}
              </span>
              <span className="text-sm text-ink-muted">{term(plan.duration_days)}</span>
            </div>

            <ul className="mt-7 space-y-3">
              {INCLUDED.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-sm text-ink-muted">
                  <Check
                    size={18}
                    strokeWidth={2}
                    className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                  />
                  {feature}
                </li>
              ))}
            </ul>

            <Link
              href="/login"
              className="mt-8 inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-ink transition-opacity hover:opacity-90"
            >
              Loslegen
            </Link>
          </div>
        )}

        <p className="mt-8 text-sm text-ink-subtle">
          Alle Preise verstehen sich zzgl. gesetzlicher Umsatzsteuer. Die Aktivierung erfolgt über
          einen Code deiner Flotte oder deines Vertriebspartners.
        </p>
      </div>
    </section>
  );
}
