'use client';

import React, { useState } from 'react';
import { Search, CheckCircle2, Activity, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DialogFooter } from '@/components/ui/dialog';
import { getIconForIntegration } from '@/components/soar/utils';
import { INTEGRATION_CATALOG } from '@/lib/integrations/catalog';

// ========== NEW INTEGRATION FORM ==========

export function NewIntegrationForm({ onSubmit }: { onSubmit: (data: { name: string; type: string; category: string; description: string; icon: string }) => Promise<void> }) {
  const [selected, setSelected] = useState<string>('');
  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = INTEGRATION_CATALOG.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.type.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async () => {
    const catalog = INTEGRATION_CATALOG.find(c => c.type === selected);
    if (!catalog) return;
    setSaving(true);
    try {
      await onSubmit({
        name: customName.trim() || catalog.name,
        type: catalog.type,
        category: catalog.category,
        description: catalog.description,
        icon: catalog.icon,
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search connectors..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>
      <ScrollArea className="h-72 border rounded-md">
        <div className="p-1.5 space-y-1">
          {filtered.map(c => (
            <button
              key={c.type}
              onClick={() => { setSelected(c.type); setCustomName(''); }}
              className={`w-full flex items-start gap-2 p-2 rounded-md border text-left transition-colors ${selected === c.type ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-muted/50'}`}
            >
              <div className="p-1.5 rounded shrink-0 bg-primary/10 text-primary">
                {getIconForIntegration(c.icon)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{c.name}</p>
                <p className="text-[10px] text-muted-foreground line-clamp-1">{c.description}</p>
              </div>
              {selected === c.type && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">No connectors match "{search}"</div>
          )}
        </div>
      </ScrollArea>
      {selected && (
        <div>
          <Label className="text-xs">Custom Name (optional)</Label>
          <Input
            value={customName}
            onChange={e => setCustomName(e.target.value)}
            placeholder={INTEGRATION_CATALOG.find(c => c.type === selected)?.name}
            className="mt-1 text-sm"
          />
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button size="sm" disabled={!selected || saving} onClick={handleCreate} data-ui-button>
          {saving ? <Activity className="h-3 w-3 mr-1 animate-pulse" /> : <Plus className="h-3 w-3 mr-1" />}
          Create Integration
        </Button>
      </div>
    </div>
  );
}
