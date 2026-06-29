'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, Play, GitBranch, Send, Mail, MessageSquare, Globe, Database,
  Shield, Lock, Activity, Code, FileText, Bell, Bug, Ticket, Radar,
  Monitor, Cloud, Users, Ban,
  Trash2, Plus, X, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronDown, Terminal, Webhook, Filter, Save, Lightbulb,
  Settings as SettingsIcon, Copy, ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { soarFetch, asArray } from '@/lib/soar/fetch-json';
import { EnrichmentResultsCards } from '@/components/gateway/EnrichmentResultsCards';
import {
  extractEnrichmentFromOutputs,
  type EnrichmentSnapshot,
} from '@/lib/platform/enrichment-parse';
import type { NodeOutputSummary } from '@/lib/platform/execution-view';

function workflowHasEmailNode(nodes: WFNode[]): boolean {
  return nodes.some(n => n.subtype === 'email' || n.data.config?.subtype === 'email');
}

/** Nodes reachable from trigger nodes via edges (BFS). */
function getReachableFromTriggers(nodes: WFNode[], edges: WFEdge[]): Set<string> {
  const triggers = nodes.filter(n => n.type === 'trigger');
  const reachable = new Set<string>();
  const queue = triggers.map(t => t.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    edges.filter(e => e.source === id).forEach(e => {
      if (!reachable.has(e.target)) queue.push(e.target);
    });
  }
  return reachable;
}

function getWorkflowWarnings(nodes: WFNode[], edges: WFEdge[]): string[] {
  if (nodes.length === 0) {
    return ['Add nodes from the palette to build your workflow.'];
  }

  const warnings: string[] = [];
  const triggers = nodes.filter(n => n.type === 'trigger');
  const executable = nodes.filter(n => n.type !== 'trigger');

  if (triggers.length === 0) {
    warnings.push('No Trigger node — add Manual, Alert, or Webhook from the palette and connect it to your actions.');
    return warnings;
  }

  if (executable.length === 0) {
    warnings.push('Add action nodes and connect them to your trigger.');
    return warnings;
  }

  const reachable = getReachableFromTriggers(nodes, edges);
  const unreachable = executable.filter(n => !reachable.has(n.id));
  if (unreachable.length > 0) {
    warnings.push(
      `${unreachable.length} node(s) not connected to the trigger — draw a line from the trigger (or previous node) to each action.`,
    );
  }

  return warnings;
}

export interface WFNode {
  id: string;
  type: NodeType;
  subtype?: string;
  position: { x: number; y: number };
  data: {
    label: string;
    description?: string;
    config: Record<string, unknown>;
  };
}

export interface WFEdge {
  id: string;
  source: string;
  sourcePort?: 'output';
  target: string;
  targetPort?: 'input';
  label?: string;
}

export interface WorkflowData {
  id: string;
  name: string;
  description?: string;
  status: string;
  nodes: WFNode[];
  edges: WFEdge[];
}

type NodeType = 'trigger' | 'action' | 'condition' | 'output';

