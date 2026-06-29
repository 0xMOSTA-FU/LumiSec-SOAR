export function severityBadgeClass(severity: string): string {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'high':
      return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    case 'medium':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'low':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'info':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}

export function statusBadgeClass(status: string): string {
  switch (status?.toLowerCase()) {
    case 'open':
    case 'new':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'investigating':
    case 'in_progress':
      return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    case 'contained':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'resolved':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'closed':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}

export function formatIncidentDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}
