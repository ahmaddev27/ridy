import { SCREENS, SCREEN_INFO } from "./phone-screens";
import { Container, SectionHead } from "./ui";

/** "Die App": scroll-snap slider of the real app screens, one captioned card each. */
export function AppShowcase() {
  return (
    <section id="app" className="mkt-section">
      <Container>
        <SectionHead title="Die App" meta="Hell & dunkel · DE / EN / AR" />
        <div className="mkt-slider" tabIndex={0} aria-label="App-Bildschirme">
          {SCREENS.map((Screen, i) => (
            <figure key={SCREEN_INFO[i].label} className="m-0 flex flex-none flex-col gap-[9px]">
              <div className="mkt-phone" style={{ width: "clamp(220px, 44vw, 250px)" }}>
                <div
                  className="overflow-hidden"
                  style={{ aspectRatio: "512 / 1044", borderRadius: "clamp(18px, 4vw, 26px)" }}
                >
                  <Screen />
                </div>
              </div>
              <figcaption className="text-[11.5px] text-ink-subtle" style={{ fontFamily: "var(--font-mono)" }}>
                {SCREEN_INFO[i].label} · {SCREEN_INFO[i].note}
              </figcaption>
            </figure>
          ))}
        </div>
      </Container>
    </section>
  );
}
