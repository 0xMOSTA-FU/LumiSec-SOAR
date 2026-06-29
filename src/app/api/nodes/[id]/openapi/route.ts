/**
 * /api/nodes/[id]/openapi — OpenAPI 3.1 spec for a single node
 * ---------------------------------------------------------------------------
 * Generates an OpenAPI 3.1 operation object for the node's REST facade.
 * This is what an external integrator would consume to call the node
 * directly via HTTP (e.g., from a non-SOAR automation tool).
 *
 * SECURITY FIX (AUDIT-2 finding #1): Added authentication.
 */
import { NextRequest, NextResponse } from 'next/server';
import { nodeRegistry } from '@/lib/soar/nodes/registry';
import { bootstrapNodes } from '@/lib/soar/nodes/bootstrap';
import { NodeManifest, ConfigField } from '@/lib/soar/nodes/manifest';
import { requireAuth, internalErrorResponse } from '@/lib/api-auth';
import { PERMISSIONS } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireAuth(req, PERMISSIONS.WORKFLOW_READ);
  if (authed instanceof NextResponse) return authed;

  try {
    bootstrapNodes();
    const { id } = await params;
    const executor = nodeRegistry.get(id);
    if (!executor) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

    const m = executor.manifest;
    const spec = manifestToOpenApi(m);
    return NextResponse.json(spec);
  } catch (err) {
    return internalErrorResponse(err, 'Failed to generate OpenAPI spec');
  }
}

function manifestToOpenApi(m: NodeManifest): unknown {
  // Build JSON schema for the request body from the manifest's config fields
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of m.config) {
    properties[f.key] = configFieldToJsonSchema(f);
    if (f.required) required.push(f.key);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: m.name,
      version: m.version,
      description: m.description,
      contact: { name: m.vendor, url: m.vendorUrl },
      license: { name: 'Apache-2.0' },
    },
    paths: {
      [`/api/nodes/${m.id}/execute`]: {
        post: {
          operationId: `${m.id}_execute`,
          summary: m.name,
          description: m.description,
          tags: [m.category],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties,
                  required,
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Node executed successfully',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      output: { type: 'object' },
                      idempotencyKey: { type: 'string' },
                      durationMs: { type: 'number' },
                    },
                  },
                },
              },
            },
            '4xx': {
              description: 'Client error',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', enum: [false] },
                      errorCode: { type: 'string' },
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          security: [{ ApiKeyAuth: [] }],
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Api-Key',
        },
      },
    },
  };
}

function configFieldToJsonSchema(f: ConfigField): unknown {
  const schema: Record<string, unknown> = { description: f.description || f.label };
  switch (f.type) {
    case 'number': schema.type = 'number'; break;
    case 'boolean': schema.type = 'boolean'; break;
    case 'json': schema.type = 'object'; break;
    case 'select':
      schema.type = 'string';
      if (f.options) schema.enum = f.options.map(o => o.value);
      break;
    case 'multiselect':
      schema.type = 'array';
      schema.items = { type: 'string' };
      break;
    case 'datetime': schema.type = 'string'; schema.format = 'date-time'; break;
    case 'url': schema.type = 'string'; schema.format = 'uri'; break;
    default: schema.type = 'string';
  }
  if (f.default !== undefined) schema.default = f.default;
  if (f.pattern) schema.pattern = f.pattern;
  if (f.minLength !== undefined) schema.minLength = f.minLength;
  if (f.maxLength !== undefined) schema.maxLength = f.maxLength;
  return schema;
}
