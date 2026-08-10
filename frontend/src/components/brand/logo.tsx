/**
 * Reidey brand mark — a monoline "R" with connector nodes, recreated as clean
 * SVG so it scales crisply anywhere (sidebar, login, favicon). `currentColor`
 * drives the stroke, so it adopts whatever text colour the parent sets.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      className={className}
      role="img"
      aria-label="Reidey"
    >
      <g stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
        {/* stem */}
        <path d="M30 22 V74" />
        {/* bowl */}
        <path d="M30 22 H52 C66 22 66 48 52 48 H30" />
        {/* leg */}
        <path d="M44 48 L66 74" />
      </g>
      {/* connector nodes: ring + centre dot */}
      {[
        [30, 22],
        [30, 74],
        [52, 35],
        [44, 48],
        [66, 74],
      ].map(([cx, cy], i) => (
        <g key={i}>
          <circle cx={cx} cy={cy} r={4.5} fill="var(--logo-bg, #fff)" stroke="currentColor" strokeWidth={4} />
          <circle cx={cx} cy={cy} r={1.6} fill="currentColor" />
        </g>
      ))}
    </svg>
  );
}
