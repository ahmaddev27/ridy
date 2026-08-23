"use client";

import { useState } from "react";
import {
  User,
  Phone,
  Mail,
  MessageSquare,
  Send,
  CheckCircle2,
} from "lucide-react";
import { Container } from "./ui";

type Status = "idle" | "loading" | "success" | "error";

const inputClass =
  "w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-[#10b981]/60 focus:outline-none focus:ring-1 focus:ring-[#10b981]/40";

function FieldLabel({
  icon: Icon,
  children,
}: {
  icon: typeof User;
  children: React.ReactNode;
}) {
  return (
    <span className="mb-2 flex items-center gap-2 text-sm font-medium text-white/85">
      <Icon size={15} className="text-[#10b981]" />
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
    <section id="kontakt-formular" className="py-14 lg:py-28">
      <Container>
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <span className="glass inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-white/85">
              <span className="h-2 w-2 rounded-full bg-[#10b981]" />
              Kontakt
            </span>
            <h2 className="font-heading mt-5 text-3xl font-bold text-white sm:text-4xl">
              Schreib uns — wir antworten{" "}
              <span
                style={{
                  background: "linear-gradient(100deg,#34d399,#059669)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                innerhalb 24 Stunden.
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[#9ca3af]">
              Egal ob Flotte mit 5 oder 500 Fahrern — erzähl uns, was du brauchst.
            </p>
          </div>

          <div className="card-modern mt-10 rounded-3xl p-6 lg:p-8">
            {status === "success" ? (
              <div className="flex flex-col items-center py-8 text-center">
                <CheckCircle2 size={48} className="text-[#10b981]" />
                <p className="mt-4 text-xl font-semibold text-white">
                  Nachricht gesendet!
                </p>
                <p className="mt-2 text-sm text-[#9ca3af]">
                  Danke — wir melden uns innerhalb von 24 Stunden zurück.
                </p>
                <button
                  type="button"
                  onClick={() => setStatus("idle")}
                  className="glass mt-6 rounded-2xl px-6 py-3 text-sm font-semibold text-white"
                >
                  Neue Nachricht
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="block">
                    <FieldLabel icon={User}>Name</FieldLabel>
                    <input
                      name="name"
                      type="text"
                      required
                      placeholder="Max Mustermann"
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel icon={Phone}>Telefon</FieldLabel>
                    <input
                      name="phone"
                      type="tel"
                      placeholder="+49 ..."
                      className={inputClass}
                    />
                  </label>
                </div>

                <label className="block">
                  <FieldLabel icon={Mail}>E-Mail</FieldLabel>
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="du@firma.de"
                    className={inputClass}
                  />
                </label>

                <label className="block">
                  <FieldLabel icon={MessageSquare}>Nachricht</FieldLabel>
                  <textarea
                    name="message"
                    required
                    rows={5}
                    placeholder="Wie viele Fahrer hat eure Flotte? Welche Plattformen nutzt ihr?"
                    className={`${inputClass} resize-none`}
                  />
                </label>

                {status === "error" ? (
                  <p className="text-sm text-red-400">
                    Etwas ist schiefgelaufen. Bitte versuche es erneut.
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-semibold text-white disabled:opacity-70"
                  style={{ background: "linear-gradient(100deg,#10b981,#059669)" }}
                >
                  {status === "loading" ? (
                    "Wird gesendet…"
                  ) : (
                    <>
                      Nachricht senden
                      <Send size={16} />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
