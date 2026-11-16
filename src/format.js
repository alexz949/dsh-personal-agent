const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const DAY = 864e5;

export function greeting(hour) {
  if (hour >= 5 && hour < 11) return '早上好';
  if (hour >= 11 && hour < 13) return '中午好';
  if (hour >= 13 && hour < 18) return '下午好';
  return '晚上好';
}

// Compact, sidebar-style timestamps: recent minutes, then clock time, weekday and date.
export function formatUpdatedAt(time, now = Date.now()) {
  const date = new Date(time);
  const current = new Date(now);
  const elapsed = now - time;
  if (elapsed < 60e3) return '刚刚';
  if (elapsed < 3600e3) return `${Math.floor(elapsed / 60e3)} 分钟前`;
  const today = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const pad = value => String(value).padStart(2, '0');
  if (time >= today) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (time >= today - DAY) return '昨天';
  if (time >= today - 6 * DAY) return WEEKDAYS[date.getDay()];
  if (date.getFullYear() === current.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** `11月16日 周一`, for the home header. */
export function formatToday(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}
