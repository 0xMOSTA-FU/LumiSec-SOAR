'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, GitBranch, FolderOpen, Puzzle, BookOpen, Bell,
  Play, Plus, Settings, Moon, Sun, ChevronRight,
  Shield, AlertTriangle, CheckCircle2, XCircle, Clock, Activity,
  Zap, Eye, MoreVertical, Trash2, Edit3, ExternalLink,
  ArrowUpRight, ArrowDownRight, CircleDot, MessageSquare,
  Server, Cloud, Users, Mail, Bug, Radar, Monitor, Ticket, Database,
  X, Save, Pause, RotateCcw, Send, Link2, Tag, User,
  TrendingUp, BarChart3, Globe, FileText,
  ChevronLeft, Copy, Download, RefreshCw,
  Lightbulb, ArrowLeft, Plug, KeyRound, Webhook, Hash,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import WorkflowBuilder from '@/app/WorkflowBuilder';
import { normalizeWorkflowNode, type WFNode } from '@/lib/executors/types';
import { AnalyticsView, ThreatOpsView, IncidentDetailView } from '@/app/SecurityScreens';
import { useToast } from '@/hooks/use-toast';
import type { Page, Workflow, CaseItem, Integration, Playbook, AlertItem, DashboardMetrics } from '@/app/soar/types';
import { getIconForIntegration, severityColor, statusColor, formatDate, updateWorkflowStatus } from '@/components/soar/utils';
import { UserMenu } from '@/components/soar/UserMenu';
import { RunPlaybookDialog } from '@/components/soar/modals/RunPlaybookDialog';
import { IntegrationConfigModal } from '@/components/soar/modals/IntegrationConfigModal';
import { LinkWorkflowDialog } from '@/components/soar/modals/LinkWorkflowDialog';
import { NewCaseForm, NewAlertForm, NewPlaybookForm } from '@/components/soar/modals/Forms';
import { SettingsView } from '@/components/soar/modals/SettingsView';
import { NewIntegrationForm } from '@/components/soar/modals/NewIntegrationForm';
import { soarFetch, asArray } from '@/lib/soar/fetch-json';
import { useGatewayMode } from '@/hooks/use-gateway-mode';
import { fetchDashboardOverview } from '@/lib/lumisec-api/browser/soarDashboard';
import { fetchAlerts as fetchSoarAlerts } from '@/lib/lumisec-api/browser/soarAlerts';
import {
  IncidentsList,
  IncidentDetailPage,
  ConnectorsManagement,
  VaultManagement,
  ArtifactsManagement,
  WebhookSourcesManagement,
  DashboardOverview,
  AnalyticsPage,
  AlertsManagement,
  PlaybooksManagement,
  PlaybookRunsManagement,
  PlaybookRunDetailView,
  IntegrationsManagement,
  NotificationsPanel,
  ApprovalsManagement,
  GlobalSearchPage,
} from '@/features/soar/gateway';
import { testConnector } from '@/lib/lumisec-api/browser/soarConnectors';
import type { SoarNavTarget, SoarNavigate } from '@/lib/soar/mode';
import {
  GATEWAY_SIDEBAR_SECTIONS,
  LEGACY_SIDEBAR_PAGES,
  type SidebarPageDef,
} from '@/lib/soar/sidebar-nav';

