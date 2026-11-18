export function auctionCountdown(deadline: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const unit = (value: number, label: string) => `${value} ${label}${value === 1 ? '' : 's'}`;
  if (days >= 30) {
    // Month lengths vary; long countdowns explicitly use approximate 30-day months.
    const rest = days % 30;
    return `About ${[unit(Math.floor(days / 30), 'month'),
      rest >= 7 ? unit(Math.floor(rest / 7), 'week') : '',
      rest % 7 ? unit(rest % 7, 'day') : ''].filter(Boolean).join(' ')}`;
  }
  if (days >= 7) return [unit(Math.floor(days / 7), 'week'), days % 7 ? unit(days % 7, 'day') : ''].filter(Boolean).join(' ');
  if (days >= 1) return `${unit(days, 'day')} ${Math.floor(seconds % 86400 / 3600)}h`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}m ${String(seconds % 60).padStart(2, '0')}s`;
}
