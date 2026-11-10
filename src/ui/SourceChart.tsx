/**
 * Stacked daily volume by where customers paid from (design v2 Home, "Volume by where customers paid
 * from"). Dependency-free SVG with presentation attributes only (CSP: no inline styles): bar x/width in
 * percent of the plot, heights in px from a fixed plot height, so rounded ends never distort. Amounts arrive
 * as bigint base units and are only turned into pixel heights (ratio computed in bigint); every label is
 * formatted from the exact value (INV-5).
 *
 * Series colours come from CSS classes (`dash-series--1…3`, design v2 chart palette: teal, violet, slate),
 * in fixed slot order; a legend is always shown, segments are separated by a 3 px surface gap, each day
 * has a hover tooltip, and the same numbers are available as a table ("View as table", also read by
 * screen readers) — identity is never colour alone.
 */
import { useId } from "react";

export interface SourceSeries {
  /** Stable key (CAIP-2 chain id, or "other"). */
  readonly key: string;
  readonly label: string;
}

export interface SourceDay {
  /** Axis label ("3 Nov"). */
  readonly label: string;
  readonly total: bigint;
  readonly totalDisplay: string;
  /** Value per series key (missing = 0). */
  readonly values: ReadonlyMap<string, bigint>;
  readonly displays: ReadonlyMap<string, string>;
}

const H = 220;
const TOP = 8;
const GAP = 3;
const MIN = 4;

/** Pixel heights of one day's segments (bottom first), scaled to `max`; 0 stays 0, tiny values stay visible. */
export function segmentHeights(values: readonly bigint[], max: bigint, plot = H - TOP): number[] {
  return values.map((v) => {
    if (v <= 0n || max <= 0n) return 0;
    const px = Number((v * BigInt(plot) * 1000n) / max) / 1000;
    return Math.max(MIN, Math.round(px));
  });
}

export function SourceChart({
  title,
  days,
  series,
  summary,
  emptyText = "No settled payments in this period yet.",
}: {
  title: string;
  days: readonly SourceDay[];
  /** At most three series, bottom to top (slot order = colour order). */
  series: readonly SourceSeries[];
  /** Accessible summary of the period ("Last 7 days, USD"). */
  summary: string;
  emptyText?: string;
}) {
  const id = useId();
  const max = days.reduce((m, d) => (d.total > m ? d.total : m), 0n);
  const empty = max === 0n;
  const n = Math.max(days.length, 1);
  const col = 100 / n;
  const barW = col * 0.6;
  const peak = days.reduce<SourceDay | undefined>((m, d) => (!m || d.total > m.total ? d : m), undefined);
  const aria = empty
    ? `${title}, ${summary}: ${emptyText}`
    : `${title}, ${summary}. Highest: ${peak?.totalDisplay} on ${peak?.label}. Paid from ${series.map((s) => s.label).join(", ")}.`;

  return (
    <figure className="dash-src" aria-labelledby={`${id}-t`}>
      <div className="dash-src__head">
        <h2 id={`${id}-t`} className="dash-card-title">
          {title}
        </h2>
        {series.length > 0 ? (
          <ul className="dash-src__legend" aria-label="Chains">
            {series.map((s, i) => (
              <li key={s.key} className="dash-src__key">
                <span className={`dash-src__swatch dash-series--${i + 1}`} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="dash-src__plot">
        <svg className="dash-src__svg" width="100%" height={H} role="img" aria-label={aria} data-testid="volume-chart">
          {days.map((d, i) => {
            const vals = series.map((s) => d.values.get(s.key) ?? 0n);
            const hs = segmentHeights(vals, max);
            let y = H;
            return (
              <g key={d.label}>
                {hs.map((h, si) => {
                  if (h === 0) return null;
                  const gap = y < H ? GAP : 0;
                  const top = y - gap - h;
                  y = top;
                  return (
                    <rect
                      // biome-ignore lint/suspicious/noArrayIndexKey: series slots are positional
                      key={si}
                      className={`dash-src__bar dash-series--${si + 1}`}
                      x={`${i * col + (col - barW) / 2}%`}
                      width={`${barW}%`}
                      y={top}
                      height={h}
                      rx="6"
                    />
                  );
                })}
              </g>
            );
          })}
          <line x1="0" x2="100%" y1={H - 0.5} y2={H - 0.5} className="dash-src__base" />
        </svg>
        {empty ? <p className="dash-src__empty">{emptyText}</p> : null}
        {/* hover tooltips per day (pointer only; the table below carries the same numbers for everyone) */}
        <div className="dash-src__cols" aria-hidden="true">
          {days.map((d) => (
            <div key={d.label} className="dash-src__col">
              {d.total > 0n ? (
                <div className="dash-src__tip">
                  <p className="dash-src__tip-title">
                    {d.label} · {d.totalDisplay}
                  </p>
                  {series.map((s, i) =>
                    (d.values.get(s.key) ?? 0n) > 0n ? (
                      <p key={s.key} className="dash-src__tip-row">
                        <span className={`dash-src__swatch dash-series--${i + 1}`} />
                        <span>{s.label}</span>
                        <span className="np-tabular">{d.displays.get(s.key)}</span>
                      </p>
                    ) : null,
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="dash-src__axis" aria-hidden="true">
        {days.map((d) => (
          <span key={d.label}>{d.label}</span>
        ))}
      </div>
      <details className="dash-src__table">
        <summary>View as table</summary>
        <div className="np-table-scroll">
          <table className="dash-src__data">
            <caption className="np-sr-only">
              {title}, {summary}
            </caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.label}>
                  <th scope="row">{d.label}</th>
                  {series.map((s) => (
                    <td key={s.key} className="np-tabular">
                      {d.displays.get(s.key) ?? "—"}
                    </td>
                  ))}
                  <td className="np-tabular">{d.totalDisplay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
