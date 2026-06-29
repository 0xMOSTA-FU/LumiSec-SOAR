'use client';

import React, { useState, useEffect } from 'react';
import { Settings, Activity, Zap, Save, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { soarFetch } from '@/lib/soar/fetch-json';

// ========== INTEGRATION CONFIG MODAL ==========
export function IntegrationConfigModal({ integrationId, onClose, onSaved }: { integrationId: string | null; onClose: () => void; onSaved: () => void }) {
  const [integration, setIntegration] = useState<any>(null);
  const [configForm, setConfigForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!integrationId) return;
    setLoading(true);
    soarFetch<Record<string, unknown>>(`/api/integrations/${integrationId}`)
      .then(r => {
        if (!r.ok || !r.data) throw new Error(r.error || 'Failed to load');
        return r.data;
      })
      .then(data => {
        setIntegration(data);
        const cfg = typeof data.config === 'object' && data.config !== null
          ? (data.config as Record<string, unknown>)
          : {};
        setConfigForm(Object.fromEntries(
          Object.entries(cfg).map(([k, v]) => [k, v == null ? '' : String(v)]),
        ));
      })
      .finally(() => setLoading(false));
  }, [integrationId]);

  if (!integrationId) return null;

  // Field schemas per integration type — used by both the config modal and the test endpoint
  // Each entry: { key, label, placeholder?, type? }
  const typeFields: Record<string, { key: string; label: string; placeholder?: string; type?: 'text' | 'password' }[]> = {
    virustotal: [{ key: 'api_key', label: 'VirusTotal API Key', placeholder: 'abcdef1234567890abcdef1234567890...', type: 'password' }],
    abuseipdb: [{ key: 'api_key', label: 'AbuseIPDB API Key', placeholder: 'abcdef1234567890...', type: 'password' }],
    ipinfo: [{ key: 'token', label: 'IPInfo Token (optional)', placeholder: 'abcdef12345...' }],
    slack: [
      { key: 'webhook', label: 'Slack Webhook URL', placeholder: 'https://hooks.slack.com/services/T.../B.../...' },
      { key: 'channel', label: 'Default Channel (optional)', placeholder: '#soc-alerts' },
    ],
    email: [
      { key: 'smtp_host', label: 'SMTP Host (or use service below)', placeholder: 'smtp.gmail.com' },
      { key: 'service', label: 'Service (gmail|outlook|ses|zoho, optional)', placeholder: 'gmail' },
      { key: 'port', label: 'Port', placeholder: '587' },
      { key: 'username', label: 'Username / email' },
      { key: 'password', label: 'Password / app password', type: 'password' },
      { key: 'from', label: 'From address (optional)', placeholder: 'soc@corp.com' },
      { key: 'test_to', label: 'Your email (for Save & Test)', placeholder: 'you@company.com' },
      { key: 'default_to', label: 'Default To (workflow fallback)', placeholder: 'soc@company.com' },
    ],
    telegram: [
      { key: 'bot_token', label: 'Bot token (from @BotFather)', type: 'password' },
      { key: 'chat_id', label: 'Default chat ID', placeholder: '-1001234567890 or @channel' },
    ],
    jira: [
      { key: 'host', label: 'Jira Host', placeholder: 'acme.atlassian.net' },
      { key: 'email', label: 'User Email', placeholder: 'you@acme.com' },
      { key: 'api_token', label: 'API Token', type: 'password' },
    ],
    pagerduty: [
      { key: 'api_key', label: 'API Key (Token)', type: 'password' },
      { key: 'routing_key', label: 'Integration Routing Key', type: 'password', placeholder: 'used by trigger action' },
      { key: 'email', label: 'Default From Email', placeholder: 'soc@corp.com' },
    ],
    servicenow: [
      { key: 'host', label: 'Instance Host', placeholder: 'acme.service-now.com' },
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password / API Token', type: 'password' },
    ],
    thehive: [
      { key: 'url', label: 'TheHive URL', placeholder: 'http://thehive.local:9000' },
      { key: 'api_key', label: 'API Key', type: 'password' },
    ],
    misp: [
      { key: 'url', label: 'MISP URL', placeholder: 'https://misp.corp.local' },
      { key: 'api_key', label: 'API Key', type: 'password' },
    ],
    opencti: [
      { key: 'url', label: 'OpenCTI URL', placeholder: 'https://opencti.corp.local' },
      { key: 'api_key', label: 'API Key', type: 'password' },
    ],
    wazuh: [
      { key: 'host', label: 'Manager Host', placeholder: 'wazuh.corp.local' },
      { key: 'port', label: 'API Port', placeholder: '55000' },
      { key: 'username', label: 'Username', placeholder: 'wazuh' },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    sentinel: [
      { key: 'tenant_id', label: 'Azure Tenant ID' },
      { key: 'client_id', label: 'App Client ID' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
      { key: 'subscription_id', label: 'Subscription ID' },
      { key: 'resource_group', label: 'Resource Group' },
      { key: 'workspace_name', label: 'Log Analytics Workspace Name' },
      { key: 'workspace_id', label: 'Workspace ID (for KQL)', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
    ],
    splunk: [
      { key: 'host', label: 'Splunk Host', placeholder: 'splunk.corp.local' },
      { key: 'port', label: 'MGMT Port', placeholder: '8089' },
      { key: 'username', label: 'Username' },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    elastic: [
      { key: 'url', label: 'Elastic URL', placeholder: 'https://elastic.corp.local:9200' },
      { key: 'username', label: 'Username (optional)' },
      { key: 'password', label: 'Password (optional)', type: 'password' },
      { key: 'api_key', label: 'API Key (optional, alternative to user/pass)', type: 'password' },
    ],
    msgraph: [
      { key: 'tenant_id', label: 'Azure Tenant ID' },
      { key: 'client_id', label: 'App Client ID' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
    ],
    entra_id: [
      { key: 'tenant_id', label: 'Azure Tenant ID' },
      { key: 'client_id', label: 'App Client ID' },
      { key: 'client_secret', label: 'Client Secret', type: 'password' },
    ],
    aws_securityhub: [
      { key: 'access_key_id', label: 'AWS Access Key ID' },
      { key: 'secret_access_key', label: 'Secret Access Key', type: 'password' },
      { key: 'region', label: 'Region', placeholder: 'us-east-1' },
    ],
    gcp_scc: [
      { key: 'service_account_json', label: 'Service Account JSON', type: 'password' },
      { key: 'organization_id', label: 'Organization ID (optional)' },
      { key: 'project_id', label: 'Project ID (optional)' },
    ],
    fortigate: [
      { key: 'host', label: 'FortiGate Host', placeholder: 'firewall.corp.local' },
      { key: 'port', label: 'Port', placeholder: '443' },
      { key: 'api_key', label: 'API Key', type: 'password' },
      { key: 'vdom', label: 'VDOM', placeholder: 'root' },
    ],
    opnsense: [
      { key: 'host', label: 'OPNsense Host', placeholder: 'opnsense.corp.local' },
      { key: 'port', label: 'Port', placeholder: '443' },
      { key: 'api_key', label: 'API Key' },
      { key: 'api_secret', label: 'API Secret', type: 'password' },
    ],
    pfsense: [
      { key: 'host', label: 'pfSense Host', placeholder: 'pfsense.corp.local' },
      { key: 'port', label: 'HTTPS Port', placeholder: '443' },
      { key: 'api_key', label: 'API Key / Token', type: 'password' },
    ],
    cuckoo: [
      { key: 'url', label: 'Cuckoo API Base URL', placeholder: 'http://cuckoo:8090' },
      { key: 'api_token', label: 'API Token (optional)', type: 'password' },
    ],
    clamav: [
      { key: 'url', label: 'clamav-rest Base URL', placeholder: 'http://clamav-rest:8080' },
    ],
    arkime: [
      { key: 'url', label: 'Arkime Base URL', placeholder: 'https://arkime.corp.local' },
      { key: 'username', label: 'Username (optional)' },
      { key: 'password', label: 'Password (optional)', type: 'password' },
    ],
    digitalocean: [
      { key: 'api_token', label: 'Personal Access Token', type: 'password' },
    ],
    defectdojo: [
      { key: 'url', label: 'DefectDojo URL', placeholder: 'https://dd.corp.local' },
      { key: 'api_key', label: 'API Key', type: 'password' },
    ],
    otx: [
      { key: 'api_key', label: 'OTX API Key (optional - works anonymously without)', type: 'password' },
    ],
    greynoise: [
      { key: 'api_key', label: 'API Key', type: 'password' },
    ],
    shodan: [
      { key: 'api_key', label: 'API Key', type: 'password' },
    ],
    crowdstrike: [
      { key: 'client_id', label: 'API Client ID' },
      { key: 'client_secret', label: 'API Client Secret', type: 'password' },
      { key: 'base_url', label: 'API Base URL', placeholder: 'https://api.crowdstrike.com' },
    ],
    teams: [
      { key: 'webhook_url', label: 'Incoming Webhook URL', type: 'password' },
    ],
    velociraptor: [
      { key: 'url', label: 'Velociraptor URL', placeholder: 'https://vr.corp.local:8889' },
      { key: 'api_key', label: 'API Key', type: 'password' },
    ],
    webhook: [
      { key: 'url', label: 'Default Webhook URL', placeholder: 'https://example.com/webhook' },
      { key: 'auth_header', label: 'Authorization Header (optional)', type: 'password' },
    ],
    http: [
      { key: 'base_url', label: 'Base URL (optional)', placeholder: 'https://api.example.com' },
      { key: 'api_key', label: 'API Key (optional, sent as Bearer)', type: 'password' },
    ],
  };

  const name = (integration?.name || '').toLowerCase().replace(/[\s\-_]/g, '');
  const type = (integration?.type || '').toLowerCase();
  // Try exact type match first, then name-based fallback, then generic
  let fields = typeFields[type] || typeFields[name] || [];
  if (name.includes('virustotal')) fields = fields.length ? fields : typeFields.virustotal;
  else if (name.includes('abuseipdb')) fields = fields.length ? fields : typeFields.abuseipdb;
  else if (name.includes('ipinfo')) fields = fields.length ? fields : typeFields.ipinfo;
  else if (name.includes('slack')) fields = fields.length ? fields : typeFields.slack;
  else if (name.includes('email') || name.includes('smtp')) fields = fields.length ? fields : typeFields.email;
  else if (name.includes('telegram') || name.includes('tg')) fields = fields.length ? fields : typeFields.telegram;
  else if (name.includes('jira')) fields = fields.length ? fields : typeFields.jira;
  else if (name.includes('pagerduty')) fields = fields.length ? fields : typeFields.pagerduty;
  else if (name.includes('servicenow')) fields = fields.length ? fields : typeFields.servicenow;
  else if (name.includes('thehive')) fields = fields.length ? fields : typeFields.thehive;
  else if (name.includes('misp')) fields = fields.length ? fields : typeFields.misp;
  else if (name.includes('opencti')) fields = fields.length ? fields : typeFields.opencti;
  else if (name.includes('wazuh')) fields = fields.length ? fields : typeFields.wazuh;
  else if (name.includes('sentinel')) fields = fields.length ? fields : typeFields.sentinel;
  else if (name.includes('greynoise')) fields = fields.length ? fields : typeFields.greynoise;
  else if (name.includes('shodan')) fields = fields.length ? fields : typeFields.shodan;
  else if (name.includes('crowdstrike') || name.includes('falcon')) fields = fields.length ? fields : typeFields.crowdstrike;
  else if (name.includes('teams') || name.includes('msteams')) fields = fields.length ? fields : typeFields.teams;
  else if (name.includes('splunk')) fields = fields.length ? fields : typeFields.splunk;
  else if (name.includes('elastic')) fields = fields.length ? fields : typeFields.elastic;
  else if (name.includes('msgraph') || name.includes('microsoft')) fields = fields.length ? fields : typeFields.msgraph;
  else if (name.includes('entra')) fields = fields.length ? fields : typeFields.entra_id;
  else if (name.includes('securityhub') || name.includes('aws_security')) fields = fields.length ? fields : typeFields.aws_securityhub;
  else if (name.includes('gcp') && name.includes('scc')) fields = fields.length ? fields : typeFields.gcp_scc;
  else if (name.includes('gcp_scc') || name.includes('security_command')) fields = fields.length ? fields : typeFields.gcp_scc;
  else if (name.includes('fortigate') || name.includes('fortios')) fields = fields.length ? fields : typeFields.fortigate;
  else if (name.includes('opnsense')) fields = fields.length ? fields : typeFields.opnsense;
  else if (name.includes('pfsense')) fields = fields.length ? fields : typeFields.pfsense;
  else if (name.includes('cuckoo')) fields = fields.length ? fields : typeFields.cuckoo;
  else if (name.includes('clamav')) fields = fields.length ? fields : typeFields.clamav;
  else if (name.includes('arkime') || name.includes('moloch')) fields = fields.length ? fields : typeFields.arkime;
  else if (name.includes('digitalocean')) fields = fields.length ? fields : typeFields.digitalocean;
  else if (name.includes('defectdojo')) fields = fields.length ? fields : typeFields.defectdojo;
  else if (name.includes('otx') || name.includes('alienvault')) fields = fields.length ? fields : typeFields.otx;
  else if (name.includes('velociraptor')) fields = fields.length ? fields : typeFields.velociraptor;
  // Generic fallback: show all existing config keys
  if (fields.length === 0) {
    for (const k of Object.keys(configForm)) {
      fields.push({ key: k, label: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), type: k.toLowerCase().includes('key') || k.toLowerCase().includes('password') || k.toLowerCase().includes('secret') ? 'password' : 'text' });
    }
  }

  return (
    <Dialog open={!!integrationId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Configure {integration?.name || 'Integration'}
          </DialogTitle>
          <DialogDescription>
            Set real credentials here. They are stored locally in SQLite and used by workflow nodes when this integration is referenced.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-3">
            {fields.map(f => (
              <div key={f.key}>
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type={f.type === 'password' ? 'password' : 'text'}
                  value={configForm[f.key] || ''}
                  onChange={e => setConfigForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="mt-1 text-xs font-mono"
                />
              </div>
            ))}
            {fields.length === 0 && (
              <p className="text-xs text-muted-foreground">No configurable fields for this integration.</p>
            )}

            <div className="p-2 bg-muted/50 rounded text-[11px] text-muted-foreground flex items-start gap-2">
              <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" aria-hidden />
              <span>In workflow node configs, reference values with <code>{`{{trigger.ip}}`}</code> or <code>{`{{outputs.n1.virustotal.ioc}}`}</code>. The integration API key is automatically loaded from here.</span>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={testing || !integration}
            onClick={async () => {
              setTesting(true);
              try {
                const res = await soarFetch<{
                  ok?: boolean;
                  connected?: boolean;
                  message?: string;
                  test?: { ok?: boolean; message?: string };
                }>(`/api/integrations/${integrationId}`, {
                  method: 'PUT',
                  body: JSON.stringify({ config: configForm }),
                });
                const data = res.data ?? {};
                const passed = data.connected ?? data.test?.ok ?? data.ok;
                const message = data.message ?? data.test?.message ?? res.error;
                toast({
                  title: passed ? 'Connected' : 'Test Failed',
                  description: message || (passed ? 'Integration is ready for workflows.' : 'Check credentials.'),
                  variant: passed ? 'default' : 'destructive',
                });
                if (passed) onSaved();
              } catch (e) {
                toast({ title: 'Save error', description: String(e), variant: 'destructive' });
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? <Activity className="h-3 w-3 mr-1 animate-pulse" /> : <Zap className="h-3 w-3 mr-1" />}
            Save & Test
          </Button>
          <Button
            size="sm"
            disabled={loading || testing || !integration}
            onClick={async () => {
              setTesting(true);
              try {
                const res = await soarFetch<{
                  ok?: boolean;
                  connected?: boolean;
                  message?: string;
                  test?: { ok?: boolean; message?: string };
                }>(`/api/integrations/${integrationId}`, {
                  method: 'PUT',
                  body: JSON.stringify({ config: configForm }),
                });
                const data = res.data ?? {};
                const passed = data.connected ?? data.test?.ok ?? data.ok;
                const message = data.message ?? data.test?.message;
                toast({
                  title: passed ? 'Saved & connected' : 'Saved',
                  description: passed
                    ? 'Integration is ready — workflows will use it automatically.'
                    : message || 'Credentials saved. Fix any test errors before running workflows.',
                  variant: passed ? 'default' : 'destructive',
                });
                onSaved();
              } catch (e) {
                toast({ title: 'Save error', description: String(e), variant: 'destructive' });
              } finally {
                setTesting(false);
              }
            }}
          >
            <Save className="h-3 w-3 mr-1" /> Save credentials
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}