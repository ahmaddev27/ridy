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
          <p>
            Der Schutz Ihrer personenbezogenen Daten ist uns wichtig. Diese Erklärung informiert
            Sie darüber, welche Daten wir im Zusammenhang mit der Nutzung von Reidey, unserer
            Flottenmanagement-Plattform, verarbeiten, zu welchen Zwecken dies geschieht und welche
            Rechte Ihnen zustehen.
          </p>
        </section>

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
            Einen Datenschutzbeauftragten erreichen Sie, sofern bestellt, unter: [Name / Kontakt
            DSB].
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">2. Erhobene Daten</h2>
          <p className="mt-3">
            Je nach Nutzung der Plattform verarbeiten wir folgende Kategorien personenbezogener
            Daten:
          </p>
          <h3 className="mt-5 text-base font-semibold text-ink">Kontodaten der Flottenbetreiber</h3>
          <p className="mt-2">
            Name, E-Mail-Adresse, Zugangsdaten sowie Vertrags- und Abrechnungsdaten, die für die
            Verwaltung des Kontos erforderlich sind.
          </p>
          <h3 className="mt-5 text-base font-semibold text-ink">Fahrerdaten</h3>
          <p className="mt-2">
            Name, E-Mail-Adresse, Zugangsdaten sowie weitere Angaben, die der Flottenbetreiber zur
            Verwaltung seiner Fahrer hinterlegt. Diese Daten verarbeiten wir im Auftrag des
            Betreibers.
          </p>
          <h3 className="mt-5 text-base font-semibold text-ink">Nutzungs- und Geräte-Metadaten</h3>
          <p className="mt-2">
            Technische Informationen wie Geräte- und Browserangaben, IP-Adresse, Zeitstempel und
            Protokolldaten, die für den sicheren und stabilen Betrieb der Plattform erforderlich
            sind.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            3. Zwecke und Rechtsgrundlagen nach Art. 6 DSGVO
          </h2>
          <p className="mt-3">
            Wir verarbeiten personenbezogene Daten, um die Plattform bereitzustellen und zu
            betreiben, den Vertrag zu erfüllen, mit Ihnen zu kommunizieren, die Abrechnung
            abzuwickeln und die Sicherheit unserer Systeme zu gewährleisten. Die Verarbeitung
            stützt sich auf folgende Rechtsgrundlagen:
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>Art. 6 Abs. 1 lit. b DSGVO zur Erfüllung des Vertrags und vorvertraglicher Maßnahmen,</li>
            <li>Art. 6 Abs. 1 lit. c DSGVO zur Erfüllung rechtlicher Verpflichtungen,</li>
            <li>Art. 6 Abs. 1 lit. f DSGVO zur Wahrung berechtigter Interessen am sicheren Betrieb,</li>
            <li>Art. 6 Abs. 1 lit. a DSGVO, soweit Sie in eine Verarbeitung eingewilligt haben.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">4. Auftragsverarbeitung</h2>
          <p className="mt-3">
            Personenbezogene Daten von Fahrern verarbeiten wir ausschließlich im Auftrag und nach
            Weisung des jeweiligen Flottenbetreibers gemäß Art. 28 DSGVO. Verantwortlicher für
            diese Daten bleibt der Flottenbetreiber. Grundlage der Zusammenarbeit ist ein
            Auftragsverarbeitungsvertrag, der die Rechte und Pflichten der Beteiligten regelt. Für
            die eigenen Konto- und Vertragsdaten des Flottenbetreibers sind wir selbst
            Verantwortlicher.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            5. Speicherdauer und Datenminimierung
          </h2>
          <p className="mt-3">
            Wir verarbeiten ausschließlich die Daten, die für den jeweiligen Zweck erforderlich
            sind, und folgen dabei dem Grundsatz der Datenminimierung. Personenbezogene Daten
            speichern wir nur so lange, wie es für die genannten Zwecke oder aufgrund gesetzlicher
            Aufbewahrungspflichten notwendig ist. Sind die Daten für diese Zwecke nicht mehr
            erforderlich, werden sie gelöscht oder anonymisiert.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            6. Empfänger und Hosting in der EU
          </h2>
          <p className="mt-3">
            Das Hosting sowie die Verarbeitung erfolgen innerhalb der Europäischen Union. Wir
            setzen sorgfältig ausgewählte Dienstleister ein, etwa für Hosting, Zustellung von
            Benachrichtigungen und Support, und binden diese, soweit erforderlich, im Rahmen von
            Auftragsverarbeitungsverträgen. Eine Übermittlung in Drittländer findet nur statt,
            wenn hierfür geeignete Garantien nach Art. 44 ff. DSGVO bestehen.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            7. Push- und E-Mail-Benachrichtigungen
          </h2>
          <p className="mt-3">
            Zur Zustellung von Push- und E-Mail-Benachrichtigungen verarbeiten wir die dafür
            erforderlichen Kontakt- und Gerätekennungen, etwa E-Mail-Adresse und Geräte-Token. Für
            die Zustellung von Push-Nachrichten kann ein spezialisierter Zustelldienst eingesetzt
            werden. Dabei werden nur die zur Zustellung notwendigen Daten übermittelt. Sie können
            Benachrichtigungen jederzeit in den Einstellungen Ihres Geräts oder Ihres Kontos
            deaktivieren.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            8. Betroffenenrechte nach Art. 15 bis 21 DSGVO
          </h2>
          <p className="mt-3">Nach der DSGVO stehen Ihnen folgende Rechte zu:</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>Recht auf Auskunft (Art. 15 DSGVO),</li>
            <li>Recht auf Berichtigung (Art. 16 DSGVO),</li>
            <li>Recht auf Löschung (Art. 17 DSGVO),</li>
            <li>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
            <li>Recht auf Datenübertragbarkeit (Art. 20 DSGVO),</li>
            <li>Recht auf Widerspruch gegen die Verarbeitung (Art. 21 DSGVO).</li>
          </ul>
          <p className="mt-3">
            Betrifft Ihr Anliegen Fahrerdaten, die wir im Auftrag verarbeiten, wenden Sie sich
            bitte an den jeweiligen Flottenbetreiber als Verantwortlichen. Wir unterstützen den
            Betreiber bei der Erfüllung dieser Rechte. Im Übrigen erreichen Sie uns unter
            [E-Mail].
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">9. Beschwerderecht</h2>
          <p className="mt-3">
            Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn Sie
            der Ansicht sind, dass die Verarbeitung Ihrer personenbezogenen Daten gegen die DSGVO
            verstößt. Zuständig ist unter anderem die Aufsichtsbehörde Ihres gewöhnlichen
            Aufenthaltsorts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">10. Cookies</h2>
          <p className="mt-3">
            Für die Anmeldung und den sicheren Betrieb der Plattform setzen wir technisch notwendige
            Cookies und Session-Informationen ein. Diese sind für die Bereitstellung der Dienste
            erforderlich und werden nicht zu Analyse- oder Marketingzwecken verwendet. Sofern wir
            künftig darüber hinausgehende Cookies einsetzen, holen wir zuvor Ihre Einwilligung ein.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">11. Änderungen dieser Erklärung</h2>
          <p className="mt-3">
            Wir passen diese Datenschutzerklärung an, wenn sich die Rechtslage, unsere Dienste oder
            die Datenverarbeitung ändern. Es gilt jeweils die auf dieser Seite veröffentlichte
            aktuelle Fassung. Bei Fragen zum Datenschutz erreichen Sie uns unter [E-Mail].
          </p>
        </section>
      </div>
    </div>
  );
}
