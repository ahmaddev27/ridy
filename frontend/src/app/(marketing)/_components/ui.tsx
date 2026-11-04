import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mkt-wrap ${className}`}>{children}</div>;
}

export function Eyebrow({ children, band = false }: { children: ReactNode; band?: boolean }) {
  return <span className={`mkt-eyebrow ${band ? "mkt-eyebrow--band" : ""}`}>{children}</span>;
}

/** Section header: title on the start edge, mono meta caption on the end edge. */
export function SectionHead({ title, meta, id }: { title: ReactNode; meta?: string; id?: string }) {
  return (
    <div className="mkt-head">
      <h2 id={id} className="mkt-h3">
        {title}
      </h2>
      {meta ? <Eyebrow>{meta}</Eyebrow> : null}
    </div>
  );
}
