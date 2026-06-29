'use client';

import React, { useState, useEffect } from 'react';
import { Play, Activity, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { Playbook, Workflow } from '@/app/soar/types';

// Modal that asks for a JSON trigger payload before running the playbook's
// linked workflow. Provides sensible defaults based on the workflow's nodes
// (e.g. if a node references {{trigger.ip}}, prefill {"ip": ""}).
export function RunPlaybookDialog({
  playbook, workflow, onClose, onRun,
}: {
  playbook: Playbook | null;
  workflow: Workflow | null;
  onClose: () => void;
  onRun: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [payloadText, setPayloadText] = useState('{}');
  const [running, setRunning] = useState(false);
  const { toast } = useToast();

  // When a new playbook is selected, infer a sensible default payload by
  // scanning the workflow's nodes for {{trigger.X}} references.
  useEffect(() => {
    if (!playbook || !workflow) return;
    try {
      const nodes: { data?: { config?: Record<string, unknown> } }[] =
        typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes as string) : (workflow.nodes as unknown[]) || [];
      const triggerKeys = new Set<string>();
      const nodeStr = JSON.stringify(nodes);
      const re = /\{\{\s*trigger\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(nodeStr)) !== null) {
        triggerKeys.add(m[1]);
      }
      const defaultPayload: Record<string, string> = {};
      // Pre-fill common trigger keys with example values so the user just hits Run
      const examples: Record<string, string> = {
        ip: '8.8.8.8',
        hash: '',
        domain: 'example.com',
        url: 'https://example.com',
        email: 'user@example.com',
        severity: 'high',
        source: 'manual',
        title: `Manual run: ${playbook.name}`,
      };
      triggerKeys.forEach(k => {
        defaultPayload[k] = examples[k] !== undefined ? examples[k] : '';
      });
      setPayloadText(JSON.stringify(defaultPayload, null, 2));
    } catch {
      setPayloadText('{}');
    }
  }, [playbook, workflow]);

  if (!playbook) return null;

  const handleRun = async () => {
    let payload: Record<string, unknown> = {};
    try {
      payload = payloadText.trim() ? JSON.parse(payloadText) : {};
    } catch {
      toast({ title: 'Invalid JSON', description: 'Please fix the trigger payload and try again.', variant: 'destructive' });
      return;
    }
    setRunning(true);
    try {
      await onRun(payload);
    } finally { setRunning(false); }
  };

  return (
    <Dialog open={!!playbook} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-4 w-4" /> Run Playbook: {playbook.name}
          </DialogTitle>
          <DialogDescription>
            {workflow
              ? <>Will execute workflow <span className="font-medium text-foreground">{workflow.name}</span>. Provide trigger data below.</>
              : 'No workflow linked — link one first.'}
          </DialogDescription>
        </DialogHeader>

        {workflow ? (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Trigger Payload (JSON)</Label>
              <Textarea
                value={payloadText}
                onChange={e => setPayloadText(e.target.value)}
                className="mt-1 text-xs font-mono min-h-[120px]"
                placeholder='{"ip": "8.8.8.8"}'
              />
            </div>
            <div className="p-2 bg-muted/50 rounded text-[11px] text-muted-foreground flex items-start gap-2">
              <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-500" aria-hidden />
              <span>Nodes in this workflow can reference these values via <code>{`{{trigger.ip}}`}</code>, <code>{`{{trigger.domain}}`}</code>, etc.</span>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-amber-500/10 rounded text-sm text-amber-700 dark:text-amber-300 border border-amber-500/20">
            This playbook has no linked workflow. Close this dialog and use "Link workflow" first.
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} data-ui-button>Cancel</Button>
          <Button size="sm" disabled={!workflow || running} onClick={handleRun} data-ui-button>
            {running ? <Activity className="h-3 w-3 mr-1 animate-pulse" /> : <Play className="h-3 w-3 mr-1" />}
            {running ? 'Starting...' : 'Run Workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}