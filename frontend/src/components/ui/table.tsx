import { cn } from "@/lib/utils";

/**
 * The one shared data-table look for dense, scannable data (issue #279).
 *
 * `TableCard` is an opaque, bordered container (NOT a translucent glass card):
 * dense data stays on `--surface-solid` so it meets WCAG AA over the ambient
 * field, and it never carries a blur (blur is reserved for fixed/sticky layers).
 * `Table` applies the `ui-table` recipe — sticky header on `--surface-2`,
 * tabular figures, row hover, start-aligned headers — so screens stop hand-rolling
 * `<table>` styling. All styling is token-based, so it renders natively with the
 * glass flag both off and on.
 *
 * Markup stays standard `<thead>/<tbody>/<th>/<td>`; callers keep full control of
 * their columns, sorting and row handlers. Use `.r` / `.c` on a cell for
 * end / center alignment (matching the prototype).
 */

export function TableCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("ui-table-card", className)}>
      <div className="ui-table-wrap w-full overflow-x-auto">{children}</div>
    </div>
  );
}

export function Table({
  className,
  children,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn("ui-table", className)} {...rest}>
      {children}
    </table>
  );
}
