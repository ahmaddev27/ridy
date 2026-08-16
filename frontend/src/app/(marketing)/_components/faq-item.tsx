import { Plus } from "lucide-react";

/**
 * Native <details> accordion item, styled to the brand. Server-rendered, no JS.
 * The marker rotates via the group-open state so it works without client code.
 */
export function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group rounded-xl border border-line bg-surface px-5 open:bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {question}
        <Plus
          size={18}
          strokeWidth={1.75}
          className="shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-45"
        />
      </summary>
      <p className="pb-5 text-sm leading-relaxed text-ink-muted">{answer}</p>
    </details>
  );
}
