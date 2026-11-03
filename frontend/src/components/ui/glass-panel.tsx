import { cn } from "@/lib/utils";

/**
 * Glass layers of the redesign (epic #276). Variants map 1:1 to the prototype:
 * - card:   translucent pane + white edge + inner highlight, NO blur (content)
 * - sheet:  sidebar / content sheet, blur(22px) saturate(160%)
 * - strong: modal / menu / drawer / popover, blur(26px) saturate(180%)
 * - solid:  opaque surface for dense data (tables, forms, logs)
 *
 * With html[data-glass="on"] absent every variant renders the legacy Card look,
 * so adopting the component changes nothing until the rollout flag is on.
 * Blur belongs on fixed/sticky layers only: never use sheet/strong for scrolling
 * content cards.
 */
export type GlassVariant = "card" | "sheet" | "strong" | "solid";

export interface GlassPanelProps extends React.HTMLAttributes<HTMLElement> {
  variant?: GlassVariant;
  as?: "div" | "section" | "aside" | "header" | "nav" | "article";
}

export function GlassPanel({
  variant = "card",
  as: Tag = "div",
  className,
  ...rest
}: GlassPanelProps) {
  return <Tag className={cn("glass-panel", `glass-panel--${variant}`, className)} {...rest} />;
}
