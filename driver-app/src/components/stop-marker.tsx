import Svg, { Circle, Rect } from "react-native-svg";

/**
 * A filled blue "stop" glyph (⏹) — a solid blue disc with a centered white
 * rounded square cut-out. Marks a drop-off / intermediate stop on a route rail,
 * distinct from the hollow origin (pickup) marker.
 */
export function StopMarker({ size = 16, color = "#2563EB" }: { size?: number; color?: string }) {
  const inner = size * 0.42; // side of the white square
  const offset = (size - inner) / 2;
  const corner = inner * 0.28; // rounded-corner radius of the square
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={color} />
      <Rect x={offset} y={offset} width={inner} height={inner} rx={corner} ry={corner} fill="#ffffff" />
    </Svg>
  );
}
