'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/lumisec-api/browser/api-client';
import {
  IntegrationUnavailableError,
  IntegrationValidationError,
} from '@/lib/lumisec-api/browser/integrationErrors';
import {
  blockIpFirewall,
  blockIpNetwork,
  createPhishingCampaign,
  isolateHostEdr,
  isolateHostNetwork,
  pushUctcRule,
  sendSiemEvent,
  submitGrcFinding,
  submitGrcRisk,
  triggerUctcRule,
} from '@/lib/lumisec-api/browser/soarIntegrations';
import {
  fetchLuminetAssetContext,
  fetchPhishingLandingPages,
  fetchPhishingTemplates,
  fetchPlatformStatus,
  fetchUctcRules,
  lookupItemId,
  lookupItemLabel,
  type PlatformLookupItem,
  type PlatformStatusResponse,
} from '@/lib/lumisec-api/browser/platformOutbound';
import {
  getPlatformModule,
  LUMISEC_PLATFORM_MODULES,
  type PlatformModuleDef,
} from '@/lib/lumisec-api/platform-modules';

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
const OS_OPTIONS = ['linux', 'windows'] as const;

type FieldErrors = Record<string, string>;

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-sm text-destructive">{message}</p>;
}

function buildPayload(fields: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    payload[key] = value;
  }
  return payload;
}

async function runIntegrationAction(
  action: () => Promise<{ message: string }>,
  setLoading: (value: boolean) => void,
  setFieldErrors: (errors: FieldErrors) => void,
  onSuccess?: () => void,
) {
  setLoading(true);
  setFieldErrors({});
  try {
    const result = await action();
    toast({ title: result.message });
    onSuccess?.();
  } catch (err) {
    if (err instanceof IntegrationValidationError) {
      setFieldErrors(err.fieldErrors);
      if (Object.keys(err.fieldErrors).length === 0) {
        toast({ title: err.message, variant: 'destructive' });
      }
    } else if (err instanceof IntegrationUnavailableError) {
      toast({ title: err.message, variant: 'destructive' });
    } else {
      toast({ title: getApiErrorMessage(err), variant: 'destructive' });
    }
  } finally {
    setLoading(false);
  }
}

function SubmitButton({
  loading,
  label,
}: {
  loading: boolean;
  label: string;
}) {
  return (
    <Button type="submit" disabled={loading}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {label}
    </Button>
  );
}

