"use client";

/**
 * Full-screen branded preloader: the Reidey "R" draws itself in, a little car
 * travels along the mark's path, and the wordmark pulses. Used as the route
 * loading fallback so navigations show the brand instead of a blank screen.
 */
export function Preloader() {
  // One continuous route along the R (stem → bowl → leg) for the car to follow.
  const route = "M30 74 V22 H52 C66 22 66 48 52 48 H44 L66 74";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-white">
      <style>{`
        @keyframes reidey-draw { to { stroke-dashoffset: 0; } }
        .reidey-line { stroke-dasharray: 260; stroke-dashoffset: 260; animation: reidey-draw 1.6s ease forwards; }
        @keyframes reidey-pulse { 0%,100% { opacity:.4 } 50% { opacity:1 } }
        .reidey-word { animation: reidey-pulse 1.6s ease-in-out infinite; }
      `}</style>

      <svg width={120} height={120} viewBox="0 0 96 96" fill="none" className="text-slate-900" aria-label="Loading">
        <g stroke="currentColor" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round">
          <path className="reidey-line" d="M30 22 V74" />
          <path className="reidey-line" style={{ animationDelay: "0.2s" }} d="M30 22 H52 C66 22 66 48 52 48 H30" />
          <path className="reidey-line" style={{ animationDelay: "0.5s" }} d="M44 48 L66 74" />
        </g>

        {[[30, 22], [30, 74], [52, 35], [44, 48], [66, 74]].map(([cx, cy], i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r={4.5} fill="#fff" stroke="currentColor" strokeWidth={4} />
            <circle cx={cx} cy={cy} r={1.6} fill="currentColor" />
          </g>
        ))}

        {/* Car travelling along the mark (drawn around the origin so animateMotion
            places it on the path) */}
        <g fill="#fff" stroke="#0f172a" strokeWidth={1.2}>
          <rect x={-6} y={-3.5} width={12} height={7} rx={2.2} />
          <rect x={-3.5} y={-6.5} width={7} height={4} rx={1.6} />
          <circle cx={-3.5} cy={3.5} r={1.7} fill="#0f172a" stroke="none" />
          <circle cx={3.5} cy={3.5} r={1.7} fill="#0f172a" stroke="none" />
          <animateMotion dur="3s" repeatCount="indefinite" rotate="auto" path={route} />
        </g>
      </svg>

      <div className="reidey-word text-sm font-bold tracking-wide text-slate-700">REIDEY</div>
    </div>
  );
}
