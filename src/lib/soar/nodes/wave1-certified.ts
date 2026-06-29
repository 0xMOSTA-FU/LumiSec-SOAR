/**
 * Wave 1 connectors — full manifests (replaces legacy-bridge wrapLegacyExecutor).
 */
import type { NodeCategory } from './manifest';
import type { NodeExecutor } from './registry';
import { buildCertifiedConnector } from './build-connector';
import type { NodeExecutorResult, WFNode, ExecutionContext } from '@/lib/executors/types';
import { executeAbuseIPDB } from '@/lib/executors/nodes/abuseipdb';
import { executeIPInfo } from '@/lib/executors/nodes/ipinfo';
import { executeOTX } from '@/lib/executors/nodes/alienvault-otx';
import { executeMISP } from '@/lib/executors/nodes/misp';
import { executeOpenCTI } from '@/lib/executors/nodes/opencti';
import { executeSplunk } from '@/lib/executors/nodes/splunk';
import { executeWazuh } from '@/lib/executors/nodes/wazuh';
import { executeJira } from '@/lib/executors/nodes/jira';
import { executeServiceNow } from '@/lib/executors/nodes/servicenow';
import { executePagerDuty } from '@/lib/executors/nodes/pagerduty';
import { executeTheHive } from '@/lib/executors/nodes/thehive';
import { executeDefectDojo } from '@/lib/executors/nodes/defectdojo';
import { executeMSGraph } from '@/lib/executors/nodes/msgraph';
import { executeDigitalOcean } from '@/lib/executors/nodes/digitalocean';
import { executeVelociraptor } from '@/lib/executors/nodes/velociraptor';
import { executeSlack } from '@/lib/executors/nodes/slack';
import { executeHTTP } from '@/lib/executors/nodes/http';
import { executeWebhook } from '@/lib/executors/nodes/webhook';
import { executeCondition } from '@/lib/executors/nodes/condition';
import { executeSoarUtils } from '@/lib/executors/nodes/soar-utils';
import { executeCreateCase } from '@/lib/executors/nodes/case-alert';
import { executeTrigger, executeLog, executeBlock, executeIsolate } from '@/lib/executors/nodes/builtin';

type ExecFn = (node: WFNode, ctx: ExecutionContext) => Promise<NodeExecutorResult>;

interface Wave1Spec {
  id: string;
  name: string;
  category: NodeCategory;
  description: string;
  vendor: string;
  docsUrl: string;
  vendorUrl?: string;
  allowedHosts?: string[];
  execute: ExecFn;
  requiresApproval?: boolean;
  version?: string;
}

function wave1(spec: Wave1Spec): NodeExecutor {
  return buildCertifiedConnector({
    id: spec.id,
    name: spec.name,
    version: spec.version || '2.0.0',
    category: spec.category,
    description: spec.description,
    icon: 'Circle',
    color: '#22c55e',
    vendor: spec.vendor,
    vendorUrl: spec.vendorUrl,
    docsUrl: spec.docsUrl,
    allowedHosts: spec.allowedHosts || [],
    requiresApproval: spec.requiresApproval,
    config: [],
    credentials: [],
  }, spec.execute);
}

