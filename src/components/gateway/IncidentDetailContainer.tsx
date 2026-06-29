'use client';

import { IncidentDetailPage } from '@/components/gateway/IncidentDetailPage';

interface IncidentDetailContainerProps {
  incidentId: string;
}

export function IncidentDetailContainer({ incidentId }: IncidentDetailContainerProps) {
  return <IncidentDetailPage incidentId={incidentId} />;
}
