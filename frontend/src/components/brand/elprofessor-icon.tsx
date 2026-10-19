import { createLucideIcon } from "lucide-react";

/**
 * El-Professor's mark, redrawn as a sidebar glyph.
 *
 * ## Why this is a drawing and not their logo file
 *
 * Their logo is a detailed face — silver swept hair, blue glasses carrying
 * `< />`, a beard and a tie — on a dark navy rounded square. Rendered at the
 * 16px every sidebar icon uses, it measurably turns to mush: at 16, 20 and even
 * 24px the face reads as a grey smudge on a dark tile and nothing identifies it.
 * The square would also fight the sidebar twice over — a filled colour tile
 * among transparent line glyphs, and a near-black plate that disappears against
 * the dark theme's own background.
 *
 * So the mark is reduced to the two things that survive 16px and still say
 * El-Professor: the **glasses** and the **swept quiff** above them. Drawn on
 * Lucide's grid (24 viewBox, 2px stroke, round caps) through `createLucideIcon`,
 * which is what makes it a `LucideIcon` for `nav-config.tsx` and gives it the
 * same defaults as every neighbour for free.
 *
 * It takes its colour from `currentColor`, so it needs no dark-mode variant: it
 * follows `text-ink-muted`, the active pill's `text-primary-ink`, and the dark
 * theme's `text-ink` exactly as the Lucide icons beside it do. A two-tone image
 * would have needed a separate asset per theme.
 *
 * The code brackets inside the lenses are deliberately left out — at 16px they
 * fill in and the two lenses become solid blobs, which was worse than no
 * brackets at all.
 */
export const ElProfessorIcon = createLucideIcon("ElProfessor", [
  // The quiff: one stroke, swept left-to-right, not a full head of hair.
  ["path", { d: "M5 6.2C7 4.6 9.3 4 12 4.3", key: "elp-quiff" }],
  ["rect", { x: "2", y: "9.5", width: "8.6", height: "6.8", rx: "2.4", key: "elp-lens-l" }],
  ["rect", { x: "13.4", y: "9.5", width: "8.6", height: "6.8", rx: "2.4", key: "elp-lens-r" }],
  ["path", { d: "M10.6 12.9h2.8", key: "elp-bridge" }],
]);
