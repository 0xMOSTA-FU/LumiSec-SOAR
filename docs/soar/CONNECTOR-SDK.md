# Connector SDK — LumiSec SOAR

This guide explains how to add, certify, and ship a production connector in LumiSec SOAR. For deep node implementation patterns, see also [NODE-AUTHORING.md](./NODE-AUTHORING.md).

## Architecture

```
Integration (MongoDB)  →  Executor (src/lib/executors/nodes/*.ts)
                              ↓
                         Manifest (src/lib/soar/nodes/*.ts)
                              ↓
                         bootstrap.ts → nodeRegistry
                              ↓
                    engine.ts dispatch + WorkflowBuilder UI
```

Every shipped connector has:

1. **Executor** — real HTTP/API logic (no mocks in execution paths)
2. **Certified manifest** — Zod-validated `NodeManifest` via `buildCertifiedConnector()`
3. **Bootstrap registration** — listed in `bootstrap.ts` or a wave file
4. **Engine dispatch** — `case` in `src/lib/executors/engine.ts` (subtype aliases)
5. **Connectivity test** — `testIntegrationConnectivity()` in `src/lib/integrations/test-connectivity.ts`
6. **UI** — palette entry in `WorkflowBuilder.tsx` + integration catalog in `page.tsx`

## Reference implementation

**VirusTotal** is the canonical example:

| Layer | File |
|-------|------|
| Executor | `src/lib/executors/nodes/virustotal.ts` |
| Manifest | `src/lib/soar/nodes/virustotal.ts` |
| Factory | `src/lib/soar/nodes/build-connector.ts` |

**Wave 1 migration** (legacy → certified): `src/lib/soar/nodes/wave1-certified.ts`  
**OSS extended** (pfSense, Cuckoo, ClamAV, Arkime): `src/lib/soar/nodes/oss-extended-connectors.ts`

## Step-by-step: new connector

### 1. Create the executor

```typescript
// src/lib/executors/nodes/my-tool.ts
export async function executeMyTool(node: WFNode, ctx: ExecutionContext): Promise<NodeExecutorResult> {
  const integration = ctx.getIntegration('my_tool');
  // fail-closed if missing credentials
  // resolveTemplate() for {{trigger.*}} placeholders
  // safeFetch / SSRF guard for outbound calls
}

export async function testMyToolConnectivity(config: Record<string, unknown>): Promise<{
  ok: boolean; message: string; durationMs?: number;
}> { /* real ping to vendor API */ }
```

Rules:

- Load credentials from `ctx.getIntegration(type)` — never hardcode secrets
- Use `resolveTemplate()` for user-supplied fields
- Return structured `output` keys (e.g. `my_tool: { ok, ... }`) for downstream `{{outputs.n1.my_tool.*}}`
- Export a connectivity test used by **Settings → Integrations → Test**

### 2. Define the manifest

```typescript
import { buildCertifiedConnector } from './build-connector';
import { executeMyTool } from '@/lib/executors/nodes/my-tool';

export const myToolExecutor = buildCertifiedConnector({
  id: 'my_tool',                    // lowercase snake_case — registry id
  name: 'My Tool',
  version: '1.0.0',                 // semver
  category: 'threat_intel',         // see manifest.ts NodeCategorySchema
  description: 'At least 10 chars describing what this node does.',
  icon: 'Shield',
  color: '#22c55e',
  vendor: 'Vendor Name',
  vendorUrl: 'https://example.com/',
  docsUrl: 'https://docs.example.com/api',
  allowedHosts: ['api.example.com'], // empty = self-hosted URL from integration
  config: [
    { key: 'action', label: 'Action', type: 'select', required: true, template: false,
      options: [{ value: 'lookup', label: 'Lookup' }] },
    { key: 'ip', label: 'IP', type: 'text', required: false, template: true },
  ],
  credentials: [{
    kind: 'api_key',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true, template: false },
    ],
    placement: 'header',
    fieldName: 'Authorization',
    valueTemplate: 'Bearer {api_key}',
  }],
  requiresApproval: false,            // true for block/isolate/contain actions
}, executeMyTool);
```

