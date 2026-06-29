/**
 * Real connector actions from registered node manifests (workflow executor registry).
 */
import { resolveExecutorType } from '@/lib/integrations/catalog';
import { bootstrapNodes } from '@/lib/soar/nodes/bootstrap';
import { nodeRegistry } from '@/lib/soar/nodes/registry';

export interface ConnectorActionDescriptor {
  id: string;
  name: string;
  description: string;
  type: string;
}

export function getConnectorActionsForIntegration(
  type: string,
  name: string,
): ConnectorActionDescriptor[] {
  bootstrapNodes();
  const executorType = resolveExecutorType(type, name);
  const node = nodeRegistry.get(executorType);

  const base: ConnectorActionDescriptor[] = [
    {
      id: 'test',
      name: 'Test connection',
      description: 'Verify credentials against the live API',
      type: executorType,
    },
  ];

  if (!node) return base;

  const actionField = node.manifest.config.find(f => f.key === 'action');
  const options = actionField?.options ?? [];

  if (options.length > 0) {
    return [
      ...base,
      ...options.map(opt => ({
        id: String(opt.value),
        name: String(opt.label),
        description: `${node.manifest.name}: ${opt.label}`,
        type: executorType,
      })),
    ];
  }

  return [
    ...base,
    {
      id: 'execute',
      name: node.manifest.name,
      description: node.manifest.description,
      type: executorType,
    },
  ];
}
