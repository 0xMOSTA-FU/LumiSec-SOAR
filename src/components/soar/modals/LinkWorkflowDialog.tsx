'use client';

import React, { useState, useEffect } from 'react';
import { Link2, Search, X, GitBranch, CheckCircle2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Workflow } from '@/app/soar/types';
import { statusColor } from '@/components/soar/utils';

// ========== LINK WORKFLOW DIALOG ==========
// Lets the user pick which workflow backs a playbook. The chosen workflow
// is what actually runs when the user clicks "Run" on the playbook card.
export function LinkWorkflowDialog({
  playbookId, workflows, currentWorkflowId, onClose, onLink,
}: {
  playbookId: string | null;
  workflows: Workflow[];
  currentWorkflowId: string | null;
  onClose: () => void;
  onLink: (workflowId: string | null) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(currentWorkflowId);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Keep local selection in sync when the dialog opens for a different playbook
  useEffect(() => { setSelected(currentWorkflowId); setSearch(''); }, [playbookId, currentWorkflowId]);

  if (!playbookId) return null;

  const filtered = workflows.filter(w =>
    !search || w.name.toLowerCase().includes(search.toLowerCase()) || (w.description || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async () => {
    setSaving(true);
    try { await onLink(selected); } finally { setSaving(false); }
  };

  return (
    <Dialog open={!!playbookId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Link Workflow
          </DialogTitle>
          <DialogDescription>
            Pick the workflow that implements this playbook's automated steps. The playbook's "Run" button will execute this workflow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search workflows..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>

          <ScrollArea className="h-72 border rounded-md">
            <div className="p-1.5">
              {/* "None" option to unlink */}
              <button
                onClick={() => setSelected(null)}
                className={`w-full flex items-center gap-2 p-2 rounded-md text-left text-xs transition-colors ${selected === null ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'}`}
              >
                <div className="p-1.5 rounded bg-muted text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">No workflow (documentation only)</p>
                  <p className="text-[10px] text-muted-foreground">Playbook steps will be shown but cannot be executed.</p>
                </div>
                {selected === null && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
              </button>

              {filtered.length === 0 && (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-25" />
                  No workflows found.
                </div>
              )}

              {filtered.map(w => (
                <button
                  key={w.id}
                  onClick={() => setSelected(w.id)}
                  className={`w-full flex items-center gap-2 p-2 rounded-md text-left text-xs transition-colors mt-1 ${selected === w.id ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'}`}
                >
                  <div className={`p-1.5 rounded ${w.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-yellow-500/10 text-yellow-600'}`}>
                    <GitBranch className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{w.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {w.description || 'No description'} · {w.nodes?.length || 0} nodes
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-[9px] ${statusColor(w.status)}`}>{w.status}</Badge>
                  {selected === w.id && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saving} onClick={handleSave}>
            <Save className="h-3.5 w-3.5 mr-1" /> {saving ? 'Saving...' : 'Save link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}