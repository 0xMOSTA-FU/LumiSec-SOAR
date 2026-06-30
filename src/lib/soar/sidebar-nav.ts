import type { Page } from '@/app/soar/types';

export interface SidebarPageDef {
  page: Page;
  label: string;
  badgeKey?: 'newAlerts' | 'openCases' | 'activeWorkflows';
}

export interface SidebarSectionDef {
  label?: string;
  pages: SidebarPageDef[];
}

/** Industry SOAR sidebar — operations → automation → integrations → evidence */
export const GATEWAY_SIDEBAR_SECTIONS: SidebarSectionDef[] = [
  {
    label: 'Operations',
    pages: [
      { page: 'dashboard', label: 'Dashboard' },
      { page: 'alerts', label: 'Alerts', badgeKey: 'newAlerts' },
      { page: 'incidents', label: 'Incidents', badgeKey: 'openCases' },
      { page: 'approvals', label: 'Approvals' },
      { page: 'search', label: 'Search' },
      { page: 'threat-ops', label: 'Threat Ops' },
    ],
  },
  {
    label: 'Automation',
    pages: [
      { page: 'workflows', label: 'Workflows', badgeKey: 'activeWorkflows' },
      { page: 'playbooks', label: 'Playbooks' },
      { page: 'playbook-runs', label: 'Playbook Runs' },
    ],
  },
  {
    label: 'Integrations',
    pages: [
      { page: 'connectors', label: 'Connectors' },
      { page: 'integrations', label: 'Outbound Actions' },
      { page: 'webhook-sources', label: 'Webhooks' },
    ],
  },
  {
    label: 'Evidence',
    pages: [
      { page: 'artifacts', label: 'Artifacts' },
      { page: 'vault', label: 'Vault' },
    ],
  },
  {
    pages: [
      { page: 'analytics', label: 'Analytics' },
      { page: 'settings', label: 'Settings' },
    ],
  },
];

export const LEGACY_SIDEBAR_PAGES: SidebarPageDef[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'alerts', label: 'Alerts', badgeKey: 'newAlerts' },
  { page: 'cases', label: 'Cases', badgeKey: 'openCases' },
  { page: 'threat-ops', label: 'Threat Ops' },
  { page: 'workflows', label: 'Workflows', badgeKey: 'activeWorkflows' },
  { page: 'playbooks', label: 'Playbooks' },
  { page: 'integrations', label: 'Integrations' },
  { page: 'analytics', label: 'Analytics' },
  { page: 'settings', label: 'Settings' },
];
