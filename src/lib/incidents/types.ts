export type IncidentKind = 'case' | 'alert';

export type ArtifactType =
  | 'ip'
  | 'domain'
  | 'hash'
  | 'hostname'
  | 'email'
  | 'url'
  | 'user'
  | 'file'
  | 'unknown';

export interface ParsedArtifact {
  type: ArtifactType;
  value: string;
  label?: string;
}

export interface IncidentContext {
  id: string;
  kind: IncidentKind;
  title: string;
  description: string;
  severity: string;
  status: string;
  source: string;
  tags: string[];
  artifacts: ParsedArtifact[];
  raw: Record<string, unknown>;
  timeline: { time: string; event: string }[];
  ips: string[];
  hostnames: string[];
  hashes: string[];
  domains: string[];
  users: string[];
  emails: string[];
  caseId?: string | null;
}

export type ResponseActionCategory = 'contain' | 'investigate' | 'notify' | 'remediate' | 'status' | 'platform';

export type ResponseActionId =
  | 'block_ip'
  | 'isolate_host'
  | 'enrich_ip'
  | 'scan_hash'
  | 'disable_user'
  | 'notify_soc_slack'
  | 'notify_email'
  | 'notify_telegram'
  | 'run_enrichment_playbook'
  | 'mark_investigating'
  | 'mark_contained'
  | 'platform_grc_finding'
  | 'platform_grc_risk'
  | 'platform_uctc_rule'
  | 'platform_phishing_campaign'
  | 'platform_luminet_context';

export interface RecommendedAction {
  id: ResponseActionId;
  label: string;
  description: string;
  category: ResponseActionCategory;
  destructive: boolean;
  available: boolean;
  unavailableReason?: string;
  requiresIntegrations: string[];
  params: Record<string, unknown>;
  score: number;
}

export interface IncidentActionResult {
  ok: boolean;
  message: string;
  actionId: ResponseActionId;
  logs: { time: string; message: string; level: string }[];
  executionId?: string;
  statusUpdated?: string;
}
