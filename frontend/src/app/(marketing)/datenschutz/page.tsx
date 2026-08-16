export const metadata = {
  title: "Datenschutz · Reidey",
  description:
    "Datenschutzerklärung von Reidey nach DSGVO: Verantwortlicher, verarbeitete Daten, Zwecke und Rechtsgrundlagen, Auftragsverarbeitung, Betroffenenrechte.",
};

export default function DatenschutzPage() {
  return (
    <div className="mx-auto max-w-[70ch] px-4 py-16 lg:py-24">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-ink">
        <strong className="font-semibold">Vorlage:</strong> Bitte durch die tatsächlichen
        Unternehmensangaben ersetzen. Alle mit eckigen Klammern markierten Felder sind Platzhalter.
      </div>

      <h1 className="mt-10 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Datenschutzerklärung
      </h1>
      <p className="mt-3 text-sm text-ink-subtle">Stand: [Datum]</p>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-ink-muted">
        <section>
          <h2 className="text-xl font-semibold text-ink">1. Verantwortlicher</h2>
          <p className="mt-3">
            Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) ist:
          </p>
          <p className="mt-3">
            [Firmenname]
            <br />
            [Anschrift]
            <br />
            Vertreten durch: [Geschäftsführer]
            <br />
            E-Mail: [E-Mail]
            <br />
            Telefon: [Telefon]
          </p>
          <p className="mt-3">
            Datenschutzbeauftragter (falls bestellt): [Name / Kontakt DSB]
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">2. Rolle als Auftragsverarbeiter</h2>
          <p className="mt-3">
            Reidey ist eine Flottenmanagement-Plattform. Personenbezogene Daten von Fahrern
            verarbeiten wir im Auftrag und nach Weisung des jeweiligen Flottenbetreibers im Sinne
            von Art. 28 DSGVO (Auftragsverarbeitung). Verantwortlich für diese Daten bleibt der
            Flottenbetreiber. Für die eigenen Kontodaten des Flottenbetreibers sind wir selbst
            Verantwortlicher.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">3. Welche Daten wir verarbeiten</h2>
          <h3 className="mt-4 text-base font-semibold text-ink">Kontodaten der Flottenbetreiber</h3>
          <p className="mt-2">
            Name, E-Mail-Adresse, Zugangsdaten, Abrechnungs- und Vertragsdaten.
          </p>
          <h3 className="mt-4 text-base font-semibold text-ink">Fahrerdaten (im Auftrag)</h3>
          <p className="mt-2">
            Name, E-Mail-Adresse, Zugangsdaten sowie Angaben, die der Flottenbetreiber zur
            Verwaltung seiner Fahrer hinterlegt.
          </p>
          <h3 className="mt-4 text-base font-semibold text-ink">Nutzungs- und Geräte-Metadaten</h3>
          <p className="mt-2">
            Technische Informationen wie Geräte- und Browserangaben, Zeitstempel und Protokolldaten,
            die für den sicheren Betrieb der Plattform erforderlich sind.
          </p>
          <h3 className="mt-4 text-base font-semibold text-ink">Cookies und Session</h3>
          <p className="mt-2">
            Für die Anmeldung und den Betrieb setzen wir technisch notwendige Cookies und
            Session-Informationen ein.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">4. Zwecke und Rechtsgrundlagen</h2>
          <p className="mt-3">
            Wir verarbeiten personenbezogene Daten zur Bereitstellung und zum Betrieb der Plattform,
            zur Vertragserfüllung, zur Kommunikation und zur Abrechnung. Rechtsgrundlagen sind:
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>Art. 6 Abs. 1 lit. b DSGVO (Erfüllung des Vertrags),</li>
            <li>Art. 6 Abs. 1 lit. c DSGVO (rechtliche Verpflichtungen),</li>
            <li>Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse am sicheren Betrieb),</li>
            <li>Art. 28 DSGVO für die Verarbeitung im Auftrag der Flottenbetreiber.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">5. Benachrichtigungen</h2>
          <p className="mt-3">
            Zur Zustellung von Push- und E-Mail-Benachrichtigungen verarbeiten wir die dafür
            erforderlichen Kontakt- und Gerätekennungen. Für Push-Nachrichten kann ein
            Zustelldienst (z. B. Firebase Cloud Messaging) eingesetzt werden. Dabei werden nur die
            zur Zustellung notwendigen Daten übermittelt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">6. Empfänger und Hosting</h2>
          <p className="mt-3">
            Das Hosting und die Verarbeitung erfolgen innerhalb der Europäischen Union. Eingesetzte
            Dienstleister werden sorgfältig ausgewählt und, soweit erforderlich, im Rahmen von
            Auftragsverarbeitungsverträgen gebunden. Eine Übermittlung in Drittländer findet nur
            statt, sofern hierfür geeignete Garantien nach Art. 44 ff. DSGVO bestehen.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">7. Speicherdauer und Datenminimierung</h2>
          <p className="mt-3">
            Wir verarbeiten nur die Daten, die für den jeweiligen Zweck erforderlich sind
            (Datenminimierung), und speichern sie nur so lange, wie es für die genannten Zwecke oder
            aufgrund gesetzlicher Aufbewahrungspflichten notwendig ist. Anschließend werden die Daten
            gelöscht oder anonymisiert.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">8. Ihre Rechte</h2>
          <p className="mt-3">Nach der DSGVO stehen Ihnen folgende Rechte zu:</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>Auskunft (Art. 15 DSGVO),</li>
            <li>Berichtigung (Art. 16 DSGVO),</li>
            <li>Löschung (Art. 17 DSGVO),</li>
            <li>Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
            <li>Datenübertragbarkeit (Art. 20 DSGVO),</li>
            <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO).</li>
          </ul>
          <p className="mt-3">
            Betrifft die Verarbeitung Fahrerdaten, die wir im Auftrag verarbeiten, richten Sie Ihr
            Anliegen bitte an den jeweiligen Flottenbetreiber. Wir unterstützen den Betreiber bei
            der Erfüllung dieser Rechte.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">9. Beschwerderecht</h2>
          <p className="mt-3">
            Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn Sie
            der Ansicht sind, dass die Verarbeitung Ihrer personenbezogenen Daten gegen die DSGVO
            verstößt. Zuständig ist unter anderem die Aufsichtsbehörde Ihres gewöhnlichen
            Aufenthaltsorts.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">10. Kontakt</h2>
          <p className="mt-3">
            Bei Fragen zum Datenschutz erreichen Sie uns unter [E-Mail]. Für Anliegen rund um Ihre
            Rechte wenden Sie sich bitte an den oben genannten Verantwortlichen bzw. den
            Datenschutzbeauftragten.
          </p>
        </section>
      </div>
    </div>
  );
}
