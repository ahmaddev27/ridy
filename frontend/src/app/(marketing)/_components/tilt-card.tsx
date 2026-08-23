"use client";

import { useRef, type ReactNode } from "react";

/**
 * Pointer-driven 3D tilt wrapper mirroring the reference TiltCard.jsx — the card
 * rotates toward the cursor and lifts slightly, easing back to flat on leave.
 */
export function TiltCard({
  children,
  className = "",
  intensity = 8,
}: {
  children: ReactNode;
  className?: string;
  intensity?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${px * intensity}deg) rotateX(${-py * intensity}deg) translateZ(10px)`;
  };

  const reset = () => {
    if (ref.current) {
      ref.current.style.transform =
        "perspective(900px) rotateY(0deg) rotateX(0deg)";
    }
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      className={`mkt-tilt ${className}`}
    >
      {children}
    </div>
  );
}
