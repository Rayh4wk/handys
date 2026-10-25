// KST (UTC+9, no DST). Fixed-offset arithmetic so results never depend on the runtime TZ.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const p2 = (n: number) => String(n).padStart(2, '0');

function parts(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Invalid ISO date: ${iso}`);
  const d = new Date(t + KST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: p2(d.getUTCMonth() + 1),
    d: p2(d.getUTCDate()),
    h: p2(d.getUTCHours()),
    mi: p2(d.getUTCMinutes()),
    s: p2(d.getUTCSeconds()),
  };
}

/** "MM/DD HH:mm" in KST */
export function formatKst(iso: string | null): string {
  if (!iso) return '';
  const k = parts(iso);
  return `${k.mo}/${k.d} ${k.h}:${k.mi}`;
}

/** "HH:mm" in KST */
export function formatKstTime(iso: string | null): string {
  if (!iso) return '';
  const k = parts(iso);
  return `${k.h}:${k.mi}`;
}

/** "YYYY-MM-DD HH:mm:ss" in KST */
export function formatKstDateTime(iso: string): string {
  const k = parts(iso);
  return `${k.y}-${k.mo}-${k.d} ${k.h}:${k.mi}:${k.s}`;
}

/** ISO -> "YYYY-MM-DDTHH:mm" (datetime-local value, KST) */
export function isoToKstInput(iso: string | null): string {
  if (!iso) return '';
  const k = parts(iso);
  return `${k.y}-${k.mo}-${k.d}T${k.h}:${k.mi}`;
}

/** "YYYY-MM-DDTHH:mm" (KST) -> UTC ISO string */
export function kstInputToIso(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) throw new Error(`Invalid KST input: ${value}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi) - KST_OFFSET_MS;
  const out = new Date(t);
  if (Number.isNaN(t) || isoToKstInput(out.toISOString()) !== value) {
    throw new Error(`Invalid KST input: ${value}`);
  }
  return out.toISOString();
}
