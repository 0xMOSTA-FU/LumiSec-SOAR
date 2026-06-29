import {
  connectorTypeOptions,
  integrationConfigFields,
  integrationTypeLabel,
} from '@/lib/integrations/catalog';

export const CONNECTOR_TYPES = connectorTypeOptions();

export type ConnectorType = string;

export interface ConnectorConfigField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

export function connectorConfigFields(type: string): ConnectorConfigField[] {
  return integrationConfigFields(type);
}

export function connectorTypeLabel(type: string): string {
  return integrationTypeLabel(type);
}

export function connectorStatusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
    case 'connected':
    case 'online':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'error':
    case 'failed':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'inactive':
    case 'disconnected':
    case 'offline':
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}

export function connectorStatusDotClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'active':
    case 'connected':
    case 'online':
      return 'bg-emerald-500';
    case 'error':
    case 'failed':
      return 'bg-red-500';
    default:
      return 'bg-gray-400';
  }
}

export function normalizeConnectorStatus(status: string): 'active' | 'inactive' | 'error' {
  const normalized = status.toLowerCase();
  if (['active', 'connected', 'online'].includes(normalized)) return 'active';
  if (['error', 'failed'].includes(normalized)) return 'error';
  return 'inactive';
}
