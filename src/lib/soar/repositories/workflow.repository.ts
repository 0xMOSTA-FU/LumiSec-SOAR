/**
 * Workflow Repository — MongoDB implementation
 * ---------------------------------------------------------------------------
 * Repository pattern: the domain layer depends on this interface, not on
 * MongoDB directly. This makes the domain testable with an in-memory
 * implementation and lets us swap storage backends without touching
 * business logic.
 *
 * Compliance: SOC2 CC6.1 (logical access), ISO27001 A.13 (information transfer)
 */
import { getDb } from './mongo-client';
import { Workflow, WorkflowExecution, ExecutionLog } from '../domain/entities';

type WorkflowDoc = Workflow & { _id?: string };

export interface WorkflowFilters {
  tenantId?: string;
  status?: string;
  tags?: string[];
  search?: string;
}

export interface IWorkflowRepository {
  findById(id: string): Promise<Workflow | null>;
  findMany(filters: WorkflowFilters, opts?: { limit?: number; offset?: number }): Promise<Workflow[]>;
  create(workflow: Workflow): Promise<Workflow>;
  update(id: string, patch: Partial<Workflow>): Promise<Workflow | null>;
  delete(id: string): Promise<boolean>;
  count(filters?: WorkflowFilters): Promise<number>;
}

export interface IExecutionRepository {
  findById(id: string): Promise<WorkflowExecution | null>;
  findMany(filters: { workflowId?: string; status?: string; tenantId?: string }, opts?: { limit?: number; offset?: number }): Promise<WorkflowExecution[]>;
  create(execution: WorkflowExecution): Promise<WorkflowExecution>;
  update(id: string, patch: Partial<WorkflowExecution>): Promise<WorkflowExecution | null>;
  appendLog(id: string, log: ExecutionLog): Promise<void>;
  appendLogs(id: string, logs: ExecutionLog[]): Promise<void>;
  updateStatus(id: string, status: string, result?: Record<string, unknown>): Promise<void>;
}

// ============================================================================
// WORKFLOW REPOSITORY (MongoDB)
// ============================================================================

export class WorkflowRepository implements IWorkflowRepository {
  private async coll() {
    const db = await getDb();
    return db.collection<WorkflowDoc>('workflows');
  }

  async findById(id: string): Promise<Workflow | null> {
    const c = await this.coll();
    const doc = await c.findOne({ id }, { projection: { _id: 0 } });
    return doc ? this.deserialize(doc) : null;
  }

  async findMany(filters: WorkflowFilters, opts: { limit?: number; offset?: number } = {}): Promise<Workflow[]> {
    const c = await this.coll();
    const query: Record<string, unknown> = {};
    if (filters.tenantId) query.tenantId = filters.tenantId;
    if (filters.status) query.status = filters.status as Workflow['status'];
    if (filters.tags?.length) query.tags = { $in: filters.tags };
    if (filters.search) {
      query.$or = [
        { name: { $regex: filters.search, $options: 'i' } },
        { description: { $regex: filters.search, $options: 'i' } },
      ];
    }
    const cursor = c.find(query, { projection: { _id: 0 } }).sort({ updatedAt: -1 });
    if (opts.offset) cursor.skip(opts.offset);
    if (opts.limit) cursor.limit(opts.limit);
    const docs = await cursor.toArray();
    return docs.map(d => this.deserialize(d));
  }

  async create(workflow: Workflow): Promise<Workflow> {
    const c = await this.coll();
    await c.insertOne({ ...workflow, _id: workflow.id } as Workflow & { _id: string });
    return workflow;
  }