function DependencyWarning({ message }: { message: string }) {
  return (
    <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

function UnavailableIntegrationNotice({ name }: { name: string }) {
  return (
    <Alert className="border-amber-500/40 bg-amber-500/5">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription>
        {name} runs on the LumiSec monolith. Set <code className="text-xs">SOAR_BACKEND_URL=http://localhost:4000</code>{' '}
        in <code className="text-xs">.env</code> and start the platform API.
      </AlertDescription>
    </Alert>
  );
}

function PlatformModuleHeader({
  module,
  status,
}: {
  module: PlatformModuleDef;
  status: PlatformStatusResponse | null;
}) {
  return (
    <div className="space-y-3">
      <PlatformModuleNotice moduleKey={module.statusKey} label={module.name} status={status} />
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-semibold">{module.name}</p>
              <p className="text-xs text-muted-foreground">{module.description}</p>
              <p className="text-[11px] text-muted-foreground font-mono">{module.mountPath}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {module.soarActions.map((action) => (
                <span
                  key={action}
                  className="rounded-md border border-border/60 bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {action}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlatformStatusBanner({ status }: { status: PlatformStatusResponse | null }) {
  if (!status) return null;

  if (!status.configured) {
    return (
      <UnavailableIntegrationNotice name="LumiSec platform (GRC Â· UCTC Â· Phishing Â· LumiNet)" />
    );
  }

  const moduleLabels: Record<string, string> = {
    health: 'Monolith API',
    soar: 'SOAR module',
    grc: 'GRC',
    uctc: 'UCTC',
    phishing: 'Phishing',
    network: 'LumiNet',
  };

  return (
    <Alert className={status.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}>
      {status.ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-600" />
      )}
      <AlertDescription className="space-y-2">
        <p>
          Platform bridge: <strong>{status.base_url || 'configured'}</strong>
          {status.ok
            ? ' â€” internal modules reachable'
            : ' â€” some modules offline (start full monolith stack)'}
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(status.modules).map(([key, mod]) => (
            <span
              key={key}
              className={`rounded-full px-2 py-0.5 ${
                mod.ok ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'
              }`}
            >
              {moduleLabels[key] || key}: {mod.ok ? 'OK' : 'down'}
            </span>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}

function PlatformModuleNotice({
  moduleKey,
  label,
  status,
}: {
  moduleKey: string;
  label: string;
  status: PlatformStatusResponse | null;
}) {
  if (!status?.configured) {
    return <UnavailableIntegrationNotice name={label} />;
  }
  const mod = status.modules[moduleKey];
  if (mod?.ok) return null;
  return (
    <Alert variant="destructive" className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription>
        {label} module is unreachable on the platform backend{mod?.message ? `: ${mod.message}` : ''}.
      </AlertDescription>
    </Alert>
  );
}

function GrcTab({ platformStatus }: { platformStatus: PlatformStatusResponse | null }) {
  const module = getPlatformModule('grc')!;
  const [findingLoading, setFindingLoading] = useState(false);
  const [riskLoading, setRiskLoading] = useState(false);
  const [findingErrors, setFindingErrors] = useState<FieldErrors>({});
  const [riskErrors, setRiskErrors] = useState<FieldErrors>({});

  const [findingIncidentId, setFindingIncidentId] = useState('');
  const [findingTitle, setFindingTitle] = useState('');
  const [findingDescription, setFindingDescription] = useState('');
  const [findingSeverity, setFindingSeverity] = useState<string>('high');
  const [findingAsset, setFindingAsset] = useState('');
  const [createRisk, setCreateRisk] = useState(false);

  const [riskIncidentId, setRiskIncidentId] = useState('');
  const [riskTitle, setRiskTitle] = useState('');
  const [riskDescription, setRiskDescription] = useState('');
  const [riskSeverity, setRiskSeverity] = useState<string>('high');
  const [riskAsset, setRiskAsset] = useState('');
  const [riskLikelihood, setRiskLikelihood] = useState('');
  const [riskImpact, setRiskImpact] = useState('');

  const resetFinding = () => {
    setFindingIncidentId('');
    setFindingTitle('');
    setFindingDescription('');
    setFindingSeverity('high');
    setFindingAsset('');
    setCreateRisk(false);
  };

  const resetRisk = () => {
    setRiskIncidentId('');
    setRiskTitle('');
    setRiskDescription('');
    setRiskSeverity('high');
    setRiskAsset('');
    setRiskLikelihood('');
    setRiskImpact('');
  };

  return (
    <div className="space-y-4">
      <PlatformModuleHeader module={module} status={platformStatus} />
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Submit Finding</CardTitle>
          <CardDescription>Push a SOAR-linked finding into the LumiSec GRC module.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void runIntegrationAction(
                () =>
                  submitGrcFinding(
                    buildPayload({
                      incidentId: findingIncidentId.trim(),
                      title: findingTitle.trim(),
                      description: findingDescription.trim(),
                      severity: findingSeverity,
                      asset: findingAsset.trim(),
                      createRisk,
                    }),
                  ),
                setFindingLoading,
                setFindingErrors,
                resetFinding,
              );
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="grc-finding-title">Title</Label>
              <Input
                id="grc-finding-title"
                value={findingTitle}
                onChange={(e) => setFindingTitle(e.target.value)}
                placeholder="SOAR to GRC finding"
                required
              />
              <FieldError message={findingErrors.title} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grc-finding-description">Description</Label>
              <Textarea
                id="grc-finding-description"
                value={findingDescription}
                onChange={(e) => setFindingDescription(e.target.value)}
                placeholder="Synced from incident"
                rows={3}
              />
              <FieldError message={findingErrors.description} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={findingSeverity} onValueChange={setFindingSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={findingErrors.severity} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grc-finding-asset">Asset</Label>
                <Input
                  id="grc-finding-asset"
                  value={findingAsset}
                  onChange={(e) => setFindingAsset(e.target.value)}
                  placeholder="server-01.example.com"
                />
                <FieldError message={findingErrors.asset} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="grc-finding-incident">Incident ID</Label>
              <Input
                id="grc-finding-incident"
                value={findingIncidentId}
                onChange={(e) => setFindingIncidentId(e.target.value)}
                placeholder="Optional linked incident"
              />
              <FieldError message={findingErrors.incidentId} />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="grc-finding-create-risk"
                checked={createRisk}
                onCheckedChange={(checked) => setCreateRisk(checked === true)}
              />
              <Label htmlFor="grc-finding-create-risk" className="font-normal">
                Also create linked risk
              </Label>
            </div>
            <FieldError message={findingErrors.createRisk} />
            <SubmitButton loading={findingLoading} label="Submit Finding" />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Submit Risk</CardTitle>
          <CardDescription>Register a risk in the LumiSec GRC risk register from SOAR.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void runIntegrationAction(
                () =>
                  submitGrcRisk(
                    buildPayload({
                      incidentId: riskIncidentId.trim(),
                      title: riskTitle.trim(),
                      description: riskDescription.trim(),
                      severity: riskSeverity,
                      asset: riskAsset.trim(),
                      likelihood: riskLikelihood.trim(),
                      impact: riskImpact.trim(),
                    }),
                  ),
                setRiskLoading,
                setRiskErrors,
                resetRisk,
              );
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="grc-risk-title">Title</Label>
              <Input
                id="grc-risk-title"
                value={riskTitle}
                onChange={(e) => setRiskTitle(e.target.value)}
                placeholder="Unpatched critical vulnerability"
                required
              />
              <FieldError message={riskErrors.title} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="grc-risk-description">Description</Label>
              <Textarea
                id="grc-risk-description"
                value={riskDescription}
                onChange={(e) => setRiskDescription(e.target.value)}
                rows={3}
              />
              <FieldError message={riskErrors.description} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select value={riskSeverity} onValueChange={setRiskSeverity}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={riskErrors.severity} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grc-risk-asset">Asset</Label>
                <Input
                  id="grc-risk-asset"
                  value={riskAsset}
                  onChange={(e) => setRiskAsset(e.target.value)}
                />
                <FieldError message={riskErrors.asset} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="grc-risk-likelihood">Likelihood</Label>
                <Input
                  id="grc-risk-likelihood"
                  value={riskLikelihood}
                  onChange={(e) => setRiskLikelihood(e.target.value)}
                  placeholder="medium"
                />
                <FieldError message={riskErrors.likelihood} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="grc-risk-impact">Impact</Label>
                <Input
                  id="grc-risk-impact"
                  value={riskImpact}
                  onChange={(e) => setRiskImpact(e.target.value)}
                  placeholder="high"
                />
                <FieldError message={riskErrors.impact} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="grc-risk-incident">Incident ID</Label>
              <Input
                id="grc-risk-incident"
                value={riskIncidentId}
                onChange={(e) => setRiskIncidentId(e.target.value)}
              />
              <FieldError message={riskErrors.incidentId} />
            </div>
            <SubmitButton loading={riskLoading} label="Submit Risk" />
          </form>
        </CardContent>
      </Card>
    </div>
    </div>
  );
}

function UctcTab({ platformStatus }: { platformStatus: PlatformStatusResponse | null }) {
  const module = getPlatformModule('uctc')!;
  const [ruleLoading, setRuleLoading] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [ruleErrors, setRuleErrors] = useState<FieldErrors>({});
  const [triggerErrors, setTriggerErrors] = useState<FieldErrors>({});
  const [savedRules, setSavedRules] = useState<PlatformLookupItem[]>([]);

  const [ruleName, setRuleName] = useState('');
  const [ruleDescription, setRuleDescription] = useState('');
  const [ruleYaml, setRuleYaml] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [triggerRuleId, setTriggerRuleId] = useState('');
  const [incidentId, setIncidentId] = useState('');

  useEffect(() => {
    if (!platformStatus?.configured || !platformStatus.modules.uctc?.ok) return;
    void fetchUctcRules()
      .then(setSavedRules)
      .catch(() => setSavedRules([]));
  }, [platformStatus]);

  const resetRule = () => {
    setRuleName('');
    setRuleDescription('');
    setRuleYaml('');
    setRuleId('');
    setIncidentId('');
  };

  return (
    <div className="space-y-4">
      <PlatformModuleHeader module={module} status={platformStatus} />
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Deploy / Push Rule</CardTitle>
          <CardDescription>Deploy an existing Sigma rule or push YAML to UCTC via SOAR integration.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void runIntegrationAction(
                () =>
                  pushUctcRule(
                    buildPayload({
                      ruleId: ruleId.trim(),
                      name: ruleName.trim(),
                      description: ruleDescription.trim(),
                      yaml: ruleYaml.trim(),
                      incidentId: incidentId.trim(),
                    }),
                  ),
                setRuleLoading,
                setRuleErrors,
                resetRule,
              );
            }}
          >
            {savedRules.length > 0 && (
              <div className="space-y-2">
                <Label>Existing rule (optional)</Label>
                <Select
                  value={ruleId || undefined}
                  onValueChange={(value) => {
                    setRuleId(value);
                    const picked = savedRules.find((r) => lookupItemId(r) === value);
                    if (picked?.name) setRuleName(picked.name);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick saved UCTC rule" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedRules.map((rule) => (
                      <SelectItem key={lookupItemId(rule)} value={lookupItemId(rule)}>
                        {lookupItemLabel(rule)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="uctc-rule-name">Name</Label>
              <Input
                id="uctc-rule-name"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Suspicious PowerShell execution"
              />
              <FieldError message={ruleErrors.name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uctc-rule-description">Description</Label>
              <Textarea
                id="uctc-rule-description"
                value={ruleDescription}
                onChange={(e) => setRuleDescription(e.target.value)}
                rows={2}
              />
              <FieldError message={ruleErrors.description} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uctc-rule-yaml">Sigma YAML (for new rules)</Label>
              <Textarea
                id="uctc-rule-yaml"
                value={ruleYaml}
                onChange={(e) => setRuleYaml(e.target.value)}
                placeholder={'title: Example\nlogsource:\n  product: windows'}
                rows={6}
                className="font-mono text-sm"
              />
              <FieldError message={ruleErrors.yaml} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="uctc-incident">Linked incident ID</Label>
              <Input
                id="uctc-incident"
                value={incidentId}
                onChange={(e) => setIncidentId(e.target.value)}
                placeholder="Optional SOAR incident"
              />
            </div>
            <SubmitButton loading={ruleLoading} label="Push / Deploy Rule" />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trigger Rule</CardTitle>
          <CardDescription>Fire a deployed UCTC rule workflow from SOAR.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void runIntegrationAction(
                () =>
                  triggerUctcRule(
                    buildPayload({
                      ruleId: triggerRuleId.trim(),
                      incidentId: incidentId.trim(),
                    }),
                  ),
                setTriggerLoading,
                setTriggerErrors,
                () => setTriggerRuleId(''),
              );
            }}
          >
            {savedRules.length > 0 ? (
              <div className="space-y-2">
                <Label>Rule</Label>
                <Select value={triggerRuleId || undefined} onValueChange={setTriggerRuleId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select UCTC rule" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedRules.map((rule) => (
                      <SelectItem key={lookupItemId(rule)} value={lookupItemId(rule)}>
                        {lookupItemLabel(rule)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={triggerErrors.ruleId ?? triggerErrors.id} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="uctc-rule-id">Rule ID</Label>
                <Input
                  id="uctc-rule-id"
                  value={triggerRuleId}
                  onChange={(e) => setTriggerRuleId(e.target.value)}
                  placeholder="MongoDB rule _id"
                  required
                />
                <FieldError message={triggerErrors.ruleId ?? triggerErrors.id} />
              </div>
            )}
            <SubmitButton loading={triggerLoading} label="Trigger Rule" />
          </form>
        </CardContent>
      </Card>
    </div>
    </div>
  );
}

function PhishingTab({ platformStatus }: { platformStatus: PlatformStatusResponse | null }) {
  const module = getPlatformModule('phishing')!;
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [templates, setTemplates] = useState<PlatformLookupItem[]>([]);
  const [landingPages, setLandingPages] = useState<PlatformLookupItem[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [landingPageId, setLandingPageId] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [targetGroup, setTargetGroup] = useState('');
  const [startDate, setStartDate] = useState('');
  const [autoLaunch, setAutoLaunch] = useState(false);

  useEffect(() => {
    if (!platformStatus?.configured || !platformStatus.modules.phishing?.ok) return;
    void Promise.all([fetchPhishingTemplates(), fetchPhishingLandingPages()])
      .then(([t, l]) => {
        setTemplates(t);
        setLandingPages(l);
      })
      .catch(() => {
        setTemplates([]);
        setLandingPages([]);
      });
  }, [platformStatus]);

  const reset = () => {
    setName('');
    setDescription('');
    setTemplateId('');
    setLandingPageId('');
    setIncidentId('');
    setTargetGroup('');
    setStartDate('');
    setAutoLaunch(false);
  };

  return (
    <div className="space-y-4">
      <PlatformModuleHeader module={module} status={platformStatus} />
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Link / Create Campaign</CardTitle>
        <CardDescription>
          Create or link a phishing simulation campaign to a SOAR incident via LumiSec Phishing module.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void runIntegrationAction(
              () =>
                createPhishingCampaign(
                  buildPayload({
                    name: name.trim(),
                    description: description.trim(),
                    templateId: templateId.trim(),
                    landingPageId: landingPageId.trim(),
                    incidentId: incidentId.trim(),
                    targetGroup: targetGroup.trim(),
                    launchDate: startDate.trim(),
                    autoLaunch,
                  }),
                ),
              setLoading,
              setFieldErrors,
              reset,
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="phishing-name">Campaign Name</Label>
            <Input
              id="phishing-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <FieldError message={fieldErrors.name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phishing-description">Description</Label>
            <Textarea
              id="phishing-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
            <FieldError message={fieldErrors.description} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phishing-incident">Linked SOAR Incident ID</Label>
            <Input
              id="phishing-incident"
              value={incidentId}
              onChange={(e) => setIncidentId(e.target.value)}
              placeholder="Optional â€” ties campaign to incident"
            />
            <FieldError message={fieldErrors.incidentId} />
          </div>
          {templates.length > 0 ? (
            <div className="space-y-2">
              <Label>Email template</Label>
              <Select value={templateId || undefined} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((item) => (
                    <SelectItem key={lookupItemId(item)} value={lookupItemId(item)}>
                      {lookupItemLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={fieldErrors.templateId} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="phishing-template">Template ID</Label>
              <Input
                id="phishing-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              />
              <FieldError message={fieldErrors.templateId} />
            </div>
          )}
          {landingPages.length > 0 ? (
            <div className="space-y-2">
              <Label>Landing page</Label>
              <Select value={landingPageId || undefined} onValueChange={setLandingPageId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select landing page" />
                </SelectTrigger>
                <SelectContent>
                  {landingPages.map((item) => (
                    <SelectItem key={lookupItemId(item)} value={lookupItemId(item)}>
                      {lookupItemLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={fieldErrors.landingPageId} />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="phishing-landing">Landing Page ID</Label>
              <Input
                id="phishing-landing"
                value={landingPageId}
                onChange={(e) => setLandingPageId(e.target.value)}
              />
              <FieldError message={fieldErrors.landingPageId} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="phishing-target">Target group / department</Label>
            <Input
              id="phishing-target"
              value={targetGroup}
              onChange={(e) => setTargetGroup(e.target.value)}
              placeholder="finance-team"
            />
            <FieldError message={fieldErrors.targetGroup} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phishing-start">Launch date</Label>
            <Input
              id="phishing-start"
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <FieldError message={fieldErrors.launchDate ?? fieldErrors.startDate} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="phishing-auto-launch"
              checked={autoLaunch}
              onCheckedChange={(checked) => setAutoLaunch(checked === true)}
            />
            <Label htmlFor="phishing-auto-launch" className="font-normal">
              Launch immediately after create
            </Label>
          </div>
          <SubmitButton loading={loading} label="Create Campaign" />
        </form>
      </CardContent>
    </Card>
    </div>
  );
}

function LumiNetTab({ platformStatus }: { platformStatus: PlatformStatusResponse | null }) {
  const module = getPlatformModule('luminet')!;
  const [lookupLoading, setLookupLoading] = useState(false);
  const [findingLoading, setFindingLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [ip, setIp] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [assetContext, setAssetContext] = useState<Record<string, unknown> | null>(null);
  const [findingTitle, setFindingTitle] = useState('');
  const [findingDescription, setFindingDescription] = useState('');
  const [findingSeverity, setFindingSeverity] = useState<string>('medium');

  const runLookup = async () => {
    if (!ip.trim()) return;
    setLookupLoading(true);
    setAssetContext(null);
    try {
      const ctx = await fetchLuminetAssetContext(ip.trim());
      setAssetContext(ctx);
      const hostname = String(ctx.hostname ?? ctx.host ?? '').trim();
      const titleBase = hostname || ip.trim();
      if (!findingTitle) setFindingTitle(`Network exposure â€” ${titleBase}`);
      if (!findingDescription && ctx.openPorts) {
        setFindingDescription(`Asset context from LumiNet for ${ip.trim()}`);
      }
    } catch (err) {
      toast({ title: getApiErrorMessage(err), variant: 'destructive' });
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <PlatformModuleHeader module={module} status={platformStatus} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Asset Context</CardTitle>
            <CardDescription>
              Query LumiNet inventory for a host IP before opening GRC findings or UCTC rules.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="luminet-ip">Host IP</Label>
              <Input
                id="luminet-ip"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="10.0.0.25"
              />
            </div>
            <Button type="button" onClick={() => void runLookup()} disabled={lookupLoading || !ip.trim()}>
              {lookupLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lookup asset
            </Button>
            {assetContext && (
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 text-xs font-mono">
                {JSON.stringify(assetContext, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Push Finding â†’ GRC</CardTitle>
            <CardDescription>
              Send a network-discovered issue to GRC with <code className="text-xs">sourceModule=luminet</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void runIntegrationAction(
                  () =>
                    submitGrcFinding(
                      buildPayload({
                        title: findingTitle.trim(),
                        description: findingDescription.trim(),
                        severity: findingSeverity,
                        asset: ip.trim(),
                        ip: ip.trim(),
                        incidentId: incidentId.trim(),
                        sourceModule: 'luminet',
                        sourceId: incidentId.trim() || ip.trim(),
                      }),
                    ),
                  setFindingLoading,
                  setFieldErrors,
                );
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="luminet-finding-title">Title</Label>
                <Input
                  id="luminet-finding-title"
                  value={findingTitle}
                  onChange={(e) => setFindingTitle(e.target.value)}
                  required
                />
                <FieldError message={fieldErrors.title} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="luminet-finding-desc">Description</Label>
                <Textarea
                  id="luminet-finding-desc"
                  value={findingDescription}
                  onChange={(e) => setFindingDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Severity</Label>
                  <Select value={findingSeverity} onValueChange={setFindingSeverity}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEVERITIES.map((level) => (
                        <SelectItem key={level} value={level}>
                          {level}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="luminet-incident">SOAR incident ID</Label>
                  <Input
                    id="luminet-incident"
                    value={incidentId}
                    onChange={(e) => setIncidentId(e.target.value)}
                    placeholder="Optional link"
                  />
                </div>
              </div>
              <SubmitButton loading={findingLoading} label="Push to GRC" />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SocInfraIntro() {
  return (
    <Card className="border-border/60">
      <CardContent className="pt-4 pb-4">
        <p className="text-sm font-medium">SOC infrastructure actions</p>
        <p className="text-xs text-muted-foreground mt-1">
          These tabs drive external SOC tools (SIEM, firewall, EDR) via configured connectors â€” separate from
          the LumiSec platform modules above.
        </p>
      </CardContent>
    </Card>
  );
}

function SiemTab() {
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [eventType, setEventType] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [severity, setSeverity] = useState<string>('high');
  const [message, setMessage] = useState('');

  const reset = () => {
    setEventType('');
    setIncidentId('');
    setSeverity('high');
    setMessage('');
  };

  return (
    <div className="space-y-6 max-w-xl">
      <DependencyWarning message="Requires Elasticsearch/ELK to be configured." />
      <Card>
        <CardHeader>
          <CardTitle>Send Event</CardTitle>
          <CardDescription>Forward an event to the SIEM/ELK stack.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void runIntegrationAction(
                () =>
                  sendSiemEvent(
                    buildPayload({
                      eventType: eventType.trim(),
                      incidentId: incidentId.trim(),
                      severity,
                      message: message.trim(),
                    }),
                  ),
                setLoading,
                setFieldErrors,
                reset,
              );
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="siem-event-type">Event Type</Label>
              <Input
                id="siem-event-type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="incident_updated"
                required
              />
              <FieldError message={fieldErrors.eventType} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siem-incident">Incident ID</Label>
              <Input
                id="siem-incident"
                value={incidentId}
                onChange={(e) => setIncidentId(e.target.value)}
              />
              <FieldError message={fieldErrors.incidentId} />
            </div>
            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={fieldErrors.severity} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siem-message">Message</Label>
              <Textarea
                id="siem-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Incident escalated"
                rows={3}
                required
              />
              <FieldError message={fieldErrors.message} />
            </div>
            <SubmitButton loading={loading} label="Send Event" />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function BlockIpForm({
  title,
  description,
  onSubmit,
}: {
  title: string;
  description: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<{ message: string }>;
}) {
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [ip, setIp] = useState('');
  const [comment, setComment] = useState('');
  const [incidentId, setIncidentId] = useState('');

  const reset = () => {
    setIp('');
    setComment('');
    setIncidentId('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void runIntegrationAction(
              () =>
                onSubmit(
                  buildPayload({
                    ip: ip.trim(),
                    comment: comment.trim(),
                    incidentId: incidentId.trim(),
                  }),
                ),
              setLoading,
              setFieldErrors,
              reset,
            );
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${title}-ip`}>IP Address</Label>
            <Input
              id={`${title}-ip`}
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="203.0.113.99"
              required
            />
            <FieldError message={fieldErrors.ip} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${title}-comment`}>Comment</Label>
            <Input
              id={`${title}-comment`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="SOAR automated block"
            />
            <FieldError message={fieldErrors.comment} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${title}-incident`}>Incident ID</Label>
            <Input
              id={`${title}-incident`}
              value={incidentId}
              onChange={(e) => setIncidentId(e.target.value)}
            />
            <FieldError message={fieldErrors.incidentId} />
          </div>
          <SubmitButton loading={loading} label="Block IP" />
        </form>
      </CardContent>
    </Card>
  );
}

function FirewallNetworkTab() {
  const [isolateLoading, setIsolateLoading] = useState(false);
  const [isolateErrors, setIsolateErrors] = useState<FieldErrors>({});
  const [host, setHost] = useState('');
  const [incidentId, setIncidentId] = useState('');

  return (
    <div className="space-y-6">
      <DependencyWarning message="Requires SSH/WinRM access to target host." />
      <div className="grid gap-6 lg:grid-cols-2">
        <BlockIpForm
          title="Block IP (Firewall)"
          description="Block an IP on FortiGate or pfSense."
          onSubmit={blockIpFirewall}
        />
        <BlockIpForm
          title="Block IP (Network)"
          description="Block an IP at the network layer."
          onSubmit={blockIpNetwork}
        />
      </div>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Isolate Host</CardTitle>
          <CardDescription>Isolate a host via SSH/WinRM at the network layer.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void runIntegrationAction(
                () =>
                  isolateHostNetwork(
                    buildPayload({
                      host: host.trim(),
                      hostname: host.trim(),
                      incidentId: incidentId.trim(),
                    }),
                  ),
                setIsolateLoading,
                setIsolateErrors,
                () => {
                  setHost('');
                  setIncidentId('');
                },
              );
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="network-isolate-host">Hostname / IP</Label>
              <Input
                id="network-isolate-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="10.0.0.25"
                required
              />
              <FieldError message={isolateErrors.host ?? isolateErrors.hostname} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="network-isolate-incident">Incident ID</Label>
              <Input
                id="network-isolate-incident"
                value={incidentId}
                onChange={(e) => setIncidentId(e.target.value)}
              />
              <FieldError message={isolateErrors.incidentId} />
            </div>
            <SubmitButton loading={isolateLoading} label="Isolate Host" />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function EdRTab() {
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [host, setHost] = useState('');
  const [os, setOs] = useState<string>('linux');
  const [incidentId, setIncidentId] = useState('');

  const reset = () => {
    setHost('');
    setOs('linux');
    setIncidentId('');
  };

  return (
    <div className="space-y-6 max-w-xl">
      <DependencyWarning message="Requires SSH/WinRM host access." />
      <Card>
        <CardHeader>
          <CardTitle>Isolate Host</CardTitle>
          <CardDescription>Isolate a host through the EDR integration.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void runIntegrationAction(
                () =>
                  isolateHostEdr(
                    buildPayload({
                      host: host.trim(),
                      os,
                      incidentId: incidentId.trim(),
                    }),
                  ),
                setLoading,
                setFieldErrors,
                reset,
              );
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="edr-isolate-host">Hostname / IP</Label>
              <Input
                id="edr-isolate-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="10.0.0.25"
                required
              />
              <FieldError message={fieldErrors.host} />
            </div>
            <div className="space-y-2">
              <Label>Operating System</Label>
              <Select value={os} onValueChange={setOs}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={fieldErrors.os} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edr-isolate-incident">Incident ID</Label>
              <Input
                id="edr-isolate-incident"
                value={incidentId}
                onChange={(e) => setIncidentId(e.target.value)}
              />
              <FieldError message={fieldErrors.incidentId} />
            </div>
            <SubmitButton loading={loading} label="Isolate Host" />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export function IntegrationsManagement() {
  const [platformStatus, setPlatformStatus] = useState<PlatformStatusResponse | null>(null);

  useEffect(() => {
    void fetchPlatformStatus()
      .then(setPlatformStatus)
      .catch(() =>
        setPlatformStatus({
          configured: false,
          ok: false,
          modules: {},
        }),
      );
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Outbound Actions</h3>
        <p className="text-sm text-muted-foreground">
          Platform bridge between this SOAR and your LumiSec tools (GRC, UCTC, Phishing, LumiNet). Each tab
          calls the internal module API on the monolith via <code className="text-xs">SOAR_BACKEND_URL</code>.
        </p>
      </div>

      <PlatformStatusBanner status={platformStatus} />

      <Tabs defaultValue="platform" className="space-y-4">
        <TabsList>
          <TabsTrigger value="platform">LumiSec Platform</TabsTrigger>
          <TabsTrigger value="soc">SOC Infrastructure</TabsTrigger>
        </TabsList>

        <TabsContent value="platform" className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Full internal products — same monolith as SOAR, orchestrated from incident response workflows.
          </p>
          <Tabs defaultValue="grc" className="space-y-4">
            <div className="overflow-x-auto pb-1">
              <TabsList className="inline-flex h-auto w-max flex-nowrap gap-1">
                {LUMISEC_PLATFORM_MODULES.map((mod) => (
                  <TabsTrigger key={mod.tab} value={mod.tab}>
                    {mod.shortName}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <TabsContent value="grc">
              <GrcTab platformStatus={platformStatus} />
            </TabsContent>
            <TabsContent value="uctc">
              <UctcTab platformStatus={platformStatus} />
            </TabsContent>
            <TabsContent value="phishing">
              <PhishingTab platformStatus={platformStatus} />
            </TabsContent>
            <TabsContent value="luminet">
              <LumiNetTab platformStatus={platformStatus} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="soc" className="space-y-4">
          <SocInfraIntro />
          <Tabs defaultValue="siem" className="space-y-4">
            <div className="overflow-x-auto pb-1">
              <TabsList className="inline-flex h-auto w-max flex-nowrap gap-1">
                <TabsTrigger value="siem">SIEM</TabsTrigger>
                <TabsTrigger value="firewall-network">Firewall / Network</TabsTrigger>
                <TabsTrigger value="edr">EDR</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="siem">
              <SiemTab />
            </TabsContent>
            <TabsContent value="firewall-network">
              <FirewallNetworkTab />
            </TabsContent>
            <TabsContent value="edr">
              <EdRTab />
            </TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}
