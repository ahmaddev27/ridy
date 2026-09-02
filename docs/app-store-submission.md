# Reidey Driver — App Store Connect Submission

Everything needed to clear the "Unable to Add for Review" checklist. Copy the
fields below into App Store Connect. The store copy deliberately never names any
ride-hailing platform (Uber/Bolt) or mentions capture/scraping — required to
avoid rejection.

> **Current status (2026-09-02):** the app is **approved** — current release is
> **v1.0.3 (build 11)**. The listing still shows **"Cannot Sell"** in Germany
> because the **DSA trader status is "In Review"**; it goes on sale once Apple
> clears the trader verification. The checklist below remains the reference for
> the review-readiness fields.

---

## URLs (ready to paste)

| Field | Value |
|---|---|
| **Privacy Policy URL** (App Privacy) | `https://reidey.de/datenschutz` |
| **Support URL** | `https://reidey.de/#kontakt-formular` |
| **Marketing URL** (optional) | `https://reidey.de` |

---

## German — Description

```
Reidey bewertet jedes Fahrtangebot klar, bevor du zusagst. Fahrpreis, €/km, Distanz und Route auf einen Blick – in den Sekunden, die zählen. Für Fahrer in Fahrdienst-Flotten in ganz Deutschland.

FUNKTIONEN
• Sofortige Benachrichtigung bei jedem neuen Fahrtangebot – mit hoher Priorität, auf dem Sperrbildschirm, mit Ton, auch wenn die App geschlossen ist.
• Qualitätsbewertung: jedes Angebot als €, €€ oder €€€, gemessen am €/km-Schnitt deiner Region.
• Großer Fahrpreis, €/km, Distanz und Route – plus ein ruhiger Countdown.
• Echte Adressen für Abholung und Ziel im Klartext.
• Vollständiges Protokoll deiner Angebote mit Status, Fahrpreis und Route.
• Tageskennzahlen: Angebote, Annahmequote, Verdienst und Strecke – pro Tag, Woche und Monat.
• Deutsch, Englisch und Arabisch, mit vollständig gespiegelter Oberfläche.
• Helles und dunkles Design.

Reidey greift nie in deine Aufträge ein – die App zeigt und bewertet das Angebot, entschieden wird von dir.

Datenschutz: Deine Daten werden auf Servern in der EU verarbeitet, DSGVO-konform.
```

## German — Keywords (≤ 100 characters)

```
Fahrer,Flotte,Fahrdienst,Fahrpreis,Angebot,Dispatch,Verdienst,Schicht,Route,km,Fahrten,Taxi
```

## German — Promotional Text (optional, ≤ 170 characters)

```
Bewerte jedes Fahrtangebot in Sekunden: Fahrpreis, €/km, Distanz und Route auf einen Blick. Schneller entscheiden, profitabler fahren.
```

---

## Portal decisions (recommended answers)

| Item | Answer |
|---|---|
| **Content Rights Information** (App Information) | **No** — the app does not contain, show, or access third-party content that requires rights. |
| **Age Rating** questionnaire (App Information) | Every category **None** → results in a **4+** rating. |
| **Contact Information** (App Review) | Your real first/last name, email, and phone number (used only for Apple's review). |
| **Build** | Choose the uploaded iOS build. If none is listed yet, upload one first (iOS build workflow / `eas submit -p ios`), wait for it to finish processing, then select it. |

---

## Checklist mapping (the red errors → what to do)

- **You must choose a build** → upload + select an iOS build.
- **Complete the Contact Information section** → fill first/last name, phone, email.
- **Set up Content Rights Information in App Information** → answer "No".
- **Respond to the required age ratings questions** → answer all **None** (4+).
- **Enter a Privacy Policy URL in App Privacy** → `https://reidey.de/datenschutz`.
- **German – Description** → paste the description above.
- **German – Keywords** → paste the keywords above.
- **German – Support URL** → `https://reidey.de/#kontakt-formular`.

---

## Notes

- **No platform names / no capture wording** anywhere in the copy — this is a hard
  requirement for App Store approval (and for the brand).
- The `datenschutz` page already serves as the privacy policy; `impressum` covers
  the legal notice.
- Screenshots: use the four in-app screens (Start / Angebot / Liste / Statistik)
  captured on a device or simulator at the required sizes.
