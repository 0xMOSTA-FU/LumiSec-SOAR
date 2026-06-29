/**
 * AWS Security Hub executor
 * Docs: https://docs.aws.amazon.com/securityhub/latest/APIReference/
 */
import {
  SecurityHubClient,
  GetFindingsCommand,
  BatchUpdateFindingsCommand,
  DescribeHubCommand,
  GetEnabledStandardsCommand,
} from '@aws-sdk/client-securityhub';
import type { IntegrationConfig, NodeExecutorResult, WFNode, ExecutionContext } from '../types';
import { resolveTemplate } from '../types';

export interface AwsCreds {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export function parseAwsCreds(integration: IntegrationConfig | null): AwsCreds | null {
  const c = integration?.config || {};
  const accessKeyId = String(c.access_key_id || c.accessKeyId || c.aws_access_key_id || '');
  const secretAccessKey = String(c.secret_access_key || c.secretAccessKey || c.aws_secret_access_key || '');
  const region = String(c.region || 'us-east-1');
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, region };
}

export function parseAwsCredsFromConfig(config: Record<string, unknown>): AwsCreds | null {
  return parseAwsCreds({
    id: 'test',
    name: 'aws',
    type: 'aws_securityhub',
    category: 'cloud_iam',
    config,
    status: 'connected',
  });
}

function createSecurityHubClient(creds: AwsCreds): SecurityHubClient {
  return new SecurityHubClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
    },
  });
}

export async function testAwsSecurityHubConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean;
  message: string;
  durationMs?: number;
}> {
  const creds = parseAwsCredsFromConfig(config);
  if (!creds) return { ok: false, message: 'access_key_id and secret_access_key required' };
  const start = Date.now();
  try {
    const client = createSecurityHubClient(creds);
    await client.send(new DescribeHubCommand({}));
    return { ok: true, message: `AWS Security Hub connected (${creds.region})`, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

export async function executeAwsSecurityHub(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const cfg = node.data.config;
  const action = (cfg.action as string) || 'list_findings';
  const logs: NodeExecutorResult['logs'] = [];
  const start = Date.now();
  const integration = ctx.getIntegration('aws_securityhub')
    || ctx.getIntegration('securityhub')
    || ctx.getIntegration('aws_security_hub');

  if (integration?.status !== 'connected') {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'AWS Security Hub: not connected', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const creds = parseAwsCreds(integration);
  if (!creds) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'AWS: access_key_id + secret_access_key required', level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }

  const client = createSecurityHubClient(creds);

  try {
    if (action === 'list_findings') {
      const max = Number(cfg.max_results) || 50;
      const severity = resolveTemplate(String(cfg.severity || ''), ctx);
      const filters: Record<string, unknown> = {};
      if (severity) {
        filters.SeverityLabel = [{ Value: severity, Comparison: 'EQUALS' }];
      }
      const workflowStatus = resolveTemplate(String(cfg.workflow_status || ''), ctx);
      if (workflowStatus) {
        filters.WorkflowStatus = [{ Value: workflowStatus, Comparison: 'EQUALS' }];
      }
      const cmd = new GetFindingsCommand({
        MaxResults: Math.min(max, 100),
        ...(Object.keys(filters).length ? { Filters: filters } : {}),
      });
      const out = await client.send(cmd);
      const count = out.Findings?.length || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `AWS Security Hub: ${count} finding(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { aws_securityhub: { ok: true, action, count, findings: out.Findings?.slice(0, 20) } }, logs };
    }

    if (action === 'update_finding') {
      const findingId = resolveTemplate(String(cfg.finding_id || ''), ctx);
      const productArn = resolveTemplate(String(cfg.product_arn || ''), ctx);
      const note = resolveTemplate(String(cfg.note || 'Updated by LumiSec SOAR'), ctx);
      const workflowStatus = resolveTemplate(String(cfg.workflow_status || 'RESOLVED'), ctx);
      if (!findingId || !productArn) {
        logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'AWS Security Hub: finding_id and product_arn required', level: 'error', duration: Date.now() - start });
        return { success: false, logs };
      }
      await client.send(new BatchUpdateFindingsCommand({
        FindingIdentifiers: [{ Id: findingId, ProductArn: productArn }],
        Workflow: { Status: workflowStatus as 'NEW' | 'NOTIFIED' | 'RESOLVED' | 'SUPPRESSED' },
        Note: { Text: note, UpdatedBy: 'lumisec-soar' },
      }));
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `AWS Security Hub: updated ${findingId}`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { aws_securityhub: { ok: true, action, finding_id: findingId, workflow_status: workflowStatus } }, logs };
    }

    if (action === 'list_standards') {
      const out = await client.send(new GetEnabledStandardsCommand({}));
      const count = out.StandardsSubscriptions?.length || 0;
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `AWS Security Hub: ${count} enabled standard(s)`, level: 'success', duration: Date.now() - start });
      return { success: true, output: { aws_securityhub: { ok: true, action, count, standards: out.StandardsSubscriptions } }, logs };
    }

    if (action === 'describe_hub') {
      const out = await client.send(new DescribeHubCommand({}));
      logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: 'AWS Security Hub: hub described', level: 'success', duration: Date.now() - start });
      return { success: true, output: { aws_securityhub: { ok: true, action, hub: out } }, logs };
    }

    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `AWS Security Hub: unknown action "${action}"`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  } catch (err) {
    logs.push({ time: new Date().toISOString(), nodeId: node.id, nodeLabel: node.data.label, message: `AWS Security Hub error: ${err instanceof Error ? err.message : String(err)}`, level: 'error', duration: Date.now() - start });
    return { success: false, logs };
  }
}
