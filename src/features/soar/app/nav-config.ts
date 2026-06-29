import type { Page } from '@/app/soar/types';

export type GatewayNavItem = {
  page: Page;
  label: string;
  badgeKey?: 'openIncidents' | 'newAlerts' | 'activeWorkflows';
};

/** Sidebar order for industry SOAR (gateway) mode */
export const GATEWAY_NAV_ITEMS: GatewayNavItem[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'threat-ops', label: 'Threat Ops' },
  { page: 'incidents', label: 'Incidents', badgeKey: 'openIncidents' },
  { page: 'alerts', label: 'Alerts', badgeKey: 'newAlerts' },
  { page: 'playbooks', label: 'Playbooks' },
  { page: 'playbook-runs', label: 'Playbook Runs' },
  { page: 'connectors', label: 'Connectors' },
  { page: 'integrations', label: 'Outbound Actions' },
  { page: 'vault', label: 'Vault' },
  { page: 'artifacts', label: 'Artifacts' },
  { page: 'webhook-sources', label: 'Webhooks' },
  { page: 'workflows', label: 'Workflows', badgeKey: 'activeWorkflows' },
  { page: 'analytics', label: 'Analytics' },
  { page: 'settings', label: 'Settings' },
];

export const LEGACY_NAV_ITEMS: GatewayNavItem[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'threat-ops', label: 'Threat Ops' },
  { page: 'analytics', label: 'Analytics' },
  { page: 'workflows', label: 'Workflows', badgeKey: 'activeWorkflows' },
  { page: 'cases', label: 'Cases', badgeKey: 'openIncidents' },
  { page: 'alerts', label: 'Alerts', badgeKey: 'newAlerts' },
  { page: 'integrations', label: 'Integrations' },
  { page: 'playbooks', label: 'Playbooks' },
  { page: 'settings', label: 'Settings' },
];
