/**
 * LumiSec internal platform modules — SOAR orchestrates these via Outbound Actions.
 * Not third-party connectors; full products under the same monolith.
 */

export interface PlatformModuleDef {
  id: string;
  tab: string;
  name: string;
  shortName: string;
  mountPath: string;
  description: string;
  soarActions: string[];
  statusKey: 'grc' | 'uctc' | 'phishing' | 'network';
}

export const LUMISEC_PLATFORM_MODULES: PlatformModuleDef[] = [
  {
    id: 'grc',
    tab: 'grc',
    name: 'GRC Platform',
    shortName: 'GRC',
    mountPath: '/api/grc',
    description:
      'Governance, risk, and compliance — push SOAR incidents as findings and risks, link remediation tasks.',
    soarActions: ['Submit finding', 'Submit risk'],
    statusKey: 'grc',
  },
  {
    id: 'uctc',
    tab: 'uctc',
    name: 'UCTC Platform',
    shortName: 'UCTC',
    mountPath: '/api/uctc',
    description:
      'Detection engineering — deploy Sigma rules, trigger rule workflows, and close detection gaps from incidents.',
    soarActions: ['Deploy / push rule', 'Trigger rule'],
    statusKey: 'uctc',
  },
  {
    id: 'phishing',
    tab: 'phishing',
    name: 'Phishing Simulation',
    shortName: 'Phishing',
    mountPath: '/api/phishing',
    description:
      'Human-risk campaigns — link SOAR incidents to awareness campaigns using live templates and landing pages.',
    soarActions: ['Create / link campaign'],
    statusKey: 'phishing',
  },
  {
    id: 'luminet',
    tab: 'luminet',
    name: 'LumiNet (Network)',
    shortName: 'LumiNet',
    mountPath: '/api/luminet',
    description:
      'Asset discovery and network context — enrich incidents with host inventory before GRC or UCTC actions.',
    soarActions: ['Asset context lookup', 'Push finding to GRC'],
    statusKey: 'network',
  },
];

export function getPlatformModule(tab: string): PlatformModuleDef | undefined {
  return LUMISEC_PLATFORM_MODULES.find((m) => m.tab === tab);
}
