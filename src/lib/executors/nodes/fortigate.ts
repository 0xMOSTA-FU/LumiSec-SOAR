/* eslint-disable @typescript-eslint/no-unused-vars */
// Real FortiGate executor - block/unblock IPs and domains via FortiOS REST API
// Docs: https://docs.fortinet.com/document/fortios/7.4.0/rest-api-reference

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const host = (c.host as string) || (c.url as string) || '';
  const port = (c.port as number) || 443;
  const api_key = (c.api_key as string) || (c.token as string) || '';
  const vdom = (c.vdom as string) || 'root';
  return { host: host.replace(/^https?:\/\//, ''), port, api_key, vdom };
}

export async function callFortiGate(
  integration: IntegrationConfig | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const creds = getCreds(integration);
  if (!creds.host || !creds.api_key) return { ok: false, status: 401, data: { error: 'FortiGate host+api_key required' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'FortiGate not connected' }, durationMs: 0 };

  try {
    const url = `https://${creds.host}:${creds.port}/api/v2/${path.replace(/^\//, '')}`;
    const res = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${creds.api_key}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

export async function executeFortiGate(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'block_ip';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('fortigate') || ctx.getIntegration('fortios');

  if (action === 'block_ip') {
    const ip = resolveTemplate((cfg.ip as string) || (cfg.target as string) || '', ctx);
    const addrgrp = (cfg.address_group as string) || 'SOAR-BlockList';
    if (!ip) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'FortiGate: ip required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `FortiGate: blocking ${ip}...`, level: 'info' });

    // 1. Create address object for the IP
    const createRes = await callFortiGate(integration, 'POST', 'cmdb/firewall/address', {
      name: `SOAR-BL-${ip.replace(/\./g, '-')}`,
      type: 'ipmask',
      subnet: `${ip} 255.255.255.255`,
      comment: `Blocked by SOAR workflow`,
    });
    if (!createRes.ok && createRes.status !== 424) { // 424 = already exists
      const err = (createRes.data as { error?: string })?.error || `HTTP ${createRes.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `FortiGate error: ${err}`, level: 'error', duration: createRes.durationMs, data: createRes.data });
      return { success: false, output: { fortigate: { ok: false, error: err } }, logs };
    }

    // 2. Add to address group
    const addrName = `SOAR-BL-${ip.replace(/\./g, '-')}`;
    const grpRes = await callFortiGate(integration, 'GET', `cmdb/firewall/addrgrp/${encodeURIComponent(addrgrp)}`);
    let grpOk = true;
    if (grpRes.status === 404) {
      // Create group
      const newGrp = await callFortiGate(integration, 'POST', 'cmdb/firewall/addrgrp', {
        name: addrgrp, type: 'address', member: [{ name: addrName }],
      });
      grpOk = newGrp.ok;
    } else if (grpRes.ok) {
      // Add to existing group
      const grp = (grpRes.data as { results?: { member?: { name: string }[] }[] }).results?.[0];
      const members = grp?.member || [];
      if (!members.find(m => m.name === addrName)) {
        members.push({ name: addrName });
        const upd = await callFortiGate(integration, 'PUT', `cmdb/firewall/addrgrp/${encodeURIComponent(addrgrp)}`, { member: members });
        grpOk = upd.ok;
      }
    }
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `FortiGate: ${ip} blocked via address-group "${addrgrp}"`,
      level: 'success',
      duration: Date.now() - start,
      data: { ip, addrgrp },
    });
    return { success: true, output: { fortigate: { ok: true, ip, address_group: addrgrp, address_object: addrName } }, logs };
  }

  if (action === 'block_domain') {
    const domain = resolveTemplate(
      (cfg.domain as string) || (cfg.target as string) || '',
      ctx,
    );
    const addrgrp = (cfg.address_group as string) || 'SOAR-BlockList';
    if (!domain) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'FortiGate: domain required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const safeName = domain.replace(/[^a-zA-Z0-9.-]/g, '-').replace(/\./g, '-');
    const addrName = `SOAR-BL-${safeName}`;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `FortiGate: blocking domain ${domain}...`, level: 'info' });

    const createRes = await callFortiGate(integration, 'POST', 'cmdb/firewall/address', {
      name: addrName,
      type: 'fqdn',
      fqdn: domain,
      comment: 'Blocked by SOAR workflow',
    });
    if (!createRes.ok && createRes.status !== 424) {
      const err = (createRes.data as { error?: string })?.error || `HTTP ${createRes.status}`;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `FortiGate error: ${err}`, level: 'error', duration: createRes.durationMs, data: createRes.data });
      return { success: false, output: { fortigate: { ok: false, error: err } }, logs };
    }

    const grpRes = await callFortiGate(integration, 'GET', `cmdb/firewall/addrgrp/${encodeURIComponent(addrgrp)}`);
    if (grpRes.status === 404) {
      await callFortiGate(integration, 'POST', 'cmdb/firewall/addrgrp', {
        name: addrgrp, type: 'address', member: [{ name: addrName }],
      });
    } else if (grpRes.ok) {
      const grp = (grpRes.data as { results?: { member?: { name: string }[] }[] }).results?.[0];
      const members = grp?.member || [];
      if (!members.find(m => m.name === addrName)) {
        members.push({ name: addrName });
        await callFortiGate(integration, 'PUT', `cmdb/firewall/addrgrp/${encodeURIComponent(addrgrp)}`, { member: members });
      }
    }

    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `FortiGate: ${domain} blocked via address-group "${addrgrp}"`,
      level: 'success',
      duration: Date.now() - start,
      data: { domain, addrgrp },
    });
    return { success: true, output: { fortigate: { ok: true, domain, address_group: addrgrp, address_object: addrName } }, logs };
  }

  if (action === 'unblock_ip') {
    const ip = resolveTemplate((cfg.ip as string) || '', ctx);
    const addrName = `SOAR-BL-${ip.replace(/\./g, '-')}`;
    if (!ip) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'FortiGate: ip required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const res = await callFortiGate(integration, 'DELETE', `cmdb/firewall/address/${encodeURIComponent(addrName)}`);
    logs.push({
      time: new Date().toISOString(),
      nodeId: node.id,
      nodeLabel: node.data.label,
      message: `FortiGate: ${ip} unblocked (addr=${addrName})`,
      level: 'success',
      duration: Date.now() - start,
    });
    return { success: true, output: { fortigate: { ok: true, ip, unblocked: true } }, logs };
  }

  if (action === 'list_addresses') {
    const res = await callFortiGate(integration, 'GET', 'cmdb/firewall/address');
    const data = res.data as { results?: { name: string; type: string; subnet?: string }[] };
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `FortiGate: ${data.results?.length || 0} addresses`, level: 'success', duration: Date.now() - start });
    return { success: true, output: { fortigate: { ok: true, count: data.results?.length, addresses: data.results?.slice(0, 20) } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `FortiGate: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
