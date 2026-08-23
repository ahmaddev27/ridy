import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-6xl px-5 lg:px-8 ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mkt-eyebrow">{children}</p>;
}

export function SectionHeading({
  eyebrow,
  title,
  sub,
  center,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-3xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="font-heading mt-3 text-3xl font-bold leading-tight text-white sm:text-4xl">
        {title}
      </h2>
      {sub ? <p className="mt-4 text-base leading-relaxed text-[#9ca3af]">{sub}</p> : null}
    </div>
  );
}
