'use client';

import { useMemo } from 'react';
import type { SoarBackendKind } from '@/lib/soar/mode';

export interface GatewayModeState {
  /** Industry SOAR UI (Incidents, Connectors, Vault, …) */
  enabled: boolean;
  /** `local` = `/api/soar/*` on this app; `remote` = BFF → LUMISEC_API_URL */
  backend: SoarBackendKind;
  loading: boolean;
}

/**
 * Gateway UI is ON by default (`NEXT_PUBLIC_SOAR_GATEWAY=0` to use legacy Cases nav).
 * Remote colleague backend: `NEXT_PUBLIC_SOAR_USE_REMOTE_GATEWAY=1` + `LUMISEC_API_URL`.
 */
export function useGatewayMode(): GatewayModeState {
  return useMemo(() => {
    const disabled =
      typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SOAR_GATEWAY === '0';
    const remote =
      typeof process !== 'undefined' &&
      process.env.NEXT_PUBLIC_SOAR_USE_REMOTE_GATEWAY === '1' &&
      Boolean(process.env.NEXT_PUBLIC_LUMISEC_API_URL || process.env.LUMISEC_API_URL);

    return {
      enabled: !disabled,
      backend: remote ? 'remote' : 'local',
      loading: false,
    };
  }, []);
}
