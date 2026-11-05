import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl px-5 lg:px-8 ${className}`}>{children}</div>;
}

export function Eyebrow({
  children,
  color = "#10b981",
}: {
  children: ReactNode;
  color?: string;
}) {
  return (
    <span
      className="text-xs font-medium uppercase tracking-widest"
      style={{ color }}
    >
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
  eyebrowColor = "#10b981",
  align = "responsive",
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  eyebrowColor?: string;
  /** "responsive" centres on mobile then left-aligns from lg; "left" is always left. */
  align?: "responsive" | "left";
}) {
  const wrap =
    align === "left"
      ? "max-w-2xl"
      : "mx-auto max-w-2xl text-center lg:mx-0 lg:text-left";
  return (
    <div className={wrap}>
      <Eyebrow color={eyebrowColor}>{eyebrow}</Eyebrow>
      <h2 className="font-heading mt-3 text-3xl font-bold leading-[1.08] tracking-[-0.02em] text-balance text-white sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {sub ? (
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}