export const nodeTypeConfig: Record<NodeType, { color: string; bgColor: string; borderColor: string; icon: React.ReactNode; label: string }> = {
  trigger: { color: 'text-emerald-600', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/40', icon: <Zap className="h-4 w-4" />, label: 'Trigger' },
  action: { color: 'text-blue-600', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/40', icon: <Play className="h-4 w-4" />, label: 'Action' },
  condition: { color: 'text-amber-600', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/40', icon: <GitBranch className="h-4 w-4" />, label: 'Condition' },
  output: { color: 'text-purple-600', bgColor: 'bg-purple-500/10', borderColor: 'border-purple-500/40', icon: <Send className="h-4 w-4" />, label: 'Output' },
};

// Node subtypes with specific icons and configs
// Categories group 22 real connectors matching the engine dispatch:
//   Threat Intel: virustotal, abuseipdb, ipinfo, otx, misp, opencti, greynoise, shodan
//   SIEM: sentinel, splunk, elastic, wazuh
//   Ticketing: jira, servicenow, pagerduty, thehive, defectdojo
//   Cloud/IAM: msgraph, digitalocean
//   Network: fortigate, opnsense, pfsense
//   Sandbox: cuckoo, clamav
//   PCAP/SIEM: arkime
//   EDR: velociraptor, crowdstrike, isolate
//   Comms: slack, email, teams
//   Generic: http, webhook, soar_utils, block, create_case
export const nodeSubtypes: Record<NodeType, { id: string; label: string; icon: React.ReactNode; description: string; defaultConfig: Record<string, unknown> }[]> = {
  trigger: [
    { id: 'webhook', label: 'Webhook', icon: <Webhook className="h-4 w-4" />, description: 'HTTP webhook trigger - accepts POST/GET body', defaultConfig: { method: 'POST', path: '/webhook' } },
    { id: 'schedule', label: 'Schedule', icon: <Clock className="h-4 w-4" />, description: 'Time-based trigger (cron or interval)', defaultConfig: { interval: '5m', cron: '' } },
    { id: 'alert', label: 'Alert', icon: <Bell className="h-4 w-4" />, description: 'Triggered by alert creation', defaultConfig: { severity: 'high', source: '' } },
    { id: 'manual', label: 'Manual', icon: <Play className="h-4 w-4" />, description: 'Manual execution', defaultConfig: {} },
  ],
  action: [
    // ===== Threat Intel =====
    { id: 'virustotal', label: 'VirusTotal Lookup', icon: <Shield className="h-4 w-4" />, description: 'Real VirusTotal v3 API: IP/hash/domain/url reputation', defaultConfig: { ioc_type: 'ip', ioc_value: '' } },
    { id: 'abuseipdb', label: 'AbuseIPDB Check', icon: <Shield className="h-4 w-4" />, description: 'Real AbuseIPDB v2 API: IP abuse confidence score', defaultConfig: { ip: '' } },
    { id: 'ipinfo', label: 'IPInfo Geolocate', icon: <Globe className="h-4 w-4" />, description: 'Real IPInfo API: IP geolocation & ASN (FREE - no key needed)', defaultConfig: { ip: '' } },
    { id: 'otx', label: 'AlienVault OTX', icon: <Radar className="h-4 w-4" />, description: 'Real OTX API: lookup IOC across threat pulses', defaultConfig: { ioc_type: 'ip', ioc_value: '', action: 'lookup_indicator' } },
    { id: 'misp', label: 'MISP', icon: <Database className="h-4 w-4" />, description: 'Real MISP API: search/add IOC attributes', defaultConfig: { action: 'search_attributes', value: '', type: 'ip-src' } },
    { id: 'opencti', label: 'OpenCTI', icon: <Database className="h-4 w-4" />, description: 'Real OpenCTI GraphQL: create indicators + entities', defaultConfig: { action: 'create_indicator', pattern: '', name: '', pattern_type: 'stix' } },
    { id: 'greynoise', label: 'GreyNoise', icon: <Radar className="h-4 w-4" />, description: 'Internet noise intel: community IP, RIOT, context', defaultConfig: { action: 'lookup_ip', ip: '{{trigger.ip}}' } },
    { id: 'shodan', label: 'Shodan', icon: <Globe className="h-4 w-4" />, description: 'Shodan host lookup and internet search', defaultConfig: { action: 'host_lookup', ip: '{{trigger.ip}}', query: '' } },
    // ===== SIEM =====
    { id: 'sentinel', label: 'Microsoft Sentinel', icon: <Shield className="h-4 w-4" />, description: 'Azure Sentinel: incidents API + Log Analytics KQL', defaultConfig: { action: 'list_incidents', top: 50, filter: '', incident_id: '', status: 'Active', query: 'SecurityIncident | take 5', timespan: 'PT1H' } },
    { id: 'splunk', label: 'Splunk Search', icon: <Radar className="h-4 w-4" />, description: 'Real Splunk REST: run SPL searches, list saved searches', defaultConfig: { action: 'search', search: 'search * | head 10', earliest: '-1h', latest: 'now' } },
    { id: 'elastic', label: 'Elasticsearch', icon: <Database className="h-4 w-4" />, description: 'Real ES _search API: query indices with JSON or query string', defaultConfig: { action: 'search', index: '*', query: '*' } },
    { id: 'wazuh', label: 'Wazuh', icon: <Radar className="h-4 w-4" />, description: 'Real Wazuh v4 API: list agents, alerts, syscheck', defaultConfig: { action: 'list_agents', agent_id: '' } },
    { id: 'arkime', label: 'Arkime', icon: <Globe className="h-4 w-4" />, description: 'Open-source Arkime (Moloch): session search & stats', defaultConfig: { action: 'search_sessions', expression: 'ip.src=={{trigger.ip}}' } },
    // ===== Ticketing / ITSM =====
    { id: 'jira', label: 'Jira Issue', icon: <Ticket className="h-4 w-4" />, description: 'Real Jira Cloud REST: create issues, comments, JQL search', defaultConfig: { action: 'create_issue', project_key: '', summary: '', description: '', issue_type: 'Task', priority: 'Medium' } },
    { id: 'servicenow', label: 'ServiceNow', icon: <Ticket className="h-4 w-4" />, description: 'Real ServiceNow Table API: create/query incidents', defaultConfig: { action: 'create_incident', short_description: '', urgency: '3', impact: '3' } },
    { id: 'pagerduty', label: 'PagerDuty', icon: <Bell className="h-4 w-4" />, description: 'Real PagerDuty Events API v2: trigger/ack/resolve incidents', defaultConfig: { action: 'trigger', summary: '', severity: 'warning', source: 'soar', routing_key: '' } },
    { id: 'thehive', label: 'TheHive Case', icon: <Shield className="h-4 w-4" />, description: 'Real TheHive v5 API: create cases + observables', defaultConfig: { action: 'create_case', title: '', description: '', severity: 2 } },
    { id: 'defectdojo', label: 'DefectDojo', icon: <Bug className="h-4 w-4" />, description: 'Real DefectDojo v2 API: list/create findings + engagements', defaultConfig: { action: 'list_findings', title: '', description: '', severity: 'Medium', product_id: 1, engagement_id: null } },
    // ===== Cloud / Identity =====
    { id: 'msgraph', label: 'Microsoft Graph', icon: <Users className="h-4 w-4" />, description: 'Real MS Graph: users, alerts, sign-ins, send mail', defaultConfig: { action: 'list_users', upn: '', from: '', to: '', subject: '', body: '' } },
    { id: 'entra_id', label: 'Microsoft Entra ID', icon: <Users className="h-4 w-4" />, description: 'Entra ID: users, groups, disable/enable, sign-ins', defaultConfig: { action: 'list_users', upn: '{{trigger.user}}', top: 25 } },
    { id: 'aws_securityhub', label: 'AWS Security Hub', icon: <Cloud className="h-4 w-4" />, description: 'AWS Security Hub findings and standards', defaultConfig: { action: 'list_findings', max_results: 50, severity: '', workflow_status: '' } },
    { id: 'gcp_scc', label: 'GCP Security Command Center', icon: <Cloud className="h-4 w-4" />, description: 'GCP SCC findings at org/project scope', defaultConfig: { action: 'list_findings', page_size: 50, filter: '' } },
    { id: 'digitalocean', label: 'DigitalOcean', icon: <Cloud className="h-4 w-4" />, description: 'Real DO API v2: list droplets, add FW rules, power off', defaultConfig: { action: 'list_droplets', firewall_id: '', ip: '', port: '0:65535', protocol: 'tcp', droplet_id: '' } },
    // ===== Network / Firewall =====
    { id: 'fortigate', label: 'FortiGate Block', icon: <Shield className="h-4 w-4" />, description: 'Real FortiOS REST: block/unblock IPs via address groups', defaultConfig: { action: 'block_ip', ip: '', address_group: 'SOAR-BlockList' } },
    { id: 'opnsense', label: 'OPNsense Block', icon: <Shield className="h-4 w-4" />, description: 'Real OPNsense API: block IPs via firewall aliases', defaultConfig: { action: 'block_ip', ip: '', alias: 'SOAR_BlockList' } },
    { id: 'pfsense', label: 'pfSense', icon: <Shield className="h-4 w-4" />, description: 'Open-source pfSense REST API: aliases, system status, block IP', defaultConfig: { action: 'system_status' } },
    { id: 'block', label: 'Block IP (auto)', icon: <Ban className="h-4 w-4" />, description: 'Generic block — uses whichever firewall (FortiGate / OPNsense) you have connected', defaultConfig: { type: 'ip', target: '' } },
    // ===== Sandbox / Malware =====
    { id: 'cuckoo', label: 'Cuckoo Sandbox', icon: <Bug className="h-4 w-4" />, description: 'Open-source Cuckoo: submit URL, list tasks, fetch JSON report', defaultConfig: { action: 'submit_url', url: '{{trigger.url}}' } },
    { id: 'clamav', label: 'ClamAV', icon: <Shield className="h-4 w-4" />, description: 'Open-source ClamAV via HTTP gateway: scan hash or file URL', defaultConfig: { action: 'scan_hash', hash: '{{trigger.hash}}' } },
    // ===== EDR / IR =====
    { id: 'velociraptor', label: 'Velociraptor Hunt', icon: <Monitor className="h-4 w-4" />, description: 'Real Velociraptor VQL: create hunts, list clients', defaultConfig: { action: 'list_hunts', artifact: 'Windows.System.ProcessVads', description: '' } },
    { id: 'crowdstrike', label: 'CrowdStrike Falcon', icon: <Shield className="h-4 w-4" />, description: 'Falcon API: hosts, detections, contain/lift', defaultConfig: { action: 'list_hosts', device_id: '', filter: '' } },
    { id: 'isolate', label: 'Isolate Host', icon: <Lock className="h-4 w-4" />, description: 'Network isolate endpoint (queued if no EDR connected)', defaultConfig: { hostname: '' } },
    // ===== Comms =====
    { id: 'slack', label: 'Slack Message', icon: <MessageSquare className="h-4 w-4" />, description: 'Real Slack incoming webhook post', defaultConfig: { channel: '#soc-alerts', message: '' } },
    { id: 'telegram', label: 'Telegram Message', icon: <Send className="h-4 w-4" />, description: 'Send alert via Telegram Bot API', defaultConfig: { message: 'SOAR: {{trigger.title}}', parse_mode: '' } },
    { id: 'teams', label: 'Microsoft Teams', icon: <MessageSquare className="h-4 w-4" />, description: 'Teams incoming webhook MessageCard', defaultConfig: { title: 'SOAR Alert', message: '{{trigger.title}}', theme_color: '0078D4' } },
    { id: 'email', label: 'Send Email', icon: <Mail className="h-4 w-4" />, description: 'Real SMTP email via configured integration', defaultConfig: { to: '{{trigger.to}}', subject: 'SOAR: {{trigger.title}}', body: '{{trigger.message}}', format: 'text' } },
    // ===== Case management =====
    { id: 'create_case', label: 'Create Case', icon: <FileText className="h-4 w-4" />, description: 'Create real incident case in DB', defaultConfig: { title: '', description: '', severity: 'medium', tags: '' } },
    // ===== Generic =====
    { id: 'http', label: 'HTTP Request', icon: <Globe className="h-4 w-4" />, description: 'Real HTTP request to any URL (supports {{templates}})', defaultConfig: { method: 'GET', url: '', headers: {}, body: '' } },
    { id: 'custom_app', label: 'Custom App', icon: <Globe className="h-4 w-4" />, description: 'Call your custom application REST API (SSRF-safe HTTP)', defaultConfig: { method: 'POST', url: '', headers: '{}', body: '{}' } },
    { id: 'webhook', label: 'Webhook Out', icon: <Webhook className="h-4 w-4" />, description: 'Send HTTP webhook to any URL with auth header', defaultConfig: { method: 'POST', url: '', body: '', auth_header: '' } },
    { id: 'soar_utils', label: 'SOAR Utils', icon: <Code className="h-4 w-4" />, description: 'Internal utilities: delay, set_var, parse_json, condition_eval', defaultConfig: { action: 'set_var', name: '', value: '' } },
  ],
  condition: [
    { id: 'if', label: 'If Condition', icon: <GitBranch className="h-4 w-4" />, description: 'Branch on field comparison', defaultConfig: { field: '', operator: '==', value: '' } },
    { id: 'switch', label: 'Switch', icon: <Filter className="h-4 w-4" />, description: 'Multi-branch switch', defaultConfig: { field: '', cases: {} } },
    { id: 'severity_check', label: 'Severity Check', icon: <AlertTriangle className="h-4 w-4" />, description: 'Check alert severity threshold', defaultConfig: { threshold: 'high' } },
  ],
  output: [
    { id: 'log', label: 'Log Output', icon: <Terminal className="h-4 w-4" />, description: 'Log message to execution', defaultConfig: { message: '', level: 'info' } },
    { id: 'webhook_response', label: 'Webhook Response', icon: <Webhook className="h-4 w-4" />, description: 'Return HTTP response to caller', defaultConfig: { status: 200, body: '{}' } },
    { id: 'alert_out', label: 'Create Alert', icon: <Bell className="h-4 w-4" />, description: 'Generate new alert in DB', defaultConfig: { title: '', severity: 'medium' } },
  ],
};

// Category filter lists (used by palette categories)
export const nodeCategories = {
  threat_intel: ['virustotal', 'abuseipdb', 'ipinfo', 'otx', 'misp', 'opencti', 'greynoise', 'shodan'],
  siem: ['sentinel', 'splunk', 'elastic', 'wazuh', 'arkime'],
  ticketing: ['jira', 'servicenow', 'pagerduty', 'thehive', 'defectdojo'],
  cloud_iam: ['msgraph', 'entra_id', 'aws_securityhub', 'gcp_scc', 'digitalocean'],
  network: ['fortigate', 'opnsense', 'pfsense', 'block'],
  sandbox: ['cuckoo', 'clamav'],
  edr: ['velociraptor', 'crowdstrike', 'isolate'],
  comms: ['slack', 'telegram', 'teams', 'email'],
  case_mgmt: ['create_case'],
  generic: ['http', 'custom_app', 'webhook', 'soar_utils'],
};

interface ExecutionLog {
  time: string;
  nodeId?: string;
  nodeLabel?: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
  data?: unknown;
}

interface WorkflowBuilderProps {
  workflow: WorkflowData;
  onChange: (wf: WorkflowData) => void;
  onSave: (opts?: SaveWorkflowOptions) => Promise<SaveWorkflowResult | void>;
  onBack: () => void;
  onExecute: () => void;
  /** Open Logs tab (e.g. after redirect from workflows list for email runs) */
  focusRunPanel?: boolean;
}

export interface SaveWorkflowOptions {
  stayOnPage?: boolean;
  activate?: boolean;
}

export interface SaveWorkflowResult {
  ok: boolean;
  workflowId?: string;
}

export default function WorkflowBuilder({ workflow, onChange, onSave, onBack, onExecute, focusRunPanel }: WorkflowBuilderProps) {
  const { toast } = useToast();
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [draggingConnector, setDraggingConnector] = useState<{ sourceId: string; startX: number; startY: number } | null>(null);
  const [tempEdge, setTempEdge] = useState<{ x: number; y: number } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [paletteTab, setPaletteTab] = useState<'nodes' | 'properties' | 'logs'>('nodes');
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);
  const [executionEnrichment, setExecutionEnrichment] = useState<EnrichmentSnapshot | null>(null);
  const [executionDemoIp, setExecutionDemoIp] = useState<string | null>(null);
  const [executionDurationMs, setExecutionDurationMs] = useState<number | null>(null);
  const [executionNodeOutputs, setExecutionNodeOutputs] = useState<NodeOutputSummary[]>([]);
  const [executionPartialSuccess, setExecutionPartialSuccess] = useState(false);
  const [lastExecutionId, setLastExecutionId] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executedNodes, setExecutedNodes] = useState<Set<string>>(new Set());

  const canvasRef = useRef<HTMLDivElement>(null);

  const NODE_WIDTH = 216;
  const NODE_HEIGHT = 96;

  // Trigger payload (JSON) the user can supply for a manual run — kept here
  // alongside the other state so it is initialized before any effect/handler
  // that reads it. (Previously declared further down, which was confusing.)
  const [triggerPayloadInput, setTriggerPayloadInput] = useState<string>('');
  const [emailRunTo, setEmailRunTo] = useState('');
  const [emailRunTitle, setEmailRunTitle] = useState('');
  const [emailRunMessage, setEmailRunMessage] = useState('Test notification from LumiSec SOAR');
  const [smtpDefaultTo, setSmtpDefaultTo] = useState('');
  const [smtpConnected, setSmtpConnected] = useState(false);

  const hasEmailWorkflow = workflowHasEmailNode(workflow.nodes);

  useEffect(() => {
    if (focusRunPanel) setPaletteTab('logs');
  }, [focusRunPanel, workflow.id]);

  // Load SMTP integration defaults and pre-fill run panel for email workflows
  useEffect(() => {
    if (!hasEmailWorkflow) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await soarFetch<Record<string, unknown>[]>('/api/integrations');
        const list = asArray<Record<string, unknown>>(res.data);
        const emailInt = list.find(
          (i) =>
            String(i.type || '').toLowerCase() === 'email' ||
            String(i.name || '').toLowerCase().includes('smtp'),
        );
        if (cancelled || !emailInt) return;

        let defTo = '';
        const publicCfg = emailInt.public_config as Record<string, string> | undefined;
        if (publicCfg) {
          defTo = String(publicCfg.default_to || publicCfg.test_to || '').trim();
        }
        if (!defTo && emailInt.id) {
          const detail = await soarFetch<{ config?: Record<string, unknown>; status?: string }>(
            `/api/integrations/${emailInt.id}`,
          );
          if (detail.ok && detail.data) {
            const cfg = detail.data.config || {};
            defTo = String(cfg.default_to || cfg.test_to || '').trim();
            setSmtpConnected(detail.data.status === 'connected');
          }
        } else {
          setSmtpConnected(emailInt.status === 'connected');
        }
        setSmtpDefaultTo(defTo);
        if (!triggerPayloadInput.trim()) {
          setEmailRunTitle(workflow.name);
          if (defTo) {
            setEmailRunTo(defTo);
            setTriggerPayloadInput(JSON.stringify({
              to: defTo,
              title: workflow.name,
              message: 'Test notification from LumiSec SOAR',
            }, null, 2));
          }
        }
      } catch {
        /* non-fatal */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-prefill when workflow identity changes
  }, [workflow.id, hasEmailWorkflow]);

  // ========== NODE OPERATIONS ==========
  const addNode = (type: NodeType, subtype?: string) => {
    const sub = subtype ? nodeSubtypes[type].find(s => s.id === subtype) : null;
    const newNode: WFNode = {
      id: `n${Date.now()}`,
      type,
      subtype,
      position: {
        x: 100 - pan.x / zoom + Math.random() * 100,
        y: 100 - pan.y / zoom + Math.random() * 100,
      },
      data: {
        label: sub?.label || nodeTypeConfig[type].label,
        description: sub?.description,
        config: { ...(sub?.defaultConfig || {}) },
      },
    };
    onChange({ ...workflow, nodes: [...workflow.nodes, newNode] });
    setSelectedNode(newNode.id);
    setPaletteTab('properties');
  };

  const updateNode = (nodeId: string, updates: Partial<WFNode>) => {
    onChange({
      ...workflow,
      nodes: workflow.nodes.map(n => n.id === nodeId ? { ...n, ...updates, data: { ...n.data, ...updates.data } } : n),
    });
  };

  const updateNodeConfig = (nodeId: string, key: string, value: unknown) => {
    onChange({
      ...workflow,
      nodes: workflow.nodes.map(n => n.id === nodeId ? {
        ...n,
        data: { ...n.data, config: { ...n.data.config, [key]: value } }
      } : n),
    });
  };

  const deleteNode = (nodeId: string) => {
    onChange({
      ...workflow,
      nodes: workflow.nodes.filter(n => n.id !== nodeId),
      edges: workflow.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
    });
    setSelectedNode(null);
  };

  const duplicateNode = (nodeId: string) => {
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const newNode: WFNode = {
      ...node,
      id: `n${Date.now()}`,
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data, config: { ...node.data.config } },
    };
    onChange({ ...workflow, nodes: [...workflow.nodes, newNode] });
  };

  // ========== EDGE OPERATIONS ==========
  const addEdge = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    // Prevent duplicate edges
    const exists = workflow.edges.some(e => e.source === sourceId && e.target === targetId);
    if (exists) return;
    const newEdge: WFEdge = {
      id: `e${Date.now()}`,
      source: sourceId,
      target: targetId,
    };
    onChange({ ...workflow, edges: [...workflow.edges, newEdge] });
  };

  const deleteEdge = (edgeId: string) => {
    onChange({ ...workflow, edges: workflow.edges.filter(e => e.id !== edgeId) });
    setSelectedEdge(null);
  };

  const updateEdgeLabel = (edgeId: string, label: string) => {
    onChange({
      ...workflow,
      edges: workflow.edges.map(e => e.id === edgeId ? { ...e, label } : e),
    });
  };

  // ========== CONNECTOR DRAG ==========
  const startConnectorDrag = (sourceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingConnector({ sourceId, startX: e.clientX, startY: e.clientY });
    setTempEdge({ x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!draggingConnector) return;
    const onMove = (e: MouseEvent) => {
      if (canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        setTempEdge({
          x: (e.clientX - rect.left - pan.x) / zoom,
          y: (e.clientY - rect.top - pan.y) / zoom,
        });
      }
    };
    const onUp = (e: MouseEvent) => {
      // Find if we dropped on a node's input port
      const target = (e.target as HTMLElement).closest('[data-node-id]');
      if (target) {
        const targetId = target.getAttribute('data-node-id');
        if (targetId && targetId !== draggingConnector.sourceId) {
          addEdge(draggingConnector.sourceId, targetId);
        }
      }
      setDraggingConnector(null);
      setTempEdge(null);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [draggingConnector, zoom, pan]);

  // ========== NODE DRAG ==========
  const handleNodeDrag = (nodeId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't drag if clicking on a connector port
    if ((e.target as HTMLElement).closest('[data-port]')) return;
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const origX = node.position.x;
    const origY = node.position.y;

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      updateNode(nodeId, { position: { x: Math.max(0, origX + dx), y: Math.max(0, origY + dy) } });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ========== CANVAS PAN ==========
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    // Only pan when clicking on empty canvas
    if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('workflow-canvas-inner')) {
      setSelectedNode(null);
      setSelectedEdge(null);
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  useEffect(() => {
    if (!isPanning) return;
    const onMove = (e: MouseEvent) => {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    };
    const onUp = () => setIsPanning(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isPanning, panStart]);

  // ========== EXECUTION ENGINE (REAL - calls backend /api/workflow-executions) ==========
  const runExecution = async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    setExecutedNodes(new Set());
    setExecutionLogs([]);
    setExecutionEnrichment(null);
    setExecutionDemoIp(null);
    setExecutionDurationMs(null);
    setExecutionNodeOutputs([]);
    setExecutionPartialSuccess(false);
    setLastExecutionId(null);
    setPaletteTab('logs');

    const addLog = (log: ExecutionLog) => {
      setExecutionLogs(prev => [...prev, log]);
    };

    addLog({ time: new Date().toISOString(), message: 'Submitting workflow to execution engine...', level: 'info' });

    if (workflow.nodes.length === 0) {
      addLog({ time: new Date().toISOString(), message: 'Cannot run: workflow has no nodes. Add nodes from the palette first.', level: 'error' });
      setIsExecuting(false);
      return;
    }

    const runWarnings = getWorkflowWarnings(workflow.nodes, workflow.edges);
    for (const warning of runWarnings) {
      addLog({ time: new Date().toISOString(), message: warning, level: 'warning' });
    }

    let workflowId = workflow.id;

    if (workflowId.startsWith('new-')) {
      addLog({ time: new Date().toISOString(), message: 'Saving workflow before test run...', level: 'info' });
      const saved = await onSave({ stayOnPage: true });
      if (!saved || (typeof saved === 'object' && !saved.ok)) {
        addLog({ time: new Date().toISOString(), message: 'Save failed — fix errors and try again', level: 'error' });
        setIsExecuting(false);
        return;
      }
      if (typeof saved === 'object' && saved.workflowId) {
        workflowId = saved.workflowId;
      }
    }

    let triggerPayload: Record<string, unknown> = {};
    try {
      triggerPayload = triggerPayloadInput ? JSON.parse(triggerPayloadInput) : {};
    } catch {
      addLog({ time: new Date().toISOString(), message: 'Invalid trigger JSON payload — fix the JSON in the Run panel.', level: 'error' });
      setIsExecuting(false);
      return;
    }

    const triggerNode = workflow.nodes.find(n => n.type === 'trigger');

    const hasEmailNode = hasEmailWorkflow;

    if (Object.keys(triggerPayload).length === 0 && triggerNode) {
      const subtype = triggerNode.subtype;
      if (subtype === 'alert') {
        triggerPayload.severity = triggerNode.data.config.severity || 'high';
        triggerPayload.source = triggerNode.data.config.source || 'manual';
        triggerPayload.title = `Manual trigger: ${workflow.name}`;
      } else if (subtype === 'webhook') {
        triggerPayload.method = triggerNode.data.config.method || 'POST';
        triggerPayload.path = triggerNode.data.config.path || '/webhook';
      } else if (hasEmailNode) {
        triggerPayload.title = emailRunTitle.trim() || workflow.name;
        triggerPayload.message = emailRunMessage.trim() || 'Test notification from LumiSec SOAR';
        if (emailRunTo.trim()) triggerPayload.to = emailRunTo.trim();
      }
    }

    if (hasEmailNode) {
      if (emailRunTo.trim()) triggerPayload.to = emailRunTo.trim();
      if (emailRunTitle.trim()) triggerPayload.title = emailRunTitle.trim();
      if (emailRunMessage.trim()) triggerPayload.message = emailRunMessage.trim();
      const resolvedTo = String(
        triggerPayload.to || triggerPayload.email || smtpDefaultTo || '',
      ).trim();
      if (!resolvedTo) {
        addLog({
          time: new Date().toISOString(),
          message: 'Cannot run: set recipient in "To" below, or configure default_to on Email (SMTP) integration (Integrations → Configure → Save & Test).',
          level: 'error',
        });
        setPaletteTab('logs');
        setIsExecuting(false);
        return;
      }
      if (!smtpConnected) {
        addLog({
          time: new Date().toISOString(),
          message: 'Email integration is not connected. Go to Integrations → Email (SMTP) → Save & Test with real SMTP credentials first.',
          level: 'error',
        });
        setPaletteTab('logs');
        setIsExecuting(false);
        return;
      }
      triggerPayload.to = resolvedTo;
      triggerPayload.email = resolvedTo;
      setTriggerPayloadInput(JSON.stringify(triggerPayload, null, 2));
    }

    let executionId: string | null = null;
    try {
      const res = await soarFetch<{ id?: string }>('/api/workflow-executions', {
        method: 'POST',
        body: JSON.stringify({ workflowId, trigger: triggerPayload, testRun: true }),
      });
      if (!res.ok) {
        addLog({ time: new Date().toISOString(), message: `Failed to start execution: ${res.error || 'Unknown error'}`, level: 'error' });
        setIsExecuting(false);
        return;
      }
      const data = res.data ?? {};
      executionId = data.id ?? null;
      setLastExecutionId(executionId);
      setExecutionDemoIp(String(triggerPayload.ip || triggerPayload.source_ip || ''));
      addLog({ time: new Date().toISOString(), message: `Execution started (id=${executionId}). Polling for live logs...`, level: 'info' });
    } catch (e) {
      addLog({ time: new Date().toISOString(), message: `Network error: ${e instanceof Error ? e.message : String(e)}`, level: 'error' });
      setIsExecuting(false);
      return;
    }

    // Poll for live logs
    const seenLogKeys = new Set<string>();
    const executedSet = new Set<string>();
    let lastLogCount = 0;
    let pollCount = 0;
    const maxPolls = 120; // 120 * 1.5s = 3 min max

    while (pollCount < maxPolls) {
      pollCount++;
      await new Promise(r => setTimeout(r, 1500));

      try {
        const r = await soarFetch<{
          logs?: ExecutionLog[];
          status?: string;
          enrichment?: EnrichmentSnapshot;
          displayIp?: string | null;
          partialSuccess?: boolean;
          nodeOutputs?: NodeOutputSummary[];
          result?: {
            executed_nodes?: number;
            failed_nodes?: number;
            duration_ms?: number;
            outputs?: Record<string, unknown>;
          };
        }>(`/api/workflow-executions/${executionId}`);
        if (!r.ok || !r.data) continue;
        const exec = r.data;

        // Add new logs
        const logs: ExecutionLog[] = exec.logs || [];
        for (const log of logs) {
          const key = `${log.time}|${log.message}|${log.nodeId || ''}`;
          if (!seenLogKeys.has(key)) {
            seenLogKeys.add(key);
            // Only add logs we haven't shown yet (after the initial "submitting" message)
            if (seenLogKeys.size > 1 || log.message !== logs[0]?.message) {
              addLog(log);
            }
            // Track executed nodes for visual highlighting
            if (log.nodeId && (log.level === 'success' || log.level === 'warning')) {
              executedSet.add(log.nodeId);
              setExecutedNodes(new Set(executedSet));
            }
          }
        }

        // Check for completion
        if (exec.status === 'success' || exec.status === 'failed' || exec.status === 'awaiting_approval' || exec.status === 'cancelled') {
          if (logs.length > lastLogCount) {
            lastLogCount = logs.length;
          }
          const outputs = exec.result?.outputs;
          const enrichment =
            exec.enrichment ??
            (outputs && typeof outputs === 'object'
              ? extractEnrichmentFromOutputs(outputs)
              : null);
          if (enrichment) {
            setExecutionEnrichment(enrichment);
          }
          if (exec.displayIp) {
            setExecutionDemoIp(exec.displayIp);
          } else if (enrichment?.virustotal?.ioc) {
            setExecutionDemoIp(enrichment.virustotal.ioc);
          }
          if (exec.nodeOutputs?.length) {
            setExecutionNodeOutputs(exec.nodeOutputs);
          } else if (outputs && typeof outputs === 'object') {
            setExecutionNodeOutputs(
              Object.entries(outputs).map(([nodeId, raw]) => ({
                nodeId,
                ok: Boolean((raw as Record<string, unknown>)?.ok),
                output: raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined,
              })),
            );
          }
          setExecutionPartialSuccess(Boolean(exec.partialSuccess));
          if (exec.result?.duration_ms != null) {
            setExecutionDurationMs(exec.result.duration_ms);
          }
          const partial = Boolean(exec.partialSuccess);
          const awaiting = exec.status === 'awaiting_approval';
          addLog({
            time: new Date().toISOString(),
            message: awaiting
              ? 'Execution awaiting human approval for a destructive action — approve via Approvals panel'
              : partial
                ? `Partial success: enrichment APIs returned data, but ${exec.result?.failed_nodes || 0} node(s) failed — see node outputs below`
                : `Execution ${exec.status.toUpperCase()}: ${exec.result?.executed_nodes || 0} nodes executed, ${exec.result?.failed_nodes || 0} failed, duration=${exec.result?.duration_ms || 0}ms`,
            level: exec.status === 'success' ? 'success' : awaiting || partial ? 'warning' : 'error',
          });
          break;
        }
      } catch (e) {
        // Log transient polling errors so they don’t disappear silently — but keep polling
        console.warn('Workflow execution poll error:', e);
      }
    }

    setIsExecuting(false);
    if (onExecute) onExecute(); // notify parent to refresh dashboards
  };

  // (triggerPayloadInput is declared at the top with the other state — see above.)

  // ========== KEYBOARD SHORTCUTS ==========
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // Delete selected node/edge
      if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedNode || selectedEdge)) {
        e.preventDefault();
        if (selectedNode) deleteNode(selectedNode);
        else if (selectedEdge) deleteEdge(selectedEdge);
      }
      // Ctrl/Cmd+S = save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        onSave({ stayOnPage: true });
      }
      // Ctrl/Cmd+Enter = run test
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!isExecuting) runExecution();
      }
      // Escape = deselect
      if (e.key === 'Escape') {
        setSelectedNode(null);
        setSelectedEdge(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNode, selectedEdge, isExecuting, onSave]);

  // ========== EDGE PATH CALCULATION ==========
  const getEdgePath = (source: WFNode, target: WFNode) => {
    const sx = source.position.x + NODE_WIDTH;
    const sy = source.position.y + NODE_HEIGHT / 2;
    const tx = target.position.x;
    const ty = target.position.y + NODE_HEIGHT / 2;
    const dx = Math.abs(tx - sx) / 2;
    return {
      path: `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`,
      midX: (sx + tx) / 2,
      midY: (sy + ty) / 2,
    };
  };

  const selectedNodeData = selectedNode ? workflow.nodes.find(n => n.id === selectedNode) : null;
  const selectedEdgeData = selectedEdge ? workflow.edges.find(e => e.id === selectedEdge) : null;
  const workflowWarnings = getWorkflowWarnings(workflow.nodes, workflow.edges);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0 px-4 sm:px-6 pt-4 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          <Button variant="ghost" size="sm" onClick={onBack} data-ui-button>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
          <Input
            value={workflow.name}
            onChange={e => onChange({ ...workflow, name: e.target.value })}
            className="font-semibold border-none shadow-none p-0 h-auto focus-visible:ring-0 w-32 sm:w-48 md:w-64 bg-transparent"
            aria-label="Workflow name"
          />
          <Badge
            variant="outline"
            className={`shrink-0 ${workflow.status === 'active' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${workflow.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {workflow.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0 overflow-x-auto max-w-full pb-0.5">
          {/* Zoom Controls — accessible with tooltips and ARIA labels */}
          <TooltipProvider delayDuration={300}>
            <div className="zoom-control" role="group" aria-label="Zoom controls">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} aria-label="Zoom out">
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Zoom out</TooltipContent>
              </Tooltip>
              <span className="zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setZoom(z => Math.min(2, z + 0.1))} aria-label="Zoom in">
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Zoom in</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} aria-label="Reset zoom and pan">
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Reset view (100%)</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
          <Separator orientation="vertical" className="h-6" />
          {/* Save - secondary action */}
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => onSave({ stayOnPage: true })} className="gap-1.5" data-ui-button>
                  <Save className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Save</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Save workflow (Ctrl+S)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Run Test - primary dev action */}
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={runExecution}
                  disabled={isExecuting}
                  className="bg-orange-500 hover:bg-orange-600 text-white gap-1.5 shadow-sm" data-ui-button
                >
                  {isExecuting ? <Activity className="h-3.5 w-3.5 animate-pulse" /> : <Play className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{isExecuting ? 'Running...' : 'Run Test'}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Execute workflow once for testing (Ctrl+Enter)</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Activate - production publish. Saves the workflow first, then flips
              its status to 'active' so live triggers can fire. */}
          <TooltipProvider delayDuration={400}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={async () => {
                    // Defer to the parent's save handler, which already knows
                    // whether this is a create or update. Activate is only
                    // meaningful after a save succeeds.
                    const r = await onSave({ stayOnPage: true, activate: true });
                    if (r?.ok) {
                      toast({ title: 'Workflow activated', description: `${workflow.name} is now active for live triggers.` });
                    } else {
                      toast({ title: 'Activate failed', description: 'Save the workflow first and fix any errors.', variant: 'destructive' });
                    }
                  }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1.5 shadow-sm" data-ui-button
                >
                  <Zap className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Save &amp; Activate</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Save workflow and make it available to live triggers</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {workflowWarnings.length > 0 && (
        <div className="mx-4 sm:mx-6 mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 flex items-start gap-2 shrink-0">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0 text-xs text-amber-900 dark:text-amber-100 space-y-0.5">
            {workflowWarnings.map((warning, i) => (
              <p key={i} className="leading-snug">{warning}</p>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 flex-1 min-h-0 px-4 sm:px-6 pb-4">
        {/* Left Panel - Nodes & Properties & Logs */}
        <div className="w-full lg:w-72 xl:w-80 shrink-0 flex flex-col min-h-0 max-h-[42vh] lg:max-h-none">
          <Tabs value={paletteTab} onValueChange={(v) => setPaletteTab(v as 'nodes' | 'properties' | 'logs')} className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-3 shrink-0 h-9">
              <TabsTrigger value="nodes" className="text-[10px] sm:text-xs px-1 truncate">Nodes</TabsTrigger>
              <TabsTrigger value="properties" className="text-[10px] sm:text-xs px-1 truncate">Props</TabsTrigger>
              <TabsTrigger value="logs" className="text-[10px] sm:text-xs px-1 truncate">
                Logs
                {executionLogs.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{executionLogs.length}</Badge>}
              </TabsTrigger>
            </TabsList>

            {/* Nodes Palette */}
            <TabsContent value="nodes" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <Card className="h-full overflow-hidden min-w-0">
                <div className="p-3 max-h-full overflow-y-auto overflow-x-hidden">
                  {/* Triggers category */}
                  <PaletteCategory
                    title="Triggers"
                    color="bg-emerald-500/10 text-emerald-500"
                    icon={<Zap className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.trigger.map(s => ({ ...s, type: 'trigger' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="trigger"
                    itemColor="bg-emerald-500/10 text-emerald-500"
                  />
                  {/* Threat Intel */}
                  <PaletteCategory
                    title="Threat Intel"
                    color="bg-red-500/10 text-red-500"
                    icon={<Bug className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.threat_intel.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-red-500/10 text-red-500"
                  />
                  {/* SIEM */}
                  <PaletteCategory
                    title="SIEM"
                    color="bg-blue-500/10 text-blue-500"
                    icon={<Radar className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.siem.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-blue-500/10 text-blue-500"
                  />
                  {/* Ticketing / ITSM */}
                  <PaletteCategory
                    title="Ticketing / ITSM"
                    color="bg-indigo-500/10 text-indigo-500"
                    icon={<Ticket className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.ticketing.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-indigo-500/10 text-indigo-500"
                  />
                  {/* Cloud / IAM */}
                  <PaletteCategory
                    title="Cloud / IAM"
                    color="bg-cyan-500/10 text-cyan-500"
                    icon={<Cloud className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.cloud_iam.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-cyan-500/10 text-cyan-500"
                  />
                  {/* Network / Firewall */}
                  <PaletteCategory
                    title="Network / Firewall"
                    color="bg-orange-500/10 text-orange-500"
                    icon={<Shield className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.network.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-orange-500/10 text-orange-500"
                  />
                  {/* EDR / IR */}
                  <PaletteCategory
                    title="EDR / IR"
                    color="bg-purple-500/10 text-purple-500"
                    icon={<Monitor className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.edr.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-purple-500/10 text-purple-500"
                  />
                  {/* Sandbox / Malware */}
                  <PaletteCategory
                    title="Sandbox / Malware"
                    color="bg-gray-500/10 text-gray-600"
                    icon={<Bug className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.sandbox.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-gray-500/10 text-gray-600"
                  />
                  {/* Communication */}
                  <PaletteCategory
                    title="Communication"
                    color="bg-pink-500/10 text-pink-500"
                    icon={<Send className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.comms.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-pink-500/10 text-pink-500"
                  />
                  {/* Case Management */}
                  <PaletteCategory
                    title="Case Management"
                    color="bg-yellow-500/10 text-yellow-500"
                    icon={<FileText className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.case_mgmt.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-yellow-500/10 text-yellow-500"
                  />
                  {/* Generic / Utilities */}
                  <PaletteCategory
                    title="Generic / Utilities"
                    color="bg-gray-500/10 text-gray-500"
                    icon={<Code className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.action.filter(s => nodeCategories.generic.includes(s.id)).map(s => ({ ...s, type: 'action' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="action"
                    itemColor="bg-gray-500/10 text-gray-500"
                  />
                  {/* Logic category */}
                  <PaletteCategory
                    title="Logic"
                    color="bg-amber-500/10 text-amber-500"
                    icon={<GitBranch className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.condition.map(s => ({ ...s, type: 'condition' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="condition"
                    itemColor="bg-amber-500/10 text-amber-500"
                  />
                  {/* Output category */}
                  <PaletteCategory
                    title="Output"
                    color="bg-rose-500/10 text-rose-500"
                    icon={<FileText className="h-3.5 w-3.5" />}
                    items={nodeSubtypes.output.map(s => ({ ...s, type: 'output' as NodeType }))}
                    onAdd={(t, st) => addNode(t, st)}
                    type="output"
                    itemColor="bg-rose-500/10 text-rose-500"
                  />
                </div>
              </Card>
            </TabsContent>

            {/* Properties Panel */}
            <TabsContent value="properties" className="flex-1 min-h-0 mt-0 overflow-hidden">
              <Card className="h-full overflow-hidden min-w-0">
                <ScrollArea className="h-full min-w-0">
                  <div className="p-4">
                    {selectedNodeData ? (
                      <div className="space-y-4">
                        <div>
                          <Label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Node Type</Label>
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <Badge className={`${nodeTypeConfig[selectedNodeData.type].bgColor} ${nodeTypeConfig[selectedNodeData.type].color} border-0 gap-1 max-w-full truncate`}>
                              {nodeTypeConfig[selectedNodeData.type].icon}
                              <span>{nodeTypeConfig[selectedNodeData.type].label}</span>
                            </Badge>
                            {selectedNodeData.subtype && (
                              <Badge variant="outline" className="text-[10px] font-mono">{selectedNodeData.subtype}</Badge>
                            )}
                          </div>
                        </div>

                        <div>
                          <Label className="text-xs font-medium">Label</Label>
                          <Input
                            value={selectedNodeData.data.label}
                            onChange={e => updateNode(selectedNodeData.id, { data: { ...selectedNodeData.data, label: e.target.value } })}
                            className="mt-1 h-8 text-xs"
                          />
                        </div>

                        <div>
                          <Label className="text-xs font-medium">Description</Label>
                          <Input
                            value={selectedNodeData.data.description || ''}
                            onChange={e => updateNode(selectedNodeData.id, { data: { ...selectedNodeData.data, description: e.target.value } })}
                            className="mt-1 h-8 text-xs"
                            placeholder="Optional description"
                          />
                        </div>

                        <Separator />

                        {/* Node-specific config */}
                        <div>
                          <Label className="text-xs font-semibold uppercase tracking-wide">Configuration</Label>
                          <div className="mt-2">
                            <NodeConfigEditor
                              node={selectedNodeData}
                              onConfigChange={(key, value) => updateNodeConfig(selectedNodeData.id, key, value)}
                            />
                          </div>
                        </div>

                        <Separator />

                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="flex-1" onClick={() => duplicateNode(selectedNodeData.id)} data-ui-button>
                            <Copy className="h-3 w-3 mr-1" /> Duplicate
                          </Button>
                          <Button variant="destructive" size="sm" className="flex-1" onClick={() => deleteNode(selectedNodeData.id)} data-ui-button>
                            <Trash2 className="h-3 w-3 mr-1" /> Delete
                          </Button>
                        </div>
                      </div>
                    ) : selectedEdgeData ? (
                      <div className="space-y-4">
                        <div>
                          <Label className="text-xs text-muted-foreground">Edge</Label>
                          <p className="text-sm font-medium mt-1">
                            {workflow.nodes.find(n => n.id === selectedEdgeData.source)?.data.label} → {workflow.nodes.find(n => n.id === selectedEdgeData.target)?.data.label}
                          </p>
                        </div>
                        <div>
                          <Label className="text-xs">Label (for conditions)</Label>
                          <Input
                            value={selectedEdgeData.label || ''}
                            onChange={e => updateEdgeLabel(selectedEdgeData.id, e.target.value)}
                            className="mt-1 h-8 text-xs"
                            placeholder="Yes / No / etc."
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">Use 'Yes' or 'No' for condition branches</p>
                        </div>
                        <Button variant="destructive" size="sm" className="w-full" onClick={() => deleteEdge(selectedEdgeData.id)}>
                          <Trash2 className="h-3 w-3 mr-1" /> Delete Edge
                        </Button>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-xs text-muted-foreground">
                        <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                          <SettingsIcon className="h-6 w-6 text-muted-foreground/50" />
                        </div>
                        <p className="font-medium text-foreground">No selection</p>
                        <p className="mt-1 text-muted-foreground">Select a node or edge to edit its properties</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </Card>
            </TabsContent>

            {/* Execution Logs */}
            <TabsContent value="logs" className="flex-1 min-h-0 mt-0 overflow-hidden flex flex-col">
              <Card className="h-full flex flex-col">
                <div className="p-2 border-b flex items-center justify-between">
                  <span className="text-xs font-medium flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
                    Execution Logs
                  </span>
                  {executionLogs.length > 0 && (
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setExecutionLogs([])} aria-label="Clear logs">
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {/* Trigger payload — email workflows get dedicated fields */}
                <div className="p-2 border-b bg-muted/30 space-y-2">
                  {hasEmailWorkflow && (
                    <div className="space-y-2 pb-2 border-b border-border/50">
                      <Label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                        Email run data (required)
                      </Label>
                      <div>
                        <Label className="text-[10px]">To</Label>
                        <Input
                          type="email"
                          value={emailRunTo}
                          onChange={e => {
                            setEmailRunTo(e.target.value);
                            const payload = {
                              to: e.target.value,
                              title: emailRunTitle || workflow.name,
                              message: emailRunMessage,
                            };
                            setTriggerPayloadInput(JSON.stringify(payload, null, 2));
                          }}
                          placeholder={smtpDefaultTo || 'you@company.com'}
                          className="mt-0.5 h-8 text-xs"
                        />
                        {smtpDefaultTo && !emailRunTo && (
                          <p className="text-[9px] text-muted-foreground mt-0.5">
                            Integration default: {smtpDefaultTo}
                          </p>
                        )}
                      </div>
                      <div>
                        <Label className="text-[10px]">Subject line (trigger.title)</Label>
                        <Input
                          value={emailRunTitle}
                          onChange={e => {
                            setEmailRunTitle(e.target.value);
                            setTriggerPayloadInput(JSON.stringify({
                              to: emailRunTo,
                              title: e.target.value,
                              message: emailRunMessage,
                            }, null, 2));
                          }}
                          className="mt-0.5 h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Body (trigger.message)</Label>
                        <Textarea
                          value={emailRunMessage}
                          onChange={e => {
                            setEmailRunMessage(e.target.value);
                            setTriggerPayloadInput(JSON.stringify({
                              to: emailRunTo,
                              title: emailRunTitle || workflow.name,
                              message: e.target.value,
                            }, null, 2));
                          }}
                          className="mt-0.5 text-[11px] min-h-[44px]"
                        />
                      </div>
                      {!smtpConnected && (
                        <p className="text-[9px] text-amber-600 dark:text-amber-400">
                          SMTP not connected — configure Integrations → Email → Save &amp; Test first.
                        </p>
                      )}
                    </div>
                  )}
                  <Label className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Trigger Payload (JSON)</Label>
                  <Textarea
                    value={triggerPayloadInput}
                    onChange={e => {
                      setTriggerPayloadInput(e.target.value);
                      try {
                        const p = JSON.parse(e.target.value || '{}') as Record<string, unknown>;
                        if (typeof p.to === 'string') setEmailRunTo(p.to);
                        if (typeof p.title === 'string') setEmailRunTitle(p.title);
                        if (typeof p.message === 'string') setEmailRunMessage(p.message);
                      } catch { /* ignore while typing */ }
                    }}
                    placeholder={hasEmailWorkflow
                      ? '{"to": "you@company.com", "title": "SOAR test", "message": "Hello"}'
                      : '{"ip": "8.8.8.8", "severity": "high"}'}
                    className="mt-1 text-[11px] font-mono min-h-[50px] max-h-[100px]"
                  />
                  <p className="text-[9px] text-muted-foreground mt-1">Use <code className="bg-muted px-1 rounded">{`{{trigger.to}}`}</code> in the email node to reference the To field</p>
                </div>
                <ScrollArea className="flex-1 min-h-0">
                  <div className="p-2 text-xs space-y-1 min-w-0">
                    {executionLogs.length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <div className="mx-auto w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-2">
                          <Terminal className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                        <p className="text-xs">No logs yet</p>
                        <p className="text-[10px] mt-1">Run the workflow to see live execution logs</p>
                      </div>
                    ) : (
                      executionLogs.map((log, i) => (
                        <motion.div
                          key={i}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={`execution-log-line flex items-start gap-2 p-1.5 rounded ${
                            log.level === 'error' ? 'bg-red-500/10 border border-red-500/20' :
                            log.level === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20' :
                            log.level === 'warning' ? 'bg-amber-500/10 border border-amber-500/20' : ''
                          }`}
                        >
                          <span className="text-muted-foreground shrink-0 tabular-nums text-[10px] font-mono whitespace-nowrap">
                            {new Date(log.time).toLocaleTimeString('en-US', { hour12: false })}
                          </span>
                          <span className={`shrink-0 mt-0.5 ${
                            log.level === 'error' ? 'text-red-500' :
                            log.level === 'success' ? 'text-emerald-500' :
                            log.level === 'warning' ? 'text-amber-500' : 'text-blue-500'
                          }`}>
                            {log.level === 'error' ? <XCircle className="h-3 w-3" /> :
                             log.level === 'success' ? <CheckCircle2 className="h-3 w-3" /> :
                             log.level === 'warning' ? <AlertTriangle className="h-3 w-3" /> :
                             <Activity className="h-3 w-3" />}
                          </span>
                          <span className="execution-log-message text-[11px] text-foreground/90 min-w-0">
                            {log.nodeLabel && <span className="text-primary font-medium">[{log.nodeLabel}] </span>}
                            {log.message}
                            {log.duration && <span className="text-muted-foreground ml-1">({log.duration}ms)</span>}
                            {log.data != null && (
                              <pre className="mt-1 p-1.5 rounded bg-muted/80 text-[9px] font-mono whitespace-pre-wrap break-words max-w-full overflow-x-auto">
                                {JSON.stringify(log.data, null, 2)}
                              </pre>
                            )}
                          </span>
                        </motion.div>
                      ))
                    )}
                  </div>
                </ScrollArea>
                {executionEnrichment && (executionEnrichment.virustotal || executionEnrichment.ipinfo || executionEnrichment.abuseipdb) && (
                  <div className="border-t p-3 shrink-0 max-h-[45%] overflow-y-auto">
                    {executionPartialSuccess && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Workflow marked failed, but live enrichment data is shown below.
                      </p>
                    )}
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                      Live enrichment results
                    </p>
                    <EnrichmentResultsCards
                      ip={executionDemoIp || executionEnrichment.virustotal?.ioc || '—'}
                      enrichment={executionEnrichment}
                      durationMs={executionDurationMs ?? undefined}
                      executionId={lastExecutionId ?? undefined}
                    />
                  </div>
                )}
                {executionNodeOutputs.length > 0 && (
                  <div className="border-t p-3 shrink-0 max-h-[35%] overflow-y-auto">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                      Node outputs (from backend)
                    </p>
                    <div className="space-y-2">
                      {executionNodeOutputs.map((node) => (
                        <div
                          key={node.nodeId}
                          className={`rounded border p-2 text-[10px] ${
                            node.skipped
                              ? 'border-amber-500/20 bg-amber-500/5'
                              : node.ok
                                ? 'border-emerald-500/20 bg-emerald-500/5'
                                : 'border-red-500/20 bg-red-500/5'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium text-foreground">
                              {node.label || node.nodeId}
                              {node.subtype ? ` · ${node.subtype}` : ''}
                            </span>
                            <Badge variant="outline" className="text-[9px] h-4">
                              {node.skipped ? 'skipped' : node.ok ? 'ok' : 'failed'}
                            </Badge>
                          </div>
                          {node.preview && (
                            <p className="text-muted-foreground mb-1">{node.preview}</p>
                          )}
                          {node.output && (
                            <pre className="p-1.5 rounded bg-muted/80 font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto">
                              {JSON.stringify(node.output, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative min-w-0 min-h-[240px] lg:min-h-0">
          <div
            ref={canvasRef}
            className="w-full h-full rounded-xl border border-border workflow-canvas overflow-hidden relative bg-muted/20"
            onMouseDown={handleCanvasMouseDown}
            style={{ cursor: isPanning ? 'grabbing' : 'default' }}
          >
            <div
              className="workflow-canvas-inner absolute"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                width: '100%',
                height: '100%',
              }}
            >
              {/* SVG Edges Layer */}
              <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible', zIndex: 1 }}>
                <defs>
                  <marker id="arrowhead" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto">
                    <polygon points="0 0, 12 5, 0 10" fill="var(--primary)" />
                  </marker>
                  <marker id="arrowhead-selected" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto">
                    <polygon points="0 0, 12 5, 0 10" fill="var(--destructive)" />
                  </marker>
                  <marker id="arrowhead-true" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto">
                    <polygon points="0 0, 12 5, 0 10" fill="oklch(0.62 0.17 162)" />
                  </marker>
                  <marker id="arrowhead-false" markerWidth="12" markerHeight="10" refX="10" refY="5" orient="auto">
                    <polygon points="0 0, 12 5, 0 10" fill="oklch(0.65 0.25 25)" />
                  </marker>
                </defs>

                {workflow.edges.map(edge => {
                  const source = workflow.nodes.find(n => n.id === edge.source);
                  const target = workflow.nodes.find(n => n.id === edge.target);
                  if (!source || !target) return null;
                  const { path, midX, midY } = getEdgePath(source, target);
                  const isSel = selectedEdge === edge.id;
                  const labelLower = (edge.label || '').toLowerCase();
                  const isTrueBranch = labelLower === 'yes' || labelLower === 'true';
                  const isFalseBranch = labelLower === 'no' || labelLower === 'false';
                  const strokeColor = isSel
                    ? 'var(--destructive)'
                    : isTrueBranch
                    ? 'oklch(0.62 0.17 162)'
                    : isFalseBranch
                    ? 'oklch(0.65 0.25 25)'
                    : 'var(--primary)';
                  const marker = isSel
                    ? 'url(#arrowhead-selected)'
                    : isTrueBranch
                    ? 'url(#arrowhead-true)'
                    : isFalseBranch
                    ? 'url(#arrowhead-false)'
                    : 'url(#arrowhead)';
                  return (
                    <g key={edge.id} style={{ pointerEvents: 'auto', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setSelectedEdge(edge.id); setSelectedNode(null); }}>
                      {/* Invisible thicker path for easier clicking */}
                      <path d={path} fill="none" stroke="transparent" strokeWidth="20" />
                      <path
                        d={path}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={isSel ? 3 : 2}
                        markerEnd={marker}
                        opacity={isSel ? 1 : 0.85}
                        style={{ transition: 'stroke 0.15s ease, stroke-width 0.15s ease' }}
                      />
                      {edge.label && (
                        <g>
                          <rect x={midX - 26} y={midY - 10} width="52" height="20" rx="4" fill="var(--background)" stroke={strokeColor} strokeWidth="1" />
                          <text x={midX} y={midY + 4} textAnchor="middle" className="text-[10px] fill-foreground font-semibold">{edge.label}</text>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* Temporary edge while dragging connector */}
                {draggingConnector && tempEdge && (() => {
                  const source = workflow.nodes.find(n => n.id === draggingConnector.sourceId);
                  if (!source) return null;
                  const sx = source.position.x + NODE_WIDTH;
                  const sy = source.position.y + NODE_HEIGHT / 2;
                  return (
                    <path
                      d={`M ${sx} ${sy} C ${sx + 50} ${sy}, ${tempEdge.x - 50} ${tempEdge.y}, ${tempEdge.x} ${tempEdge.y}`}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth="2"
                      strokeDasharray="5 5"
                      opacity="0.6"
                    />
                  );
                })()}
              </svg>

              {/* Nodes Layer */}
              {workflow.nodes.map(node => {
                const config = nodeTypeConfig[node.type];
                const isSelected = selectedNode === node.id;
                const isHovered = hoveredNode === node.id;
                const isExecuted = executedNodes.has(node.id);
                const isExecutingNode = isExecuting && executedNodes.has(node.id);
                const nodeSubtype = node.subtype ? nodeSubtypes[node.type].find(s => s.id === node.subtype) : null;

                // Compute a 1-2 line "data needs" preview from the node's config.
                // We show only the most relevant field(s) per subtype so the user
                // can see at a glance what data this block will send to its API.
                const cfg = node.data.config || {};
                const previewFields: { label: string; value: string }[] = [];
                const pushField = (key: string, label: string) => {
                  const v = cfg[key];
                  if (v !== undefined && v !== null && String(v).trim() !== '') {
                    previewFields.push({ label, value: String(v).slice(0, 40) });
                  }
                };
                if (node.type === 'action') {
                  switch (node.subtype) {
                    case 'virustotal': case 'otx':
                      pushField('ioc_type', 'type');
                      pushField('ioc_value', 'ioc');
                      break;
                    case 'abuseipdb': case 'ipinfo':
                      pushField('ip', 'ip');
                      break;
                    case 'splunk':
                      pushField('search', 'spl');
                      break;
                    case 'elastic':
                      pushField('index', 'index');
                      pushField('query', 'query');
                      break;
                    case 'wazuh':
                      pushField('action', 'action');
                      pushField('agent_id', 'agent');
                      break;
                    case 'jira': case 'servicenow': case 'thehive': case 'pagerduty': case 'defectdojo':
                      pushField('action', 'action');
                      pushField('summary', 'summary');
                      pushField('title', 'title');
                      break;
                    case 'msgraph': case 'digitalocean': case 'velociraptor':
                      pushField('action', 'action');
                      pushField('upn', 'upn');
                      pushField('droplet_id', 'droplet');
                      break;
                    case 'fortigate': case 'opnsense': case 'pfsense':
                      pushField('action', 'action');
                      pushField('ip', 'ip');
                      break;
                    case 'cuckoo':
                      pushField('action', 'action');
                      pushField('url', 'url');
                      pushField('task_id', 'task');
                      break;
                    case 'clamav':
                      pushField('action', 'action');
                      pushField('hash', 'hash');
                      break;
                    case 'arkime':
                      pushField('action', 'action');
                      pushField('expression', 'expr');
                      break;
                    case 'slack':
                      pushField('channel', 'ch');
                      pushField('message', 'msg');
                      break;
                    case 'email':
                      pushField('to', 'to');
                      pushField('subject', 'subj');
                      break;
                    case 'create_case':
                      pushField('title', 'title');
                      pushField('severity', 'sev');
                      break;
                    case 'http': case 'webhook': case 'custom_app':
                      pushField('method', 'method');
                      pushField('url', 'url');
                      break;
                    case 'isolate':
                      pushField('hostname', 'host');
                      break;
                    default:
                      pushField('action', 'action');
                  }
                } else if (node.type === 'trigger') {
                  pushField('path', 'path');
                  pushField('interval', 'interval');
                  pushField('severity', 'min sev');
                } else if (node.type === 'condition') {
                  pushField('field', 'field');
                  pushField('operator', 'op');
                  pushField('value', 'value');
                }

                return (
                  <div
                    key={node.id}
                    data-node-id={node.id}
                    className={`workflow-node absolute rounded-lg border-2 bg-card shadow-md overflow-hidden box-border ${isSelected ? 'border-primary ring-2 ring-primary/30 shadow-lg' : isHovered ? config.borderColor : 'border-border'} ${isExecutingNode ? 'animate-pulse' : ''}`}
                    style={{
                      left: node.position.x,
                      top: node.position.y,
                      width: NODE_WIDTH,
                      height: NODE_HEIGHT,
                      zIndex: isSelected ? 10 : 2,
                    }}
                    onMouseDown={(e) => { setSelectedNode(node.id); setSelectedEdge(null); handleNodeDrag(node.id, e); }}
                    onMouseEnter={() => setHoveredNode(node.id)}
                    onMouseLeave={() => setHoveredNode(null)}
                    title={node.data.description || nodeSubtype?.description || ''}
                  >
                    <div className="flex flex-col h-full min-h-0">
                    {/* Node Header */}
                    <div className="flex items-center gap-2 p-2 pb-1 shrink-0 min-w-0">
                      <div className={`p-1.5 rounded shrink-0 ${config.bgColor} ${config.color}`}>
                        {config.icon}
                      </div>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="text-xs font-semibold truncate leading-tight">{node.data.label}</p>
                        <p className="text-[10px] text-muted-foreground truncate leading-tight">
                          {node.subtype || config.label}
                        </p>
                      </div>
                      {isExecuted && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      )}
                    </div>

                    <div className="flex-1 min-h-0 overflow-hidden px-2 pb-1.5 space-y-0.5">
                    {/* Config preview only — full description on hover via title */}
                    {previewFields.length > 0 && (
                      <div className="space-y-0.5 overflow-hidden">
                        {previewFields.slice(0, 2).map((f, i) => (
                          <p key={i} className="text-[9px] leading-tight text-muted-foreground truncate" title={`${f.label}: ${f.value}`}>
                            <span className="uppercase tracking-wide opacity-70">{f.label}</span>{' '}
                            <span className="font-mono text-foreground/80">{f.value}</span>
                          </p>
                        ))}
                      </div>
                    )}
                    </div>

                    {/* Node Status Bar */}
                    <div className={`h-1 shrink-0 rounded-b ${isExecuted ? 'bg-emerald-500' : isExecutingNode ? 'bg-amber-500 animate-pulse' : 'bg-transparent'}`} />
                    </div>

                    {/* Input Port (left) - not for triggers */}
                    {node.type !== 'trigger' && (
                      <div
                        data-port="input"
                        className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-card transition-colors ${isHovered ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                      />
                    )}

                    {/* Output Port (right) */}
                    <div
                      data-port="output"
                      onMouseDown={(e) => startConnectorDrag(node.id, e)}
                      className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-card cursor-crosshair transition-all hover:scale-150 ${draggingConnector?.sourceId === node.id ? 'bg-primary scale-150' : 'bg-primary'}`}
                    />
                  </div>
                );
              })}

              {/* Empty state */}
              {workflow.nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center max-w-sm">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                      <GitBranch className="h-8 w-8 text-primary/60" />
                    </div>
                    <p className="text-sm font-medium text-foreground">Start building your workflow</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Drag a node from the left panel, or click any node type to add it to the canvas.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Canvas Info Overlay */}
            <div className="absolute bottom-2 left-2 right-2 sm:right-auto max-w-[calc(100%-1rem)] flex flex-wrap gap-2 text-[10px] text-muted-foreground bg-background/95 rounded-md px-2 py-1 border shadow-sm">
              <span className="font-medium">{workflow.nodes.length} nodes</span>
              <span aria-hidden>•</span>
              <span className="font-medium">{workflow.edges.length} connections</span>
              {isExecuting && (
                <>
                  <span aria-hidden>•</span>
                  <span className="text-emerald-500 flex items-center gap-1 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 pulse-dot" /> Running
                  </span>
                </>
              )}
            </div>

            {/* Help Overlay */}
            <div className="absolute top-2 right-2 hidden lg:block text-[10px] text-muted-foreground bg-background/95 rounded-md px-2.5 py-1.5 max-w-[240px] space-y-0.5 border shadow-sm">
              <p className="font-semibold text-foreground flex items-center gap-1">
                <HelpCircle className="h-3 w-3" /> Shortcuts
              </p>
              <p>• Drag from <span className="inline-block h-2 w-2 rounded-full bg-primary align-middle"/> output port to input port</p>
              <p>• <kbd>Del</kbd> delete selected · <kbd>Esc</kbd> deselect</p>
              <p>• <kbd>Ctrl</kbd>+<kbd>S</kbd> save · <kbd>Ctrl</kbd>+<kbd>↵</kbd> run test</p>
            </div>

            {/* Execution Progress Bar */}
            {isExecuting && (
              <div className="absolute top-2 left-2 max-w-[calc(100%-1rem)] bg-background/95 rounded-md px-3 py-2 border shadow-sm">
                <div className="flex items-center gap-2 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 pulse-dot" />
                  <span className="font-medium">Executing workflow...</span>
                  <span className="text-muted-foreground">
                    {executedNodes.size}/{workflow.nodes.length} nodes
                  </span>
                </div>
                <div className="mt-1.5 h-1 w-48 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-500"
                    style={{ width: `${workflow.nodes.length === 0 ? 0 : (executedNodes.size / workflow.nodes.length) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ========== NODE CONFIG EDITOR ==========
// Auto-generates form fields for every node subtype based on its defaultConfig.
// Falls back to type-specific renderers for known schemas (selects, textareas).
function NodeConfigEditor({ node, onConfigChange }: { node: WFNode; onConfigChange: (key: string, value: unknown) => void }) {
  const config = node.data.config || {};
  const subtype = node.subtype;

  const renderField = (key: string, label: string, type: 'text' | 'textarea' | 'select' | 'number', options?: { value: string; label: string }[]) => {
    const value = config[key] as string | number;
    if (type === 'textarea') {
      return (
        <div key={key} className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{label}</Label>
          <Textarea
            value={String(value || '')}
            onChange={e => onConfigChange(key, e.target.value)}
            className="text-xs min-h-[60px]"
            placeholder={`Enter ${label.toLowerCase()}`}
          />
        </div>
      );
    }
    if (type === 'select' && options) {
      return (
        <div key={key} className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">{label}</Label>
          <Select value={String(value || '')} onValueChange={v => onConfigChange(key, v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={`Select ${label.toLowerCase()}`} /></SelectTrigger>
            <SelectContent>
              {options.map(o => <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      );
    }
    return (
      <div key={key} className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{label}</Label>
        <Input
          value={String(value || '')}
          onChange={e => onConfigChange(key, type === 'number' ? Number(e.target.value) : e.target.value)}
          type={type === 'number' ? 'number' : 'text'}
          className="h-8 text-xs"
          placeholder={`Enter ${label.toLowerCase()}`}
        />
      </div>
    );
  };

  // Info banner for connector nodes that need credentials
  const needsApiKey = (s?: string) => {
    const needsKey: Record<string, string> = {
      virustotal: 'Requires VirusTotal API key',
      abuseipdb: 'Requires AbuseIPDB API key',
      otx: 'Requires AlienVault OTX API key (X-OTX-API-KEY)',
      misp: 'Requires MISP API key',
      opencti: 'Requires OpenCTI URL + API token (Save & Test)',
      slack: 'Requires Slack incoming webhook URL',
      telegram: 'Requires Telegram bot token (+ chat_id for test)',
      email: 'Requires SMTP credentials (Save & Test on Integrations)',
      sentinel: 'Requires Azure AD app + Sentinel workspace (Reader/Incident permissions)',
      greynoise: 'Requires GreyNoise API key',
      shodan: 'Requires Shodan API key',
      crowdstrike: 'Requires Falcon API client_id + client_secret',
      teams: 'Requires Teams incoming webhook URL on integration',
      splunk: 'Requires Splunk auth (username/password or token)',
      elastic: 'Requires Elasticsearch credentials',
      wazuh: 'Requires Wazuh API credentials',
      jira: 'Requires Jira API token + email',
      servicenow: 'Requires ServiceNow credentials',
      pagerduty: 'Requires PagerDuty API token',
      thehive: 'Requires TheHive API key',
      defectdojo: 'Requires DefectDojo API key',
      msgraph: 'Requires Azure AD client_id + client_secret',
      entra_id: 'Requires Entra app with Graph User/Group permissions',
      aws_securityhub: 'Requires IAM access key with Security Hub permissions',
      gcp_scc: 'Requires GCP service account JSON + org/project ID',
      digitalocean: 'Requires DigitalOcean API token',
      fortigate: 'Requires FortiOS API token',
      opnsense: 'Requires OPNsense API key + secret',
      pfsense: 'Requires pfSense host + API key (REST package)',
      cuckoo: 'Requires Cuckoo API base URL (+ token if enabled)',
      clamav: 'Requires clamav-rest or HTTP gateway URL',
      arkime: 'Requires Arkime base URL (+ basic auth if enabled)',
      velociraptor: 'Requires Velociraptor API key + username',
    };
    return needsKey[s || ''];
  };
  const keyHint = needsApiKey(subtype);

  // ============================================================================
  // TRIGGER NODE CONFIGS
  // ============================================================================
  if (node.type === 'trigger') {
    if (subtype === 'webhook') {
      return (
        <div className="space-y-3">
          {renderField('method', 'HTTP Method', 'select', [
            { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' }
          ])}
          {renderField('path', 'Webhook Path', 'text')}
        </div>
      );
    }
    if (subtype === 'schedule') {
      return (
        <div className="space-y-3">
          {renderField('interval', 'Interval', 'select', [
            { value: '1m', label: 'Every minute' }, { value: '5m', label: 'Every 5 minutes' }, { value: '15m', label: 'Every 15 minutes' }, { value: '1h', label: 'Every hour' }, { value: '1d', label: 'Every day' }
          ])}
          {renderField('cron', 'Cron Expression (optional)', 'text')}
        </div>
      );
    }
    if (subtype === 'alert') {
      return (
        <div className="space-y-3">
          {renderField('severity', 'Min Severity', 'select', [
            { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }
          ])}
          {renderField('source', 'Source Filter', 'text')}
        </div>
      );
    }
  }

  // ============================================================================
  // ACTION NODE CONFIGS — full coverage of all 22 real connectors
  // ============================================================================
  if (node.type === 'action') {
    // Show API-key hint banner if needed
    const hintBanner = keyHint ? (
      <div className="p-2 bg-amber-500/10 rounded-md text-[11px] text-amber-700 dark:text-amber-300 border border-amber-500/20 flex items-start gap-2">
        <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">{keyHint}.</span>{' '}
          <span>Set credentials on the Integrations page.</span>
        </div>
      </div>
    ) : null;

    // Generic helper: render a standard form from a schema definition
    const renderSchema = (fields: { key: string; label: string; type: 'text' | 'textarea' | 'select' | 'number'; options?: { value: string; label: string }[]; placeholder?: string }[]) => (
      <div className="space-y-3">
        {hintBanner}
        {fields.map(f => renderField(f.key, f.label, f.type, f.options))}
        <div className="p-2 bg-muted/50 rounded text-[10px] text-muted-foreground flex items-start gap-2">
          <Lightbulb className="h-3 w-3 shrink-0 mt-0.5 text-amber-500" aria-hidden />
          <span>Use <code>{`{{trigger.ip}}`}</code> or <code>{`{{outputs.n1.field}}`}</code> for templates.</span>
        </div>
      </div>
    );

    switch (subtype) {
      // ===== Threat Intel =====
      case 'virustotal':
        return renderSchema([
          { key: 'ioc_type', label: 'IOC Type', type: 'select', options: [
            { value: 'ip', label: 'IP Address' }, { value: 'domain', label: 'Domain' },
            { value: 'hash', label: 'File Hash' }, { value: 'url', label: 'URL' }
          ]},
          { key: 'ioc_value', label: 'IOC Value', type: 'text', placeholder: '{{trigger.ip}} or 8.8.8.8' },
        ]);
      case 'abuseipdb':
        return renderSchema([
          { key: 'ip', label: 'IP Address', type: 'text', placeholder: '{{trigger.ip}} or 1.2.3.4' },
        ]);
      case 'ipinfo':
        return renderSchema([
          { key: 'ip', label: 'IP Address', type: 'text', placeholder: '{{trigger.ip}} or 8.8.8.8' },
        ]);
      case 'otx':
        return renderSchema([
          { key: 'ioc_type', label: 'IOC Type', type: 'select', options: [
            { value: 'ip', label: 'IP' }, { value: 'domain', label: 'Domain' },
            { value: 'hash', label: 'File Hash' }, { value: 'url', label: 'URL' }, { value: 'email', label: 'Email' }
          ]},
          { key: 'ioc_value', label: 'IOC Value', type: 'text' },
        ]);
      case 'misp':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'search_attributes', label: 'Search attributes' },
            { value: 'add_attribute', label: 'Add attribute' }
          ]},
          { key: 'value', label: 'Value', type: 'text' },
          { key: 'type', label: 'Attribute Type', type: 'select', options: [
            { value: 'ip-src', label: 'Source IP' }, { value: 'ip-dst', label: 'Destination IP' },
            { value: 'domain', label: 'Domain' }, { value: 'url', label: 'URL' },
            { value: 'md5', label: 'MD5' }, { value: 'sha256', label: 'SHA256' }
          ]},
        ]);
      case 'opencti':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'create_indicator', label: 'Create indicator (STIX pattern)' },
            { value: 'create_indicator_from_value', label: 'Create indicator from IOC value' },
            { value: 'create_observable', label: 'Create observable' },
            { value: 'create_case', label: 'Create incident case' },
            { value: 'search', label: 'Search indicators' },
            { value: 'search_observables', label: 'Search observables' },
          ]},
          { key: 'pattern', label: 'STIX Pattern', type: 'text', placeholder: "[ipv4-addr:value = '8.8.8.8']" },
          { key: 'value', label: 'IOC / search value', type: 'text', placeholder: '{{trigger.ip}}' },
          { key: 'search', label: 'Search term', type: 'text', placeholder: '8.8.8.8 or malware' },
          { key: 'name', label: 'Name / title', type: 'text', placeholder: 'SOAR indicator' },
          { key: 'description', label: 'Description (case)', type: 'textarea' },
          { key: 'pattern_type', label: 'Pattern Type', type: 'select', options: [
            { value: 'stix', label: 'STIX' }, { value: 'pcre', label: 'PCRE' }, { value: 'sigma', label: 'SIGMA' }
          ]},
          { key: 'observable_type', label: 'Observable type', type: 'select', options: [
            { value: 'IPv4-Addr', label: 'IPv4' }, { value: 'Domain-Name', label: 'Domain' },
            { value: 'Url', label: 'URL' }, { value: 'File', label: 'File hash' }, { value: 'Email-Addr', label: 'Email' },
          ]},
          { key: 'severity', label: 'Case severity', type: 'select', options: [
            { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
          ]},
          { key: 'labels', label: 'Labels (comma-separated)', type: 'text', placeholder: 'soar,automated' },
        ]);

      case 'greynoise':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'lookup_ip', label: 'Community lookup' },
            { value: 'context', label: 'Enterprise context' },
            { value: 'riot_lookup', label: 'RIOT lookup' },
          ]},
          { key: 'ip', label: 'IP address', type: 'text', placeholder: '{{trigger.ip}}' },
        ]);

      case 'shodan':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'host_lookup', label: 'Host lookup' },
            { value: 'search', label: 'Search' },
          ]},
          { key: 'ip', label: 'IP / host', type: 'text', placeholder: '{{trigger.ip}}' },
          { key: 'query', label: 'Shodan query', type: 'text', placeholder: 'apache country:US' },
        ]);

      // ===== SIEM =====
      case 'sentinel':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_incidents', label: 'List incidents' },
            { value: 'get_incident', label: 'Get incident' },
            { value: 'update_incident', label: 'Update incident' },
            { value: 'run_query', label: 'Run KQL query' },
          ]},
          { key: 'incident_id', label: 'Incident ID', type: 'text', placeholder: '{{trigger.incident_id}}' },
          { key: 'status', label: 'Status (update)', type: 'select', options: [
            { value: 'New', label: 'New' }, { value: 'Active', label: 'Active' }, { value: 'Closed', label: 'Closed' },
          ]},
          { key: 'classification', label: 'Classification', type: 'text' },
          { key: 'owner_email', label: 'Owner email', type: 'text' },
          { key: 'comment', label: 'Comment', type: 'textarea' },
          { key: 'filter', label: 'OData filter (list)', type: 'text', placeholder: "properties/status eq 'New'" },
          { key: 'top', label: 'Max results', type: 'number' },
          { key: 'query', label: 'KQL query', type: 'textarea', placeholder: 'SecurityIncident | take 5' },
          { key: 'timespan', label: 'Timespan', type: 'text', placeholder: 'PT1H' },
        ]);
      case 'splunk':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'search', label: 'Run search' },
            { value: 'list_saved_searches', label: 'List saved searches' }
          ]},
          { key: 'search', label: 'SPL Search', type: 'textarea', placeholder: 'search * | head 10' },
          { key: 'earliest', label: 'Earliest Time', type: 'text', placeholder: '-1h' },
          { key: 'latest', label: 'Latest Time', type: 'text', placeholder: 'now' },
        ]);
      case 'elastic':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'search', label: 'Search' }, { value: 'count', label: 'Count documents' }
          ]},
          { key: 'index', label: 'Index Pattern', type: 'text', placeholder: '*' },
          { key: 'query', label: 'Query (Lucene or JSON)', type: 'textarea', placeholder: '*' },
        ]);
      case 'wazuh':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_agents', label: 'List agents' },
            { value: 'list_alerts', label: 'List alerts' },
            { value: 'agent_active', label: 'Get agent details (needs agent_id)' },
            { value: 'syscheck', label: 'Syscheck / FIM for agent (needs agent_id)' }
          ]},
          { key: 'agent_id', label: 'Agent ID (required for agent_active / syscheck)', type: 'text', placeholder: '{{trigger.agent_id}} or 001' },
        ]);

      // ===== Ticketing / ITSM =====
      case 'jira':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'create_issue', label: 'Create issue' },
            { value: 'add_comment', label: 'Add comment' },
            { value: 'search', label: 'JQL search' }
          ]},
          { key: 'project_key', label: 'Project Key', type: 'text', placeholder: 'SOC' },
          { key: 'summary', label: 'Summary', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'issue_type', label: 'Issue Type', type: 'select', options: [
            { value: 'Task', label: 'Task' }, { value: 'Bug', label: 'Bug' },
            { value: 'Story', label: 'Story' }, { value: 'Incident', label: 'Incident' }
          ]},
          { key: 'priority', label: 'Priority', type: 'select', options: [
            { value: 'Highest', label: 'Highest' }, { value: 'High', label: 'High' },
            { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }, { value: 'Lowest', label: 'Lowest' }
          ]},
        ]);
      case 'servicenow':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'create_incident', label: 'Create incident' },
            { value: 'query', label: 'Query incidents' },
            { value: 'update_incident', label: 'Update incident' },
            { value: 'query_cmdb', label: 'Query CMDB CI' },
            { value: 'get_ci', label: 'Get CI by sys_id' },
            { value: 'create_ci', label: 'Create CI' },
          ]},
          { key: 'short_description', label: 'Short Description', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'urgency', label: 'Urgency', type: 'select', options: [
            { value: '1', label: '1 - High' }, { value: '2', label: '2 - Medium' }, { value: '3', label: '3 - Low' }
          ]},
          { key: 'impact', label: 'Impact', type: 'select', options: [
            { value: '1', label: '1 - High' }, { value: '2', label: '2 - Medium' }, { value: '3', label: '3 - Low' }
          ]},
          { key: 'table', label: 'Table (query/CMDB)', type: 'text', placeholder: 'cmdb_ci' },
          { key: 'sysparm_query', label: 'Encoded query', type: 'text', placeholder: 'operational_status=1' },
          { key: 'sys_id', label: 'sys_id', type: 'text', placeholder: '{{outputs.n1.servicenow.sys_id}}' },
          { key: 'name', label: 'CI name (create_ci)', type: 'text' },
          { key: 'ci_class', label: 'CI class (create_ci)', type: 'text', placeholder: 'cmdb_ci_server' },
          { key: 'ip_address', label: 'IP address (create_ci)', type: 'text' },
        ]);
      case 'pagerduty':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'trigger', label: 'Trigger incident' },
            { value: 'acknowledge', label: 'Acknowledge' },
            { value: 'resolve', label: 'Resolve' }
          ]},
          { key: 'summary', label: 'Summary', type: 'text' },
          { key: 'severity', label: 'Severity', type: 'select', options: [
            { value: 'critical', label: 'Critical' }, { value: 'error', label: 'Error' },
            { value: 'warning', label: 'Warning' }, { value: 'info', label: 'Info' }
          ]},
          { key: 'source', label: 'Source', type: 'text', placeholder: 'soar-platform' },
          { key: 'routing_key', label: 'Routing Key (overrides integration)', type: 'text' },
        ]);
      case 'thehive':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'create_case', label: 'Create case' },
            { value: 'create_observable', label: 'Create observable' }
          ]},
          { key: 'title', label: 'Case Title', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'severity', label: 'Severity (1-4)', type: 'number' },
        ]);
      case 'defectdojo':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_findings', label: 'List findings' },
            { value: 'create_finding', label: 'Create finding (needs title, severity, product_id)' },
            { value: 'list_engagements', label: 'List engagements' }
          ]},
          { key: 'title', label: 'Finding title (for create_finding)', type: 'text', placeholder: 'Vulnerability in {{trigger.hostname}}' },
          { key: 'description', label: 'Description (for create_finding)', type: 'textarea' },
          { key: 'severity', label: 'Severity (for create_finding)', type: 'select', options: [
            { value: 'Critical', label: 'Critical' }, { value: 'High', label: 'High' },
            { value: 'Medium', label: 'Medium' }, { value: 'Low', label: 'Low' }, { value: 'Info', label: 'Info' }
          ]},
          { key: 'product_id', label: 'Product ID (for create_finding)', type: 'number' },
          { key: 'engagement_id', label: 'Engagement ID (optional, for create_finding)', type: 'number' },
        ]);

      // ===== Cloud / Identity =====
      case 'msgraph':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_users', label: 'List users' },
            { value: 'list_alerts', label: 'List security alerts' },
            { value: 'list_signins', label: 'List sign-in logs' },
            { value: 'get_user', label: 'Get user by UPN (needs upn)' },
            { value: 'send_mail', label: 'Send mail (needs from, to, subject, body)' }
          ]},
          { key: 'upn', label: 'User UPN (for get_user)', type: 'text', placeholder: '{{trigger.user}} or user@corp.com' },
          { key: 'from', label: 'From (for send_mail)', type: 'text', placeholder: 'soc@corp.com' },
          { key: 'to', label: 'To (for send_mail)', type: 'text', placeholder: '{{trigger.assignee}} or analyst@corp.com' },
          { key: 'subject', label: 'Subject (for send_mail)', type: 'text', placeholder: 'SOAR notification' },
          { key: 'body', label: 'Body (for send_mail, supports {{templates}})', type: 'textarea' },
        ]);
      case 'entra_id':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_users', label: 'List users' },
            { value: 'get_user', label: 'Get user' },
            { value: 'disable_user', label: 'Disable user' },
            { value: 'enable_user', label: 'Enable user' },
            { value: 'list_groups', label: 'List groups' },
            { value: 'add_user_to_group', label: 'Add user to group' },
            { value: 'list_sign_ins', label: 'List sign-ins' },
          ]},
          { key: 'upn', label: 'User UPN', type: 'text', placeholder: '{{trigger.user}}' },
          { key: 'user_id', label: 'User object ID', type: 'text' },
          { key: 'group_id', label: 'Group ID', type: 'text' },
          { key: 'top', label: 'Max results', type: 'number' },
        ]);
      case 'aws_securityhub':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_findings', label: 'List findings' },
            { value: 'update_finding', label: 'Update finding' },
            { value: 'list_standards', label: 'List standards' },
            { value: 'describe_hub', label: 'Describe hub' },
          ]},
          { key: 'finding_id', label: 'Finding ID', type: 'text' },
          { key: 'product_arn', label: 'Product ARN', type: 'text' },
          { key: 'workflow_status', label: 'Workflow status', type: 'select', options: [
            { value: 'NEW', label: 'NEW' }, { value: 'RESOLVED', label: 'RESOLVED' }, { value: 'SUPPRESSED', label: 'SUPPRESSED' },
          ]},
          { key: 'severity', label: 'Severity filter', type: 'select', options: [
            { value: 'CRITICAL', label: 'CRITICAL' }, { value: 'HIGH', label: 'HIGH' }, { value: 'MEDIUM', label: 'MEDIUM' }, { value: 'LOW', label: 'LOW' },
          ]},
          { key: 'note', label: 'Note', type: 'textarea' },
          { key: 'max_results', label: 'Max results', type: 'number' },
        ]);
      case 'gcp_scc':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_findings', label: 'List findings' },
            { value: 'get_finding', label: 'Get finding' },
            { value: 'update_finding', label: 'Update finding state' },
          ]},
          { key: 'finding_name', label: 'Finding resource name', type: 'text' },
          { key: 'filter', label: 'Filter', type: 'text', placeholder: 'severity="HIGH"' },
          { key: 'state', label: 'State', type: 'select', options: [
            { value: 'ACTIVE', label: 'ACTIVE' }, { value: 'INACTIVE', label: 'INACTIVE' },
          ]},
          { key: 'page_size', label: 'Page size', type: 'number' },
        ]);
      case 'digitalocean':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_droplets', label: 'List droplets' },
            { value: 'add_firewall_rule', label: 'Add firewall rule (needs firewall_id, ip)' },
            { value: 'power_off_droplet', label: 'Power off droplet (needs droplet_id)' }
          ]},
          { key: 'firewall_id', label: 'Firewall ID (for add_firewall_rule)', type: 'text', placeholder: '{{trigger.firewall_id}}' },
          { key: 'ip', label: 'IP to allow/deny (for add_firewall_rule)', type: 'text', placeholder: '{{trigger.ip}}' },
          { key: 'port', label: 'Port range (default 0:65535)', type: 'text', placeholder: '22 or 0:65535' },
          { key: 'protocol', label: 'Protocol (default tcp)', type: 'select', options: [
            { value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'icmp', label: 'ICMP' }
          ]},
          { key: 'droplet_id', label: 'Droplet ID (for power_off_droplet)', type: 'text', placeholder: '{{trigger.droplet_id}}' },
        ]);

      // ===== Network / Firewall =====
      case 'fortigate':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'block_ip', label: 'Block IP' },
            { value: 'unblock_ip', label: 'Unblock IP' },
            { value: 'list_addresses', label: 'List addresses' }
          ]},
          { key: 'ip', label: 'IP Address', type: 'text', placeholder: '{{trigger.ip}}' },
          { key: 'address_group', label: 'Address Group', type: 'text', placeholder: 'SOAR-BlockList' },
        ]);
      case 'opnsense':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'block_ip', label: 'Block IP' },
            { value: 'list_aliases', label: 'List aliases' }
          ]},
          { key: 'ip', label: 'IP Address', type: 'text', placeholder: '{{trigger.ip}}' },
          { key: 'alias', label: 'Alias Name', type: 'text', placeholder: 'SOAR_BlockList' },
        ]);
      case 'pfsense':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'system_status', label: 'System status' },
            { value: 'list_aliases', label: 'List aliases' },
            { value: 'block_ip', label: 'Block IP (alias)' },
            { value: 'add_alias_ip', label: 'Add IP to alias' },
          ]},
          { key: 'ip', label: 'IP Address', type: 'text', placeholder: '{{trigger.ip}}' },
          { key: 'alias', label: 'Alias Name', type: 'text', placeholder: 'SOAR_BlockList' },
        ]);
      case 'cuckoo':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'submit_url', label: 'Submit URL' },
            { value: 'list_tasks', label: 'List tasks' },
            { value: 'get_report', label: 'Get JSON report' },
            { value: 'view_task', label: 'View task' },
          ]},
          { key: 'url', label: 'Target URL', type: 'text', placeholder: '{{trigger.url}}' },
          { key: 'task_id', label: 'Task ID', type: 'text', placeholder: '{{outputs.n1.cuckoo.task_id}}' },
          { key: 'limit', label: 'List limit', type: 'number', placeholder: '10' },
        ]);
      case 'clamav':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'scan_hash', label: 'Scan hash' },
            { value: 'scan_url', label: 'Scan file URL' },
          ]},
          { key: 'hash', label: 'SHA256 hash', type: 'text', placeholder: '{{trigger.hash}}' },
          { key: 'file_url', label: 'File URL', type: 'text', placeholder: '{{trigger.file_url}}' },
        ]);
      case 'arkime':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'search_sessions', label: 'Search sessions' },
            { value: 'stats', label: 'Cluster stats' },
          ]},
          { key: 'expression', label: 'Arkime expression', type: 'text', placeholder: 'ip.src=={{trigger.ip}}' },
          { key: 'start_time', label: 'Start epoch (optional)', type: 'text' },
          { key: 'stop_time', label: 'Stop epoch (optional)', type: 'text' },
        ]);
      case 'block':
        return renderSchema([
          { key: 'type', label: 'Target Type', type: 'select', options: [
            { value: 'ip', label: 'IP Address' },
            { value: 'domain', label: 'Domain' },
            { value: 'url', label: 'URL' },
          ]},
          { key: 'target', label: 'Target', type: 'text', placeholder: '{{trigger.ip}} or 1.2.3.4' },
        ]);

      // ===== EDR / IR =====
      case 'velociraptor':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_hunts', label: 'List hunts' },
            { value: 'create_hunt', label: 'Create hunt (needs artifact, description)' },
            { value: 'list_clients', label: 'List clients' }
          ]},
          { key: 'artifact', label: 'Artifact name (for create_hunt)', type: 'text', placeholder: 'Windows.System.ProcessVads' },
          { key: 'description', label: 'Hunt description (for create_hunt)', type: 'text', placeholder: 'Hunt for {{trigger.process}}' },
        ]);
      case 'crowdstrike':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'list_hosts', label: 'List hosts' },
            { value: 'list_detections', label: 'List detections' },
            { value: 'contain_host', label: 'Contain host' },
            { value: 'lift_containment', label: 'Lift containment' },
          ]},
          { key: 'device_id', label: 'Device ID', type: 'text', placeholder: '{{trigger.device_id}}' },
          { key: 'filter', label: 'FQL filter', type: 'text' },
        ]);
      case 'isolate':
        return renderSchema([
          { key: 'hostname', label: 'Hostname / Agent ID', type: 'text', placeholder: 'SRV-01 or agent-123' },
        ]);

      // ===== Communication =====
      case 'slack':
        return renderSchema([
          { key: 'channel', label: 'Channel (or use integration default)', type: 'text', placeholder: '#soc-alerts' },
          { key: 'message', label: 'Message (supports {{templates}})', type: 'textarea' },
        ]);
      case 'telegram':
        return renderSchema([
          { key: 'chat_id', label: 'Chat ID (optional if set on integration)', type: 'text', placeholder: '{{trigger.chat_id}}' },
          { key: 'message', label: 'Message', type: 'textarea', placeholder: 'SOAR alert: {{trigger.title}}' },
          { key: 'parse_mode', label: 'Parse mode', type: 'select', options: [
            { value: '', label: 'Plain' }, { value: 'HTML', label: 'HTML' }, { value: 'MarkdownV2', label: 'MarkdownV2' },
          ]},
        ]);
      case 'teams':
        return renderSchema([
          { key: 'title', label: 'Title', type: 'text', placeholder: 'SOAR Alert' },
          { key: 'message', label: 'Message', type: 'textarea', placeholder: '{{trigger.title}}' },
          { key: 'theme_color', label: 'Theme color', type: 'text', placeholder: '0078D4' },
          { key: 'webhook_url', label: 'Webhook override (optional)', type: 'text' },
        ]);
      case 'email':
        return renderSchema([
          { key: 'to', label: 'To', type: 'text', placeholder: '{{trigger.to}} or analyst@corp.com' },
          { key: 'cc', label: 'CC (optional)', type: 'text' },
          { key: 'bcc', label: 'BCC (optional)', type: 'text' },
          { key: 'from', label: 'From (optional override)', type: 'text' },
          { key: 'subject', label: 'Subject', type: 'text', placeholder: 'SOAR Alert: {{trigger.title}}' },
          { key: 'body', label: 'Body', type: 'textarea' },
          { key: 'format', label: 'Format', type: 'select', options: [
            { value: 'text', label: 'Plain text' }, { value: 'html', label: 'HTML' },
          ]},
        ]);

      // ===== Case Management =====
      case 'create_case':
        return renderSchema([
          { key: 'title', label: 'Case Title', type: 'text', placeholder: 'Phishing - {{trigger.ip}}' },
          { key: 'description', label: 'Description', type: 'textarea', placeholder: 'VT score={{outputs.n2.virustotal.score}}%, AbuseIPDB={{outputs.n3.abuseipdb.abuse_score}}%' },
          { key: 'severity', label: 'Severity', type: 'select', options: [
            { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }
          ]},
          { key: 'tags', label: 'Tags (comma-separated)', type: 'text', placeholder: 'phishing, automated' },
        ]);

      // ===== Generic =====
      case 'http':
      case 'custom_app':
        return renderSchema([
          { key: 'method', label: 'Method', type: 'select', options: [
            { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' },
            { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' }, { value: 'PATCH', label: 'PATCH' }
          ]},
          { key: 'url', label: 'URL', type: 'text', placeholder: 'https://api.example.com/v1/status' },
          { key: 'headers', label: 'Headers (JSON)', type: 'textarea', placeholder: '{"Authorization": "Bearer xxx"}' },
          { key: 'body', label: 'Request Body (JSON)', type: 'textarea' },
        ]);
      case 'webhook':
        return renderSchema([
          { key: 'method', label: 'Method', type: 'select', options: [
            { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }
          ]},
          { key: 'url', label: 'Webhook URL', type: 'text' },
          { key: 'body', label: 'Body (supports {{templates}})', type: 'textarea' },
          { key: 'auth_header', label: 'Auth Header (optional)', type: 'text', placeholder: 'Bearer xxx' },
        ]);
      case 'soar_utils':
        return renderSchema([
          { key: 'action', label: 'Action', type: 'select', options: [
            { value: 'delay', label: 'Delay (ms)' },
            { value: 'set_var', label: 'Set variable' },
            { value: 'parse_json', label: 'Parse JSON' },
            { value: 'transform', label: 'Transform value' },
            { value: 'build_payload', label: 'Build payload' },
            { value: 'condition_eval', label: 'Evaluate condition' }
          ]},
          { key: 'name', label: 'Variable Name', type: 'text' },
          { key: 'value', label: 'Value', type: 'text' },
        ]);

      // Unknown action subtype — fall through to auto-render
      default:
        break;
    }
  }

  // ============================================================================
  // CONDITION NODE CONFIGS
  // ============================================================================
  if (node.type === 'condition') {
    if (subtype === 'if') {
      return (
        <div className="space-y-3">
          {renderField('field', 'Field', 'text')}
          {renderField('operator', 'Operator', 'select', [
            { value: '==', label: '==' }, { value: '!=', label: '!=' }, { value: '>', label: '>' },
            { value: '<', label: '<' }, { value: '>=', label: '>=' }, { value: '<=', label: '<=' },
            { value: 'contains', label: 'contains' }, { value: 'startsWith', label: 'startsWith' },
            { value: 'endsWith', label: 'endsWith' }
          ])}
          {renderField('value', 'Value', 'text')}
          <div className="p-2 bg-muted/50 rounded text-[10px] text-muted-foreground flex items-start gap-2">
            <Lightbulb className="h-3 w-3 shrink-0 mt-0.5 text-amber-500" aria-hidden />
            <span>Add edges with labels "Yes" and "No" to define branches</span>
          </div>
        </div>
      );
    }
    if (subtype === 'switch') {
      return (
        <div className="space-y-3">
          {renderField('field', 'Field to switch on', 'text')}
          {renderField('cases', 'Cases (JSON: {"value": "branch_label"})', 'textarea')}
        </div>
      );
    }
    if (subtype === 'severity_check') {
      return (
        <div className="space-y-3">
          {renderField('threshold', 'Severity Threshold', 'select', [
            { value: 'low', label: 'Low+' }, { value: 'medium', label: 'Medium+' },
            { value: 'high', label: 'High+' }, { value: 'critical', label: 'Critical only' }
          ])}
        </div>
      );
    }
  }

  // ============================================================================
  // OUTPUT NODE CONFIGS
  // ============================================================================
  if (node.type === 'output') {
    if (subtype === 'log') {
      return (
        <div className="space-y-3">
          {renderField('level', 'Log Level', 'select', [
            { value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'error', label: 'Error' }
          ])}
          {renderField('message', 'Message', 'textarea')}
        </div>
      );
    }
    if (subtype === 'webhook_response') {
      return (
        <div className="space-y-3">
          {renderField('status', 'HTTP Status', 'number')}
          {renderField('body', 'Response Body (JSON)', 'textarea')}
        </div>
      );
    }
    if (subtype === 'alert_out') {
      return (
        <div className="space-y-3">
          {renderField('title', 'Alert Title', 'text')}
          {renderField('description', 'Description', 'textarea')}
          {renderField('severity', 'Severity', 'select', [
            { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }
          ])}
        </div>
      );
    }
  }

  // ============================================================================
  // FALLBACK: Auto-render fields based on defaultConfig
  // If we don't have an explicit form for this subtype, scan its defaultConfig
  // and render a text/textarea field for each key. This guarantees users can
  // ALWAYS configure every node, even ones added in the future.
  // ============================================================================
  const defaultConfig = subtype
    ? nodeSubtypes[node.type].find(s => s.id === subtype)?.defaultConfig || {}
    : {};
  const keys = Object.keys(defaultConfig);
  if (keys.length === 0) {
    return <p className="text-xs text-muted-foreground">No configuration available for this node type.</p>;
  }
  return (
    <div className="space-y-3">
      {keys.map(k => (
        <div key={k} className="space-y-1">
          <Label className="text-[11px] text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</Label>
          <Input
            value={String(config[k] ?? '')}
            onChange={e => onConfigChange(k, e.target.value)}
            className="h-8 text-xs"
            placeholder={`Enter ${k}`}
          />
        </div>
      ))}
    </div>
  );
}

