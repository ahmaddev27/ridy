export const metadata = {
  title: "Impressum · Reidey",
  description: "Impressum von Reidey gemäß § 5 TMG.",
};

export default function ImpressumPage() {
  return (
    <div className="mx-auto max-w-[70ch] px-4 py-16 lg:py-24">
      <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">Impressum</h1>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-ink-muted">
        <section>
          <h2 className="text-xl font-semibold text-ink">Angaben gemäß § 5 TMG</h2>
          <p className="mt-3">
            Reidey
            <br />
            Einzelunternehmen
            <br />
            Hölderlinstraße 17
            <br />
            42699 Solingen
            <br />
            Deutschland
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">Vertreten durch</h2>
          <p className="mt-3">Reidey</p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">Kontakt</h2>
          <p className="mt-3">
            Telefon: +49 1590 5655286
            <br />
            E-Mail: info@reidey.de
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV
          </h2>
          <p className="mt-3">
            Reidey
            <br />
            Hölderlinstraße 17, 42699 Solingen, Deutschland
          </p>
        </section>
      </div>
    </div>
  );
}
