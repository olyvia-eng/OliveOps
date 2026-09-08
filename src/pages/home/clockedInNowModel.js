export function formatClockedInElapsed(clockIn, now = Date.now()) {
  const startedAt = Date.parse(clockIn ?? '');
  if (!Number.isFinite(startedAt)) return '0m';
  const totalMinutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}