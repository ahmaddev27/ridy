import { forwardRef } from "react";
import type { LucideProps } from "lucide-react";

/** El-Professor's own app icon, served from `public/`. 192px: the sidebar draws
 *  it at 16, so this stays sharp to a 3x display and still weighs 23 KB. */
const SRC = "/brand/elprofessor.png";

/**
 * El-Professor's logo, used verbatim as their sidebar icon.
 *
 * **This is their image, not a drawing of it** — the owner's decision, made
 * twice and against the alternative being offered. Two redraws were tried and
 * rejected: a glasses-and-quiff glyph ("where is the face, the beard, the
 * hair?"), then a filled face with hair, outlined glasses and a beard, which
 * still read as an interpretation rather than the mark. The brand is his, and
 * recognising it is the point of putting it here.
 *
 * **What that costs, recorded so nobody re-litigates it later:** the mark is a
 * detailed face on a dark navy rounded square, and at the 16px a sidebar icon
 * gets it does not resolve into a face — measured at 16, 18, 20 and 22px, at
 * 1x and 2x. It is also a filled colour tile among transparent line glyphs, and
 * its dark plate sits close to the dark theme's own background. All of that was
 * put to the owner with renders before this shipped.
 *
 * The SAME image serves light and dark, which is what was asked for: no
 * per-theme variant, nothing to keep in sync.
 *
 * ## Why an `<svg>` wrapping an `<image>` rather than an `<img>`
 *
 * `NavItem.icon` is typed `LucideIcon`, and `nav-list.tsx` renders it as
 * `<Icon className="h-4 w-4" />`. Wrapping the bitmap in an SVG keeps that
 * contract exactly — same ref type, same sizing from the same class — so
 * neither the shared type nor the sidebar had to change for one entry.
 *
 * The rounded corners are baked into the PNG (its corners are transparent), so
 * no radius is applied here. `preserveAspectRatio` is explicit because the
 * default would letterbox if the asset were ever replaced with a non-square one.
 */
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
        // Lucide's defaults would paint over a bitmap; they mean nothing here.
        fill="none"
        stroke="none"
      >
        <image href={SRC} x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet" />
      </svg>
    );
  },
);
