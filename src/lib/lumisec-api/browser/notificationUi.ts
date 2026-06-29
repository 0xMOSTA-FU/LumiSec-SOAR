import {
  AlertTriangle,
  Bell,
  BookOpen,
  FolderOpen,
  GitBranch,
  Info,
  Plug,
  type LucideIcon,
} from 'lucide-react';

export function notificationTypeIcon(type: string): LucideIcon {
  const normalized = type.toLowerCase();
  if (normalized.includes('incident') || normalized.includes('case')) return FolderOpen;
  if (normalized.includes('alert')) return Bell;
  if (normalized.includes('playbook') && normalized.includes('run')) return GitBranch;
  if (normalized.includes('playbook')) return BookOpen;
  if (normalized.includes('connector')) return Plug;
  if (normalized.includes('error') || normalized.includes('critical')) return AlertTriangle;
  return Info;
}

import type { SoarNavTarget } from '@/lib/soar/mode';

export function notificationSoarTarget(
  resourceType: string | null | undefined,
  resourceId: string | null | undefined,
): SoarNavTarget | null {
  if (!resourceType || !resourceId) return null;

  const type = resourceType.toLowerCase().replace(/\s+/g, '_');

  if (type.includes('incident') || type === 'case' || type === 'cases') {
    return { page: 'gateway-incident-detail', incidentId: resourceId };
  }
  if (type.includes('playbook') && type.includes('run')) {
    return { page: 'playbook-run-detail', runId: resourceId };
  }
  if (type === 'playbook' || type === 'playbooks') {
    return { page: 'playbooks' };
  }
  if (type === 'alert' || type === 'alerts') {
    return { page: 'alerts' };
  }
  return null;
}

export function notificationResourceUrl(
  resourceType: string | null | undefined,
  resourceId: string | null | undefined,
): string | null {
  if (!resourceType || !resourceId) return null;

  const type = resourceType.toLowerCase().replace(/\s+/g, '_');
  const id = encodeURIComponent(resourceId);

  if (type.includes('incident') || type === 'case' || type === 'cases') {
    return `/incidents/${id}`;
  }
  if (type.includes('playbook') && type.includes('run')) {
    return `/playbook-runs/${id}`;
  }
  if (type === 'playbook' || type === 'playbooks') {
    return `/playbooks`;
  }
  if (type === 'alert' || type === 'alerts') {
    return `/alerts`;
  }
  if (type === 'connector' || type === 'connectors') {
    return `/connectors`;
  }
  if (type === 'artifact' || type === 'artifacts') {
    return `/artifacts`;
  }
  if (type === 'vault') {
    return `/vault`;
  }

  return null;
}

export function notificationExcerpt(body: string | null, maxLength = 120): string {
  if (!body) return '';
  const trimmed = body.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength).trim()}…`;
}
