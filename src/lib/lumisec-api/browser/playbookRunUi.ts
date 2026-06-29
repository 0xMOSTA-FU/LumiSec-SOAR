export function runStatusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'success':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'running':
    case 'in_progress':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'paused':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'failed':
    case 'error':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'cancelled':
    case 'canceled':
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}

export function stepStatusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'success':
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'running':
    case 'in_progress':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'pending':
    case 'queued':
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    case 'failed':
    case 'error':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'skipped':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}

export function isActiveRunStatus(status: string): boolean {
  const normalized = status.toLowerCase();
  return normalized === 'running' || normalized === 'paused' || normalized === 'in_progress';
}

export function formatRunDuration(
  duration: string | number | null | undefined,
  startedAt?: string,
  completedAt?: string | null,
): string {
  if (duration !== null && duration !== undefined && duration !== '') {
    if (typeof duration === 'number') {
      return formatMs(duration);
    }
    const asNumber = Number(duration);
    if (!Number.isNaN(asNumber) && String(duration).trim() !== '') {
      return formatMs(asNumber > 1000 ? asNumber : asNumber * 1000);
    }
    return String(duration);
  }

  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '—';
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (Number.isNaN(end)) return '—';
  return formatMs(Math.max(0, end - start));
}

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
