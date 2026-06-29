/**
 * LumiSec platform workflow nodes — real outbound to GRC / UCTC / Phishing / LumiNet.
 */
import { buildCertifiedConnector } from '@/lib/soar/nodes/build-connector';
import type { NodeExecutorResult, WFNode, ExecutionContext } from '@/lib/executors/types';
import { resolveTemplate } from '@/lib/executors/types';
import {
  callPlatformOutbound,
  platformFetch,
  isPlatformOutboundConfigured,
} from '@/lib/lumisec-api/platform-outbound';

function cfgStr(node: WFNode, ctx: ExecutionContext, ...keys: string[]): string {
  const cfg = node.data.config || {};
  for (const key of keys) {
    const raw = cfg[key];
    if (typeof raw === 'string' && raw.trim()) return resolveTemplate(raw, ctx);
  }
  return '';
}

function log(
  node: WFNode,
  level: NodeExecutorResult['logs'][0]['level'],
  message: string,
  start: number,
  data?: Record<string, unknown>,
): NodeExecutorResult['logs'][0] {
  return {
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message,
    level,
    duration: Date.now() - start,
    data,
  };
}

async function runPlatformAction(
  node: WFNode,
  ctx: ExecutionContext,
  module: 'grc' | 'uctc' | 'phishing',
  defaultAction: string,
): Promise<NodeExecutorResult> {
  const start = Date.now();
  const logs: NodeExecutorResult['logs'] = [];

  if (!isPlatformOutboundConfigured()) {
    logs.push(log(node, 'error', 'LUMISEC_PLATFORM_URL not configured', start));
    return { success: false, logs };
  }

  const action = cfgStr(node, ctx, 'action') || defaultAction;
  const body: Record<string, unknown> = {
    incidentId: cfgStr(node, ctx, 'incident_id', 'incidentId') || String(ctx.trigger.incident_id || ctx.trigger.incidentId || ''),
    title: cfgStr(node, ctx, 'title') || String(ctx.trigger.title || ''),
    description: cfgStr(node, ctx, 'description') || String(ctx.trigger.description || ''),
    severity: cfgStr(node, ctx, 'severity') || String(ctx.trigger.severity || 'medium'),
    asset: cfgStr(node, ctx, 'asset', 'ip', 'hostname'),
    name: cfgStr(node, ctx, 'name'),
    yaml: cfgStr(node, ctx, 'yaml', 'sigma_yaml'),
    ruleId: cfgStr(node, ctx, 'rule_id', 'ruleId'),
    templateId: cfgStr(node, ctx, 'template_id', 'templateId'),
    landingPageId: cfgStr(node, ctx, 'landing_page_id', 'landingPageId'),
    autoLaunch: node.data.config?.auto_launch === true || node.data.config?.autoLaunch === true,
  };

  logs.push(log(node, 'info', `Platform ${module}/${action}…`, start));
  const result = await callPlatformOutbound(module, action, body);
  if (!result.ok) {
    logs.push(log(node, 'error', result.message, start, { status: result.status, route: result.route }));
    return { success: false, logs, output: { error: result.message, status: result.status } };
  }

  logs.push(log(node, 'success', result.message, start, { data: result.data }));
  return { success: true, logs, output: (result.data as Record<string, unknown> | null) ?? {} };
}

export const lumisecGrcExecutor = buildCertifiedConnector({
  id: 'lumisec_grc',
  name: 'LumiSec GRC',
  version: '1.0.0',
  category: 'custom',
  description: 'Push SOAR incidents to GRC findings and risk register.',
  icon: 'ClipboardList',
  color: '#6366f1',
  vendor: 'LumiSec',
  config: [
    {
      key: 'action',
      label: 'Action',
      type: 'select',
      required: true,
      options: [
        { value: 'finding', label: 'Submit finding' },
        { value: 'risk', label: 'Submit risk' },
      ],
    },
    { key: 'incident_id', label: 'Incident ID', type: 'text', required: false, template: true },
    { key: 'title', label: 'Title', type: 'text', required: false, template: true },
    { key: 'description', label: 'Description', type: 'textarea', required: false, template: true },
    { key: 'severity', label: 'Severity', type: 'text', required: false, template: true },
    { key: 'asset', label: 'Asset / host', type: 'text', required: false, template: true },
  ],
  credentials: [],
}, (node, ctx) => runPlatformAction(node, ctx, 'grc', 'finding'));

