export const metadata = {
  title: "Datenschutz · Reidey",
  description:
    "Datenschutzerklärung von Reidey nach DSGVO: Verantwortlicher, verarbeitete Daten, Zwecke und Rechtsgrundlagen, Auftragsverarbeitung, Empfänger, Speicherdauer, Cookies und Betroffenenrechte.",
};

export default function DatenschutzPage() {
  return (
    <div className="mx-auto max-w-[70ch] px-4 py-16 lg:py-24">
      <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        Datenschutzerklärung
      </h1>
      <p className="mt-3 text-sm text-ink-subtle">Stand: 18.08.2026</p>

      <div className="mt-10 space-y-10 text-[15px] leading-relaxed text-ink-muted">
        <section>
          <p>
            Der Schutz Ihrer personenbezogenen Daten ist uns wichtig. Diese Erklärung informiert
            Sie darüber, welche personenbezogenen Daten wir im Zusammenhang mit Reidey, unserer
            Flottenmanagement-Plattform für Fahrdienst-Flotten, verarbeiten, zu welchen Zwecken
            und auf welcher Rechtsgrundlage dies geschieht und welche Rechte Ihnen zustehen. Die
            Verarbeitung erfolgt im Einklang mit der Datenschutz-Grundverordnung (DSGVO) und dem
            Bundesdatenschutzgesetz (BDSG).
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">1. Verantwortlicher</h2>
          <p className="mt-3">
            Verantwortlicher im Sinne des Art. 4 Nr. 7 DSGVO für den Betrieb dieser Plattform ist:
          </p>
          <p className="mt-3">
            Reidey (Einzelunternehmen)
            <br />
            Hölderlinstraße 17
            <br />
            42699 Solingen, Deutschland
            <br />
            Vertretungsberechtigt: Ahmed Jaber
            <br />
            E-Mail: info@reidey.de
            <br />
            Telefon: +49 176 56074780
          </p>
          <p className="mt-3">
            Einen Datenschutzbeauftragten erreichen Sie, sofern bestellt, unter info@reidey.de.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">2. Auftragsverarbeitung</h2>
          <p className="mt-3">
            Reidey wird von Flottenbetreibern eingesetzt, um ihre eigenen Fahrer zu verwalten.
            Personenbezogene Daten der Fahrer verarbeiten wir ausschließlich im Auftrag und nach
            Weisung des jeweiligen Flottenbetreibers gemäß Art. 28 DSGVO. Datenschutzrechtlich
            Verantwortlicher für diese Fahrerdaten ist der jeweilige Flottenbetreiber; Reidey ist
            insoweit Auftragsverarbeiter. Grundlage der Zusammenarbeit ist ein
            Auftragsverarbeitungsvertrag (AV-Vertrag), der Gegenstand, Umfang, Zweck sowie die
            technischen und organisatorischen Maßnahmen der Verarbeitung regelt.
          </p>
          <p className="mt-3">
            Für die eigenen Konto-, Vertrags- und Abrechnungsdaten der Flottenbetreiber sowie für
            den technischen Betrieb der Plattform sind wir selbst Verantwortlicher.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">3. Erhobene Daten und Zwecke</h2>
          <p className="mt-3">
            Je nach Nutzung der Plattform verarbeiten wir folgende Kategorien personenbezogener
            Daten:
          </p>

          <h3 className="mt-5 text-base font-semibold text-ink">
            Konten der Flottenbetreiber und Manager
          </h3>
          <p className="mt-2">
            Name, E-Mail-Adresse, Telefonnummer, Firmenname, Login-Zugangsdaten und die im System
            hinterlegte Rolle. Zweck: Bereitstellung des Dashboards, Verwaltung des Kontos,
            Kommunikation sowie Abwicklung von Abonnement und Abrechnung.
          </p>

          <h3 className="mt-5 text-base font-semibold text-ink">Fahrerdaten</h3>
          <p className="mt-2">
            Name, Telefonnummer, E-Mail-Adresse und bevorzugte App-Sprache; der Live-Standort
            ausschließlich während aktiver Fahrten; Fahrtangebote und Fahrtverlauf (Start- und
            Zieladressen, Preis, Distanz, Zeitstempel und Annahmestatus) sowie der Geräte-Push-Token.
            Zweck: Verwaltung der Fahrer durch den Flottenbetreiber, Zuleitung von Fahrtangeboten
            und Benachrichtigungen an die eigenen Fahrer sowie Auswertung des Flottenbetriebs. Diese
            Daten verarbeiten wir im Auftrag des Flottenbetreibers (siehe Ziffer 2).
          </p>

          <h3 className="mt-5 text-base font-semibold text-ink">Nutzungs- und Technikdaten</h3>
          <p className="mt-2">
            IP-Adresse, Session-Cookies, Geräteinformationen und Benachrichtigungs-Token. Zweck:
            sicherer und stabiler Betrieb der Plattform, Anmeldung, Fehleranalyse sowie Erkennung
            und Abwehr von Missbrauch.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            4. Rechtsgrundlagen nach Art. 6 DSGVO
          </h2>
          <p className="mt-3">Die Verarbeitung stützt sich auf folgende Rechtsgrundlagen:</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>
              Bereitstellung der Flottenmanagement-Dienste und des Dashboards: Art. 6 Abs. 1 lit. b
              DSGVO (Erfüllung des Vertrags).
            </li>
            <li>
              Fahrerverwaltung, Zuleitung von Fahrtangeboten und Benachrichtigungen an die eigenen
              Fahrer sowie Abrechnung und Abonnements: Art. 6 Abs. 1 lit. b DSGVO sowie Art. 6
              Abs. 1 lit. f DSGVO (berechtigtes Interesse an einem effizienten Flottenbetrieb).
            </li>
            <li>
              Push-Benachrichtigungen: Art. 6 Abs. 1 lit. a DSGVO (Einwilligung) bzw. Art. 6 Abs. 1
              lit. f DSGVO.
            </li>
            <li>
              Betrugs- und Missbrauchsvermeidung sowie Sicherheit der Systeme: Art. 6 Abs. 1 lit. f
              DSGVO (berechtigtes Interesse).
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">5. Empfänger und Weitergabe</h2>
          <p className="mt-3">
            Das Hosting und die Verarbeitung Ihrer Daten erfolgen auf Servern innerhalb der
            Europäischen Union (Deutschland/EU). Wir setzen sorgfältig ausgewählte Dienstleister
            ein und binden diese, soweit erforderlich, im Rahmen von
            Auftragsverarbeitungsverträgen:
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>
              Zustellung von Push-Benachrichtigungen über Google Firebase Cloud Messaging. Dabei
              kann es zu einer Übermittlung von Geräte-Token an Google (auch in die USA) kommen.
              Grundlage hierfür sind die EU-Standardvertragsklauseln nach Art. 46 DSGVO.
            </li>
            <li>Versand von E-Mails über einen spezialisierten Zustelldienstleister.</li>
          </ul>
          <p className="mt-3">
            Eine Weitergabe Ihrer Daten zu Werbe- oder Marketingzwecken findet nicht statt. Eine
            Übermittlung in Drittländer erfolgt nur, wenn hierfür geeignete Garantien nach
            Art. 44 ff. DSGVO bestehen.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            6. Speicherdauer und Datenminimierung
          </h2>
          <p className="mt-3">
            Wir verarbeiten ausschließlich die Daten, die für den jeweiligen Zweck erforderlich
            sind, und folgen dem Grundsatz der Datenminimierung. Personenbezogene Daten speichern
            wir nur so lange, wie es für die Erbringung des Dienstes oder aufgrund gesetzlicher
            Aufbewahrungspflichten notwendig ist. Standort- und Fahrtdaten werden auf das
            erforderliche Maß beschränkt und nach Ablauf der jeweiligen Aufbewahrungsfrist gelöscht
            oder anonymisiert.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">7. Cookies</h2>
          <p className="mt-3">
            Wir setzen ausschließlich ein technisch notwendiges Session-Cookie ein, das für die
            Anmeldung und den sicheren Betrieb der Plattform erforderlich ist. Rechtsgrundlage ist
            Art. 6 Abs. 1 lit. f DSGVO in Verbindung mit § 25 Abs. 2 TDDDG (unbedingt
            erforderlicher Zugriff). Ein Einsatz von Cookies zu Tracking-, Analyse- oder
            Marketingzwecken findet nicht statt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">8. Push-Benachrichtigungen</h2>
          <p className="mt-3">
            Über die App können wir Ihnen Push-Benachrichtigungen zusenden, etwa zu neuen
            Fahrtangeboten oder betrieblichen Hinweisen. Hierfür verarbeiten wir den Geräte-Push-Token.
            Sie können Push-Benachrichtigungen jederzeit mit Wirkung für die Zukunft widerrufen,
            indem Sie diese in der App oder in den Einstellungen Ihres Geräts deaktivieren.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">
            9. Ihre Rechte als betroffene Person
          </h2>
          <p className="mt-3">Nach der DSGVO stehen Ihnen folgende Rechte zu:</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5">
            <li>Recht auf Auskunft (Art. 15 DSGVO),</li>
            <li>Recht auf Berichtigung (Art. 16 DSGVO),</li>
            <li>Recht auf Löschung (Art. 17 DSGVO),</li>
            <li>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO),</li>
            <li>Recht auf Datenübertragbarkeit (Art. 20 DSGVO),</li>
            <li>Recht auf Widerspruch gegen die Verarbeitung (Art. 21 DSGVO),</li>
            <li>
              Recht auf Widerruf einer erteilten Einwilligung mit Wirkung für die Zukunft (Art. 7
              Abs. 3 DSGVO).
            </li>
          </ul>
          <p className="mt-3">
            Betrifft Ihr Anliegen Fahrerdaten, die wir im Auftrag eines Flottenbetreibers
            verarbeiten, wenden Sie sich bitte an den jeweiligen Flottenbetreiber als
            Verantwortlichen; wir unterstützen ihn bei der Erfüllung dieser Rechte. Im Übrigen
            erreichen Sie uns unter info@reidey.de.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">10. Beschwerderecht</h2>
          <p className="mt-3">
            Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn Sie
            der Ansicht sind, dass die Verarbeitung Ihrer personenbezogenen Daten gegen die DSGVO
            verstößt. Zuständig ist unter anderem die Aufsichtsbehörde Ihres gewöhnlichen
            Aufenthaltsorts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">11. Datensicherheit</h2>
          <p className="mt-3">
            Wir treffen geeignete technische und organisatorische Maßnahmen, um Ihre Daten zu
            schützen. Die Übertragung erfolgt verschlüsselt über TLS; sensible Daten werden
            zusätzlich verschlüsselt gespeichert. Der Zugriff auf personenbezogene Daten ist über
            eine rollenbasierte Zugriffskontrolle auf berechtigte Personen beschränkt.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">12. Änderungen dieser Erklärung</h2>
          <p className="mt-3">
            Wir passen diese Datenschutzerklärung an, wenn sich die Rechtslage, unsere Dienste oder
            die Datenverarbeitung ändern. Es gilt jeweils die auf dieser Seite veröffentlichte
            aktuelle Fassung. Stand dieser Erklärung: 18.08.2026. Bei Fragen zum Datenschutz erreichen
            Sie uns unter info@reidey.de.
          </p>
        </section>
      </div>
    </div>
  );
}
