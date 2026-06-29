'use client';

import { AuthProvider } from '@/components/auth/AuthProvider';
import { SoarApp } from '@/components/soar/SoarApp';

export default function HomePage() {
  return (
    <AuthProvider>
      <SoarApp />
    </AuthProvider>
  );
}
