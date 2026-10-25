import type { InspectionStatus } from '../api/types';
import { formatKstTime } from '../lib/kst';

const HOUR = 60 * 60 * 1000;

function duration(ms: number): string {
  const total = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}시간 ${m}분`;
  return h ? `${h}시간` : `${m}분`;
}

function caption(gap: number): string {
  if (gap < 0) return `청소가 체크아웃보다 ${duration(gap)} 먼저 시작합니다`;
  if (gap === 0) return '체크아웃과 동시에 청소를 시작합니다';
  return `체크아웃 ${duration(gap)} 뒤 청소를 시작합니다`;
}

/**
 * Checkout vs. cleaning start on one time axis. The band between the two markers is the overlap
 * (cleaning while the guest is still in the room) when the judgment is CONFLICT, otherwise the
 * turnover gap. Renders nothing when either time is missing — the facts list says why.
 */
export default function TimeCompare({
  checkoutAt,
  cleaningAt,
  status,
}: {
  checkoutAt: string | null;
  cleaningAt: string | null;
  status: InspectionStatus | null;
}) {
  if (!checkoutAt || !cleaningAt) return null;
  const c = Date.parse(checkoutAt);
  const s = Date.parse(cleaningAt);
  if (Number.isNaN(c) || Number.isNaN(s)) return null;

  const span = Math.abs(c - s);
  const pad = Math.max(HOUR, span * 0.25);
  const lo = Math.floor((Math.min(c, s) - pad) / HOUR) * HOUR;
  const hi = Math.ceil((Math.max(c, s) + pad) / HOUR) * HOUR;
  const pct = (t: number) => ((t - lo) / (hi - lo)) * 100;
  const hours = (hi - lo) / HOUR;
  const step = hours <= 8 ? 1 : Math.ceil(hours / 6);
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += step * HOUR) ticks.push(t);

  const tone = status === 'CONFLICT' ? 'conflict' : status === 'NORMAL' ? 'normal' : 'neutral';
  const edge = (p: number) => (p < 14 ? 'start' : p > 86 ? 'end' : 'mid');
  const cp = pct(c);
  const sp = pct(s);

  return (
    <figure className={`tc tc-${tone}`} aria-label="체크아웃과 청소 시작 시각 비교">
      <div className="tc-plot">
        <div className={`tc-label tc-label-top tc-${edge(cp)}`} style={{ left: `${cp}%` }}>
          체크아웃 <b className="tnum">{formatKstTime(checkoutAt)}</b>
        </div>
        <div className="tc-track">
          <div
            className="tc-band"
            style={{ left: `${Math.min(cp, sp)}%`, width: `${Math.abs(cp - sp)}%` }}
          />
          <span className="tc-mark tc-mark-checkout" style={{ left: `${cp}%` }} />
          <span className="tc-mark tc-mark-cleaning" style={{ left: `${sp}%` }} />
        </div>
        <div className={`tc-label tc-label-bottom tc-${edge(sp)}`} style={{ left: `${sp}%` }}>
          청소 시작 <b className="tnum">{formatKstTime(cleaningAt)}</b>
        </div>
        <div className="tc-axis" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="tc-tick" style={{ left: `${pct(t)}%` }}>
              {formatKstTime(new Date(t).toISOString()).slice(0, 2)}시
            </span>
          ))}
        </div>
      </div>
      <figcaption>{caption(s - c)}</figcaption>
    </figure>
  );
}