  async update(id: string, patch: Partial<Workflow>): Promise<Workflow | null> {
    const c = await this.coll();
    const update: Record<string, unknown> = {
      $set: { ...patch, updatedAt: new Date() } as Partial<Workflow>,
    };
    // Increment version on every update — optimistic concurrency
    update.$inc = { version: 1 } as never;
    const result = await c.findOneAndUpdate(
      { id },
      update,
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    return result ? this.deserialize(result) : null;
  }

  async delete(id: string): Promise<boolean> {
    const c = await this.coll();
    const result = await c.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async count(filters: WorkflowFilters = {}): Promise<number> {
    const c = await this.coll();
    const query: Record<string, unknown> = {};
    if (filters.tenantId) query.tenantId = filters.tenantId;
    if (filters.status) query.status = filters.status as Workflow['status'];
    return c.countDocuments(query);
  }

  /** Mongo stores nodes/edges as objects; we keep them as parsed arrays. */
  private deserialize(doc: Workflow & { _id?: string }): Workflow {
    const { _id, ...rest } = doc as Workflow & { _id?: string };
    // Defensive: handle legacy rows where nodes/edges were JSON strings
    const wf = { ...rest } as Workflow;
    if (typeof (wf as unknown as { nodes?: string }).nodes === 'string') {
      try { wf.nodes = JSON.parse((wf as unknown as { nodes: string }).nodes); } catch { wf.nodes = []; }
    }
    if (typeof (wf as unknown as { edges?: string }).edges === 'string') {
      try { wf.edges = JSON.parse((wf as unknown as { edges: string }).edges); } catch { wf.edges = []; }
    }
    if (typeof (wf as unknown as { trigger?: string }).trigger === 'string') {
      try { wf.trigger = JSON.parse((wf as unknown as { trigger: string }).trigger); } catch { wf.trigger = {}; }
    }
    if (typeof wf.tags === 'string') {
      try { wf.tags = JSON.parse(ww_tags_string(wf)); } catch { wf.tags = []; }
    }
    return wf;
  }
}

// Avoids TS narrowing issue when reading tags as string
function ww_tags_string(wf: Workflow): string {
  return (wf as unknown as { tags: string }).tags;
}

// ============================================================================
// EXECUTION REPOSITORY (MongoDB)
// ============================================================================

export class ExecutionRepository implements IExecutionRepository {
  private async coll() {
    const db = await getDb();
    return db.collection<WorkflowExecution & { _id?: string }>('workflow_executions');
  }

  async findById(id: string): Promise<WorkflowExecution | null> {
    const c = await this.coll();
    const doc = await c.findOne({ id }, { projection: { _id: 0 } });
    if (!doc) return null;
    return this.deserialize(doc);
  }

  async findMany(filters: { workflowId?: string; status?: string; tenantId?: string }, opts: { limit?: number; offset?: number } = {}): Promise<WorkflowExecution[]> {
    const c = await this.coll();
    const query: Record<string, unknown> = {};
    if (filters.workflowId) query.workflowId = filters.workflowId;
    if (filters.status) query.status = filters.status as WorkflowExecution['status'];
    if (filters.tenantId) query.tenantId = filters.tenantId;
    const cursor = c.find(query, { projection: { _id: 0 } }).sort({ startedAt: -1 });
    if (opts.offset) cursor.skip(opts.offset);
    if (opts.limit) cursor.limit(opts.limit);
    const docs = await cursor.toArray();
    return docs.map(d => this.deserialize(d));
  }

  async create(execution: WorkflowExecution): Promise<WorkflowExecution> {
    const c = await this.coll();
    await c.insertOne({ ...execution, _id: execution.id } as WorkflowExecution & { _id: string });
    return execution;
  }

  async update(id: string, patch: Partial<WorkflowExecution>): Promise<WorkflowExecution | null> {
    const c = await this.coll();
    const result = await c.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
    return result ? this.deserialize(result) : null;
  }

  /** Atomic log append — uses $push so concurrent node completions don't lose entries. */
  async appendLog(id: string, log: ExecutionLog): Promise<void> {
    const c = await this.coll();
    await c.updateOne({ id }, { $push: { logs: log } as never });
  }

  /** Atomic bulk log append — preferred over appendLog for batches. */
  async appendLogs(id: string, logs: ExecutionLog[]): Promise<void> {
    if (logs.length === 0) return;
    const c = await this.coll();
    await c.updateOne({ id }, { $push: { logs: { $each: logs } } as never });
  }

  async updateStatus(id: string, status: string, result?: Record<string, unknown>): Promise<void> {
    const c = await this.coll();
    const patch: Record<string, unknown> = {
      $set: {
        status,
        ...(result !== undefined ? { result } : {}),
        ...(status === 'success' || status === 'failed' || status === 'cancelled' ? { endedAt: new Date() } : {}),
      },
    };
    await c.updateOne({ id }, patch);
  }

  private deserialize(doc: WorkflowExecution & { _id?: string }): WorkflowExecution {
    const { _id, ...rest } = doc;
    const exec = { ...rest } as WorkflowExecution;
    if (typeof (exec as unknown as { trigger?: string }).trigger === 'string') {
      try { exec.trigger = JSON.parse((exec as unknown as { trigger: string }).trigger); } catch { exec.trigger = {}; }
    }
    if (typeof (exec as unknown as { result?: string }).result === 'string') {
      try { exec.result = JSON.parse((exec as unknown as { result: string }).result); } catch { exec.result = {}; }
    }
    if (typeof (exec as unknown as { logs?: string }).logs === 'string') {
      try { exec.logs = JSON.parse((exec as unknown as { logs: string }).logs); } catch { exec.logs = []; }
    }
    return exec;
  }
}