function formatPageTitle(page: Page): string {
  const titles: Record<string, string> = {
    dashboard: 'Dashboard',
    workflows: 'Workflows',
    'workflow-builder': 'Workflow Builder',
    cases: 'Cases',
    integrations: 'Integrations',
    playbooks: 'Playbooks',
    alerts: 'Alerts',
    analytics: 'Analytics',
    settings: 'Settings',
    'threat-ops': 'Threat Operations',
    'incident-detail': 'Incident Detail',
    incidents: 'Incidents',
    connectors: 'Connectors',
    vault: 'Vault',
    artifacts: 'Artifacts',
    'webhook-sources': 'Webhook Sources',
    'playbook-runs': 'Playbook Runs',
    approvals: 'Approvals',
    search: 'Search',
    'outbound-actions': 'Outbound Actions',
  };
  return titles[page] ?? page.replaceAll('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SoarApp() {
  const { enabled: gatewayMode } = useGatewayMode();
  const [page, setPage] = useState<Page>('dashboard');
  const [gatewayIncidentId, setGatewayIncidentId] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [playbookRunsFilterId, setPlaybookRunsFilterId] = useState<string | undefined>(undefined);
  const [selectedPlaybookRunId, setSelectedPlaybookRunId] = useState<string | null>(null);
  // Persist sidebar + darkMode in localStorage so they survive reloads
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [alertSeverityFilter, setAlertSeverityFilter] = useState('');
  const [integrationCategoryFilter, setIntegrationCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [builderFocusRun, setBuilderFocusRun] = useState(false);

  // Data
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [activityFeed, setActivityFeed] = useState<{ type: string; message: string; time: string; severity: string }[]>([]);
  const [severityDist, setSeverityDist] = useState({ critical: 0, high: 0, medium: 0, low: 0 });

  // Workflow Builder state
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  // Currently selected incident id (case or alert) — drives the IncidentDetailView
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);

  // Dialog states
  const [showNewWorkflow, setShowNewWorkflow] = useState(false);
  const [showNewCase, setShowNewCase] = useState(false);
  const [showNewAlert, setShowNewAlert] = useState(false);
  const [showNewPlaybook, setShowNewPlaybook] = useState(false);
  const [showNewIntegration, setShowNewIntegration] = useState(false);
  // Playbook → Workflow link dialog: holds the playbook id being linked, or null
  const [linkingPlaybookId, setLinkingPlaybookId] = useState<string | null>(null);
  // Playbook run dialog: holds the playbook being run, so the user can supply
  // a trigger payload (e.g. {"ip":"8.8.8.8"}) before the workflow starts.
  const [runningPlaybook, setRunningPlaybook] = useState<Playbook | null>(null);

  // Integration config modal
  const [configuringIntegration, setConfiguringIntegration] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    setAlertSeverityFilter('');
    setIntegrationCategoryFilter('');
  }, [page]);

  const soarNavigate: SoarNavigate = useCallback((target: SoarNavTarget) => {
    switch (target.page) {
      case 'incidents':
        setGatewayIncidentId(null);
        setPage('incidents');
        break;
      case 'gateway-incident-detail':
        setGatewayIncidentId(target.incidentId);
        setPage('gateway-incident-detail');
        break;
      case 'playbooks':
        setSelectedPlaybookRunId(null);
        setPage('playbooks');
        break;
      case 'playbook-runs':
        setPlaybookRunsFilterId(target.playbookId);
        setSelectedPlaybookRunId(null);
        setPage('playbook-runs');
        break;
      case 'playbook-run-detail':
        setSelectedPlaybookRunId(target.runId);
        setPage('playbook-run-detail');
        break;
      case 'alerts':
        setSelectedAlertId(target.alertId ?? null);
        setPage('alerts');
        break;
      default:
        break;
    }
  }, []);

  // Toggle dark mode + persist
  useEffect(() => {
    // Read persisted prefs on first mount — fall back to OS preference for dark mode
    try {
      const savedDark = localStorage.getItem('soar:darkMode');
      const savedSidebar = localStorage.getItem('soar:sidebarCollapsed');
      if (savedDark !== null) {
        setDarkMode(savedDark === 'true');
      } else if (typeof window !== 'undefined' && window.matchMedia) {
        // Respect OS color scheme on first visit (no saved preference)
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        setDarkMode(prefersDark);
      }
      if (savedSidebar !== null) setSidebarCollapsed(savedSidebar === 'true');
    } catch {/* ignore */}
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('soar:darkMode', String(darkMode)); } catch {/* ignore */}
  }, [darkMode]);

  useEffect(() => {
    try { localStorage.setItem('soar:sidebarCollapsed', String(sidebarCollapsed)); } catch {/* ignore */}
  }, [sidebarCollapsed]);

  const fetchGatewayMetrics = useCallback(async () => {
    try {
      const [overview, alertPage, wfRes, playbookRes] = await Promise.all([
        fetchDashboardOverview(),
        fetchSoarAlerts({ page: 1, limit: 1 }),
        soarFetch<Record<string, unknown>[]>('/api/workflows'),
        soarFetch<Record<string, unknown>[]>('/api/playbooks'),
      ]);
      const wfCount = wfRes.ok ? asArray<Record<string, unknown>>(wfRes.data).length : 0;
      const pbCount = playbookRes.ok ? asArray<Record<string, unknown>>(playbookRes.data).length : 0;
      setMetrics({
        openCases: Number(overview.open_incidents ?? 0),
        criticalCases: Number(overview.critical_count ?? 0),
        newAlerts: alertPage.pagination.total,
        activeWorkflows: wfCount,
        connectedIntegrations: Number(overview.connected_integrations ?? 0),
        runningExecutions: Number(overview.running_executions ?? 0),
        recentAlerts: Number(overview.recent_alerts_24h ?? 0),
        recentCases: Number(overview.recent_cases_24h ?? 0),
        recentExecutions: Number(overview.total_executions ?? 0),
        totalWorkflows: wfCount,
        totalCases: Number(overview.open_incidents ?? 0),
        totalAlerts: alertPage.pagination.total,
        totalPlaybooks: pbCount,
        externalBackendOk: true,
      });
    } catch {
      /* gateway metrics optional on first paint */
    }
  }, []);

  const fetchDashboard = useCallback(async () => {
    const r = await soarFetch<{ metrics?: DashboardMetrics; severityDistribution?: typeof severityDist; activityFeed?: typeof activityFeed }>('/api/dashboard');
    if (!r.ok || !r.data) return;
    if (r.data.metrics) setMetrics(r.data.metrics);
    if (r.data.severityDistribution) setSeverityDist(r.data.severityDistribution);
    if (r.data.activityFeed) setActivityFeed(r.data.activityFeed);
  }, []);

  const fetchWorkflows = useCallback(async () => {
    const r = await soarFetch<Record<string, unknown>[]>('/api/workflows');
    if (!r.ok) return;
    setWorkflows(asArray<Record<string, unknown>>(r.data).map((w) => ({
      ...w,
      nodes: typeof w.nodes === 'string' ? JSON.parse(w.nodes as string) : w.nodes,
      edges: typeof w.edges === 'string' ? JSON.parse(w.edges as string) : w.edges,
      trigger: typeof w.trigger === 'string' ? JSON.parse(w.trigger as string) : w.trigger,
      tags: typeof w.tags === 'string' ? JSON.parse(w.tags as string) : w.tags,
    })) as Workflow[]);
  }, []);

  const fetchCases = useCallback(async () => {
    const r = await soarFetch<Record<string, unknown>[]>('/api/cases');
    if (!r.ok) return;
    setCases(asArray<Record<string, unknown>>(r.data).map((c) => ({
      ...c,
      tags: typeof c.tags === 'string' ? JSON.parse(c.tags as string) : c.tags,
      artifacts: typeof c.artifacts === 'string' ? JSON.parse(c.artifacts as string) : c.artifacts,
      timeline: typeof c.timeline === 'string' ? JSON.parse(c.timeline as string) : c.timeline,
    })) as CaseItem[]);
  }, []);

  const fetchIntegrations = useCallback(async () => {
    const r = await soarFetch<Record<string, unknown>[]>('/api/integrations');
    if (!r.ok) return;
    setIntegrations(asArray<Record<string, unknown>>(r.data).map((i) => ({
      ...i,
      config: typeof i.config === 'string' ? JSON.parse(i.config as string) : i.config,
    })) as Integration[]);
  }, []);

  const fetchPlaybooks = useCallback(async () => {
    const r = await soarFetch<Record<string, unknown>[]>('/api/playbooks');
    if (!r.ok) return;
    setPlaybooks(asArray<Record<string, unknown>>(r.data).map((p) => ({
      ...p,
      steps: typeof p.steps === 'string' ? JSON.parse(p.steps as string) : p.steps,
      triggers: typeof p.triggers === 'string' ? JSON.parse(p.triggers as string) : p.triggers,
      tags: typeof p.tags === 'string' ? JSON.parse(p.tags as string) : p.tags,
      workflowId: p.workflowId ?? null,
    })) as Playbook[]);
  }, []);

  const fetchAlerts = useCallback(async () => {
    const r = await soarFetch<Record<string, unknown>[]>('/api/alerts');
    if (!r.ok) return;
    setAlerts(asArray<Record<string, unknown>>(r.data).map((a) => ({
      ...a,
      raw: typeof a.raw === 'string' ? JSON.parse(a.raw as string) : a.raw,
    })) as AlertItem[]);
  }, []);

  useEffect(() => {
    const init = async () => {
      if (gatewayMode) {
        await fetchWorkflows();
        await fetchGatewayMetrics();
      } else {
        await Promise.all([
          fetchDashboard(),
          fetchWorkflows(),
          fetchCases(),
          fetchIntegrations(),
          fetchPlaybooks(),
          fetchAlerts(),
        ]);
      }
      setLoading(false);
    };
    init();
  }, [
    gatewayMode,
    fetchGatewayMetrics,
    fetchDashboard,
    fetchWorkflows,
    fetchCases,
    fetchIntegrations,
    fetchPlaybooks,
    fetchAlerts,
  ]);

  // ========== ACTIONS ==========
  const workflowNeedsTriggerPayload = (wf: Workflow) =>
    wf.nodes.some(n => {
      const st = n.subtype || (n.data.config?.subtype as string | undefined);
      return st === 'email' || st === 'telegram';
    });

  const executeWorkflow = async (id: string) => {
    const wf = workflows.find(w => w.id === id);
    if (wf && workflowNeedsTriggerPayload(wf)) {
      setBuilderFocusRun(true);
      openWorkflowBuilder(wf);
      toast({
        title: 'Set run data first',
        description: 'This workflow needs a recipient in the Run panel (Logs tab). Fill "To" then click Run Test.',
      });
      return;
    }
    try {
      const r = await soarFetch('/api/workflow-executions', {
        method: 'POST',
        body: JSON.stringify({ workflowId: id }),
      });
      if (!r.ok) {
        toast({ title: 'Execution failed', description: r.error || 'Unknown', variant: 'destructive' });
        return;
      }
      toast({ title: 'Execution started', description: 'Workflow is now running. Open Workflow Builder to see live logs.' });
      fetchDashboard(); fetchWorkflows();
    } catch (e) {
      toast({ title: 'Network error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const deleteWorkflow = async (id: string) => {
    try {
      await soarFetch(`/api/workflows?id=${id}`, { method: 'DELETE' });
      toast({ title: 'Workflow deleted' });
      fetchWorkflows(); fetchDashboard();
    } catch (e) { toast({ title: 'Delete failed', description: String(e), variant: 'destructive' }); }
  };

  const deleteCase = async (id: string) => {
    try {
      await soarFetch(`/api/cases?id=${id}`, { method: 'DELETE' });
      toast({ title: 'Case deleted' });
      fetchCases(); fetchDashboard();
    } catch (e) { toast({ title: 'Delete failed', description: String(e), variant: 'destructive' }); }
  };

  const deleteAlert = async (id: string) => {
    try {
      await soarFetch(`/api/alerts?id=${id}`, { method: 'DELETE' });
      toast({ title: 'Alert deleted' });
      fetchAlerts(); fetchDashboard();
    } catch (e) { toast({ title: 'Delete failed', description: String(e), variant: 'destructive' }); }
  };

  const deletePlaybook = async (id: string) => {
    try {
      await soarFetch(`/api/playbooks?id=${id}`, { method: 'DELETE' });
      toast({ title: 'Playbook deleted' });
      fetchPlaybooks(); fetchDashboard();
    } catch (e) { toast({ title: 'Delete failed', description: String(e), variant: 'destructive' }); }
  };

  // Duplicate a playbook — fetches the source row, strips the id, and POSTs a copy
  const duplicatePlaybook = async (id: string) => {
    try {
      const res = await soarFetch<Record<string, unknown>>(`/api/playbooks?id=${id}`);
      if (!res.ok || !res.data) throw new Error(res.error || 'Failed to load playbook');
      const src = res.data;
      const body = {
        name: `${src.name || 'Playbook'} (Copy)`,
        description: src.description || '',
        category: src.category || 'incident_response',
        steps: src.steps || [],
        triggers: src.triggers || [],
        tags: src.tags || [],
        status: 'draft',
      };
      const postRes = await soarFetch('/api/playbooks', {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!postRes.ok) throw new Error(postRes.error || 'Failed to create copy');
      toast({ title: 'Playbook duplicated', description: body.name });
      fetchPlaybooks(); fetchDashboard();
    } catch (e) {
      toast({ title: 'Duplicate failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  // Toggle a playbook between active and draft
  const togglePlaybookStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'draft' : 'active';
    try {
      const res = await soarFetch('/api/playbooks', {
        method: 'PUT', body: JSON.stringify({ id, status: newStatus }),
      });
      if (!res.ok) throw new Error(res.error || 'Failed to update status');
      toast({ title: `Playbook ${newStatus === 'active' ? 'activated' : 'deactivated'}` });
      fetchPlaybooks(); fetchDashboard();
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  // Execute a playbook — runs the linked workflow with an optional trigger payload.
  // If the playbook has no linked workflow, shows a toast prompting the user to link one.
  const executePlaybook = async (pb: Playbook, triggerPayload?: Record<string, unknown>) => {
    if (!pb.workflowId) {
      toast({
        title: 'No linked workflow',
        description: 'This playbook is documentation-only. Link a workflow to enable execution.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const res = await soarFetch<{ workflowName?: string }>(`/api/playbooks/${pb.id}/execute`, {
        method: 'POST', body: JSON.stringify({ trigger: triggerPayload || {} }),
      });
      if (!res.ok) {
        toast({ title: 'Execution failed', description: res.error, variant: 'destructive' });
        return;
      }
      const data = res.data ?? {};
      toast({
        title: 'Playbook execution started',
        description: `"${pb.name}" is now running workflow "${data.workflowName}".`,
      });
      fetchDashboard();
    } catch (e) {
      toast({ title: 'Network error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  // Link a playbook to a workflow (or unlink when workflowId is null)
  const linkPlaybookWorkflow = async (playbookId: string, workflowId: string | null) => {
    try {
      const res = await soarFetch('/api/playbooks', {
        method: 'PUT', body: JSON.stringify({ id: playbookId, workflowId }),
      });
      if (!res.ok) throw new Error(res.error || 'Failed to update link');
      toast({
        title: workflowId ? 'Workflow linked' : 'Workflow unlinked',
        description: workflowId ? 'Playbook can now be executed.' : 'Playbook is now documentation-only.',
      });
      fetchPlaybooks();
    } catch (e) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const toggleIntegration = async (id: string, currentStatus: string) => {
    if (currentStatus !== 'connected') {
      setConfiguringIntegration(id);
      toast({
        title: 'Configure credentials first',
        description: 'Enter API keys and use Save & Test — connections require a successful test.',
      });
      return;
    }
    try {
      await soarFetch('/api/integrations', { method: 'PUT', body: JSON.stringify({ id, status: 'disconnected' }) });
      toast({ title: 'Integration disconnected' });
      fetchIntegrations(); fetchDashboard();
    } catch (e) { toast({ title: 'Toggle failed', description: String(e), variant: 'destructive' }); }
  };

  const updateAlertStatus = async (id: string, status: string) => {
    try {
      await soarFetch('/api/alerts', { method: 'PUT', body: JSON.stringify({ id, status }) });
      toast({ title: `Alert marked as ${status}` });
      fetchAlerts(); fetchDashboard();
    } catch (e) { toast({ title: 'Update failed', description: String(e), variant: 'destructive' }); }
  };

  const updateCaseStatus = async (id: string, status: string) => {
    try {
      await soarFetch('/api/cases', { method: 'PUT', body: JSON.stringify({ id, status }) });
      toast({ title: `Case marked as ${status}` });
      fetchCases(); fetchDashboard();
    } catch (e) { toast({ title: 'Update failed', description: String(e), variant: 'destructive' }); }
  };

  // Workflow Builder
  const openWorkflowBuilder = (wf?: Workflow) => {
    if (wf) {
      setEditingWorkflow(wf);
    } else {
      const newWf: Workflow = {
        id: `new-${Date.now()}`, name: 'New Workflow', description: '', status: 'draft',
        nodes: [{ id: 'n1', type: 'trigger', position: { x: 80, y: 250 }, data: { label: 'New Trigger', config: {} } }],
        edges: [], trigger: {}, tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      setEditingWorkflow(newWf);
    }
    setPage('workflow-builder');
  };

  const saveWorkflow = async (opts?: { stayOnPage?: boolean; activate?: boolean }): Promise<{ ok: boolean; workflowId?: string }> => {
    if (!editingWorkflow) return { ok: false };
    try {
      const isNew = editingWorkflow.id.startsWith('new-');
      const normalizedNodes = editingWorkflow.nodes.map(n => {
        const norm = normalizeWorkflowNode({
          id: n.id,
          type: n.type,
          subtype: n.subtype || (n.data.config?.subtype as string | undefined),
          position: n.position,
          data: { label: n.data.label, description: n.data.description, config: n.data.config || {} },
        } as WFNode);
        return {
          id: norm.id,
          type: norm.type,
          subtype: norm.subtype,
          position: norm.position,
          data: norm.data,
        };
      });
      const status = opts?.activate ? 'active' : editingWorkflow.status;
      const body = { ...editingWorkflow, status, nodes: normalizedNodes };
      if (isNew) {
        const { id, ...data } = body;
        const res = await soarFetch<{ id?: string }>('/api/workflows', { method: 'POST', body: JSON.stringify(data) });
        if (!res.ok) {
          toast({ title: 'Save failed', description: res.error, variant: 'destructive' });
          return { ok: false };
        }
        const created = res.data ?? {};
        const newId = created.id as string;
        toast({ title: 'Workflow created', description: editingWorkflow.name });
        if (opts?.stayOnPage) {
          setEditingWorkflow({ ...editingWorkflow, id: newId, status, nodes: normalizedNodes });
          fetchWorkflows();
          return { ok: true, workflowId: newId };
        }
      } else {
        const res = await soarFetch('/api/workflows', { method: 'PUT', body: JSON.stringify(body) });
        if (!res.ok) {
          toast({ title: 'Save failed', description: res.error, variant: 'destructive' });
          return { ok: false };
        }
        toast({ title: opts?.activate ? 'Workflow activated' : 'Workflow saved', description: editingWorkflow.name });
        if (opts?.stayOnPage) {
          setEditingWorkflow({ ...editingWorkflow, status, nodes: normalizedNodes });
          fetchWorkflows();
          return { ok: true, workflowId: editingWorkflow.id };
        }
      }
      fetchWorkflows();
      if (!opts?.stayOnPage) {
        setPage('workflows');
        setEditingWorkflow(null);
      }
      return { ok: true, workflowId: editingWorkflow.id.startsWith('new-') ? undefined : editingWorkflow.id };
    } catch (e) {
      toast({ title: 'Save error', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      return { ok: false };
    }
  };

  // ========== SIDEBAR ==========
  const pageIcons: Record<string, React.ReactNode> = {
    dashboard: <LayoutDashboard className="h-5 w-5" />,
    'threat-ops': <Radar className="h-5 w-5" />,
    incidents: <FolderOpen className="h-5 w-5" />,
    cases: <FolderOpen className="h-5 w-5" />,
    alerts: <Bell className="h-5 w-5" />,
    playbooks: <BookOpen className="h-5 w-5" />,
    'playbook-runs': <Activity className="h-5 w-5" />,
    connectors: <Plug className="h-5 w-5" />,
    integrations: <Puzzle className="h-5 w-5" />,
    vault: <KeyRound className="h-5 w-5" />,
    artifacts: <Hash className="h-5 w-5" />,
    'webhook-sources': <Webhook className="h-5 w-5" />,
    workflows: <GitBranch className="h-5 w-5" />,
    analytics: <BarChart3 className="h-5 w-5" />,
    settings: <Settings className="h-5 w-5" />,
  };

  const resolveBadge = (def: SidebarPageDef): number | undefined => {
    if (!metrics || !def.badgeKey) return undefined;
    if (def.badgeKey === 'newAlerts') return metrics.newAlerts;
    if (def.badgeKey === 'openCases') return metrics.openCases;
    if (def.badgeKey === 'activeWorkflows') return metrics.activeWorkflows;
    return undefined;
  };

  const renderNavButton = (def: SidebarPageDef) => {
    const badge = resolveBadge(def);
    return (
      <Tooltip key={def.page} delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            onClick={() => { setPage(def.page); setMobileSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors relative group
              ${page === def.page || (page === 'workflow-builder' && def.page === 'workflows')
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'}`}
          >
            {pageIcons[def.page]}
            {!sidebarCollapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="truncate">{def.label}</motion.span>
            )}
            {badge != null && badge > 0 && (
              <span className={`${sidebarCollapsed ? 'absolute top-1 right-1' : 'ml-auto'} bg-red-500 text-white text-[10px] font-bold rounded-full h-4 min-w-4 flex items-center justify-center px-1`}>
                {badge}
              </span>
            )}
          </button>
        </TooltipTrigger>
        {sidebarCollapsed && <TooltipContent side="right">{def.label}</TooltipContent>}
      </Tooltip>
    );
  };

  // ========== RENDER ==========
  if (loading) {
    return (
      <div className="h-full min-h-screen flex items-center justify-center bg-background">
        {/* Static fallback (visible before framer-motion hydrates) */}
        <noscript>
          <div className="flex flex-col items-center gap-4">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25">
              <Shield className="h-7 w-7 text-primary-foreground" />
            </div>
            <div className="text-center space-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight">LumiSec SOAR</h2>
              <p className="text-muted-foreground text-sm">Loading…</p>
            </div>
          </div>
        </noscript>
        <motion.div
          initial={false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="flex flex-col items-center gap-5"
        >
          <div className="relative">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0 -m-3 border-2 border-primary/15 border-t-primary rounded-full"
            />
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/25">
              <Shield className="h-7 w-7 text-primary-foreground" />
            </div>
          </div>
          <div className="text-center space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight">LumiSec SOAR</h2>
            <p className="text-muted-foreground text-sm flex items-center gap-1.5 justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot" />
              Initializing security platform...
            </p>
          </div>
          <Progress className="w-56 h-1.5" />
        </motion.div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="h-screen flex overflow-hidden bg-background">
        {/* Mobile sidebar backdrop */}
        {mobileSidebarOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setMobileSidebarOpen(false)}
          />
        )}
        {/* Sidebar */}
        <motion.aside
          initial={false}
          animate={{ width: sidebarCollapsed ? 64 : 256 }}
          className={`h-full shrink-0 bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border z-40
            fixed md:relative inset-y-0 left-0
            ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
        >
          {/* Logo */}
          <div className="h-16 flex items-center gap-3 px-4 border-b border-sidebar-border">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shrink-0 shadow-sm shadow-primary/30">
              <Shield className="h-5 w-5 text-primary-foreground" />
            </div>
            {!sidebarCollapsed && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-hidden">
                <h1 className="font-bold text-base leading-tight tracking-tight">LumiSec SOAR</h1>
                <p className="text-[10px] text-sidebar-foreground/50 leading-tight">Security Orchestration Platform</p>
              </motion.div>
            )}
          </div>

          {/* Nav */}
          <nav className="flex-1 py-2 overflow-y-auto">
            {gatewayMode
              ? GATEWAY_SIDEBAR_SECTIONS.map((section, si) => (
                <div key={si} className={si > 0 ? 'mt-1 pt-1 border-t border-sidebar-border/60' : ''}>
                  {section.label && !sidebarCollapsed && (
                    <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                      {section.label}
                    </p>
                  )}
                  {section.pages.map(renderNavButton)}
                </div>
              ))
              : LEGACY_SIDEBAR_PAGES.map(renderNavButton)}
          </nav>

          {/* Bottom */}
          <div className="p-2 border-t border-sidebar-border">
            <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-sidebar-foreground/50 hover:text-sidebar-foreground rounded-md hover:bg-sidebar-accent/50 transition-colors">
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              {!sidebarCollapsed && <span>Collapse</span>}
            </button>
          </div>
        </motion.aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Top Bar */}
          <header className="shrink-0 h-16 bg-background border-b border-border flex items-center justify-between px-4 sm:px-6 z-30">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Mobile sidebar toggle */}
              <Button variant="ghost" size="icon" className="md:hidden shrink-0" onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}>
                <ChevronRight className={`h-5 w-5 transition-transform ${mobileSidebarOpen ? 'rotate-180' : ''}`} />
              </Button>
              <h2 className="text-base sm:text-lg font-semibold truncate">{formatPageTitle(page)}</h2>
              {metrics && (page === 'dashboard' || page === 'alerts') && metrics.runningExecutions > 0 && (
                <Badge variant="outline" className="hidden sm:flex bg-green-500/10 text-green-600 border-green-500/20 gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500 pulse-dot" />
                  {metrics.runningExecutions} Running
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <Button variant="ghost" size="icon" onClick={() => setDarkMode(!darkMode)} aria-label="Toggle dark mode" className="shrink-0">
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              {gatewayMode && <NotificationsPanel onNavigate={soarNavigate} />}
              <UserMenu onOpenSettings={() => setPage('settings')} />
            </div>
          </header>

          {/* Page Content — scroll contained here, not on document body */}
          <div className={`flex-1 min-h-0 overflow-y-auto ${page === 'workflow-builder' ? 'flex flex-col' : 'p-4 sm:p-6'}`}>
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                className={page === 'workflow-builder' ? 'flex-1 min-h-0 flex flex-col min-w-0 overflow-hidden' : 'min-w-0'}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >

                {page === 'dashboard' && gatewayMode && <DashboardOverview />}

                {/* ===== DASHBOARD (local BFF) ===== */}
                {page === 'dashboard' && !gatewayMode && metrics && (
                  <div className="space-y-6">
                    {/* Quick security access banner */}
                    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20">
                      <Radar className="h-5 w-5 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">Threat Operations Center</p>
                        <p className="text-xs text-muted-foreground">Real-time threat monitoring, incident queue, and global threat intel</p>
                      </div>
                      <Button size="sm" variant="default" onClick={() => setPage('threat-ops')}>
                        Open Threat Ops <ChevronRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setPage('analytics')}>
                        <BarChart3 className="h-3.5 w-3.5 mr-1" /> Analytics
                      </Button>
                    </div>

                    {/* Metric Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      {[
                        { label: 'Open Cases', value: metrics.openCases, icon: <FolderOpen className="h-5 w-5" />, color: 'text-blue-500', bg: 'bg-blue-500/10', sub: metrics.recentCases ? `${metrics.recentCases} new (24h)` : 'No new cases (24h)' },
                        { label: 'Critical Alerts', value: metrics.criticalCases, icon: <AlertTriangle className="h-5 w-5" />, color: 'text-red-500', bg: 'bg-red-500/10', sub: `${metrics.newAlerts} open` },
                        { label: 'Active Workflows', value: metrics.activeWorkflows, icon: <GitBranch className="h-5 w-5" />, color: 'text-emerald-500', bg: 'bg-emerald-500/10', sub: `${metrics.totalWorkflows} total` },
                        { label: 'New Alerts (24h)', value: metrics.recentAlerts, icon: <Bell className="h-5 w-5" />, color: 'text-amber-500', bg: 'bg-amber-500/10', sub: metrics.recentExecutions ? `${metrics.recentExecutions} runs (24h)` : 'No runs (24h)' },
                      ].map((m, i) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
                          <Card data-interactive-card>
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className={`p-2 rounded-lg ${m.bg} ${m.color}`} aria-hidden>{m.icon}</div>
                                <span className="text-[10px] text-muted-foreground font-medium truncate max-w-[160px] lg:max-w-none text-right lg:text-left">
                                  {m.sub}
                                </span>
                              </div>
                              <div className="mt-3">
                                <p className="text-2xl font-bold tabular-nums">{m.value}</p>
                                <p className="text-xs text-muted-foreground mt-0.5">{m.label}</p>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ))}
                    </div>

                    {/* Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Alert Severity Distribution */}
                      <Card data-interactive-card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-semibold">Alert Severity Distribution</CardTitle>
                          <CardDescription className="text-[11px]">Total alerts grouped by severity</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-3">
                            {Object.entries(severityDist).map(([key, val]) => {
                              const total = Object.values(severityDist).reduce((a, b) => a + b, 0) || 1;
                              const pct = Math.round((val / total) * 100);
                              const colors: Record<string, string> = { critical: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-yellow-500', low: 'bg-green-500' };
                              return (
                                <div key={key} className="space-y-1">
                                  <div className="flex justify-between text-xs">
                                    <span className="capitalize font-medium">{key}</span>
                                    <span className="text-muted-foreground">{val} ({pct}%)</span>
                                  </div>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                                    <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: 0.2 }} className={`h-full rounded-full ${colors[key]}`} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Quick Stats */}
                      <Card data-interactive-card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-semibold">Platform Overview</CardTitle>
                          <CardDescription className="text-[11px]">System resources and counts</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { label: 'Total Workflows', value: metrics.totalWorkflows, icon: <GitBranch className="h-4 w-4" /> },
                              { label: 'Total Cases', value: metrics.totalCases, icon: <FolderOpen className="h-4 w-4" /> },
                              { label: 'Integrations', value: metrics.connectedIntegrations, icon: <Puzzle className="h-4 w-4" /> },
                              { label: 'Playbooks', value: metrics.totalPlaybooks, icon: <BookOpen className="h-4 w-4" /> },
                              { label: 'Executions (24h)', value: metrics.recentExecutions, icon: <Activity className="h-4 w-4" /> },
                              { label: 'New Cases (24h)', value: metrics.recentCases, icon: <TrendingUp className="h-4 w-4" /> },
                            ].map((s, i) => (
                              <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/50 hover:bg-muted transition-colors">
                                <div className="text-muted-foreground" aria-hidden>{s.icon}</div>
                                <div>
                                  <p className="text-lg font-bold leading-tight tabular-nums">{s.value}</p>
                                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* External backend (Node.js + MongoDB) connection status */}
                          <div className="mt-3 pt-3 border-t border-border">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-[10px] text-muted-foreground truncate">External Backend (Node.js + Mongo)</span>
                              </div>
                              <Badge variant="outline" className={
                                metrics.externalBackendOk
                                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                  : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                              }>
                                <span className={`h-1.5 w-1.5 rounded-full mr-1 ${metrics.externalBackendOk ? 'bg-emerald-500 pulse-dot' : 'bg-amber-500'}`} />
                                {metrics.externalBackendOk ? 'Connected' : 'Offline'}
                              </Badge>
                            </div>
                            {metrics.externalBackendOk && (
                              <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
                                <span>External incidents: <span className="font-medium text-foreground tabular-nums">{metrics.externalIncidents ?? 0}</span></span>
                                <span>External assets: <span className="font-medium text-foreground tabular-nums">{metrics.externalAssets ?? 0}</span></span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Activity Feed */}
                      <Card data-interactive-card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
                          <CardDescription className="text-[11px]">Latest platform events</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ScrollArea className="h-64">
                            <div className="space-y-3">
                              {activityFeed.map((item, i) => (
                                <div key={i} className="flex items-start gap-2">
                                  <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${item.severity === 'critical' ? 'bg-red-500' : item.severity === 'high' ? 'bg-orange-500' : item.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'}`} />
                                  <div className="min-w-0">
                                    <p className="text-xs truncate">{item.message}</p>
                                    <p className="text-[10px] text-muted-foreground">{formatDate(item.time)}</p>
                                  </div>
                                </div>
                              ))}
                              {activityFeed.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No recent activity</p>}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Recent Items */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Recent Workflows */}
                      <Card data-interactive-card>
                        <CardHeader className="pb-3 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-semibold">Active Workflows</CardTitle>
                          <button className="view-all-link" type="button" onClick={() => setPage('workflows')}>View All <ChevronRight className="h-3 w-3" /></button>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {workflows.filter(w => w.status === 'active').length === 0 ? (
                              <div className="text-center py-6 text-xs text-muted-foreground">
                                No active workflows yet
                              </div>
                            ) : workflows.filter(w => w.status === 'active').slice(0, 3).map(wf => (
                              <div key={wf.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors">
                                <div className="flex items-center gap-2 min-w-0">
                                  <GitBranch className="h-4 w-4 text-primary shrink-0" aria-hidden />
                                  <span className="text-sm truncate">{wf.name}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant="outline" className={statusColor(wf.status)}>{wf.status}</Badge>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => executeWorkflow(wf.id)} aria-label="Execute workflow" data-ui-button>
                                    <Play className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Recent Cases */}
                      <Card data-interactive-card>
                        <CardHeader className="pb-3 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm font-semibold">Open Cases</CardTitle>
                          <button className="view-all-link" type="button" onClick={() => setPage('cases')}>View All <ChevronRight className="h-3 w-3" /></button>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-2">
                            {cases.filter(c => c.status !== 'closed').length === 0 ? (
                              <div className="text-center py-6 text-xs text-muted-foreground">
                                No open cases
                              </div>
                            ) : cases.filter(c => c.status !== 'closed').slice(0, 3).map(c => (
                              <div key={c.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors">
                                <div className="flex items-center gap-2 min-w-0">
                                  <FolderOpen className="h-4 w-4 text-blue-500 shrink-0" aria-hidden />
                                  <span className="text-sm truncate">{c.title}</span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant="outline" className={severityColor(c.severity)}>{c.severity}</Badge>
                                  <Badge variant="outline" className={statusColor(c.status)}>{c.status}</Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                )}

                {/* ===== THREAT OPS ===== */}
                {page === 'threat-ops' && (
                  <ThreatOpsView
                    gatewayMode={gatewayMode}
                    onInvestigate={(id, kind) => {
                    if (gatewayMode) {
                      if (kind === 'alert') {
                        setSelectedAlertId(id);
                        setPage('alerts');
                      } else {
                        setGatewayIncidentId(id);
                        setPage('gateway-incident-detail');
                      }
                    } else {
                      setSelectedIncidentId(id);
                      setPage('incident-detail');
                    }
                  }} />
                )}

                {/* ===== GATEWAY: INCIDENTS ===== */}
                {page === 'incidents' && gatewayMode && (
                  <IncidentsList onSelectIncident={(id) => { setGatewayIncidentId(id); setPage('gateway-incident-detail'); }} />
                )}

                {page === 'approvals' && gatewayMode && <ApprovalsManagement />}

                {page === 'search' && gatewayMode && (
                  <GlobalSearchPage onNavigate={soarNavigate} />
                )}

                {page === 'gateway-incident-detail' && gatewayMode && gatewayIncidentId && (
                  <IncidentDetailPage
                    incidentId={gatewayIncidentId}
                    onBack={() => { setGatewayIncidentId(null); setPage('incidents'); }}
                    onNavigateIncident={(id) => setGatewayIncidentId(id)}
                    onNavigate={soarNavigate}
                  />
                )}

                {page === 'playbook-runs' && gatewayMode && (
                  <PlaybookRunsManagement
                    playbookId={playbookRunsFilterId}
                    onNavigate={soarNavigate}
                    onBack={() => soarNavigate({ page: 'playbooks' })}
                  />
                )}

                {page === 'playbook-run-detail' && gatewayMode && selectedPlaybookRunId && (
                  <PlaybookRunDetailView
                    runId={selectedPlaybookRunId}
                    onNavigate={soarNavigate}
                    onBack={() => soarNavigate({ page: 'playbook-runs', playbookId: playbookRunsFilterId })}
                  />
                )}

                {page === 'connectors' && gatewayMode && <ConnectorsManagement />}
                {page === 'vault' && gatewayMode && <VaultManagement />}
                {page === 'artifacts' && gatewayMode && <ArtifactsManagement />}
                {page === 'webhook-sources' && gatewayMode && <WebhookSourcesManagement />}

                {/* ===== ANALYTICS ===== */}
                {page === 'analytics' && (gatewayMode ? <AnalyticsPage /> : <AnalyticsView />)}

                {/* ===== INCIDENT DETAIL ===== */}
                {page === 'incident-detail' && selectedIncidentId && (
                  <IncidentDetailView
                    incidentId={selectedIncidentId}
                    onBack={() => { setSelectedIncidentId(null); setPage('threat-ops'); }}
                    onClose={() => { setSelectedIncidentId(null); setPage('threat-ops'); }}
                  />
                )}
                {page === 'incident-detail' && !selectedIncidentId && (
                  <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
                    <AlertTriangle className="h-10 w-10 mx-auto mb-3 opacity-25" />
                    No incident selected. Pick one from Threat Ops or the Cases/Alerts list.
                    <div className="mt-4">
                      <Button size="sm" onClick={() => setPage('threat-ops')}>
                        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Threat Ops
                      </Button>
                    </div>
                  </CardContent></Card>
                )}

                {/* ===== WORKFLOWS ===== */}
                {page === 'workflows' && (
                  <div className="space-y-4 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold">Workflows</h3>
                        <p className="text-sm text-muted-foreground">Design and automate security workflows visually</p>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => openWorkflowBuilder()}>
                          <Plus className="h-4 w-4 mr-1" /> New Workflow
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {workflows.map(wf => (
                        <Card key={wf.id} className="hover:shadow-md transition-shadow group overflow-hidden min-w-0">
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2 min-w-0">
                              <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                <div className={`p-1.5 rounded shrink-0 ${wf.status === 'active' ? 'bg-green-500/10 text-green-600' : wf.status === 'draft' ? 'bg-yellow-500/10 text-yellow-600' : 'bg-gray-500/10 text-gray-600'}`}>
                                  <GitBranch className="h-4 w-4" />
                                </div>
                                <div className="min-w-0 flex-1 overflow-hidden">
                                  <CardTitle className="text-sm truncate">{wf.name}</CardTitle>
                                  <CardDescription className="text-xs line-clamp-2 break-words">{wf.description || 'No description'}</CardDescription>
                                </div>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 sm:opacity-100 transition-opacity">
                                    <MoreVertical className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => openWorkflowBuilder(wf)}><Edit3 className="h-4 w-4 mr-2" /> Edit</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => executeWorkflow(wf.id)}><Play className="h-4 w-4 mr-2" /> Execute</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => { updateWorkflowStatus(wf.id, wf.status === 'active' ? 'draft' : 'active'); }}><Pause className="h-4 w-4 mr-2" /> {wf.status === 'active' ? 'Pause' : 'Activate'}</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-red-600" onClick={() => deleteWorkflow(wf.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </CardHeader>
                          <CardContent className="pb-3 min-w-0">
                            <div className="flex flex-wrap items-center gap-1 mb-2">
                                <Badge variant="outline" className={statusColor(wf.status)}>{wf.status}</Badge>
                                <Badge variant="outline" className="text-xs">{wf.nodes?.length || 0} nodes</Badge>
                            </div>
                            <div className="flex flex-wrap gap-1 mb-3 max-h-12 overflow-hidden">
                              {wf.tags?.map((t, i) => (
                                <span key={i} className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground truncate max-w-full">{t}</span>
                              ))}
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground min-w-0">
                              <span className="truncate min-w-0 flex-1">Updated {formatDate(wf.updatedAt)}</span>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => executeWorkflow(wf.id)}>
                                  <Play className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openWorkflowBuilder(wf)}>
                                  <Edit3 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* ===== WORKFLOW BUILDER ===== */}
                {page === 'workflow-builder' && editingWorkflow && (
                  <div className="flex-1 min-h-0 flex flex-col">
                  <WorkflowBuilder
                    workflow={{
                      id: editingWorkflow.id,
                      name: editingWorkflow.name,
                      description: editingWorkflow.description,
                      status: editingWorkflow.status,
                      nodes: editingWorkflow.nodes.map(n => {
                        const subtype = n.subtype || (n.data.config?.subtype as string | undefined);
                        return {
                          id: n.id,
                          type: n.type as 'trigger' | 'action' | 'condition' | 'output',
                          subtype,
                          position: n.position,
                          data: {
                            label: n.data.label,
                            description: n.data.description,
                            config: { ...n.data.config, ...(subtype ? { subtype } : {}) },
                          },
                        };
                      }),
                      edges: editingWorkflow.edges.map(e => ({
                        id: e.id,
                        source: e.source,
                        target: e.target,
                        label: e.label,
                      })),
                    }}
                    onChange={(wf) => {
                      setEditingWorkflow({
                        ...editingWorkflow,
                        name: wf.name,
                        description: wf.description,
                        status: wf.status,
                        nodes: wf.nodes.map(n => {
                          const subtype = n.subtype || (n.data.config?.subtype as string | undefined);
                          return {
                            id: n.id,
                            type: n.type,
                            subtype,
                            position: n.position,
                            data: {
                              label: n.data.label,
                              description: n.data.description,
                              config: { ...n.data.config, subtype: n.subtype || n.data.config?.subtype },
                            },
                          };
                        }),
                        edges: wf.edges.map(e => ({
                          id: e.id,
                          source: e.source,
                          target: e.target,
                          label: e.label,
                        })),
                      });
                    }}
                    onSave={saveWorkflow}
                    onBack={() => { setPage('workflows'); setEditingWorkflow(null); setBuilderFocusRun(false); }}
                    onExecute={() => executeWorkflow(editingWorkflow.id)}
                    focusRunPanel={builderFocusRun}
                  />
                  </div>
                )}

                {/* ===== CASES ===== */}
                {page === 'cases' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">Case Management</h3>
                        <p className="text-sm text-muted-foreground">Track and manage security incidents</p>
                      </div>
                      <Dialog open={showNewCase} onOpenChange={setShowNewCase}>
                        <DialogTrigger asChild>
                          <Button><Plus className="h-4 w-4 mr-1" /> New Case</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Create New Case</DialogTitle>
                            <DialogDescription>Open a new security incident case</DialogDescription>
                          </DialogHeader>
                          <NewCaseForm onSubmit={async (data) => { await soarFetch('/api/cases', { method: 'POST', body: JSON.stringify(data) }); fetchCases(); fetchDashboard(); setShowNewCase(false); }} />
                        </DialogContent>
                      </Dialog>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                      {cases.length === 0 && !loading && (
                        <Card className="lg:col-span-2 xl:col-span-3"><CardContent className="py-12 text-center text-sm text-muted-foreground">
                          <FolderOpen className="h-10 w-10 mx-auto mb-3 opacity-25" />
                          No cases yet. Create a new case or trigger a workflow that creates cases automatically.
                        </CardContent></Card>
                      )}
                      {cases.map(c => (
                        <Card key={c.id} className="hover:shadow-md transition-shadow flex flex-col overflow-hidden min-w-0" data-interactive-card>
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <CardTitle className="text-sm truncate">{c.title}</CardTitle>
                                <CardDescription className="text-xs line-clamp-2">{c.description}</CardDescription>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" data-ui-button><MoreVertical className="h-4 w-4" /></Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => { setSelectedIncidentId(c.id); setPage('incident-detail'); }}><ExternalLink className="h-4 w-4 mr-2" /> View Incident Detail</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => updateCaseStatus(c.id, c.status === 'open' ? 'investigating' : c.status === 'investigating' ? 'contained' : c.status === 'contained' ? 'closed' : 'open')}>
                                    <RotateCcw className="h-4 w-4 mr-2" /> Change Status
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem className="text-red-600" onClick={() => deleteCase(c.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </CardHeader>
                          <CardContent className="pb-3 flex-1 flex flex-col">
                            <div className="flex flex-wrap gap-1 mb-2">
                              <Badge variant="outline" className={severityColor(c.severity)}>{c.severity}</Badge>
                              <Badge variant="outline" className={statusColor(c.status)}>{c.status}</Badge>
                              {c.assignee && <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/20 max-w-full truncate"><User className="h-3 w-3 mr-1 shrink-0" />{c.assignee}</Badge>}
                            </div>
                            <div className="flex flex-wrap gap-1 mb-2">
                              {c.tags?.map((t, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground truncate max-w-full">{t}</span>)}
                            </div>
                            {/* Timeline */}
                            {c.timeline && c.timeline.length > 0 && (
                              <div className="border-t border-border pt-2 mt-2">
                                <p className="text-[10px] font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                                  <Clock className="h-2.5 w-2.5" /> Timeline
                                </p>
                                <div className="space-y-1 max-h-24 overflow-y-auto">
                                  {c.timeline.slice(-3).map((t, i) => (
                                    <div key={i} className="flex items-start gap-1.5 text-[10px] min-w-0">
                                      <CircleDot className="h-2.5 w-2.5 mt-0.5 text-primary shrink-0" />
                                      <span className="text-muted-foreground truncate min-w-0">{new Date(t.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} - {t.event}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {c.artifacts && c.artifacts.length > 0 && (
                              <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
                                <FileText className="h-3 w-3" />
                                {c.artifacts.length} artifact{c.artifacts.length > 1 ? 's' : ''}
                              </div>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/40 flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />
                              Updated {formatDate(c.updatedAt)}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* ===== ALERTS ===== */}
                {page === 'alerts' && gatewayMode && (
                  <AlertsManagement
                    onNavigate={soarNavigate}
                    initialAlertId={selectedAlertId}
                    onInitialAlertConsumed={() => setSelectedAlertId(null)}
                  />
                )}
                {page === 'alerts' && !gatewayMode && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">Alerts</h3>
                        <p className="text-sm text-muted-foreground">Security alerts from all connected sources</p>
                      </div>
                      <Dialog open={showNewAlert} onOpenChange={setShowNewAlert}>
                        <DialogTrigger asChild>
                          <Button><Plus className="h-4 w-4 mr-1" /> Create Alert</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Create Manual Alert</DialogTitle><DialogDescription>Manually create a security alert</DialogDescription></DialogHeader>
                          <NewAlertForm onSubmit={async (data) => { await soarFetch('/api/alerts', { method: 'POST', body: JSON.stringify(data) }); fetchAlerts(); fetchDashboard(); setShowNewAlert(false); }} />
                        </DialogContent>
                      </Dialog>
                    </div>

                    {/* Alert Filters */}
                    <div className="flex gap-2 flex-wrap">
                      {['all', 'critical', 'high', 'medium', 'low'].map(f => (
                        <Button key={f} variant={alertSeverityFilter === f || (f === 'all' && !alertSeverityFilter) ? 'default' : 'outline'} size="sm" onClick={() => setAlertSeverityFilter(f === 'all' ? '' : f)}>
                          {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                          {f !== 'all' && <span className="ml-1 text-[10px] opacity-70">({alerts.filter(a => a.severity === f).length})</span>}
                        </Button>
                      ))}
                    </div>

                    <div className="space-y-2">
                      {alerts.length === 0 && !loading && (
                        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
                          <Bell className="h-10 w-10 mx-auto mb-3 opacity-25" />
                          No alerts. New alerts from connected integrations will appear here.
                        </CardContent></Card>
                      )}
                      {alerts.filter(a => !alertSeverityFilter || a.severity === alertSeverityFilter).map(alert => (
                        <Card key={alert.id} className="hover:shadow-md transition-shadow" data-interactive-card>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className={`p-2 rounded-lg shrink-0 ${severityColor(alert.severity)}`}>
                                <AlertTriangle className="h-4 w-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <h4 className="text-sm font-medium truncate">{alert.title}</h4>
                                    <p className="text-xs text-muted-foreground line-clamp-1">{alert.description}</p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <Badge variant="outline" className={severityColor(alert.severity)}>{alert.severity}</Badge>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" data-ui-button><MoreVertical className="h-4 w-4" /></Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => { setSelectedIncidentId(alert.id); setPage('incident-detail'); }}><ExternalLink className="h-4 w-4 mr-2" /> View Incident Detail</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => updateAlertStatus(alert.id, 'investigating')}><Eye className="h-4 w-4 mr-2" /> Investigate</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => updateAlertStatus(alert.id, 'resolved')}><CheckCircle2 className="h-4 w-4 mr-2" /> Resolve</DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => updateAlertStatus(alert.id, 'new')}><RotateCcw className="h-4 w-4 mr-2" /> Reopen</DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="text-red-600" onClick={() => deleteAlert(alert.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground flex-wrap">
                                  <span className="flex items-center gap-1"><Radar className="h-3 w-3" /> {alert.source}</span>
                                  <Badge variant="outline" className={statusColor(alert.status)}>{alert.status}</Badge>
                                  {alert.assignee && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {alert.assignee}</span>}
                                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDate(alert.createdAt)}</span>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* ===== INTEGRATIONS ===== */}
                {page === 'integrations' && gatewayMode && <IntegrationsManagement />}
                {page === 'integrations' && !gatewayMode && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">Integrations</h3>
                        <p className="text-sm text-muted-foreground">Connect security tools and data sources — set real API keys here</p>
                      </div>
                      <div className="flex gap-2 items-center">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                          {metrics?.connectedIntegrations || 0} Connected
                        </Badge>
                        <Dialog open={showNewIntegration} onOpenChange={setShowNewIntegration}>
                          <DialogTrigger asChild>
                            <Button size="sm" data-ui-button>
                              <Plus className="h-4 w-4 mr-1" /> Add Integration
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-md">
                            <DialogHeader>
                              <DialogTitle>Add Integration</DialogTitle>
                              <DialogDescription>Pick a connector type. You'll set credentials after it's created.</DialogDescription>
                            </DialogHeader>
                            <NewIntegrationForm
                              onSubmit={async (data) => {
                                try {
                                  const res = await soarFetch('/api/integrations', {
                                    method: 'POST', body: JSON.stringify(data),
                                  });
                                  if (!res.ok) {
                                    toast({ title: 'Failed to create', description: res.error, variant: 'destructive' });
                                    return;
                                  }
                                  toast({ title: 'Integration created', description: `${data.name} added — configure credentials next.` });
                                  fetchIntegrations();
                                  fetchDashboard();
                                  setShowNewIntegration(false);
                                } catch (e) {
                                  toast({ title: 'Error', description: String(e), variant: 'destructive' });
                                }
                              }}
                            />
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>

                    {/* Categories */}
                    <div className="flex gap-2 flex-wrap">
                      {['all', 'security', 'network', 'communication', 'cloud', 'endpoint', 'iam'].map(cat => (
                        <Button key={cat} variant={integrationCategoryFilter === cat || (cat === 'all' && !integrationCategoryFilter) ? 'default' : 'outline'} size="sm" onClick={() => setIntegrationCategoryFilter(cat === 'all' ? '' : cat)}>
                          {cat === 'all' ? 'All' : cat === 'iam' ? 'Identity' : cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </Button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {integrations.length === 0 && !loading && (
                        <Card className="md:col-span-2 xl:col-span-3">
                          <CardContent className="py-12 text-center text-sm text-muted-foreground">
                            <Puzzle className="h-10 w-10 mx-auto mb-3 opacity-25" />
                            No integrations configured yet. Add connectors under Integrations → Connectors.
                          </CardContent>
                        </Card>
                      )}
                      {integrations.filter(i => !integrationCategoryFilter || i.category === integrationCategoryFilter).map(int => (
                        <Card key={int.id} className="hover:shadow-md transition-all duration-200 group overflow-hidden min-w-0" data-interactive-card>
                          <CardContent className="p-4 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-3 min-w-0">
                              <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                                <div className={`p-2.5 rounded-xl shrink-0 ${int.status === 'connected' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : int.status === 'error' ? 'bg-red-500/10 text-red-500 dark:text-red-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'} transition-transform group-hover:scale-105`}>
                                  {getIconForIntegration(int.icon)}
                                </div>
                                <div className="min-w-0">
                                  <h4 className="text-sm font-medium truncate">{int.name}</h4>
                                  <p className="text-[10px] text-muted-foreground capitalize truncate">{int.type} - {int.category}</p>
                                </div>
                              </div>
                              <Badge variant="outline" className={`shrink-0 ${statusColor(int.status)}`}>
                                {int.status === 'connected' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1 pulse-dot" />}
                                {int.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mb-3 line-clamp-2 break-words">{int.description}</p>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2 border-t border-border/60">
                              <span className="text-[10px] text-muted-foreground capitalize flex items-center gap-1 truncate min-w-0">
                                <Tag className="h-2.5 w-2.5 shrink-0" />
                                {int.category}
                              </span>
                              <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                                <Button variant="outline" size="sm" onClick={() => setConfiguringIntegration(int.id)} data-ui-button>
                                  <Settings className="h-3 w-3 mr-1" /> Configure
                                </Button>
                                <Button
                                  variant="default"
                                  size="sm"
                                  onClick={async () => {
                                    try {
                                      setTestingId(int.id);
                                      const result = await testConnector(int.id);
                                      toast({
                                        title: result.success ? 'Connected' : 'Test Failed',
                                        description: result.message,
                                        variant: result.success ? 'default' : 'destructive',
                                      });
                                      fetchIntegrations();
                                      fetchDashboard();
                                    } catch (e) {
                                      toast({ title: 'Test error', description: String(e), variant: 'destructive' });
                                    } finally {
                                      setTestingId(null);
                                    }
                                  }}
                                  disabled={testingId === int.id}
                                  data-ui-button
                                >
                                  {testingId === int.id ? <Activity className="h-3 w-3 mr-1 animate-pulse" /> : <Zap className="h-3 w-3 mr-1" />}
                                  Test
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={async () => {
                                    if (!confirm(`Delete integration "${int.name}"? This cannot be undone.`)) return;
                                    try {
                                      await soarFetch(`/api/integrations?id=${int.id}`, { method: 'DELETE' });
                                      toast({ title: 'Integration deleted' });
                                      fetchIntegrations(); fetchDashboard();
                                    } catch (e) {
                                      toast({ title: 'Delete failed', description: String(e), variant: 'destructive' });
                                    }
                                  }}
                                  data-ui-button
                                  aria-label="Delete integration"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}

                {/* ===== PLAYBOOKS ===== */}
                {page === 'playbooks' && gatewayMode && (
                  <PlaybooksManagement onNavigate={soarNavigate} />
                )}
                {page === 'playbooks' && !gatewayMode && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold">Playbooks</h3>
                        <p className="text-sm text-muted-foreground">Predefined response procedures linked to executable workflows</p>
                      </div>
                      <Dialog open={showNewPlaybook} onOpenChange={setShowNewPlaybook}>
                        <DialogTrigger asChild>
                          <Button><Plus className="h-4 w-4 mr-1" /> New Playbook</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Create Playbook</DialogTitle><DialogDescription>Define a new response playbook</DialogDescription></DialogHeader>
                          <NewPlaybookForm onSubmit={async (data) => { await soarFetch('/api/playbooks', { method: 'POST', body: JSON.stringify(data) }); fetchPlaybooks(); fetchDashboard(); setShowNewPlaybook(false); }} />
                        </DialogContent>
                      </Dialog>
                    </div>

                    <div className="space-y-4">
                      {playbooks.length === 0 && !loading && (
                        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
                          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-25" />
                          No playbooks yet. Create a new playbook to define an automated response procedure.
                        </CardContent></Card>
                      )}
                      {playbooks.map(pb => {
                        // Resolve linked workflow object (if any) so we can show its name + status
                        const linkedWf = pb.workflowId ? workflows.find(w => w.id === pb.workflowId) : null;
                        return (
                          <Card key={pb.id} className="hover:shadow-md transition-shadow overflow-hidden min-w-0" data-interactive-card>
                            <CardContent className="p-4 sm:p-5 min-w-0">
                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-3 gap-3 min-w-0">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                                    <BookOpen className="h-5 w-5" />
                                  </div>
                                  <div className="min-w-0">
                                    <h4 className="font-medium truncate">{pb.name}</h4>
                                    <p className="text-xs text-muted-foreground line-clamp-1">{pb.description}</p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {/* Run button — primary CTA. Disabled if no workflow linked. */}
                                  <Button
                                    size="sm"
                                    variant="default"
                                    disabled={!pb.workflowId}
                                    onClick={() => setRunningPlaybook(pb)}
                                    data-ui-button
                                    title={pb.workflowId ? 'Run linked workflow' : 'Link a workflow to enable execution'}
                                  >
                                    <Play className="h-3.5 w-3.5 mr-1" /> Run
                                  </Button>
                                  <Badge variant="outline" className={statusColor(pb.status)}>{pb.status}</Badge>
                                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 hidden sm:inline-flex">{pb.category.replace('_', ' ')}</Badge>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" data-ui-button><MoreVertical className="h-4 w-4" /></Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => duplicatePlaybook(pb.id)}><Copy className="h-4 w-4 mr-2" /> Duplicate</DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => togglePlaybookStatus(pb.id, pb.status)}><Pause className="h-4 w-4 mr-2" /> {pb.status === 'active' ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                                      {pb.workflowId && linkedWf && (
                                        <DropdownMenuItem onClick={() => openWorkflowBuilder(linkedWf)}>
                                          <Edit3 className="h-4 w-4 mr-2" /> Edit Workflow
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem onClick={() => setLinkingPlaybookId(pb.id)}>
                                        <Link2 className="h-4 w-4 mr-2" /> {pb.workflowId ? 'Change linked workflow' : 'Link workflow'}
                                      </DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem className="text-red-600" onClick={() => deletePlaybook(pb.id)}><Trash2 className="h-4 w-4 mr-2" /> Delete</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </div>

                              {/* Linked Workflow Banner */}
                              <div className={`mb-3 p-2 rounded-md border text-xs flex items-center gap-2 ${pb.workflowId ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300'}`}>
                                {pb.workflowId ? (
                                  <>
                                    <GitBranch className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">
                                      Linked workflow: <span className="font-medium">{linkedWf?.name || '(deleted)'}</span>
                                      {linkedWf && <span className="text-muted-foreground"> · {linkedWf.status}</span>}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    <span>Documentation-only — link a workflow to enable the Run button.</span>
                                  </>
                                )}
                              </div>

                              {/* Steps */}
                              <div className="mt-4">
                                <h5 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                                  <Activity className="h-3 w-3" />
                                  Response Steps ({pb.steps?.length || 0})
                                </h5>
                                <div className="flex gap-2 overflow-x-auto pb-2">
                                  {pb.steps?.map((step, i) => (
                                    <div key={i} className="flex items-center gap-2 shrink-0">
                                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30 min-w-[140px] hover:border-primary/30 transition-colors">
                                        <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold shrink-0">{step.order}</span>
                                        <div className="min-w-0">
                                          <p className="text-xs font-medium truncate">{step.name}</p>
                                          <Badge variant="outline" className={`text-[8px] px-1 py-0 ${step.automation === 'auto' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : step.automation === 'semi-auto' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 'bg-blue-500/10 text-blue-600 border-blue-500/20'}`}>
                                            {step.automation}
                                          </Badge>
                                        </div>
                                      </div>
                                      {i < pb.steps.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                                    </div>
                                  ))}
                                  {(!pb.steps || pb.steps.length === 0) && (
                                    <p className="text-[11px] text-muted-foreground italic px-2 py-2">No steps defined yet.</p>
                                  )}
                                </div>
                              </div>

                              {/* Triggers & Tags */}
                              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border gap-2 flex-wrap">
                                <div className="flex items-center gap-2 min-w-0">
                                  <Zap className="h-3 w-3 text-amber-500 shrink-0" />
                                  <span className="text-[10px] text-muted-foreground truncate">Triggers: <span className="font-medium text-foreground">{pb.triggers?.map(t => t.type).join(', ') || 'none'}</span></span>
                                </div>
                                <div className="flex gap-1 flex-wrap">
                                  {pb.tags?.map((t, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{t}</span>)}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ===== SETTINGS ===== */}
                {page === 'settings' && (
                  <SettingsView darkMode={darkMode} setDarkMode={setDarkMode} metrics={metrics} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Integration Config Modal */}
      <IntegrationConfigModal
        integrationId={configuringIntegration}
        onClose={() => setConfiguringIntegration(null)}
        onSaved={async () => { fetchIntegrations(); fetchDashboard(); setConfiguringIntegration(null); toast({ title: 'Saved', description: 'Integration config updated' }); }}
      />

      {/* Playbook → Workflow Link Dialog */}
      <LinkWorkflowDialog
        playbookId={linkingPlaybookId}
        workflows={workflows}
        currentWorkflowId={linkingPlaybookId ? playbooks.find(p => p.id === linkingPlaybookId)?.workflowId ?? null : null}
        onClose={() => setLinkingPlaybookId(null)}
        onLink={async (workflowId) => {
          if (linkingPlaybookId) {
            await linkPlaybookWorkflow(linkingPlaybookId, workflowId);
          }
          setLinkingPlaybookId(null);
        }}
      />

      {/* Playbook Run Dialog — lets the user supply a trigger payload before
          executing the linked workflow. Without this, nodes that reference
          {{trigger.ip}} etc. would always receive an empty trigger. */}
      <RunPlaybookDialog
        playbook={runningPlaybook}
        workflow={runningPlaybook ? workflows.find(w => w.id === runningPlaybook.workflowId) ?? null : null}
        onClose={() => setRunningPlaybook(null)}
        onRun={async (payload) => {
          if (runningPlaybook) {
            await executePlaybook(runningPlaybook, payload);
            setRunningPlaybook(null);
            // Switch to workflow builder view so the user can see live logs
            if (runningPlaybook.workflowId) {
              const wf = workflows.find(w => w.id === runningPlaybook.workflowId);
              if (wf) {
                setEditingWorkflow(wf);
                setPage('workflow-builder');
              }
            }
          }
        }}
      />
    </TooltipProvider>
  );
}

// ========== RUN PLAYBOOK DIALOG ==========