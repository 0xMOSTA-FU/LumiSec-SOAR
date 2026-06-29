# SOAR Feature Module

Industry SOAR UI and API client surface for LumiSec.

## Imports

```ts
// Gateway pages
import { IncidentsList, DashboardOverview } from '@/features/soar/gateway';

// API
import { fetchIncidents, apiClient } from '@/features/soar/api';

// Nav config
import { GATEWAY_NAV_ITEMS } from '@/features/soar/app/nav-config';
```

Implementation files remain under `src/components/gateway/` and `src/lib/lumisec-api/browser/` — migrate incrementally.
