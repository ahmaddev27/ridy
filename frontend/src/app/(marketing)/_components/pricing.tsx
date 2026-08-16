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
  const base = process.env.NEXT_PUBLIC_API_URL ?? "https://reidey.de";
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

  // Best value = lowest price per day; used to highlight one card (data-driven).
  const bestId =
    plans.length > 1
      ? plans.reduce((best, p) =>
          p.price / p.duration_days < best.price / best.duration_days ? p : best,
        ).id
      : plans[0]?.id;

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

        {plans.length === 0 ? (
          <div className="mt-12 rounded-xl border border-line bg-canvas p-8 text-center">
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
          <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => {
              const featured = plan.id === bestId;
              return (
                <div
                  key={plan.id}
                  className={
                    "flex flex-col rounded-xl border p-7 " +
                    (featured
                      ? "border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30"
                      : "border-line bg-canvas")
                  }
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
                    {featured && (
                      <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
                        Bester Wert
                      </span>
                    )}
                  </div>

                  <div className="mt-5 flex items-baseline gap-1.5">
                    <span className="text-4xl font-bold tracking-tight text-ink">
                      {euro.format(plan.price)}
                    </span>
                    <span className="text-sm text-ink-muted">{term(plan.duration_days)}</span>
                  </div>

                  <ul className="mt-7 flex-1 space-y-3">
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
                    className={
                      "mt-8 inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition-opacity hover:opacity-90 " +
                      (featured
                        ? "bg-emerald-600 text-white"
                        : "bg-primary text-primary-ink")
                    }
                  >
                    Loslegen
                  </Link>
                </div>
              );
            })}
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
