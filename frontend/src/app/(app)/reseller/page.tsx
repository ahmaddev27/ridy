"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Ticket, Search, Loader2, CircleCheck, Copy, Building2, Plus, TriangleAlert } from "lucide-react";
import { PageHead } from "@/components/ui/rd";
import { useI18n } from "@/lib/i18n/context";
import { latnLocale } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/api/payments";
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
import { apiErrorMessage } from "@/lib/api/error-message";

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
      toast.error(c("failed"), { description: apiErrorMessage(e, t, locale) });
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
    <>
      <div className="rs-wrap">
        <PageHead title={t("pages.reseller.title")} sub={t("pages.reseller.subtitle")} />

        {code ? (
          <section className="card">
            <div className="card-body stack-lg" style={{ textAlign: "center", alignItems: "center" }}>
              <span className="stat-ico success" style={{ width: 56, height: 56, borderRadius: 99 }}>
                <CircleCheck style={{ width: 28, height: 28 }} />
              </span>
              <h2 className="section-title" style={{ fontSize: 17 }}>
                {c("codeFor").replace("{company}", code.company).replace("{plan}", code.plan)}
              </h2>
              <div className="rs-code" style={{ width: "100%" }}>
                <b>{code.code}</b>
                <button
                  type="button"
                  aria-label={c("copy")}
                  title={c("copy")}
                  onClick={() => {
                    navigator.clipboard.writeText(code.code);
                    toast.success(c("copied"));
                  }}
                >
                  <Copy className="ico-sm" />
                </button>
              </div>
              <div className="stack-sm">
                <div className="strong num">
                  {money(code.price)} · {c("daysN").replace("{n}", String(code.days))} · {c("validHint")}
                </div>
                {code.payment_ref && (
                  <div className="text-sm muted">
                    {c("paymentRef")} <span className="mono" dir="ltr">{code.payment_ref}</span>
                  </div>
                )}
                {code.payment_method && (
                  <div className="text-sm muted">
                    {t("screens.codes.method")}: {paymentMethodLabel(code.payment_method, t)}
                  </div>
                )}
              </div>
              <button type="button" className="btn btn-secondary" onClick={reset}>
                <Plus />
                {c("newCode")}
              </button>
            </div>
          </section>
        ) : (
          <section className="card">
            <div className="card-body stack-lg">
              {/* Plan */}
              {plans.length === 0 ? (
                <div className="callout warning">
                  <TriangleAlert />
                  <div>{c("noPlans")}</div>
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="rs-plan">{c("plan")}</label>
                  <select id="rs-plan" className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                    <option value="">{c("selectPlan")}</option>
                    {plans.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {`${p.name} · ${money(p.price)} · ${c("daysN").replace("{n}", String(p.duration_days))}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Company search */}
              <div className="field">
                <label htmlFor="rs-q">{c("company")}</label>
                {company ? (
                  <div className="row card inset" style={{ padding: "10px 12px", gap: 10 }}>
                    <span className="stat-ico"><Building2 /></span>
                    <div className="grow truncate">
                      <div className="strong truncate">{company.name}</div>
                      {company.phone && <div className="subtle text-sm num" dir="ltr">{company.phone}</div>}
                    </div>
                    <button
                      type="button"
                      className="link text-sm"
                      style={{ background: "none", border: 0, cursor: "pointer" }}
                      onClick={() => setCompany(null)}
                    >
                      {c("change")}
                    </button>
                  </div>
                ) : (
                  <div className="rs-search">
                    <div className="input-group">
                      <Search />
                      <input
                        id="rs-q"
                        className="input"
                        type="search"
                        autoComplete="off"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={c("searchCompany")}
                      />
                    </div>
                    {(searching || results.length > 0) && (
                      <div className="rs-results">
                        {searching ? (
                          <div className="row" style={{ justifyContent: "center", padding: 12 }}>
                            <Loader2 className="ico-sm animate-spin" />
                          </div>
                        ) : (
                          results.map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                setCompany(r);
                                setResults([]);
                              }}
                            >
                              <span className="truncate">{r.name}</span>
                              {r.phone && <span className="subtle text-sm num" dir="ltr">{r.phone}</span>}
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
                <p className="text-sm muted">
                  {c("summary")
                    .replace("{company}", company.name)
                    .replace("{plan}", selectedPlan.name)
                    .replace("{price}", money(selectedPlan.price))}
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                onClick={generate}
                disabled={!canGenerate || busy}
              >
                {busy ? <Loader2 className="animate-spin" /> : <Ticket />}
                {c("generate")}
              </button>
            </div>
          </section>
        )}
      </div>

      {/* The reseller's own codes and their lifecycle. */}
      <CodesLedger
        key={code?.code ?? "list"}
        title={c("myCodesTitle")}
        sub={c("myCodesDesc")}
        fetchCodes={getResellerCodes}
        onRegenerate={async (row) => {
          if (!row.plan_id) return;
          try {
            const res = await generateResellerCode(row.tenant_id, row.plan_id);
            setCode(res);
            toast.success(c("generated"));
          } catch (e) {
            toast.error(c("failed"), { description: apiErrorMessage(e, t, locale) });
          }
        }}
      />
    </>
  );
}
