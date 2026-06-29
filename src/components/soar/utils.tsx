import React from 'react';
import { soarFetch, asArray } from '@/lib/soar/fetch-json';
import {
  Shield, Bug, MessageSquare, Ticket, Monitor, Cloud, Database,
  Mail, Users, Server, Globe, Bell, Link2, Send, Puzzle, Radar,
} from 'lucide-react';

export const getIconForIntegration = (icon: string) => {
  const map: Record<string, React.ReactNode> = {
    radar: <Radar className="h-5 w-5" />,
    shield: <Shield className="h-5 w-5" />,
    bug: <Bug className="h-5 w-5" />,
    'message-circle': <MessageSquare className="h-5 w-5" />,
    'message-square': <MessageSquare className="h-5 w-5" />,
    ticket: <Ticket className="h-5 w-5" />,
    monitor: <Monitor className="h-5 w-5" />,
    cloud: <Cloud className="h-5 w-5" />,
    database: <Database className="h-5 w-5" />,
    mail: <Mail className="h-5 w-5" />,
    users: <Users className="h-5 w-5" />,
    server: <Server className="h-5 w-5" />,
    globe: <Globe className="h-5 w-5" />,
    bell: <Bell className="h-5 w-5" />,
    webhook: <Link2 className="h-5 w-5" />,
    link: <Globe className="h-5 w-5" />,
    send: <Send className="h-5 w-5" />,
  };
  return map[icon] || <Puzzle className="h-5 w-5" />;
};

export const severityColor = (sev: string) => {
  switch (sev) {
    case 'critical':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    case 'high':
      return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
    case 'medium':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'low':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
};

export const statusColor = (status: string) => {
  switch (status) {
    case 'open':
    case 'new':
    case 'running':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    case 'investigating':
    case 'active':
      return 'bg-purple-500/10 text-purple-600 border-purple-500/20';
    case 'connected':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
    case 'contained':
    case 'draft':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20';
    case 'resolved':
    case 'success':
    case 'closed':
      return 'bg-green-500/10 text-green-600 border-green-500/20';
    case 'failed':
    case 'disconnected':
    case 'error':
      return 'bg-red-500/10 text-red-600 border-red-500/20';
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
  }
};

export const formatDate = (d: string) => {
  try {
    return new Date(d).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d;
  }
};

export async function updateWorkflowStatus(id: string, status: string) {
  await soarFetch('/api/workflows', {
    method: 'PUT',
    body: JSON.stringify({ id, status }),
  });
}