`buildCertifiedConnector` auto-fills `errors`, `compliance`, and bridges to the legacy executor context.

### 3. Register in bootstrap

```typescript
// src/lib/soar/nodes/bootstrap.ts
import { myToolExecutor } from './my-tool';

const nodes = [
  // ...
  myToolExecutor,
];
```

Or add to a wave file (`wave1-certified.ts`, `oss-extended-connectors.ts`, etc.) and spread into bootstrap.

### 4. Wire engine dispatch

```typescript
// src/lib/executors/engine.ts
case 'my_tool':
case 'mytool':
  return await executeMyTool(node, ctx);
```

### 5. Add connectivity test

```typescript
// src/lib/integrations/test-connectivity.ts
case 'my_tool':
  return testMyToolConnectivity(config);
```

### 6. UI + integration catalog

- **WorkflowBuilder.tsx** — `nodeSubtypes.action`, `nodeCategories`, config schema `switch (subtype)`, optional `needsApiKey` hint
- **page.tsx** — `INTEGRATION_CATALOG` + `typeFields` for credential form

### 7. Aliases (optional)

```typescript
// src/lib/soar/nodes/registry.ts → aliasMap
my_tool: ['mytool'],
```

### 8. OSS catalog (if open-source / free tier)

```typescript
// src/lib/soar/connectors/catalog.ts → OSS_PRIORITY_CATALOG
{ id: 'my_tool', name: 'My Tool', tier: 'oss', category: '...', docsUrl: '...' },
```

### 9. Validate

```bash
npm run connector:validate   # manifest registry + Zod schema
npm test
```

## Certification checklist

| # | Requirement |
|---|-------------|
| 1 | Manifest passes `safeValidateManifest()` at boot |
| 2 | Executor performs real API calls (no stub/mock in prod path) |
| 3 | Fail-closed without integration credentials |
| 4 | SSRF protection for user-controlled URLs (`safeFetch`, `allowedHosts`) |
| 5 | Secrets redacted in logs |
| 6 | `test*Connectivity()` implemented |
| 7 | Engine dispatch + subtype aliases |
| 8 | WorkflowBuilder palette + config fields |
| 9 | Integration catalog entry |
| 10 | High-risk actions set `requiresApproval: true` |

## Priority: OSS / free / community tools

Community SOAR stacks should ship **self-hosted and free-tier** connectors first. See [connectors/OSS-CATALOG.md](./connectors/OSS-CATALOG.md).

Current OSS-priority wave:

- **Threat intel:** MISP, OpenCTI, OTX, AbuseIPDB, IPInfo, VirusTotal (free tier), GreyNoise, Shodan
- **SIEM:** Elasticsearch, Wazuh, Arkime
- **Case mgmt:** TheHive, DefectDojo
- **EDR/DFIR:** Velociraptor
- **Firewall:** OPNsense, pfSense
- **Sandbox:** Cuckoo, ClamAV
- **Utility:** HTTP, Webhook

## Legacy bridge (deprecated)

`legacy-bridge.ts` + `wrapLegacyExecutor()` was used for Wave 1. **All Wave 1 nodes are now certified manifests** in `wave1-certified.ts`. Do not add new connectors via `wrapLegacyExecutor`.

## Shuffle interoperability

When exporting workflows to Shuffle format, map subtypes in `src/lib/shuffle/adapter.ts` → `subtypeToAppName()`.

## Related docs

- [NODE-AUTHORING.md](./NODE-AUTHORING.md) — 40-point production node spec
- [ARCHITECTURE.md](./ARCHITECTURE.md) — execution modes (inline / shuffle / BullMQ)
- [connectors/OSS-CATALOG.md](./connectors/OSS-CATALOG.md) — open-source connector matrix
