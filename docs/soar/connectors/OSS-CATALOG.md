# OSS & Free-Tier Connector Catalog

Priority connectors for community SOAR deployments: **open-source**, **self-hosted**, or **free public API tiers**.

Source of truth in code: `src/lib/soar/connectors/catalog.ts` (`OSS_PRIORITY_CATALOG`).

## Shipped connectors

| ID | Name | Tier | Category | Status |
|----|------|------|----------|--------|
| `virustotal` | VirusTotal | free_tier | threat_intel | ✅ Certified manifest |
| `abuseipdb` | AbuseIPDB | free_tier | threat_intel | ✅ Wave 1 certified |
| `ipinfo` | IPInfo | free_tier | threat_intel | ✅ Wave 1 certified |
| `otx` | AlienVault OTX | free_tier | threat_intel | ✅ Wave 1 certified |
| `greynoise` | GreyNoise | free_tier | threat_intel | ✅ Wave 2 |
| `shodan` | Shodan | free_tier | threat_intel | ✅ Wave 2 |
| `misp` | MISP | oss | threat_intel | ✅ Wave 1 certified |
| `opencti` | OpenCTI | oss | threat_intel | ✅ Wave 1 certified |
| `elastic` | Elasticsearch | oss | siem | ✅ Wave 1 certified |
| `wazuh` | Wazuh | oss | siem | ✅ Wave 1 certified |
| `arkime` | Arkime | oss | siem | ✅ OSS extended |
| `thehive` | TheHive | oss | case_management | ✅ Wave 1 certified |
| `defectdojo` | DefectDojo | oss | case_management | ✅ Wave 1 certified |
| `velociraptor` | Velociraptor | oss | edr | ✅ Wave 1 certified |
| `opnsense` | OPNsense | oss | firewall | ✅ Wave 1 certified |
| `pfsense` | pfSense | oss | firewall | ✅ OSS extended |
| `cuckoo` | Cuckoo Sandbox | oss | utility | ✅ OSS extended |
| `clamav` | ClamAV | oss | utility | ✅ OSS extended |
| `http` | HTTP Request | oss | utility | ✅ Wave 1 certified |
| `webhook` | Webhook | oss | utility | ✅ Wave 1 certified |

## Integration credentials

| Connector | Required fields | Notes |
|-----------|-----------------|-------|
| Elasticsearch | `url`, optional `username`/`password` or `api_key` | OpenSearch compatible |
| VirusTotal | `api_key` | Free tier: 500 req/day |
| pfSense | `host`, `api_key`, optional `port` | Requires REST API package |
| Cuckoo | `url`, optional `api_token` | Self-hosted sandbox |
| ClamAV | `url` | Points to [clamav-rest](https://github.com/benzino77/clamav-rest-api) or similar HTTP gateway |
| Arkime | `url`, optional `username`/`password` | Formerly Moloch |
| MISP | `url`, `api_key` | Self-hosted |
| Wazuh | `url`, `username`, `password` | Manager API |

## Roadmap (community requests)

Candidates for next OSS waves:

| Tool | Category | Notes |
|------|----------|-------|
| Suricata / EveBox | siem | Alert export + search |
| Zeek | siem | Log correlation |
| Security Onion | siem | Elastic stack bundle |
| Cortex | case_management | Observable analysis |
| IRIS | case_management | DFIR case platform |
| Shuffle | orchestration | Native app parity |
| n8n webhooks | utility | Cross-automation |
| YARA scanning | utility | Via custom HTTP service |

To propose a connector, follow [CONNECTOR-SDK.md](../CONNECTOR-SDK.md) and open a PR with executor + manifest + tests.

## Validation

```bash
npm run connector:validate
```

Ensures every `OSS_PRIORITY_CATALOG` entry with `tier: oss | free_tier` is registered in `nodeRegistry` at boot.