// ========== PALETTE CATEGORY COMPONENT ==========
function PaletteCategory({
  title, color, icon, items, onAdd, type, itemColor,
}: {
  title: string;
  color: string;
  icon: React.ReactNode;
  items: { id: string; label: string; icon: React.ReactNode; description: string; type: NodeType }[];
  onAdd: (type: NodeType, subtype: string) => void;
  type: NodeType;
  itemColor: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="mb-4">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 mb-2 hover:opacity-80 transition-opacity"
      >
        <div className={`p-1 rounded ${color}`}>{icon}</div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex-1 text-left truncate min-w-0">{title}</h4>
        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${collapsed ? 'rotate-90' : ''}`} />
      </button>
      {!collapsed && (
        <div className="space-y-1">
          {items.map(sub => (
            <button
              key={sub.id}
              onClick={() => onAdd(type, sub.id)}
              className="w-full flex items-start gap-2 p-2 rounded-md border border-transparent hover:border-primary/30 hover:bg-muted/50 transition-colors text-left group"
            >
              <div className={`p-1.5 rounded shrink-0 ${itemColor} group-hover:scale-110 transition-transform`}>
                {sub.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{sub.label}</p>
                <p className="text-[10px] text-muted-foreground line-clamp-1">{sub.description}</p>
              </div>
              <Plus className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

