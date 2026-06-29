// OpenCTI executor — indicators, observables, cases via GraphQL
// Docs: https://docs.opencti.io/latest/usage/

import { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext, resolveTemplate } from '../types';

function getCreds(integration: IntegrationConfig | null) {
  const c = integration?.config || {};
  const url = (c.url as string) || (c.host as string) || '';
  const api_key = (c.api_key as string) || (c.token as string) || '';
  return { url: url.replace(/\/$/, ''), api_key };
}

export async function callOpenCTI(
  integration: IntegrationConfig | null,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
  const start = Date.now();
  const creds = getCreds(integration);
  if (!creds.url || !creds.api_key) return { ok: false, status: 401, data: { error: 'OpenCTI url+api_key required' }, durationMs: 0 };
  if (integration?.status !== 'connected') return { ok: false, status: 503, data: { error: 'OpenCTI not connected' }, durationMs: 0 };

  try {
    const res = await fetch(`${creds.url}/graphql`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    const gqlErrors = (data as { errors?: unknown[] })?.errors;
    return { ok: res.ok && !gqlErrors?.length, status: res.status, data, durationMs: Date.now() - start };
  } catch (err: unknown) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : String(err) }, durationMs: Date.now() - start };
  }
}

function gqlError(data: unknown): string {
  const d = data as { errors?: { message: string }[] };
  return d.errors?.[0]?.message || 'GraphQL error';
}

function stixPatternForObservable(type: string, value: string): string {
  const map: Record<string, string> = {
    'IPv4-Addr': 'ipv4-addr',
    'IPv6-Addr': 'ipv6-addr',
    'Domain-Name': 'domain-name',
    'Hostname': 'domain-name',
    'Url': 'url',
    'File': 'file',
    'Email-Addr': 'email-addr',
  };
  const stixType = map[type] || 'ipv4-addr';
  if (stixType === 'file' && value.length === 64) {
    return `[file:hashes.'SHA-256' = '${value}']`;
  }
  if (stixType === 'file' && value.length === 32) {
    return `[file:hashes.MD5 = '${value}']`;
  }
  return `[${stixType}:value = '${value.replace(/'/g, "\\'")}']`;
}

