'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DialogFooter } from '@/components/ui/dialog';

// ========== FORM COMPONENTS ==========
export function NewCaseForm({ onSubmit }: { onSubmit: (data: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [assignee, setAssignee] = useState('');

  return (
    <div className="space-y-4">
      <div><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Case title" /></div>
      <div><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Case description" /></div>
      <div><Label>Severity</Label><Select value={severity} onValueChange={setSeverity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div>
      <div><Label>Assignee</Label><Input value={assignee} onChange={e => setAssignee(e.target.value)} placeholder="Assign to..." /></div>
      <DialogFooter>
        <Button onClick={() => onSubmit({ title, description, severity, assignee: assignee || null })} disabled={!title}>Create Case</Button>
      </DialogFooter>
    </div>
  );
}

export function NewAlertForm({ onSubmit }: { onSubmit: (data: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [source, setSource] = useState('manual');

  return (
    <div className="space-y-4">
      <div><Label>Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Alert title" /></div>
      <div><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Alert description" /></div>
      <div><Label>Severity</Label><Select value={severity} onValueChange={setSeverity}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="critical">Critical</SelectItem></SelectContent></Select></div>
      <div><Label>Source</Label><Input value={source} onChange={e => setSource(e.target.value)} placeholder="Alert source" /></div>
      <DialogFooter>
        <Button onClick={() => onSubmit({ title, description, severity, source })} disabled={!title}>Create Alert</Button>
      </DialogFooter>
    </div>
  );
}

export function NewPlaybookForm({ onSubmit }: { onSubmit: (data: Record<string, unknown>) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('incident_response');

  return (
    <div className="space-y-4">
      <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Playbook name" /></div>
      <div><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Playbook description" /></div>
      <div><Label>Category</Label><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="incident_response">Incident Response</SelectItem><SelectItem value="investigation">Investigation</SelectItem><SelectItem value="remediation">Remediation</SelectItem><SelectItem value="compliance">Compliance</SelectItem></SelectContent></Select></div>
      <DialogFooter>
        <Button onClick={() => onSubmit({ name, description, category })} disabled={!name}>Create Playbook</Button>
      </DialogFooter>
    </div>
  );
}