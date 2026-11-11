/**
 * A scannable QR code of `value` as SVG (no inline styles, CSP-safe): `uqr` encodes (MIT, no dependencies),
 * one path draws the dark modules. Used by the payment link share card (landing `LinksCard` look).
 */
import { encode } from "uqr";

/** The dark modules of `value` as one SVG path (unit squares), and the side length in modules. */
export function qrPath(value: string): { d: string; size: number } {
  const { data, size } = encode(value, { ecc: "M", border: 0 });
  let d = "";
  for (let y = 0; y < size; y++) {
    const row = data[y] ?? [];
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue;
      // merge runs of dark modules in a row into one rectangle
      let w = 1;
      while (x + w < size && row[x + w]) w++;
      d += `M${x} ${y}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return { d, size };
}

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { d, size } = qrPath(value);
  return (
    <svg
      className={className}
      viewBox={`-2 -2 ${size + 4} ${size + 4}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect x="-2" y="-2" width={size + 4} height={size + 4} fill="#ffffff" />
      <path d={d} fill="#12263F" />
    </svg>
  );
}
