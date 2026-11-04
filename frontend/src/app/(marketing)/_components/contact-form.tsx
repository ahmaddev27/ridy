"use client";

import { useState } from "react";
import { User, Phone, Mail, MessageSquare, Send, CheckCircle2 } from "lucide-react";
import { Container, Eyebrow } from "./ui";

type Status = "idle" | "loading" | "success" | "error";

function FieldLabel({ icon: Icon, children }: { icon: typeof User; children: React.ReactNode }) {
  return (
    <span className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-ink-muted">
      <Icon size={14} className="text-primary" aria-hidden />
      {children}
    </span>
  );
}

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const payload = {
      name: String(data.get("name") || ""),
      email: String(data.get("email") || ""),
      phone: String(data.get("phone") || ""),
      message: String(data.get("message") || ""),
    };

    setStatus("loading");
    try {
      const base = process.env.NEXT_PUBLIC_API_URL || "";
      const res = await fetch(`${base}/api/v1/contact`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("request failed");
      form.reset();
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section id="kontakt-formular" className="mkt-section">
      <Container>
        <div className="mkt-card mx-auto max-w-3xl !rounded-[20px] !p-[clamp(24px,4vw,44px)]">
          <div className="mb-8 flex flex-col gap-3">
            <Eyebrow>Kontakt</Eyebrow>
            <h2 className="mkt-h2">Schreib uns — wir antworten innerhalb 24 Stunden.</h2>
            <p className="text-[15.5px] leading-[1.6] text-ink-muted">
              Egal ob Flotte mit 5 oder 500 Fahrern — erzähl uns, was du brauchst.
            </p>
          </div>

          {status === "success" ? (
            <div className="flex flex-col items-center py-8 text-center" role="status">
              <CheckCircle2 size={44} className="text-primary" aria-hidden />
              <p className="mt-4 text-xl font-semibold">Nachricht gesendet!</p>
              <p className="mt-2 text-sm text-ink-muted">Danke — wir melden uns innerhalb von 24 Stunden zurück.</p>
              <button type="button" onClick={() => setStatus("idle")} className="mkt-btn mt-6 !py-3">
                Neue Nachricht
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <FieldLabel icon={User}>Name</FieldLabel>
                  <input name="name" type="text" required placeholder="Max Mustermann" className="mkt-input" />
                </label>
                <label className="block">
                  <FieldLabel icon={Phone}>Telefon</FieldLabel>
                  <input name="phone" type="tel" placeholder="+49 ..." className="mkt-input" />
                </label>
              </div>

              <label className="block">
                <FieldLabel icon={Mail}>E-Mail</FieldLabel>
                <input name="email" type="email" required placeholder="du@firma.de" className="mkt-input" />
              </label>

              <label className="block">
                <FieldLabel icon={MessageSquare}>Nachricht</FieldLabel>
                <textarea
                  name="message"
                  required
                  rows={5}
                  placeholder="Wie viele Fahrer hat eure Flotte? Welche Plattformen nutzt ihr?"
                  className="mkt-input resize-none"
                />
              </label>

              {status === "error" ? (
                <p className="text-sm font-medium text-[var(--danger-fg)]" role="alert">
                  Etwas ist schiefgelaufen. Bitte versuche es erneut.
                </p>
              ) : null}

              <button type="submit" disabled={status === "loading"} className="mkt-btn w-full">
                {status === "loading" ? (
                  "Wird gesendet…"
                ) : (
                  <>
                    Nachricht senden
                    <Send size={16} aria-hidden />
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </Container>
    </section>
  );
}
