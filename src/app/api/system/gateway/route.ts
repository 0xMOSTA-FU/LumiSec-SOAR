import { isGatewayMode } from '@/lib/lumisec-api/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({
    enabled: isGatewayMode(),
    mode: isGatewayMode() ? 'gateway' : 'local-bff',
    soarApi: '/api/soar',
  });
}
