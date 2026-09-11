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
  plan: 'TRIAL' | 'BASIC' | 'PRO' | 'PRO_MAX' | string;
  status: 'ACTIVE' | 'EXPIRED' | 'BLOCKED' | 'TRIAL' | string;
  expires_at: string | null;
  max_apartments: number;
}

export interface ImpersonatedCondo {
  id: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  license: LicenseInfo | null;
  loading: boolean;
  isPortaria: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isMorador: boolean;
  impersonatedCondo: ImpersonatedCondo | null;
  effectiveCondoId: string | null;
  isImpersonating: boolean;
  impersonateCondo: (condo: ImpersonatedCondo) => void;
  stopImpersonating: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [impersonatedCondo, setImpersonatedCondo] = useState<ImpersonatedCondo | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  // Carrega impersonação salva no localStorage ao iniciar
  useEffect(() => {
    try {
      const saved = localStorage.getItem('condobox_impersonated_condo');
      if (saved) {
        setImpersonatedCondo(JSON.parse(saved));
      }
    } catch {
      // ignora erro de json/storage
    }
  }, []);

  const fetchLicenseForCondo = async (condoId: string) => {
    try {
      const { data: licData } = await supabase
        .from('licenses')
        .select('*')
        .eq('condo_id', condoId)
        .maybeSingle();
      if (licData) {
        setLicense(licData as LicenseInfo);
      } else {
        setLicense(null);
      }
    } catch (err) {
      console.error('Erro ao buscar licença:', err);
    }
  };

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, phone, role, condo_id')
      .eq('id', userId)
      .single();

    if (data) {
      setProfile(data as UserProfile);

      // Se não houver condomínio impersonado, busca licença do condomínio do perfil
      const targetCondoId = impersonatedCondo?.id || data.condo_id;
      if (targetCondoId) {
        fetchLicenseForCondo(targetCondoId);
      }
    }
  };

  // Se mudar o condomínio impersonado, atualiza a licença ativa
  useEffect(() => {
    const targetCondoId = impersonatedCondo?.id || profile?.condo_id;
    if (targetCondoId) {
      fetchLicenseForCondo(targetCondoId);
    }
  }, [impersonatedCondo, profile?.condo_id]);

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

  const impersonateCondo = (condo: ImpersonatedCondo) => {
    setImpersonatedCondo(condo);
    try {
      localStorage.setItem('condobox_impersonated_condo', JSON.stringify(condo));
    } catch {}
  };

  const stopImpersonating = () => {
    setImpersonatedCondo(null);
    try {
      localStorage.removeItem('condobox_impersonated_condo');
    } catch {}
  };

  const signOut = async () => {
    stopImpersonating();
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setLicense(null);
    router.push('/login');
  };

  const role = profile?.role;

  // Lista de e-mails de super administradores (Dono do Sistema / Proprietário do SaaS)
  const superAdminEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || 'rainhalupita@gmail.com,klebervenancio2002@icloud.com')
    .split(',')
    .map(e => e.trim().toLowerCase());

  const userEmail = user?.email?.toLowerCase() || '';
  const isMasterByEmail = !!userEmail && superAdminEmails.includes(userEmail);

  // O Dono do Sistema tem acesso Master apenas se for perfil de sistema ou estiver na lista de e-mails do proprietário
  const isSuperAdmin = (role === 'ADMIN' && (!profile?.condo_id || isMasterByEmail)) || isMasterByEmail;
  const isPortaria = isSuperAdmin || role === 'SYNDIC' || role === 'GUARD';
  const isAdmin = isSuperAdmin || role === 'SYNDIC';
  const isMorador = isSuperAdmin || role === 'RESIDENT' || role === 'SYNDIC';
  const effectiveCondoId = impersonatedCondo?.id || profile?.condo_id || null;
  const isImpersonating = !!impersonatedCondo;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        license,
        loading,
        isPortaria,
        isAdmin,
        isSuperAdmin,
        isMorador,
        impersonatedCondo,
        effectiveCondoId,
        isImpersonating,
        impersonateCondo,
        stopImpersonating,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