export const lumisecUctcExecutor = buildCertifiedConnector({
  id: 'lumisec_uctc',
  name: 'LumiSec UCTC',
  version: '1.0.0',
  category: 'custom',
  description: 'Deploy Sigma rules and trigger UCTC workflows from SOAR.',
  icon: 'Code',
  color: '#0ea5e9',
  vendor: 'LumiSec',
  config: [
    {
      key: 'action',
      label: 'Action',
      type: 'select',
      required: true,
      options: [
        { value: 'rule', label: 'Create / deploy rule' },
        { value: 'rule-trigger', label: 'Trigger rule deploy' },
      ],
    },
    { key: 'incident_id', label: 'Incident ID', type: 'text', required: false, template: true },
    { key: 'rule_id', label: 'Rule ID (deploy existing)', type: 'text', required: false, template: true },
    { key: 'name', label: 'Rule name', type: 'text', required: false, template: true },
    { key: 'yaml', label: 'Sigma YAML', type: 'textarea', required: false, template: true },
  ],
  credentials: [],
}, (node, ctx) => runPlatformAction(node, ctx, 'uctc', 'rule'));

export const lumisecPhishingExecutor = buildCertifiedConnector({
  id: 'lumisec_phishing',
  name: 'LumiSec Phishing',
  version: '1.0.0',
  category: 'custom',
  description: 'Create phishing simulation campaigns linked to incidents.',
  icon: 'Mail',
  color: '#f59e0b',
  vendor: 'LumiSec',
  config: [
    { key: 'action', label: 'Action', type: 'select', required: true, options: [{ value: 'campaign', label: 'Create campaign' }] },
    { key: 'incident_id', label: 'Incident ID', type: 'text', required: false, template: true },
    { key: 'name', label: 'Campaign name', type: 'text', required: false, template: true },
    { key: 'template_id', label: 'Template ID', type: 'text', required: false, template: true },
    { key: 'landing_page_id', label: 'Landing page ID', type: 'text', required: false, template: true },
    { key: 'auto_launch', label: 'Auto launch', type: 'boolean', required: false },
  ],
  credentials: [],
}, (node, ctx) => runPlatformAction(node, ctx, 'phishing', 'campaign'));

async function executeLuminet(
  node: WFNode,
  ctx: ExecutionContext,
): Promise<NodeExecutorResult> {
  const start = Date.now();
  const logs: NodeExecutorResult['logs'] = [];
  if (!isPlatformOutboundConfigured()) {
    logs.push(log(node, 'error', 'LUMISEC_PLATFORM_URL not configured', start));
    return { success: false, logs };
  }

  const assetKey =
    cfgStr(node, ctx, 'asset', 'ip', 'hostname', 'host') ||
    String(ctx.trigger.ip || ctx.trigger.hostname || ctx.trigger.host || '');
  if (!assetKey) {
    logs.push(log(node, 'error', 'Asset IP or hostname required', start));
    return { success: false, logs };
  }

  logs.push(log(node, 'info', `LumiNet context lookup: ${assetKey}`, start));
  const result = await platformFetch<Record<string, unknown>>(
    `/api/luminet/assets/context/${encodeURIComponent(assetKey)}`,
    { audit: { module: 'luminet', action: 'context' } },
  );
  if (!result.ok) {
    logs.push(log(node, 'error', result.message, start));
    return { success: false, logs };
  }

  logs.push(log(node, 'success', 'Asset context retrieved', start, { asset: assetKey }));
  return { success: true, logs, output: (result.data as Record<string, unknown> | null) ?? {} };
}

export const lumisecNetworkExecutor = buildCertifiedConnector({
  id: 'lumisec_network',
  name: 'LumiSec LumiNet',
  version: '1.0.0',
  category: 'custom',
  description: 'Fetch network asset context for incident enrichment.',
  icon: 'Network',
  color: '#10b981',
  vendor: 'LumiSec',
  config: [
    { key: 'asset', label: 'Asset (IP or hostname)', type: 'text', required: false, template: true, placeholder: '{{trigger.ip}}' },
  ],
  credentials: [],
}, executeLuminet);

export const lumisecPlatformExecutors = [
  lumisecGrcExecutor,
  lumisecUctcExecutor,
  lumisecPhishingExecutor,
  lumisecNetworkExecutor,
];
