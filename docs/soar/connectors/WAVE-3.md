# Wave 3 Connectors

| Connector | ID | Permissions |
|-----------|-----|-------------|
| Microsoft Entra ID | `entra_id` | Graph: `User.Read.All`, `User.ReadWrite.All`, `Group.ReadWrite.All`, `AuditLog.Read.All` |
| AWS Security Hub | `aws_securityhub` | IAM: `securityhub:GetFindings`, `BatchUpdateFindings`, `DescribeHub` |
| GCP Security Command Center | `gcp_scc` | `roles/securitycenter.findingsViewer` + `findingsEditor` for updates |

## Entra ID actions

`list_users`, `get_user`, `disable_user`, `enable_user`, `list_groups`, `add_user_to_group`, `list_sign_ins`

Disable/enable require **approval** in manifest (`requiresApproval: true`).

## AWS Security Hub

Set `region` to the region where Security Hub is enabled (e.g. `us-east-1`).

## GCP SCC

Paste full **service account JSON** into `service_account_json`. Provide either `organization_id` or `project_id` for finding queries.

```bash
npm run connector:validate
npm test
```
