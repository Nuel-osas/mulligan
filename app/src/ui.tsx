// Shared UI pieces.
import type { ReactNode } from "react";
import { usd } from "./chain";

export function Mark() {
  // Two up-chevrons forming an M: the loss, and the half that comes back.
  return (
    <svg viewBox="0 0 26 23" aria-hidden>
      <path d="M0 18 L8 5 L16 18 H11 L8 12.6 L5 18 Z" fill="currentColor" />
      <path d="M10 18 L18 5 L26 18 H21 L18 12.6 L15 18 Z" fill="#50d2c1" />
    </svg>
  );
}

export function Btn({ children, go, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { go?: boolean }) {
  return (
    <button {...rest} className={`${rest.className ?? ""} ${go ? "go" : ""}`}>
      <span>{children}</span>
    </button>
  );
}

export function Stat({ l, n, sub }: { l: string; n: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="tag">{l}</div>
      <div className="n">{n}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const ago = (t: number, now = Math.floor(Date.now() / 1000)) => {
  const d = Math.max(0, now - t);
  return d < 60 ? `${d}s ago` : d < 3600 ? `${Math.floor(d / 60)}m ago` : `${Math.floor(d / 3600)}h ago`;
};
export const signed = (v: bigint) => (v > 0n ? `+${usd(v)}` : usd(v));
export const tone = (v: bigint) => ({ color: v > 0n ? "var(--ok)" : v < 0n ? "var(--bad)" : undefined });

/** Minimal SVG line chart. */
export function Spark({ data, height = 140, label }: { data: number[]; height?: number; label?: string }) {
  if (data.length < 2) return <div className="spark empty" style={{ height }}>Collecting live data…</div>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.001 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const w = 600;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - lo) / (hi - lo)) * height}`);
  const up = data[data.length - 1] >= data[0];
  return (
    <div className="spark">
      {label && <div className="tag spark-label">{label}</div>}
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }}>
        <defs>
          <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={up ? "#50d2c1" : "#ff8a80"} stopOpacity="0.35" />
            <stop offset="1" stopColor={up ? "#50d2c1" : "#ff8a80"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${height} ${pts.join(" ")} ${w},${height}`} fill="url(#fill)" />
        <polyline points={pts.join(" ")} fill="none" stroke={up ? "#97fce4" : "#ff8a80"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="spark-axis">
        <span>{hi.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
        <span>{lo.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>
      </div>
    </div>
  );
}

/** Split bar, e.g. reserved vs free, long vs short. */
export function Split({ a, b, la, lb }: { a: bigint; b: bigint; la: string; lb: string }) {
  const total = Number(a + b) || 1;
  const pa = (Number(a) / total) * 100;
  return (
    <div className="split">
      <div className="split-bar">
        <span style={{ width: `${pa}%` }} className="a" />
        <span style={{ width: `${100 - pa}%` }} className="b" />
      </div>
      <div className="split-legend">
        <span>
          <i className="a" /> {la} {usd(a)}
        </span>
        <span>
          <i className="b" /> {lb} {usd(b)}
        </span>
      </div>
    </div>
  );
}
