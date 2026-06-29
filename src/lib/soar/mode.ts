/**
 * Industry SOAR UI mode (Splunk SOAR / XSOAR mental model).
 *
 * - Incidents = center of work (Cases are stored locally but exposed as Incidents)
 * - Alerts → escalate to Incident
 * - Connectors = inbound sources | Integrations = outbound actions
 * - Vault = connector secrets
 * - Visual Workflows = local Prisma until remote backend supports them
 */
export {
  isGatewayMode,
  isRemoteSoarBackend,
  useRemoteGateway,
  isLumisecBackendEnabled,
  GATEWAY_BROWSER_PREFIX,
  LUMISEC_API_URL,
} from '@/lib/lumisec-api/config';

export type SoarBackendKind = 'local' | 'remote';

export function resolveSoarBackend(): SoarBackendKind {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SOAR_USE_REMOTE_GATEWAY === '1') {
    return 'remote';
  }
  if (typeof process !== 'undefined' && process.env.SOAR_USE_REMOTE_GATEWAY === '1') {
    return 'remote';
  }
  return 'local';
}

/** SPA navigation targets inside SoarApp (avoids broken Next.js routes). */
export type SoarNavTarget =
  | { page: 'incidents' }
  | { page: 'gateway-incident-detail'; incidentId: string }
  | { page: 'playbooks' }
  | { page: 'playbook-runs'; playbookId?: string }
  | { page: 'playbook-run-detail'; runId: string }
  | { page: 'alerts'; alertId?: string };

export type SoarNavigate = (target: SoarNavTarget) => void;