export const wave1CertifiedExecutors: NodeExecutor[] = [
  wave1({ id: 'abuseipdb', name: 'AbuseIPDB', category: 'threat_intel', vendor: 'AbuseIPDB', docsUrl: 'https://docs.abuseipdb.com/', allowedHosts: ['api.abuseipdb.com'], description: 'Query AbuseIPDB for IP reputation and abuse confidence scores (free tier available).', execute: executeAbuseIPDB }),
  wave1({ id: 'ipinfo', name: 'IPInfo', category: 'threat_intel', vendor: 'IPInfo', docsUrl: 'https://ipinfo.io/developers', allowedHosts: ['ipinfo.io'], description: 'IP geolocation and ASN enrichment via IPInfo.io (works without API key at reduced rate).', execute: executeIPInfo }),
  wave1({ id: 'otx', name: 'AlienVault OTX', category: 'threat_intel', vendor: 'AlienVault', docsUrl: 'https://otx.alienvault.com/api', allowedHosts: ['otx.alienvault.com'], description: 'Open Threat Exchange pulses and IOC lookup (free community API).', execute: executeOTX }),
  wave1({ id: 'misp', name: 'MISP', category: 'threat_intel', vendor: 'MISP Project', vendorUrl: 'https://www.misp-project.org/', docsUrl: 'https://www.misp-project.org/openapi/', description: 'Self-hosted MISP threat sharing: search and add attributes.', execute: executeMISP }),
  wave1({ id: 'opencti', name: 'OpenCTI', category: 'threat_intel', vendor: 'Filigran', vendorUrl: 'https://filigran.io/', docsUrl: 'https://docs.opencti.io/', description: 'OpenCTI GraphQL: indicators, observables, cases, and search.', execute: executeOpenCTI }),
  wave1({ id: 'wazuh', name: 'Wazuh', category: 'siem', vendor: 'Wazuh', vendorUrl: 'https://wazuh.com/', docsUrl: 'https://documentation.wazuh.com/', description: 'Open-source Wazuh SIEM/XDR manager API for agents, alerts, and syscheck.', execute: executeWazuh }),
  wave1({ id: 'splunk', name: 'Splunk', category: 'siem', vendor: 'Splunk', docsUrl: 'https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTsearch', description: 'Splunk Enterprise REST API for SPL searches and saved searches.', execute: executeSplunk }),
  wave1({ id: 'jira', name: 'Jira', category: 'ticketing', vendor: 'Atlassian', docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/', description: 'Jira Cloud REST API for issues, comments, and JQL search.', execute: executeJira }),
  wave1({ id: 'servicenow', name: 'ServiceNow', category: 'ticketing', vendor: 'ServiceNow', docsUrl: 'https://developer.servicenow.com/dev.do#!/reference/api/utah/rest/c_TableAPI', description: 'ServiceNow Table API for incidents, CMDB, and custom tables.', execute: executeServiceNow }),
  wave1({ id: 'pagerduty', name: 'PagerDuty', category: 'ticketing', vendor: 'PagerDuty', docsUrl: 'https://developer.pagerduty.com/docs/', description: 'PagerDuty Events API v2 for incident lifecycle.', execute: executePagerDuty }),
  wave1({ id: 'thehive', name: 'TheHive', category: 'case_management', vendor: 'StrangeBee', vendorUrl: 'https://strangebee.com/', docsUrl: 'https://docs.strangebee.com/', description: 'Open-source TheHive case and observable management API.', execute: executeTheHive }),
  wave1({ id: 'defectdojo', name: 'DefectDojo', category: 'case_management', vendor: 'DefectDojo', vendorUrl: 'https://www.defectdojo.org/', docsUrl: 'https://defectdojo.github.io/', description: 'Open-source DefectDojo findings and engagements API.', execute: executeDefectDojo }),
  wave1({ id: 'msgraph', name: 'Microsoft Graph', category: 'cloud_iam', vendor: 'Microsoft', docsUrl: 'https://learn.microsoft.com/en-us/graph/api/overview', allowedHosts: ['graph.microsoft.com', 'login.microsoftonline.com'], description: 'Microsoft Graph API for users, security alerts, sign-ins, and mail.', execute: executeMSGraph }),
  wave1({ id: 'digitalocean', name: 'DigitalOcean', category: 'cloud_iam', vendor: 'DigitalOcean', docsUrl: 'https://docs.digitalocean.com/reference/api/', allowedHosts: ['api.digitalocean.com'], description: 'DigitalOcean API v2 for droplets and cloud firewall rules.', execute: executeDigitalOcean }),
  wave1({ id: 'velociraptor', name: 'Velociraptor', category: 'edr', vendor: 'Velocidex', vendorUrl: 'https://velociraptor.ai/', docsUrl: 'https://docs.velociraptor.app/', description: 'Open-source Velociraptor DFIR: hunts, clients, and VQL.', execute: executeVelociraptor }),
  wave1({ id: 'slack', name: 'Slack', category: 'communication', vendor: 'Slack', docsUrl: 'https://api.slack.com/messaging/webhooks', allowedHosts: ['hooks.slack.com', 'slack.com'], description: 'Post messages via Slack incoming webhook.', execute: executeSlack }),
  wave1({ id: 'http', name: 'HTTP Request', category: 'utility', vendor: 'CyberSOAR', docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP', description: 'Generic HTTP with SSRF guard (safeFetch + allowlist).', execute: executeHTTP }),
  wave1({ id: 'webhook', name: 'Outbound Webhook', category: 'utility', vendor: 'CyberSOAR', docsUrl: 'https://en.wikipedia.org/wiki/Webhook', description: 'POST JSON payload to external webhook URLs.', execute: executeWebhook }),
  wave1({ id: 'condition', name: 'Condition', category: 'logic', vendor: 'Builtin', docsUrl: 'https://github.com/LumiSec-SOAR', description: 'Branch workflow based on field comparisons.', execute: executeCondition }),
  wave1({ id: 'soar_utils', name: 'SOAR Utilities', category: 'utility', vendor: 'CyberSOAR', docsUrl: 'https://github.com/LumiSec-SOAR', description: 'Delay, JSON parse, transform, and variable utilities.', execute: executeSoarUtils }),
  wave1({ id: 'create_case', name: 'Create Case', category: 'case_management', vendor: 'CyberSOAR', docsUrl: 'https://github.com/LumiSec-SOAR', description: 'Create a SOAR case record in the platform database.', execute: executeCreateCase }),
  wave1({ id: 'block', name: 'Block IP', category: 'firewall', vendor: 'CyberSOAR', docsUrl: 'https://github.com/LumiSec-SOAR', description: 'Block IP via connected FortiGate, OPNsense, or pfSense integration.', requiresApproval: true, execute: executeBlock }),
  wave1({ id: 'isolate', name: 'Isolate Host', category: 'edr', vendor: 'CyberSOAR', docsUrl: 'https://github.com/LumiSec-SOAR', description: 'Isolate endpoint via connected EDR integration.', requiresApproval: true, execute: executeIsolate }),
  wave1({ id: 'log', name: 'Log Output', category: 'output', vendor: 'Builtin', docsUrl: 'https://github.com/LumiSec-SOAR', description: 'Write a message to the execution log.', execute: executeLog }),
  wave1({ id: 'trigger', name: 'Trigger', category: 'trigger', vendor: 'Builtin', docsUrl: 'https://github.com/LumiSec-SOAR', description: 'Workflow trigger node (manual, webhook, schedule, alert).', execute: executeTrigger }),
];
