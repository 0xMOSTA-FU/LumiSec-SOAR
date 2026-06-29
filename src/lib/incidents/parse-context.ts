import type { ArtifactType, IncidentContext, IncidentKind, ParsedArtifact } from './types';

const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
const HASH_RE = /\b[a-fA-F0-9]{64}\b|\b[a-fA-F0-9]{40}\b|\b[a-fA-F0-9]{32}\b/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const EMAIL_RE = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
const HOST_RE = /\b(?:WKS|SRV|HOST|PC|LAP|WS)[-_]?\w+\b/gi;

function uniq(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}

function parseJsonField<T>(val: unknown, fallback: T): T {
  if (val == null) return fallback;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val) as T;
    } catch {
      return fallback;
    }
  }
  return val as T;
}

function addArtifact(
  list: ParsedArtifact[],
  type: ArtifactType,
  value: string,
  label?: string,
) {
  const v = value.trim();
  if (!v) return;
  if (list.some(a => a.type === type && a.value.toLowerCase() === v.toLowerCase())) return;
  list.push({ type, value: v, label });
}

function extractFromText(text: string, artifacts: ParsedArtifact[]) {
  const ips = text.match(IP_RE) || [];
  ips.forEach(ip => addArtifact(artifacts, 'ip', ip));
  const hashes = text.match(HASH_RE) || [];
  hashes.forEach(h => addArtifact(artifacts, 'hash', h));
  const emails = text.match(EMAIL_RE) || [];
  emails.forEach(e => addArtifact(artifacts, 'email', e));
  const hosts = text.match(HOST_RE) || [];
  hosts.forEach(h => addArtifact(artifacts, 'hostname', h.toUpperCase()));
  const domains = text.match(DOMAIN_RE) || [];
  domains
    .filter(d => !d.includes('@') && !/^\d+\.\d+\.\d+\.\d+$/.test(d))
    .slice(0, 5)
    .forEach(d => addArtifact(artifacts, 'domain', d.toLowerCase()));
}

function extractFromRaw(raw: Record<string, unknown>, artifacts: ParsedArtifact[]) {
  const ipKeys = ['ip', 'source_ip', 'src_ip', 'dest_ip', 'destination_ip', 'attacker_ip', 'remote_ip'];
  const hostKeys = ['hostname', 'host', 'device', 'endpoint', 'computer_name', 'agent_name'];
  const hashKeys = ['hash', 'file_hash', 'sha256', 'md5', 'sha1', 'malware'];
  const userKeys = ['user', 'username', 'account', 'upn', 'email', 'principal'];
  const domainKeys = ['domain', 'fqdn', 'dns'];

  for (const k of ipKeys) {
    const v = raw[k];
    if (typeof v === 'string') addArtifact(artifacts, 'ip', v, k);
  }
  for (const k of hostKeys) {
    const v = raw[k];
    if (typeof v === 'string') addArtifact(artifacts, 'hostname', v, k);
  }
  for (const k of hashKeys) {
    const v = raw[k];
    if (typeof v === 'string' && v.length >= 32) addArtifact(artifacts, 'hash', v, k);
  }
  for (const k of userKeys) {
    const v = raw[k];
    if (typeof v === 'string') {
      if (v.includes('@')) addArtifact(artifacts, 'email', v, k);
      else addArtifact(artifacts, 'user', v, k);
    }
  }
  for (const k of domainKeys) {
    const v = raw[k];
    if (typeof v === 'string') addArtifact(artifacts, 'domain', v, k);
  }
}

export function buildIncidentContext(
  kind: IncidentKind,
  record: Record<string, unknown>,
): IncidentContext {
  const tags = parseJsonField<string[]>(record.tags, []);
  const raw = parseJsonField<Record<string, unknown>>(record.raw, {});
  const timeline = parseJsonField<{ time: string; event: string }[]>(record.timeline, []);
  const artifactList = parseJsonField<unknown[]>(record.artifacts, []);

  const artifacts: ParsedArtifact[] = [];
  for (const item of artifactList) {
    if (typeof item === 'string') {
      extractFromText(item, artifacts);
      if (item.includes('.') && !item.includes(' ')) {
        addArtifact(artifacts, 'file', item);
      }
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const type = String(o.type || 'unknown') as ArtifactType;
      const value = String(o.value || o.data || '');
      if (value) addArtifact(artifacts, type, value, String(o.label || ''));
    }
  }

  extractFromRaw(raw, artifacts);
  const blob = `${record.title || ''} ${record.description || ''} ${record.source || ''}`;
  extractFromText(blob, artifacts);

  const ips = uniq(artifacts.filter(a => a.type === 'ip').map(a => a.value));
  const hostnames = uniq(artifacts.filter(a => a.type === 'hostname').map(a => a.value));
  const hashes = uniq(artifacts.filter(a => a.type === 'hash').map(a => a.value));
  const domains = uniq(artifacts.filter(a => a.type === 'domain').map(a => a.value));
  const users = uniq(artifacts.filter(a => a.type === 'user').map(a => a.value));
  const emails = uniq(artifacts.filter(a => a.type === 'email').map(a => a.value));

  return {
    id: String(record.id || ''),
    kind,
    title: String(record.title || 'Untitled incident'),
    description: String(record.description || ''),
    severity: String(record.severity || 'medium'),
    status: String(record.status || 'open'),
    source: String(record.source || 'unknown'),
    tags: tags.map(t => String(t).toLowerCase()),
    artifacts,
    raw,
    timeline,
    ips,
    hostnames,
    hashes,
    domains,
    users,
    emails,
    caseId: kind === 'alert' ? (record.caseId as string | null) : record.id as string,
  };
}

export function normalizeTags(tags: string[], title: string, description: string, source: string): string[] {
  const combined = `${tags.join(' ')} ${title} ${description} ${source}`.toLowerCase();
  const inferred: string[] = [...tags.map(t => t.toLowerCase())];
  const rules: [RegExp, string][] = [
    [/brute|failed login|password spray/, 'brute-force'],
    [/malware|trojan|ransom|edr|endpoint/, 'malware'],
    [/phish|spoof|invoice|email gateway/, 'phishing'],
    [/port scan|scanning|recon/, 'scan'],
    [/exfil|outbound|data transfer/, 'exfiltration'],
    [/privilege|escalat|runas|admin share/, 'privilege-escalation'],
    [/credential|dump|lsass/, 'credential-access'],
    [/vpn|firewall|palo|forti|opnsense|pfsense/, 'network'],
    [/aws|cloud|iam|azure|gcp/, 'cloud'],
    [/crowdstrike|falcon|defender|wazuh/, 'endpoint'],
  ];
  for (const [re, tag] of rules) {
    if (re.test(combined) && !inferred.includes(tag)) inferred.push(tag);
  }
  return inferred;
}
