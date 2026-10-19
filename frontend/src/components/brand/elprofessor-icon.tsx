import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

/**
 * El-Professor's own mark, background removed, in the colour each theme needs.
 *
 * Two files because the artwork is two-tone, not monochrome: the mark is drawn
 * light (silver hair, white beard) to sit on dark, and dark to sit on light. A
 * single transparent asset would be invisible in one theme — the light-on-dark
 * version all but disappears on a white sidebar, which is exactly what removing
 * the navy plate exposed. `currentColor` is not an option either: these are
 * bitmaps, and the blue glasses are part of the mark.
 *
 * Both were cut from El-Professor's own exports, not redrawn:
 *   - light theme ← `email-templates/logo.png`, the dark colourway. Its white
 *     background is keyed out by flood-filling from the BORDER only, so the
 *     white highlights inside the hair survive; a plain colour-key punched holes
 *     through them.
 *   - dark theme  ← `brand/mark-on-dark.png`, which already ships transparent.
 *
 * Each is then cropped to the artwork and padded back to a square, which is the
 * "make it bigger" half of the request: the face now fills the icon box instead
 * of floating inside the margin the source carried. The box itself is 18px
 * rather than the neighbours' 16, set inline so it beats the `h-4 w-4` that
 * `nav-list.tsx` passes without that file having to know about this one.
 *
 * ## Why an `<svg>` wrapping `<image>` rather than an `<img>`
 *
 * `NavItem.icon` is typed `LucideIcon` and `nav-list.tsx` renders it as
 * `<Icon className="h-4 w-4" />`. Wrapping the bitmaps in an SVG keeps that
 * contract exactly — same ref type, same call site — so neither the shared type
 * nor the sidebar changed for one entry.
 *
 * Both images are always in the DOM and `display` picks one, so the swap costs
 * no JavaScript and cannot flash the wrong colourway on a theme change.
 */
const LIGHT = "/brand/elprofessor-light.png";
const DARK = "/brand/elprofessor-dark.png";

export const ElProfessorIcon = forwardRef<SVGSVGElement, LucideProps>(
  function ElProfessorIcon({ className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        className={className}
        role="img"
        aria-hidden="true"
        {...props}
        // Lucide's stroke/fill defaults would paint over a bitmap, and the
        // inline size deliberately overrides the class the sidebar passes.
        fill="none"
        stroke="none"
        style={{ width: 18, height: 18 }}
      >
        <image className="dark:hidden" href={LIGHT} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
        <image className="hidden dark:block" href={DARK} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
      </svg>
    );
  },
);
