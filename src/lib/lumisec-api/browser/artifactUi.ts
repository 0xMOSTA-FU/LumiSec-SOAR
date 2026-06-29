import {
  FileText,
  Globe,
  Hash,
  Link2,
  Mail,
  Server,
  type LucideIcon,
} from 'lucide-react';

export function normalizeArtifactType(type: string): string {
  return type.toLowerCase().replace(/\s+/g, '_');
}

export function artifactTypeIcon(type: string): LucideIcon {
  switch (normalizeArtifactType(type)) {
    case 'ip':
    case 'ipv4':
    case 'ipv6':
      return Server;
    case 'domain':
    case 'hostname':
      return Globe;
    case 'hash':
    case 'md5':
    case 'sha1':
    case 'sha256':
      return Hash;
    case 'url':
    case 'uri':
      return Link2;
    case 'email':
    case 'e-mail':
      return Mail;
    case 'file':
    case 'filename':
      return FileText;
    default:
      return Hash;
  }
}

export function artifactTypeLabel(type: string): string {
  const normalized = normalizeArtifactType(type);
  const labels: Record<string, string> = {
    ip: 'IP',
    ipv4: 'IP',
    ipv6: 'IP',
    domain: 'Domain',
    hash: 'Hash',
    sha256: 'Hash',
    sha1: 'Hash',
    md5: 'Hash',
    url: 'URL',
    email: 'Email',
    file: 'File',
  };
  return labels[normalized] ?? type;
}

export function tlpBadgeClass(tlp: string): string {
  switch (tlp.toUpperCase()) {
    case 'WHITE':
    case 'CLEAR':
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
    case 'GREEN':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'AMBER':
    case 'YELLOW':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/20';
    case 'RED':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
}
