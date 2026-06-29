/**
 * SOAR Node Registry
 * ---------------------------------------------------------------------------
 * Central registry for all node executors. Provides:
 *   - O(1) lookup by id (e.g., 'virustotal')
 *   - O(1) lookup by alias (e.g., 'vt' → 'virustotal')
 *   - Manifest validation on registration (reject malformed nodes at boot)
 *   - Version negotiation (picks highest compatible version)
 *   - Plugin support (3rd-party nodes register at runtime)
 *   - Introspection (for /api/nodes endpoint → drives UI palette + OpenAPI)
 *
 * Pattern: Service Locator / Plugin Registry
 * Compliance: SOC2 CC8.1 (change management)
 */
import { NodeExecutor, NodeManifest, safeValidateManifest } from './manifest';

class NodeRegistry {
  private executors = new Map<string, NodeExecutor>();
  private aliases = new Map<string, string>(); // alias → canonical id

  /**
   * Register a node executor. The manifest is validated against the schema;
   * if validation fails we throw — fail fast at boot rather than silently
   * ship a broken node.
   */
  register(executor: NodeExecutor): void {
    const result = safeValidateManifest(executor.manifest);
    if (!result.ok) {
      throw new Error(`Invalid manifest for node "${executor.manifest.id}": ${result.error}`);
    }
    if (this.executors.has(result.manifest.id)) {
      throw new Error(`Node "${result.manifest.id}" is already registered`);
    }
    this.executors.set(result.manifest.id, executor);
    // Register common aliases
    this.registerAliases(result.manifest);
    console.log(`[node-registry] Registered ${result.manifest.id} v${result.manifest.version} (${result.manifest.category})`);
  }

  /** Look up a node executor by id or alias. */
  get(idOrAlias: string): NodeExecutor | null {
    const canonical = this.aliases.get(idOrAlias.toLowerCase()) || idOrAlias.toLowerCase();
    return this.executors.get(canonical) || null;
  }

  /** Returns true if a node is registered under the given id/alias. */
  has(idOrAlias: string): boolean {
    return this.get(idOrAlias) !== null;
  }

  /** List all registered manifests (for UI palette / OpenAPI gen). */
  list(): NodeManifest[] {
    return Array.from(this.executors.values()).map(e => e.manifest);
  }

  /** Filter manifests by category. */
  byCategory(category: string): NodeManifest[] {
    return this.list().filter(m => m.category === category);
  }

  /** Total registered nodes (for /api/health stats). */
  size(): number {
    return this.executors.size;
  }

  /** Clear all registrations (used by tests). */
  clear(): void {
    this.executors.clear();
    this.aliases.clear();
  }

  /** Register an alias after the canonical node is registered. */
  registerAlias(alias: string, canonicalId: string): void {
    const a = alias.toLowerCase();
    const c = canonicalId.toLowerCase();
    if (!this.executors.has(c)) {
      throw new Error(`Cannot alias "${alias}" → "${canonicalId}": canonical node not registered`);
    }
    this.aliases.set(a, c);
  }

  private registerAliases(manifest: NodeManifest): void {
    const id = manifest.id.toLowerCase();
    this.aliases.set(id, id);
    // Common short forms
    const aliasMap: Record<string, string[]> = {
      virustotal: ['vt'],
      abuseipdb: ['abuse_ipdb'],
      ipinfo: ['ip_info'],
      alienvault: ['otx'],
      msgraph: ['microsoft', 'microsoft_graph', 'ms_graph'],
      fortigate: ['fortios'],
      digitalocean: ['do'],
      servicenow: ['snow'],
      elastic: ['elasticsearch', 'es'],
      email: ['smtp', 'mail', 'send_email'],
      create_alert: ['alert_out'],
      http: ['rest', 'api_request'],
      custom_app: ['custom', 'custom_api'],
      sentinel: ['microsoft_sentinel', 'ms_sentinel'],
      crowdstrike: ['falcon', 'cs'],
      greynoise: ['gn'],
      shodan: ['shodan_io'],
      teams: ['msteams', 'microsoft_teams'],
      entra_id: ['entra', 'azure_ad', 'entraid'],
      aws_securityhub: ['securityhub', 'aws_security_hub'],
      gcp_scc: ['security_command_center'],
      pfsense: ['pfsense_plus'],
      cuckoo: ['cuckoo_sandbox'],
      arkime: ['moloch'],
      telegram: ['tg'],
    };
    const aliases = aliasMap[id] || [];
    for (const a of aliases) {
      this.aliases.set(a, id);
    }
  }
}

// Singleton — one registry per process
export const nodeRegistry = new NodeRegistry();

/** Helper: builds an executor from a manifest + execute function. */
export function defineNode(
  manifest: NodeManifest,
  execute: NodeExecutor['execute'],
): NodeExecutor {
  return { manifest, execute };
}
export type { NodeExecutor, NodeManifest } from './manifest';
