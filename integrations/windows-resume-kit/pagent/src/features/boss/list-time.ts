export type BossListActivity = { lowerInclusive: number; upperExclusive: number };

const minute = 60_000;
const day = 24 * 60 * minute;
const beijingOffset = 8 * 60 * minute;

/** BOSS v5543 U2 formats updateTime in Beijing time as hh:mm / 昨天 / MM月dd日. */
export function bossListActivity(label: string, now: number): BossListActivity | undefined {
  if (!Number.isFinite(now)) return undefined;
  const today = Math.floor((now + beijingOffset) / day) * day - beijingOffset;
  const clock = /^(\d{2}):(\d{2})$/.exec(label);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) return undefined;
    const start = today + (hours * 60 + minutes) * minute;
    return { lowerInclusive: start, upperExclusive: start + minute };
  }
  if (label === '昨天') return { lowerInclusive: today - day, upperExclusive: today };
  const date = /^(\d{2})月(\d{2})日$/.exec(label);
  if (!date) return undefined;
  const month = Number(date[1]);
  const dateOfMonth = Number(date[2]);
  const thisYear = new Date(today + beijingOffset).getUTCFullYear();
  // The label omits years. The latest possible past date is the safe bound, including a leap day.
  for (let year = thisYear; year >= thisYear - 4; year -= 1) {
    const utc = new Date(Date.UTC(year, month - 1, dateOfMonth));
    const start = utc.getTime() - beijingOffset;
    if (utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== dateOfMonth || start > today) continue;
    return { lowerInclusive: start, upperExclusive: start + day };
  }
  return undefined;
}
