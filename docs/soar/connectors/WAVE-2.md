# Wave 2 Connectors — Certification Summary

| Connector | ID | Docs |
|-----------|-----|------|
| Microsoft Sentinel | `sentinel` | [microsoft-sentinel.md](./microsoft-sentinel.md) |
| CrowdStrike Falcon | `crowdstrike` | [Falcon API](https://falcon.crowdstrike.com/documentation/46/crowdstrike-oauth2-based-apis) |
| GreyNoise | `greynoise` | [GreyNoise Docs](https://docs.greynoise.io/docs) |
| Shodan | `shodan` | [Shodan API](https://developer.shodan.io/api) |
| Microsoft Teams | `teams` | [Incoming Webhook](https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook) |
| ServiceNow CMDB | `servicenow` (actions) | [Table API](https://developer.servicenow.com/dev.do#!/reference/api/utah/rest/c_TableAPI) |

## ServiceNow CMDB actions (on existing `servicenow` node)

- `query_cmdb` — query any CMDB table (default `cmdb_ci`)
- `get_ci` — fetch CI by `sys_id`
- `create_ci` — create CI record

## Validate

```bash
npm run connector:validate
npm test
```

See also: [WAVE-3.md](./WAVE-3.md) (Entra ID, AWS Security Hub, GCP SCC).

## Env (backend threat intel)

```env
GREYNOISE_API_KEY=...   # optional, enriches /threat-intel/lookup for IPs
VIRUSTOTAL_API_KEY=...
```
