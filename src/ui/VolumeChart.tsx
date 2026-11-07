/**
 * Dependency-free line chart for daily payment volume (Figma Overview "Payment volume"). SVG with
 * presentation attributes only (CSP: no inline styles); amounts arrive as bigint base units and are only
 * converted to numbers for plotting — labels are formatted from the exact values (INV-5).
 * Accessible: `role="img"` with a summary, plus a visually hidden data table.
 */
import { useId } from "react";

export interface VolumePoint {
  /** Axis label ("1 Nov"). */
  label: string;
  /** Exact amount, base units. */
  value: bigint;
  /** Formatted exact amount ("$2,486.00"). */
  display: string;
}

const W = 1120;
const H = 168;

/** Plot coordinates for the points: x spread evenly, y scaled to the max (top padding 8%). */
export function chartPoints(values: readonly bigint[], width = W, height = H): [number, number][] {
  if (values.length === 0) return [];
  const max = values.reduce((m, v) => (v > m ? v : m), 0n);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((v, i) => {
    // ratio in parts per million, computed in bigint, then scaled for drawing only
    const ppm = max > 0n ? Number((v * 1_000_000n) / max) : 0;
    const y = height - (ppm / 1_000_000) * height * 0.92;
    return [Math.round(i * step * 10) / 10, Math.round(y * 10) / 10];
  });
}

export function VolumeChart({
  points,
  label,
  emptyText = "No settled payments in this period yet.",
}: {
  points: readonly VolumePoint[];
  /** Accessible summary, e.g. "Payment volume, last 7 days, USD". */
  label: string;
  emptyText?: string;
}) {
  const id = useId();
  const coords = chartPoints(points.map((p) => p.value));
  const empty = points.every((p) => p.value === 0n);
  const peak = points.reduce<VolumePoint | undefined>((m, p) => (!m || p.value > m.value ? p : m), undefined);
  const summary = empty ? `${label}: ${emptyText}` : `${label}. Highest: ${peak?.display} on ${peak?.label}.`;
  return (
    <figure className="dash-chart" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="np-sr-only">
        {summary}
      </figcaption>
      <div className="dash-chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="dash-chart__svg"
          role="img"
          aria-label={summary}
          data-testid="volume-chart"
        >
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={Math.round(H * f)} y2={Math.round(H * f)} className="dash-chart__grid" />
          ))}
          {coords.length > 1 ? (
            <polyline points={coords.map((c) => c.join(",")).join(" ")} className="dash-chart__line" />
          ) : null}
        </svg>
        {empty ? <p className="dash-chart__empty">{emptyText}</p> : null}
      </div>
      <div className="dash-chart__axis" aria-hidden="true">
        {points.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
      <table className="np-sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Settled</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.label}>
              <td>{p.label}</td>
              <td>{p.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