export async function executeOpenCTI(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'create_indicator';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('opencti');

  if (action === 'create_indicator') {
    const pattern = resolveTemplate((cfg.pattern as string) || '', ctx);
    const name = resolveTemplate((cfg.name as string) || pattern, ctx);
    const pattern_type = (cfg.pattern_type as string) || 'stix';
    const x_opencti_main_observable_type = (cfg.observable_type as string) || 'IPv4-Addr';
    if (!pattern) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'OpenCTI: pattern required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI: creating indicator "${name}"...`, level: 'info' });

    const query = `mutation CreateIndicator($input: IndicatorAddInput!) { indicatorAdd(input: $input) { id standard_id } }`;
    const result = await callOpenCTI(integration, query, {
      input: { name, pattern, pattern_type, x_opencti_main_observable_type, valid_from: new Date().toISOString() },
    });
    if (!result.ok) {
      const err = gqlError(result.data);
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI error: ${err}`, level: 'error', duration: result.durationMs, data: result.data });
      return { success: false, output: { opencti: { ok: false, error: err } }, logs };
    }
    const ind = (result.data as { data: { indicatorAdd: { id: string; standard_id: string } } }).data.indicatorAdd;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI: indicator created (id=${ind.id})`, level: 'success', duration: result.durationMs });
    return { success: true, output: { opencti: { ok: true, action, indicator_id: ind.id, standard_id: ind.standard_id } }, logs };
  }

  if (action === 'create_observable') {
    const observableType = (cfg.observable_type as string) || 'IPv4-Addr';
    const value = resolveTemplate((cfg.value as string) || (cfg.ioc_value as string) || '', ctx);
    const labels = resolveTemplate((cfg.labels as string) || '', ctx).split(',').map(s => s.trim()).filter(Boolean);
    if (!value) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'OpenCTI: value required for observable', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const query = `mutation ObservableAdd($input: StixCyberObservableAddInput!) { stixCyberObservableAdd(input: $input) { id standard_id entity_type } }`;
    const result = await callOpenCTI(integration, query, {
      input: {
        type: observableType,
        value,
        ...(labels.length ? { objectLabel: labels } : {}),
      },
    });
    if (!result.ok) {
      const err = gqlError(result.data);
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI observable error: ${err}`, level: 'error', duration: result.durationMs });
      return { success: false, output: { opencti: { ok: false, error: err } }, logs };
    }
    const obs = (result.data as { data: { stixCyberObservableAdd: { id: string; standard_id: string; entity_type: string } } }).data.stixCyberObservableAdd;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI: observable created (${obs.entity_type})`, level: 'success', duration: result.durationMs });
    return { success: true, output: { opencti: { ok: true, action, observable_id: obs.id, standard_id: obs.standard_id, value } }, logs };
  }

  if (action === 'create_case') {
    const name = resolveTemplate((cfg.name as string) || (cfg.title as string) || 'SOAR Incident', ctx);
    const description = resolveTemplate((cfg.description as string) || '', ctx);
    const severity = (cfg.severity as string) || 'medium';
    const query = `mutation CaseAdd($input: CaseIncidentAddInput!) { caseIncidentAdd(input: $input) { id name } }`;
    const result = await callOpenCTI(integration, query, {
      input: { name, description, severity, createdBy: 'SOAR' },
    });
    if (!result.ok) {
      const err = gqlError(result.data);
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI case error: ${err}`, level: 'error', duration: result.durationMs });
      return { success: false, output: { opencti: { ok: false, error: err } }, logs };
    }
    const c = (result.data as { data: { caseIncidentAdd: { id: string; name: string } } }).data.caseIncidentAdd;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI: case created (${c.name})`, level: 'success', duration: result.durationMs });
    return { success: true, output: { opencti: { ok: true, action, case_id: c.id, name: c.name } }, logs };
  }

  if (action === 'search' || action === 'search_indicators') {
    const search_value = resolveTemplate((cfg.search as string) || (cfg.value as string) || (cfg.pattern as string) || '', ctx);
    if (!search_value) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'OpenCTI: search value required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const query = `query Search($search: String) { indicators(search: $search) { edges { node { id name pattern } } } }`;
    const result = await callOpenCTI(integration, query, { search: search_value });
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI search error: ${gqlError(result.data)}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    const edges = (result.data as { data: { indicators: { edges: { node: { id: string; name: string; pattern: string } }[] } } }).data.indicators.edges;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI: ${edges?.length || 0} indicators found`, level: 'success', duration: result.durationMs });
    return { success: true, output: { opencti: { ok: true, action, count: edges?.length, indicators: edges?.slice(0, 10) } }, logs };
  }

  if (action === 'search_observables') {
    const search_value = resolveTemplate((cfg.search as string) || (cfg.value as string) || '', ctx);
    if (!search_value) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'OpenCTI: search value required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const query = `query ObsSearch($search: String) { stixCyberObservables(search: $search) { edges { node { id entity_type observable_value } } } }`;
    const result = await callOpenCTI(integration, query, { search: search_value });
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI observable search error: ${gqlError(result.data)}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    const edges = (result.data as { data: { stixCyberObservables: { edges: { node: { id: string; entity_type: string; observable_value: string } }[] } } }).data.stixCyberObservables.edges;
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI: ${edges?.length || 0} observables found`, level: 'success', duration: result.durationMs });
    return { success: true, output: { opencti: { ok: true, action, count: edges?.length, observables: edges?.slice(0, 10) } }, logs };
  }

  if (action === 'create_indicator_from_value') {
    const observableType = (cfg.observable_type as string) || 'IPv4-Addr';
    const value = resolveTemplate((cfg.value as string) || (cfg.ioc_value as string) || '', ctx);
    const name = resolveTemplate((cfg.name as string) || value, ctx);
    if (!value) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'OpenCTI: value required', level: 'error', duration: Date.now() - start });
      return { success: false, logs };
    }
    const pattern = stixPatternForObservable(observableType, value);
    const query = `mutation CreateIndicator($input: IndicatorAddInput!) { indicatorAdd(input: $input) { id standard_id } }`;
    const result = await callOpenCTI(integration, query, {
      input: { name, pattern, pattern_type: 'stix', x_opencti_main_observable_type: observableType, valid_from: new Date().toISOString() },
    });
    if (!result.ok) {
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI error: ${gqlError(result.data)}`, level: 'error', duration: result.durationMs });
      return { success: false, logs };
    }
    const ind = (result.data as { data: { indicatorAdd: { id: string; standard_id: string } } }).data.indicatorAdd;
    return { success: true, output: { opencti: { ok: true, action, indicator_id: ind.id, pattern, value } }, logs };
  }

  logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `OpenCTI: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
  return { success: false, logs };
}
