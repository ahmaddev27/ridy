"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Ticket, Search, Loader2, CheckCircle2, Copy, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";
import { CodesLedger } from "@/components/billing/codes-ledger";
import {
  getResellerPlans,
  searchResellerCompanies,
  generateResellerCode,
  getResellerCodes,
  type ResellerPlan,
  type ResellerCompany,
  type GeneratedCode,
} from "@/lib/api/reseller";

export default function ResellerPage() {
  const { t, locale } = useI18n();
  const c = (k: string) => t(`screens.reseller.${k}`);

  const [plans, setPlans] = useState<ResellerPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResellerCompany[]>([]);
  const [searching, setSearching] = useState(false);
  const [company, setCompany] = useState<ResellerCompany | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<GeneratedCode | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getResellerPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  // Debounced company search by name or phone.
  useEffect(() => {
    if (company) return; // a company is picked; don't keep searching
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      setSearching(true);
      searchResellerCompanies(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, company]);

  const money = (n: number) => new Intl.NumberFormat(latnLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const selectedPlan = useMemo(() => plans.find((p) => String(p.id) === planId) ?? null, [plans, planId]);
  const canGenerate = Boolean(planId && company);

  async function generate() {
    if (!canGenerate || !company) return;
    setBusy(true);
    try {
      const res = await generateResellerCode(company.id, Number(planId));
      setCode(res);
      toast.success(c("generated"));
    } catch (e) {
      toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCode(null);
    setCompany(null);
    setQuery("");
    setResults([]);
  }

  return (
    <div className="space-y-8">
      <div className="mx-auto max-w-xl space-y-6">
      <PageHeader tkey="reseller" />

      {code ? (
        <Card className="p-6 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success-fg" />
          <p className="mt-3 text-sm text-ink-muted">{c("codeFor").replace("{company}", code.company).replace("{plan}", code.plan)}</p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="rounded-xl bg-primary px-6 py-3 font-mono text-3xl font-bold tracking-[0.3em] text-primary-ink" dir="ltr">{code.code}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(code.code); toast.success(c("copied")); }}
              className="rounded-lg p-2 text-ink-subtle hover:bg-surface-2 hover:text-ink"
              title={c("copy")}
            >
              <Copy className="h-5 w-5" />
            </button>
          </div>
          <p className="mt-3 text-sm text-ink-muted">
            {money(code.price)} · {c("daysN").replace("{n}", String(code.days))} · {c("validHint")}
          </p>
          <Button className="mt-5" onClick={reset}>{c("newCode")}</Button>
        </Card>
      ) : (
        <Card className="space-y-5 p-6">
          {/* Plan */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">{c("plan")}</label>
            <Select
              value={planId}
              onChange={setPlanId}
              placeholder={c("selectPlan")}
              options={plans.map((p) => ({ value: String(p.id), label: `${p.name} · ${money(p.price)} · ${c("daysN").replace("{n}", String(p.duration_days))}` }))}
            />
            {plans.length === 0 && <p className="mt-1 text-xs text-warning-fg">{c("noPlans")}</p>}
          </div>

          {/* Company search */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink">{c("company")}</label>
            {company ? (
              <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-ink-muted" />
                  <span className="font-medium text-ink">{company.name}</span>
                  {company.phone && <span className="text-ink-subtle" dir="ltr">{company.phone}</span>}
                </span>
                <button onClick={() => setCompany(null)} className="text-xs font-medium text-ink-muted hover:text-ink">{c("change")}</button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle ltr:left-3 rtl:right-3" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={c("searchCompany")}
                  className="w-full rounded-lg border border-line bg-surface py-2 text-sm outline-none focus:border-ink focus:ring-2 focus:ring-line ltr:pl-9 ltr:pr-3 rtl:pr-9 rtl:pl-3"
                />
                {(searching || results.length > 0) && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
                    {searching ? (
                      <div className="flex items-center justify-center py-4 text-ink-subtle"><Loader2 className="h-4 w-4 animate-spin" /></div>
                    ) : (
                      results.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => { setCompany(r); setResults([]); }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-surface-2"
                        >
                          <span className="font-medium text-ink">{r.name}</span>
                          {r.phone && <span className="text-xs text-ink-subtle" dir="ltr">{r.phone}</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Summary + generate */}
          {selectedPlan && company && (
            <div className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-muted">
              {c("summary").replace("{company}", company.name).replace("{plan}", selectedPlan.name).replace("{price}", money(selectedPlan.price))}
            </div>
          )}
          <Button className="w-full" onClick={generate} disabled={!canGenerate || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
            {c("generate")}
          </Button>
        </Card>
      )}
      </div>

      {/* The reseller's own codes and their lifecycle. */}
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{c("myCodesTitle")}</h2>
          <p className="text-sm text-ink-muted">{c("myCodesDesc")}</p>
        </div>
        <CodesLedger
          key={code?.code ?? "list"}
          fetchCodes={getResellerCodes}
          onRegenerate={async (row) => {
            if (!row.plan_id) return;
            try {
              const res = await generateResellerCode(row.tenant_id, row.plan_id);
              setCode(res);
              toast.success(c("generated"));
            } catch (e) {
              toast.error(c("failed"), { description: e instanceof Error ? e.message : undefined });
            }
          }}
        />
      </section>
    </div>
  );
}
