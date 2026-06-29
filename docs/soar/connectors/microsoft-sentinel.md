# Microsoft Sentinel Connector (Phase 3)

| Field | Value |
|-------|-------|
| **Status** | Certified (Wave 2) |
| **Node ID** | `sentinel` |
| **API Docs** | [SecurityInsights REST](https://learn.microsoft.com/en-us/rest/api/securityinsights/) |
| **Log Analytics** | [Query API](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/overview) |

## Required Azure permissions

App registration (client credentials) with:

- `Microsoft.SecurityInsights/incidents/read` (list/get)
- `Microsoft.SecurityInsights/incidents/write` (update)
- `Microsoft.OperationalInsights/workspaces/query/read` (KQL via Log Analytics API)

Assign **Microsoft Sentinel Responder** or custom RBAC on the workspace resource group.

## Integration fields

| Key | Required | Notes |
|-----|----------|-------|
| `tenant_id` | Yes | Azure AD tenant |
| `client_id` | Yes | App registration |
| `client_secret` | Yes | Client secret |
| `subscription_id` | Yes | Azure subscription |
| `resource_group` | Yes | RG containing workspace |
| `workspace_name` | Yes | Log Analytics workspace name |
| `workspace_id` | KQL only | Workspace GUID for `run_query` |

## Workflow actions

| Action | Description |
|--------|-------------|
| `list_incidents` | GET incidents (`$top`, optional OData `$filter`) |
| `get_incident` | GET single incident by ARM name |
| `update_incident` | PATCH status, classification, owner |
| `run_query` | POST KQL to Log Analytics API |

## Test connectivity

`POST /api/integrations/test` with `type: "sentinel"` acquires an Azure AD token and calls `GET .../incidents?$top=1`.

## Certification checklist

- [x] Official API documentation linked in manifest
- [x] `testConnectivity` hits real Sentinel incidents endpoint
- [x] SSRF: hosts limited to `management.azure.com`, `api.loganalytics.azure.com`, `login.microsoftonline.com`
- [x] Unit tests for credential parsing and URL building
- [ ] Live smoke in nightly CI (requires Azure secrets)
- [ ] Security review sign-off
