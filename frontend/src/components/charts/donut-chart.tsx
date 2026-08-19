"use client";

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

type Segment = { value: number; color: string };

/**
 * Donut (Recharts) with the total in the centre. Segments carry their own status
 * colors; an all-zero set shows a single recessive ring so the widget never
 * looks broken. The caller renders the legend beside it (identity never by color
 * alone).
 */
export function DonutChart({ segments, total, size = 132 }: { segments: readonly Segment[]; total: number; size?: number }) {
  const has = total > 0 && segments.some((s) => s.value > 0);
  const data = has ? segments.filter((s) => s.value > 0) : [{ value: 1, color: "var(--surface-2)" }];

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width={size} height={size}>
        <PieChart>
          <Pie
            data={data as Segment[]}
            dataKey="value"
            innerRadius={size * 0.34}
            outerRadius={size * 0.48}
            startAngle={90}
            endAngle={-270}
            paddingAngle={has ? 2 : 0}
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold tabular-nums text-ink">{total}</span>
      </div>
    </div>
  );
}
