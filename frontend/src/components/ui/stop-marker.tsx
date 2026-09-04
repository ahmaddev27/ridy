/**
 * A drop-off / stop marker: a filled blue circle with a centered white
 * rounded-square (a ⏹ "stop" glyph). Used for every drop-off and intermediate
 * stop in a route itinerary, distinct from the origin (pickup) marker.
 *
 * Defaults to the design system's info blue (`--info-ring`, #2563EB). `color`
 * accepts any CSS color (a token var or a hex) so callers can theme it.
 */
export function StopMarker({
  size = 16,
  color = "#2563EB",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="11" fill={color} />
      <rect x="7" y="7" width="10" height="10" rx="2.8" fill="#fff" />
    </svg>
  );
}
