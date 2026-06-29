/**
 * Circuit Breaker — protects external integrations from cascading failures
 * ---------------------------------------------------------------------------
 * When an integration (e.g., VirusTotal) starts failing repeatedly, the
 * circuit "opens" and all subsequent calls fail fast instead of piling
 * up. After a cooldown, the circuit enters "half_open" and allows one
 * probe call through; if it succeeds, the circuit closes again.
 *
 * States:
 *   closed     → calls pass through normally
 *   open       → calls fail immediately with CircuitOpenError
 *   half_open  → first call after cooldown passes through; success closes,
 *                failure re-opens
 *
 * Pattern: Martin Fowler's Circuit Breaker (https://martinfowler.com/bliki/CircuitBreaker.html)
 * Compliance: SOC2 CC7.4 (anomaly detection)
 */
import { Logger } from './logger';
import { recordCircuitBreakerState } from './metrics';

type CbState = 'closed' | 'open' | 'half_open';

interface CircuitConfig {
  failureThreshold: number;     // open after this many consecutive failures
  resetTimeoutMs: number;       // cooldown before half-open
  halfOpenSuccessThreshold: number; // close after this many half-open successes
}

class CircuitBreaker {
  private state: CbState = 'closed';
  private failureCount = 0;
  private halfOpenSuccesses = 0;
  private openedAt = 0;
  private readonly log = new Logger({ component: 'circuit-breaker' });

  constructor(
    private readonly name: string,
    private readonly config: CircuitConfig,
  ) {}

  getState(): CbState { return this.state; }

  /** Called before every call — throws if circuit is open. */
  beforeCall(): void {
    if (this.state === 'closed') return;
    if (this.state === 'open') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'half_open';
        this.halfOpenSuccesses = 0;
        this.log.warn(`Circuit half-open: ${this.name} (probing)`);
        recordCircuitBreakerState(this.name, 'half_open');
      } else {
        throw new CircuitOpenError(this.name, this.config.resetTimeoutMs - elapsed);
      }
    }
    // half_open: allow the call through (will be evaluated in afterCall)
  }

  /** Called after every call — updates state based on success/failure. */
  afterCall(success: boolean): void {
    if (this.state === 'closed') {
      if (success) {
        this.failureCount = 0;
      } else {
        this.failureCount++;
        if (this.failureCount >= this.config.failureThreshold) {
          this.open();
        }
      }
    } else if (this.state === 'half_open') {
      if (success) {
        this.halfOpenSuccesses++;
        if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
          this.close();
        }
      } else {
        this.open();
      }
    }
  }

  private open(): void {
    this.state = 'open';
    this.openedAt = Date.now();
    this.log.warn(`Circuit opened: ${this.name} (failures=${this.failureCount})`);
    recordCircuitBreakerState(this.name, 'open');
  }

  private close(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.halfOpenSuccesses = 0;
    this.log.info(`Circuit closed: ${this.name} (recovered)`);
    recordCircuitBreakerState(this.name, 'closed');
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly circuitName: string, public readonly retryInMs: number) {
    super(`Circuit breaker "${circuitName}" is open — retry in ${Math.ceil(retryInMs / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}

// ============================================================================
// Registry — one circuit per integration type
// ============================================================================

const circuits = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, config?: Partial<CircuitConfig>): CircuitBreaker {
  let cb = circuits.get(name);
  if (!cb) {
    cb = new CircuitBreaker(name, {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30_000,
      halfOpenSuccessThreshold: config?.halfOpenSuccessThreshold ?? 2,
    });
    circuits.set(name, cb);
  }
  return cb;
}

/** Convenience: wrap a call with circuit breaker + retry. */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  config?: Partial<CircuitConfig>,
): Promise<T> {
  const cb = getCircuitBreaker(name, config);
  cb.beforeCall();
  try {
    const result = await fn();
    cb.afterCall(true);
    return result;
  } catch (err) {
    cb.afterCall(false);
    throw err;
  }
}
