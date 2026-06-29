// Trigger + Log + Block/IP-Isolate executors

import { NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

export async function executeTrigger(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const subtype = node.subtype || 'manual';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  let triggerMsg = `Trigger fired: ${subtype}`;
  if (subtype === 'webhook') {
    const path = (cfg.path as string) || '/webhook';
    triggerMsg = `Webhook trigger fired on ${path} (body keys: ${Object.keys(ctx.trigger).join(', ') || 'none'})`;
  } else if (subtype === 'schedule') {
    triggerMsg = `Schedule trigger fired (interval: ${cfg.interval || 'on-demand'})`;
  } else if (subtype === 'alert') {
    triggerMsg = `Alert trigger fired (severity: ${cfg.severity || 'any'}, source: ${cfg.source || 'any'})`;
  } else if (subtype === 'manual') {
    triggerMsg = `Manual trigger fired by user`;
  }

  logs.push({
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: triggerMsg,
    level: 'info',
    duration: Date.now() - start,
    data: ctx.trigger,
  });

  return {
    success: true,
    output: { trigger: ctx.trigger },
    logs,
  };
}

export async function executeLog(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  let message = (cfg.message as string) || '';
  const level = (cfg.level as string) || 'info';
  message = resolveTemplate(message, ctx);

  const logs: NodeExecutorResult['logs'] = [{
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: `LOG: ${message}`,
    level: level as 'info' | 'success' | 'warning' | 'error',
    duration: 0,
  }];

  return { success: true, output: { log: { message, level } }, logs };
}

export async function executeBlock(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  let target = (cfg.target as string) || (cfg.ip as string) || (cfg.domain as string) || '';
  const type = (cfg.type as string) || 'ip';
  target = resolveTemplate(target, ctx);

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (!target) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Block: no target specified', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const candidates = [
    { key: 'fortigate', executor: async () => {
      const { executeFortiGate } = await import('./fortigate');
      return executeFortiGate({
        ...node,
        subtype: 'fortigate',
        data: { ...node.data, config: { ...cfg, action: 'block_ip', ip: target } },
      }, ctx);
    }},
    { key: 'opnsense', executor: async () => {
      const { executeOPNsense } = await import('./opnsense');
      return executeOPNsense({
        ...node,
        subtype: 'opnsense',
        data: { ...node.data, config: { ...cfg, action: 'block_ip', ip: target } },
      }, ctx);
    }},
    { key: 'pfsense', executor: async () => {
      const { executePfSense } = await import('./pfsense');
      return executePfSense({
        ...node,
        subtype: 'pfsense',
        data: { ...node.data, config: { ...cfg, action: 'block_ip', ip: target } },
      }, ctx);
    }},
  ];

  for (const c of candidates) {
    const integ = ctx.getIntegration(c.key);
    if (integ && integ.status === 'connected') {
      const result = await c.executor();
      result.logs = result.logs.map(l => ({
        ...l,
        message: l.message.replace(/^.*(Block|block_ip).*:/i, `Block ${type} "${target}" via ${c.key}:`),
      }));
      return result;
    }
  }

  logs.push({
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: `Block failed: no connected firewall integration (FortiGate, OPNsense, or pfSense)`,
    level: 'error',
    duration: Date.now() - start,
  });
  return { success: false, logs, output: { block: { target, type, error: 'NO_FIREWALL_CONNECTED' } } };
}

export async function executeIsolate(
  node: WFNode,
  ctx: ExecutionContext
): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  let hostname = (cfg.hostname as string) || (cfg.host as string) || (cfg.target as string) || '';
  const deviceIdCfg = resolveTemplate(String(cfg.device_id || ''), ctx);
  hostname = resolveTemplate(hostname, ctx);

  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();

  if (!hostname && !deviceIdCfg) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'Isolate: hostname or device_id required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const csInteg = ctx.getIntegration('crowdstrike') || ctx.getIntegration('falcon') || ctx.getIntegration('cs');
  if (csInteg?.status === 'connected') {
    const { executeCrowdStrike } = await import('./crowdstrike');
    let deviceId = deviceIdCfg;
    if (!deviceId && hostname) {
      const escaped = hostname.replace(/'/g, "\\'");
      const list = await executeCrowdStrike({
        ...node,
        subtype: 'crowdstrike',
        data: { ...node.data, config: { action: 'list_hosts', filter: `hostname:'${escaped}'` } },
      }, ctx);
      const ids = (list.output as { crowdstrike?: { device_ids?: string[] } })?.crowdstrike?.device_ids;
      deviceId = ids?.[0] || '';
    }
    if (!deviceId) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `Isolate: no CrowdStrike device found for "${hostname}"`, level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    return executeCrowdStrike({
      ...node,
      subtype: 'crowdstrike',
      data: { ...node.data, config: { action: 'contain_host', device_id: deviceId } },
    }, ctx);
  }

  const integration = ctx.getIntegration('edr') || ctx.getIntegration('defender');
  if (integration?.status === 'connected') {
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `Isolate: EDR "${integration.type}" connected but use vendor-specific node (CrowdStrike supported).`,
      level: 'error',
      duration: Date.now() - start,
      data: { hostname, edr: integration.type },
    });
    return { success: false, logs };
  }

  logs.push({
    time: new Date().toISOString(),
    nodeId: node.id,
    nodeLabel: node.data.label,
    message: 'Isolate failed: connect CrowdStrike Falcon on Integrations page.',
    level: 'error',
    duration: Date.now() - start,
    data: { hostname },
  });

  return { success: false, logs };
}
