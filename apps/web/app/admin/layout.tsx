'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { isAdminRole } from '@webcatt/shared';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';
import { AdminSidebar } from '@/components/admin/sidebar';

/**
 * Admin shell: role guard + sidebar navigation.
 * Children render ONLY for a signed-in ADMIN/SUPERADMIN — everyone else is sent home.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = user !== null && isAdminRole(user.role);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace('/');
  }, [loading, isAdmin, router]);

  if (!isAdmin) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <AdminSidebar />
      <div className="min-w-0 flex-1 bg-neutral-50">
        <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
