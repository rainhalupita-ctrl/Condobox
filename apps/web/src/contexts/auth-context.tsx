'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export type UserRole = 'ADMIN' | 'SYNDIC' | 'GUARD' | 'RESIDENT';

export interface UserProfile {
  id: string;
  name: string;
  phone: string | null;
  role: UserRole;
  condo_id: string | null;
}

export interface LicenseInfo {
  id: string;
  plan: 'TRIAL' | 'BASIC' | 'PRO' | 'PRO_MAX';
  status: 'ACTIVE' | 'EXPIRED' | 'BLOCKED';
  expires_at: string | null;
  max_apartments: number;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  license: LicenseInfo | null;
  loading: boolean;
  isPortaria: boolean;
  isAdmin: boolean;
  isMorador: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, phone, role, condo_id')
      .eq('id', userId)
      .single();
    if (data) {
      setProfile(data as UserProfile);
      
      // Fetch license se tiver condo_id
      if (data.condo_id) {
        const { data: licData } = await supabase
          .from('licenses')
          .select('*')
          .eq('condo_id', data.condo_id)
          .single();
        if (licData) setLicense(licData as LicenseInfo);
      }
    }
  };

  useEffect(() => {
    // Sessão inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    // Listener de mudança de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setLicense(null);
    router.push('/login');
  };

  const role = profile?.role;
  const isPortaria = role === 'ADMIN' || role === 'SYNDIC' || role === 'GUARD';
  const isAdmin = role === 'ADMIN' || role === 'SYNDIC';
  const isMorador = role === 'RESIDENT';

  return (
    <AuthContext.Provider value={{ user, session, profile, license, loading, isPortaria, isAdmin, isMorador, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
