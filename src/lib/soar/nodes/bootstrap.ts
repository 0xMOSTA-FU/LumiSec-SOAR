/**
 * SOAR Node Bootstrap — registers all production connectors via manifest registry.
 */

import { nodeRegistry } from './registry';
import { virustotalExecutor } from './virustotal';
import { sentinelExecutor } from './sentinel';
import { wave2Executors } from './wave2-connectors';
import { wave3Executors } from './wave3-connectors';
import { wave1CertifiedExecutors } from './wave1-certified';
import { ossExtendedExecutors } from './oss-extended-connectors';
import { priorityConnectorsExecutors } from './priority-connectors';
import { commsExtendedExecutors } from './comms-connectors';
import { lumisecPlatformExecutors } from './lumisec-platform';

let bootstrapped = false;

export function bootstrapNodes(): void {
  if (bootstrapped) return;

  const nodes = [
    virustotalExecutor,
    sentinelExecutor,
    ...priorityConnectorsExecutors,
    ...wave2Executors,
    ...wave3Executors,
    ...wave1CertifiedExecutors,
    ...ossExtendedExecutors,
    ...commsExtendedExecutors,
    ...lumisecPlatformExecutors,
  ];

  for (const n of nodes) {
    try {
      if (!nodeRegistry.has(n.manifest.id)) {
        nodeRegistry.register(n);
      }
    } catch (e) {
      console.warn(`[soar] skip register ${n.manifest.id}:`, e);
    }
  }

  bootstrapped = true;
  console.log(`[soar] Bootstrapped ${nodeRegistry.size()} production node(s)`);
}

export { virustotalExecutor };
