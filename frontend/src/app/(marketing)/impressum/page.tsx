export const metadata = {
  title: "Impressum · Reidey",
  description: "Impressum von Reidey gemäß § 5 TMG.",
};

export default function ImpressumPage() {
  return (
    <div className="mx-auto max-w-[70ch] px-4 py-16 lg:py-24">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-ink">
        <strong className="font-semibold">Vorlage:</strong> Alle Platzhalter in eckigen Klammern
        müssen vor Veröffentlichung durch die tatsächlichen Unternehmensangaben ersetzt werden.
      </div>

      <h1 className="mt-10 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Impressum</h1>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-ink-muted">
        <section>
          <h2 className="text-xl font-semibold text-ink">Angaben gemäß § 5 TMG</h2>
          <p className="mt-3">
            [Firmenname]
            <br />
            [Rechtsform]
            <br />
            [Anschrift]
            <br />
            [PLZ, Ort]
            <br />
            [Land]
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">Vertreten durch</h2>
          <p className="mt-3">[Vertretungsberechtigter / Geschäftsführer]</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">Kontakt</h2>
          <p className="mt-3">
            Telefon: [Telefon]
            <br />
            E-Mail: [E-Mail]
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">Registereintrag</h2>
          <p className="mt-3">
            Registergericht: [Registergericht]
            <br />
            Registernummer: [HRB / Registernummer]
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">Umsatzsteuer-ID</h2>
          <p className="mt-3">
            Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz:
            <br />
            [USt-IdNr.]
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
          </h2>
          <p className="mt-3">
            [Name]
            <br />
            [Anschrift]
          </p>
        </section>
      </div>
    </div>
  );
}
