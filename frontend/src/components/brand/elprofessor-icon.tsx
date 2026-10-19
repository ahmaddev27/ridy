import { createLucideIcon } from "lucide-react";

/**
 * El-Professor's mark — the face — as a sidebar glyph.
 *
 * ## Why it is redrawn and not their logo file
 *
 * Their logo is a face on a dark navy rounded square: silver swept hair, blue
 * glasses carrying `< />`, a moustache, a beard, a collar and a tie. Dropped in
 * as an image at the 16px a sidebar icon gets, it measurably stops being a face
 * — rendered at 16, 18, 20 and 22px, at both 1x and 2x, it is a dark tile with a
 * pale smudge in it. The dark plate also disappears against the dark theme's own
 * background. The sources cap out anyway: the `.ico` is 48px, and
 * `professor_logo_white.svg` is a 117 KB filter-and-mask trace, not paths.
 *
 * So the face is drawn rather than scaled, keeping the three things that make it
 * recognisably him and that survive 16px:
 *
 *   - the **swept hair**, filled, higher on the left exactly as the mark is
 *   - the **glasses**, outlined so the lenses stay lenses instead of filling in
 *   - the **moustache and beard**, filled, tapering to the chin
 *
 * Filled shapes, not hairlines: a first attempt drew everything in Lucide's 2px
 * stroke and at 16px the detail closed up into blobs. The `< />` inside the
 * lenses is left out for the same reason — at this size it fills them solid.
 *
 * It takes its colour from `currentColor`, so there is no dark-mode variant to
 * keep in sync: it follows `text-ink-muted`, the active pill's `text-primary-ink`
 * and the dark theme's `text-ink` exactly as the Lucide icons beside it do. A
 * two-tone image would have needed one asset per theme.
 *
 * `createLucideIcon` is what makes it a `LucideIcon` for `nav-config.tsx` and
 * gives it the same 24 viewBox and sizing defaults as every neighbour.
 */
export const ElProfessorIcon = createLucideIcon("ElProfessor", [
  // Swept hair — the quiff rises on the left and sweeps back, as the mark does.
  [
    "path",
    {
      d: "M3.9 9.3C4.3 4.9 7.6 2 12 2c4.3 0 7.6 2.8 8.1 7.1-.3-1-1-1.6-1.9-2.2-1.4-.9-3.6-1.5-6.3-1.5-2.4 0-4.2.5-5.4 1.2-.9.5-1.9 1.3-2.6 2.7Z",
      fill: "currentColor",
      stroke: "none",
      key: "elp-hair",
    },
  ],
  // Moustache, then the beard line round the jaw to the chin.
  [
    "path",
    {
      d: "M9.9 16.6h4.2c-.2 1-1 1.6-2.1 1.6s-1.9-.6-2.1-1.6Z",
      fill: "currentColor",
      stroke: "none",
      key: "elp-tache",
    },
  ],
  [
    "path",
    {
      d: "M6.9 16.2c1.2.7 3 1.1 5.1 1.1s3.9-.4 5.1-1.1c-.3 3.5-2.3 5.7-5.1 5.7s-4.8-2.2-5.1-5.7Z",
      fill: "currentColor",
      stroke: "none",
      key: "elp-beard",
    },
  ],
  // Glasses stay OUTLINED so the lenses read as lenses at 16px.
  ["rect", { x: "2.6", y: "10.7", width: "8", height: "4.6", rx: "1.6", strokeWidth: "1.7", key: "elp-lens-l" }],
  ["rect", { x: "13.4", y: "10.7", width: "8", height: "4.6", rx: "1.6", strokeWidth: "1.7", key: "elp-lens-r" }],
  ["path", { d: "M10.6 13h2.8", strokeWidth: "1.7", key: "elp-bridge" }],
]);
