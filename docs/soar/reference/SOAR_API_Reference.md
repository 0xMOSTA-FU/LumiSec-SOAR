# LumiSec SOAR API - Endpoint Reference

Auto-generated from `LumiSec_APIs_Copy.postman_collection.json`. **79 endpoints** across **20 resource groups**.

Base URL: `{{api_gateway_url}}` (default `http://localhost:3000`)

Auth flow: call `POST /api/auth/login` first, then send the returned token as `Authorization: Bearer <token>` on every other request below. Routes marked `JWT or X-Internal-Api-Key` also accept the header `X-Internal-Api-Key: <service_api_key>` for service-to-service calls (no JWT needed).

---

## Resources

- [Incidents](#incidents) (16)
- [Analytics](#analytics) (4)
- [Artifacts](#artifacts) (6)
- [Connectors](#connectors) (7)
- [Integrations -> GRC](#integrations-grc) (2)
- [Integrations -> UCTC](#integrations-uctc) (2)
- [Integrations -> Phishing](#integrations-phishing) (1)
- [Playbook Runs](#playbook-runs) (5)
- [Playbooks](#playbooks) (5)
- [Vault](#vault) (5)
- [Webhook Sources](#webhook-sources) (2)
- [Alerts](#alerts) (2)
- [Docs](#docs) (1)
- [Dashboard](#dashboard) (6)
- [Notifications](#notifications) (4)
- [Integrations -> SIEM (Elasticsearch / ELK)](#integrations-siem-elasticsearch-elk) (1)
- [Integrations -> Firewall (FortiGate / pfSense)](#integrations-firewall-fortigate-pfsense) (1)
- [Integrations -> Network / LumiNet](#integrations-network-luminet) (2)
- [Integrations -> EDR (SSH / WinRM host actions)](#integrations-edr-ssh-winrm-host-actions) (1)
- [Webhooks](#webhooks) (6)

## Incidents

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/incidents` | Bearer JWT | tags: soar-core, critical |
| `GET` | `/api/soar/incidents/:id` | Bearer JWT | tags: soar-core, critical |
| `GET` | `/api/soar/incidents/:id/artifacts` | Bearer JWT | tags: soar-core, critical |
| `GET` | `/api/soar/incidents/:id/notes` | Bearer JWT | tags: soar-core, critical |
| `GET` | `/api/soar/incidents/:id/related` | Bearer JWT | tags: soar-core, critical |
| `GET` | `/api/soar/incidents/:id/timeline` | Bearer JWT | tags: soar-core, critical |
| `POST` | `/api/soar/incidents` | Bearer JWT | tags: soar-core, critical |
| `POST` | `/api/soar/incidents/:id/artifacts` | Bearer JWT | tags: soar-core, critical |
| `POST` | `/api/soar/incidents/:id/notes` | Bearer JWT | tags: soar-core, critical |
| `POST` | `/api/soar/incidents/:id/playbooks/run` | Bearer JWT | tags: soar-core, critical |
| `POST` | `/api/soar/incidents/:id/related` | Bearer JWT | tags: soar-core, critical |
| `POST` | `/api/soar/incidents/:incidentId/playbook/:playbookId` | Bearer JWT | tags: soar-core, critical |
| `PATCH` | `/api/soar/incidents/:id` | Bearer JWT | tags: soar-core, critical |
| `PATCH` | `/api/soar/incidents/:id/close` | Bearer JWT | tags: soar-core, critical |
| `PATCH` | `/api/soar/incidents/:incidentId/close` | Bearer JWT | tags: soar-core, critical |
| `DELETE` | `/api/soar/incidents/:id` | Bearer JWT | tags: soar-core, critical |

## Analytics

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/analytics/kpis` | Bearer JWT | - |
| `GET` | `/api/soar/analytics/report` | Bearer JWT | - |
| `GET` | `/api/soar/analytics/snapshots` | Bearer JWT | - |
| `POST` | `/api/soar/analytics/export` | Bearer JWT | - |

## Artifacts

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/artifacts` | Bearer JWT | - |
| `GET` | `/api/soar/artifacts/:id` | Bearer JWT | - |
| `POST` | `/api/soar/artifacts/:id/enrich` | Bearer JWT | External dependency required: OpenCTI / enrichment APIs |
| `POST` | `/api/soar/artifacts/enrich/bulk` | Bearer JWT | External dependency required: OpenCTI / enrichment APIs |
| `PATCH` | `/api/soar/artifacts/:id` | Bearer JWT | - |
| `DELETE` | `/api/soar/artifacts/:id` | Bearer JWT | - |

## Connectors

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/connectors` | Bearer JWT | - |
| `GET` | `/api/soar/connectors/:id` | Bearer JWT | - |
| `GET` | `/api/soar/connectors/:id/actions` | Bearer JWT | - |
| `POST` | `/api/soar/connectors` | Bearer JWT | - |
| `POST` | `/api/soar/connectors/:id/test` | Bearer JWT | - |
| `PATCH` | `/api/soar/connectors/:id` | Bearer JWT | - |
| `DELETE` | `/api/soar/connectors/:id` | Bearer JWT | - |

## Integrations -> GRC

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/soar/integrations/grc/finding` | JWT or X-Internal-Api-Key | tags: integration |
| `POST` | `/api/soar/integrations/grc/risk` | JWT or X-Internal-Api-Key | tags: integration |

## Integrations -> UCTC

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/soar/integrations/uctc/rule` | JWT or X-Internal-Api-Key | tags: integration |
| `POST` | `/api/soar/integrations/uctc/rule-trigger` | JWT or X-Internal-Api-Key | tags: integration |

## Integrations -> Phishing

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/soar/integrations/phishing/campaign` | JWT or X-Internal-Api-Key | tags: integration |

## Playbook Runs

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/playbook-runs` | Bearer JWT | - |
| `GET` | `/api/soar/playbook-runs/:runId` | Bearer JWT | - |
| `POST` | `/api/soar/playbook-runs/:runId/cancel` | Bearer JWT | - |
| `POST` | `/api/soar/playbook-runs/:runId/pause` | Bearer JWT | - |
| `POST` | `/api/soar/playbook-runs/:runId/resume` | Bearer JWT | - |

## Playbooks

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/playbooks` | Bearer JWT | - |
| `GET` | `/api/soar/playbooks/:id` | Bearer JWT | - |
| `POST` | `/api/soar/playbooks` | Bearer JWT | - |
| `PATCH` | `/api/soar/playbooks/:id` | Bearer JWT | - |
| `DELETE` | `/api/soar/playbooks/:id` | Bearer JWT | - |

## Vault

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/vault` | Bearer JWT | - |
| `GET` | `/api/soar/vault/:id` | Bearer JWT | - |
| `POST` | `/api/soar/vault` | Bearer JWT | - |
| `PATCH` | `/api/soar/vault/:id` | Bearer JWT | - |
| `DELETE` | `/api/soar/vault/:id` | Bearer JWT | - |

## Webhook Sources

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/webhook-sources` | Bearer JWT | - |
| `POST` | `/api/soar/webhook-sources` | Bearer JWT | - |

## Alerts

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/alerts` | Bearer JWT | - |
| `GET` | `/api/soar/alerts/:id` | Bearer JWT | - |

## Docs

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/docs/openapi.json` | Public | - |

## Dashboard

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/dashboard/analysts` | Bearer JWT | - |
| `GET` | `/api/soar/dashboard/automation` | Bearer JWT | - |
| `GET` | `/api/soar/dashboard/connectors` | Bearer JWT | - |
| `GET` | `/api/soar/dashboard/incidents` | Bearer JWT | - |
| `GET` | `/api/soar/dashboard/overview` | Bearer JWT | - |
| `GET` | `/api/soar/dashboard/playbooks` | Bearer JWT | - |

## Notifications

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/soar/notifications` | Bearer JWT | - |
| `GET` | `/api/soar/notifications/unread-count` | Bearer JWT | - |
| `PATCH` | `/api/soar/notifications/:id/read` | Bearer JWT | - |
| `PATCH` | `/api/soar/notifications/read-all` | Bearer JWT | - |

## Integrations -> SIEM (Elasticsearch / ELK)

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/soar/integrations/siem/event` | JWT or X-Internal-Api-Key | tags: integration, siem / External dependency required: Elasticsearch (ELK) |

## Integrations -> Firewall (FortiGate / pfSense)

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/soar/integrations/firewall/block-ip` | JWT or X-Internal-Api-Key | tags: integration / External dependency required: FortiGate / pfSense |

## Integrations -> Network / LumiNet

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/soar/integrations/network/block-ip` | JWT or X-Internal-Api-Key | tags: integration / External dependency required: FortiGate / pfSense |
| `POST` | `/api/soar/integrations/network/isolate-host` | JWT or X-Internal-Api-Key | tags: integration / External dependency required: SSH/WinRM host access |

## Integrations -> EDR (SSH / WinRM host actions)

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/soar/integrations/edr/isolate-host` | JWT or X-Internal-Api-Key | tags: integration / External dependency required: SSH/WinRM host access |

## Webhooks

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| `POST` | `/api/soar/webhooks/crowdstrike` | JWT + optional webhook signature | - |
| `POST` | `/api/soar/webhooks/custom` | JWT + optional webhook signature | - |
| `POST` | `/api/soar/webhooks/defender` | JWT + optional webhook signature | - |
| `POST` | `/api/soar/webhooks/fortigate` | JWT + optional webhook signature | External dependency required: FortiGate / pfSense |
| `POST` | `/api/soar/webhooks/splunk` | JWT + optional webhook signature | - |
| `POST` | `/api/soar/webhooks/wazuh` | JWT + optional webhook signature | - |
