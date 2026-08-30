'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';

export default function RootPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else {
        const isPortaria = profile?.role && ['ADMIN', 'SYNDIC', 'GUARD'].includes(profile.role);
        if (isPortaria) {
          router.replace('/portaria');
        } else {
          router.replace('/morador');
        }
      }
    }
  }, [user, profile, loading, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400">
      <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
    </div>
  );
}
