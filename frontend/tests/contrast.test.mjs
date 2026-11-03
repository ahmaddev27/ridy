// WCAG AA contrast check for the glass redesign (epic #276, Phase 0).
// Text tokens are composited over the worst-case backdrop: the translucent
// surface laid over the canvas plus the strongest ambient glow. Dense data
// uses --surface-solid, so it is checked on the solid colour as well.
import test from "node:test";
import assert from "node:assert/strict";

const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const over = ([r, g, b], a, base) => [r, g, b].map((c, i) => c * a + base[i] * (1 - a));

const THEMES = {
  light: {
    canvas: "#e8efec", surfaceRgb: [255, 255, 255], surfaceA: 0.62, solid: "#f7faf9",
    // strongest ambient glow tints (emerald/teal/sky/lime at their light alphas)
    glows: [[16, 185, 129, 0.3], [45, 212, 191, 0.22], [56, 189, 248, 0.16], [132, 204, 22, 0.1]],
    ink: "#111916", muted: "#4f5b56", subtle: "#5d6964", primary: "#047857", primaryInk: "#ffffff",
    pairs: {
      success: ["#e6f5ee", "#05603f"], danger: ["#fdecec", "#a8231b"], warning: ["#fcf2df", "#8a4b06"],
      info: ["#e8f0fc", "#1c55b3"], accent: ["#efedfa", "#5440ad"], neutral: ["#eef1f0", "#4f5b56"],
      "primary-soft": ["#e2f3eb", "#05603f"],
    },
  },
  dark: {
    canvas: "#050a08", surfaceRgb: [255, 255, 255], surfaceA: 0.045, solid: "#111715",
    glows: [[16, 185, 129, 0.22], [20, 184, 166, 0.14], [56, 189, 248, 0.09], [16, 185, 129, 0.06]],
    ink: "#e5ebe8", muted: "#a3afaa", subtle: "#93a09a", primary: "#34d399", primaryInk: "#04261a",
    pairs: {
      success: ["#0e2a1f", "#74e3b8"], danger: ["#331416", "#ffa39e"], warning: ["#2e220c", "#f5c46b"],
      info: ["#10203a", "#9cc2fb"], accent: ["#1f1a38", "#c3b8fb"], neutral: ["#1d2522", "#a3afaa"],
      "primary-soft": ["#0f2a20", "#74e3b8"],
    },
  },
};

// Worst case for text = the backdrop whose luminance is closest to the text's.
function backdrops(t) {
  const canvas = hex(t.canvas);
  const withGlow = t.glows.map(([r, g, b, a]) => over([r, g, b], a, canvas));
  return [canvas, ...withGlow].map((base) => over(t.surfaceRgb, t.surfaceA, base));
}

for (const [name, t] of Object.entries(THEMES)) {
  test(`${name}: ink tokens reach AA on translucent card over ambient`, () => {
    for (const bg of backdrops(t)) {
      assert.ok(ratio(hex(t.ink), bg) >= 4.5, "ink");
      assert.ok(ratio(hex(t.muted), bg) >= 4.5, "ink-muted");
      assert.ok(ratio(hex(t.subtle), bg) >= 4.5, "ink-subtle");
    }
  });
  test(`${name}: ink tokens reach AA on solid surface`, () => {
    for (const k of ["ink", "muted", "subtle"]) {
      assert.ok(ratio(hex(t[k]), hex(t.solid)) >= 4.5, k);
    }
  });
  test(`${name}: primary button text and primary-on-card reach AA`, () => {
    assert.ok(ratio(hex(t.primaryInk), hex(t.primary)) >= 4.5, "primary-ink on primary");
    for (const bg of backdrops(t)) assert.ok(ratio(hex(t.primary), bg) >= 3, "primary as UI/large");
  });
  test(`${name}: semantic fg-on-bg reach AA`, () => {
    for (const [k, [bg, fg]] of Object.entries(t.pairs)) {
      assert.ok(ratio(hex(fg), hex(bg)) >= 4.5, `${k}: ${ratio(hex(fg), hex(bg)).toFixed(2)}`);
    }
  });
}
