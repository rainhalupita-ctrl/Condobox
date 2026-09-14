'use client';

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  ShieldAlert,
  ShieldCheck,
  Plus,
  Trash2,
  Building2,
  Users,
  Package,
  CreditCard,
  Image as ImageIcon,
  Loader2,
  Search,
  Eye,
  SlidersHorizontal,
  Calendar,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Phone,
  Mail,
  Pencil,
  X,
  ExternalLink,
  Sparkles,
  Lock,
  Unlock,
  Layers,
  ArrowRight,
  DollarSign,
  Clock,
  AlertTriangle,
  TrendingUp,
  Download,
  Laptop,
  Copy,
  Check,
  MessageSquare,
  Receipt,
  FileCheck,
  UploadCloud,
  FileText,
  XCircle,
  Maximize2,
  Wallet,
  QrCode
} from 'lucide-react';
import { buildSupportWhatsAppUrl, SUPPORT_CONTACTS } from '@/lib/support-contacts';

interface AccountItem {
  id: string;
  name: string;
  address: string;
  phone: string;
  created_at: string;
  license: {
    id: string;
    plan: string;
    status: string;
    expires_at: string | null;
    max_apartments: number;
    created_at: string;
  } | null;
  syndic: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    role: string;
  } | null;
  stats: {
    units_count: number;
    max_units: number;
    residents_count: number;
    packages_count: number;
    pending_packages: number;
    staff_count: number;
  };
}

interface GlobalMetrics {
  total_condos: number;
  active_condos: number;
  trial_condos: number;
  paused_condos: number;
  estimated_mrr: number;
  total_units: number;
  total_residents: number;
  total_packages: number;
  total_users: number;
}

function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

// Cache Global em Memória (persiste entre trocas de abas e páginas sem tela roxa - 0ms)
let globalAccountsCache: AccountItem[] | null = null;
let globalMetricsCache: GlobalMetrics | null = null;
let globalAdsCache: any[] | null = null;
let globalStorageQuotaCache: any = null;
let globalVersionConfigCache: any = null;

export default function SuperAdminPage() {
  const { user, profile, isSuperAdmin, impersonateCondo, loading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<'ACCOUNTS' | 'FINANCIAL' | 'ADS' | 'VERSIONS'>('ACCOUNTS');
  
  // Inicialização com 0ms se já houver cache em memória ou sessionStorage
  const [accounts, setAccounts] = useState<AccountItem[]>(() => {
    if (globalAccountsCache && globalAccountsCache.length > 0) return globalAccountsCache;
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem('condobox_master_accounts');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            globalAccountsCache = parsed;
            return parsed;
          }
        }
      } catch {}
    }
    return [];
  });

  const [metrics, setMetrics] = useState<GlobalMetrics | null>(() => {
    if (globalMetricsCache) return globalMetricsCache;
    if (typeof window !== 'undefined') {
      try {
        const saved = sessionStorage.getItem('condobox_master_metrics');
        if (saved) {
          const parsed = JSON.parse(saved);
          globalMetricsCache = parsed;
          return parsed;
        }
      } catch {}
    }
    return null;
  });

  // Se já possui dados em cache, NÃO bloqueia a tela com o spinner roxo
  const [loadingData, setLoadingData] = useState(() => {
    return !globalAccountsCache || globalAccountsCache.length === 0;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [planFilter, setPlanFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Gestão Financeira & Assinaturas SaaS (Modelo Netflix)
  const [financialMetrics, setFinancialMetrics] = useState<{
    totalMonthlyRecurring: number;
    totalReceivedThisMonth: number;
    totalPending: number;
    pendingReceiptsCount: number;
  } | null>(null);
  const [financialSubscribers, setFinancialSubscribers] = useState<any[]>([]);
  const [pendingReceipts, setPendingReceipts] = useState<any[]>([]);
  const [allReceipts, setAllReceipts] = useState<any[]>([]);
  const [loadingFinancial, setLoadingFinancial] = useState(false);
  const [financialError, setFinancialError] = useState<string | null>(null);

  // Edição de Preço Mensal e Dia de Vencimento por Condomínio
  const [condoPriceEdits, setCondoPriceEdits] = useState<Record<string, {
    price: string;
    billingDay: string;
    saving?: boolean;
    msg?: string;
  }>>({});

  // Análise / Revisão de Comprovante pelo Sócio Proprietário
  const [selectedReceiptForReview, setSelectedReceiptForReview] = useState<any | null>(null);
  const [reviewExtensionDays, setReviewExtensionDays] = useState<number>(30);
  const [reviewRejectionReason, setReviewRejectionReason] = useState<string>('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);

  // Anexação Manual de Comprovante pelo Sócio Proprietário
  const [isManualReceiptModalOpen, setIsManualReceiptModalOpen] = useState(false);
  const [manualCondoId, setManualCondoId] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualFile, setManualFile] = useState<File | null>(null);
  const [manualExtensionDays, setManualExtensionDays] = useState<number>(30);
  const [manualUploading, setManualUploading] = useState(false);
  const [manualMsg, setManualMsg] = useState<string | null>(null);

  // Configurações de Cobrança & Chave Pix Oficial
  const [billingSettings, setBillingSettings] = useState<{
    pixKey: string;
    pixKeyType: string;
    holderName: string;
    bankName: string;
    instructions?: string;
  }>({
    pixKey: '73998419901',
    pixKeyType: 'TELEFONE',
    holderName: 'CondoBox Tecnologia & Gestão',
    bankName: 'Banco Digital / Pix Oficial',
    instructions: 'Envie o comprovante para análise do Sócio Proprietário'
  });
  const [savingBillingSettings, setSavingBillingSettings] = useState(false);
  const [billingSettingsMsg, setBillingSettingsMsg] = useState<string | null>(null);

  // Gestão de Versões e Atualizações OTA
  const [versionConfig, setVersionConfig] = useState<{
    'condobox-desktop'?: {
      latest_version: string;
      download_url: string;
      release_notes: string;
      is_mandatory: boolean;
      updated_at: string;
    };
    'condobox-master'?: {
      latest_version: string;
      download_url: string;
      release_notes: string;
      is_mandatory: boolean;
      updated_at: string;
    };
  }>({});

  const [versionForm, setVersionForm] = useState({
    'condobox-desktop': {
      version: '',
      url: '',
      notes: '',
      mandatory: false,
    },
    'condobox-master': {
      version: '',
      url: '',
      notes: '',
      mandatory: false,
    },
  });

  const [savingVersionApp, setSavingVersionApp] = useState<string | null>(null);
  const [versionStatusMessage, setVersionStatusMessage] = useState<{ app: string; text: string; success: boolean } | null>(null);

  // Modal de Edição de Plano & Limites
  const [editingAccount, setEditingAccount] = useState<AccountItem | null>(null);
  const [editPlan, setEditPlan] = useState('TRIAL');
  const [editMaxApartments, setEditMaxApartments] = useState(250);
  const [editStatus, setEditStatus] = useState('ACTIVE');
  const [editExpiresAt, setEditExpiresAt] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editMessage, setEditMessage] = useState<string | null>(null);

  // Modal de Exclusão de Condomínio
  const [condoToDelete, setCondoToDelete] = useState<AccountItem | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deletingCondo, setDeletingCondo] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal de Cadastro de Nova Conta / Condomínio
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCondoName, setNewCondoName] = useState('');
  const [newCondoAddress, setNewCondoAddress] = useState('');
  const [newCondoPhone, setNewCondoPhone] = useState('');
  const [newCondoPlan, setNewCondoPlan] = useState('TRIAL');
  const [newCondoMaxUnits, setNewCondoMaxUnits] = useState(250);
  const [newSyndicName, setNewSyndicName] = useState('');
  const [newSyndicEmail, setNewSyndicEmail] = useState('');
  const [newSyndicPassword, setNewSyndicPassword] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Anúncios
  const [ads, setAds] = useState<any[]>(() => globalAdsCache || []);
  const [adImage, setAdImage] = useState('');
  const [adLink, setAdLink] = useState('');
  const [adLoading, setAdLoading] = useState(false);

  // Trava Anti-Cobrança & Armazenamento em Nuvem
  const [storageQuota, setStorageQuota] = useState<{
    allowed: boolean;
    status: 'SAFE' | 'WARNING' | 'LOCKED';
    usedBytes: number;
    usedMB: number;
    limitMB: number;
    percentUsed: number;
    fileCount: number;
    provider: string;
    lastChecked: string;
    antiBillingProtectionActive: boolean;
    message?: string;
  } | null>(() => globalStorageQuotaCache || null);
  const [purgingStorage, setPurgingStorage] = useState(false);
  const [purgeResultMsg, setPurgeResultMsg] = useState<string | null>(null);
  const [purgeDaysSelect, setPurgeDaysSelect] = useState<number>(0);

  const initialLoadDoneRef = useRef(false);

  // Trava de segurança: garante que a tela roxa NUNCA fique travada por mais de 2.5s em qualquer oscilação de rede
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoadingData(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.title = 'CondoBox SaaS Master - Painel do Proprietário';
    if (!loading) {
      if (!user) {
        // Checagem assíncrona robusta: evita redirecionamento em falso durante revalidação de token do Supabase
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session?.user) {
            router.replace('/master/login');
          }
        });
      } else if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        loadData(accounts.length === 0);
      }
    }
  }, [user?.id, loading]);

  // Trava a rolagem do fundo no celular/desktop quando qualquer modal estiver aberto
  useEffect(() => {
    const isAnyModalOpen = Boolean(editingAccount || isCreateModalOpen || selectedReceiptForReview || isManualReceiptModalOpen);
    if (isAnyModalOpen) {
      const originalBodyOverflow = document.body.style.overflow;
      const originalHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalBodyOverflow;
        document.documentElement.style.overflow = originalHtmlOverflow;
      };
    }
  }, [editingAccount, isCreateModalOpen, selectedReceiptForReview, isManualReceiptModalOpen]);

  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        return {
          'Authorization': `Bearer ${session.access_token}`,
        };
      }
    } catch {}
    return {};
  };

  const loadVersions = async () => {
    try {
      const res = await fetch(`/api/app-version?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setVersionConfig(data);
        setVersionForm({
          'condobox-desktop': {
            version: data['condobox-desktop']?.latest_version || '1.0.0',
            url: data['condobox-desktop']?.download_url || '',
            notes: data['condobox-desktop']?.release_notes || '',
            mandatory: Boolean(data['condobox-desktop']?.is_mandatory),
          },
          'condobox-master': {
            version: data['condobox-master']?.latest_version || '1.0.0',
            url: data['condobox-master']?.download_url || '',
            notes: data['condobox-master']?.release_notes || '',
            mandatory: Boolean(data['condobox-master']?.is_mandatory),
          },
        });
      }
    } catch (err) {
      console.warn('Erro ao carregar versões:', err);
    }
  };

  // --- HANDLERS DA ABA FINANCEIRA & ASSINATURAS ---
  const loadFinancialData = async (silent = false) => {
    if (!silent) setLoadingFinancial(true);
    setFinancialError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/financial', {
        headers: { ...authHeaders }
      });
      if (res.ok) {
        const data = await res.json();
        setFinancialMetrics(data.metrics || null);
        setFinancialSubscribers(data.subscribers || []);
        setPendingReceipts(data.pendingReceipts || []);
        setAllReceipts(data.allReceipts || []);
        if (data.billingSettings) {
          setBillingSettings(data.billingSettings);
        }

        // Inicializa o formulário de edição de preços com os valores atuais de cada condomínio
        const initialPriceMap: Record<string, { price: string; billingDay: string }> = {};
        (data.subscribers || []).forEach((sub: any) => {
          initialPriceMap[sub.condoId] = {
            price: sub.monthlyPrice !== undefined ? String(sub.monthlyPrice) : '149',
            billingDay: sub.billingDay !== undefined ? String(sub.billingDay) : '10'
          };
        });
        setCondoPriceEdits(prev => ({ ...initialPriceMap, ...prev }));
      } else {
        const errData = await res.json().catch(() => ({}));
        setFinancialError(errData.error || 'Erro ao carregar dados financeiros.');
      }
    } catch (err: any) {
      setFinancialError(err.message || 'Falha de conexão com a API financeira.');
    } finally {
      if (!silent) setLoadingFinancial(false);
    }
  };

  const loadData = async (showLoadingScreen = false) => {
    // Marca imediatamente como iniciado para evitar concorrência
    initialLoadDoneRef.current = true;

    // Apenas ativa tela cheia de carregamento na inicialização se ainda não houver dados em memória
    if (showLoadingScreen && accounts.length === 0 && (!globalAccountsCache || globalAccountsCache.length === 0)) {
      setLoadingData(true);
    }

    try {
      const authHeaders = await getAuthHeaders();

      // 1. CARREGAMENTO PRIORITÁRIO: Contas e Condomínios (libera a tela do usuário no primeiro instante)
      const accountsPromise = (async () => {
        let loadedFromApi = false;
        try {
          const res = await fetch('/api/super-admin/accounts', {
            headers: { ...authHeaders },
          });
          if (res.ok) {
            const data = await res.json();
            const accList = data.accounts || [];
            const metData = data.metrics || null;
            setAccounts(accList);
            setMetrics(metData);
            globalAccountsCache = accList;
            globalMetricsCache = metData;
            try {
              sessionStorage.setItem('condobox_master_accounts', JSON.stringify(accList));
              if (metData) sessionStorage.setItem('condobox_master_metrics', JSON.stringify(metData));
            } catch {}
            loadedFromApi = true;
          }
        } catch (apiErr) {
          console.warn('API /api/super-admin/accounts inacessível, utilizando fallback do Supabase:', apiErr);
        }

        // Fallback direto via Supabase se a rota local estiver momentaneamente fora
        if (!loadedFromApi) {
          try {
            const [
              { data: condosData },
              { data: licensesData },
              { data: unitsData },
              { data: residentsData },
              { data: packagesData },
            ] = await Promise.all([
              supabase.from('condos').select('*').order('created_at', { ascending: false }),
              supabase.from('licenses').select('*'),
              supabase.from('units').select('id, condo_id'),
              supabase.from('residents').select('id, unit_id'),
              supabase.from('packages').select('id, condo_id, status'),
            ]);

            if (condosData) {
              const unitCondoMap = new Map((unitsData || []).map(u => [u.id, u.condo_id]));
              const mappedAccounts: AccountItem[] = condosData.map((c: any) => {
                const lic = (licensesData || []).find((l: any) => l.condo_id === c.id) || null;
                const cUnits = (unitsData || []).filter((u: any) => u.condo_id === c.id).length;
                const cPkgs = (packagesData || []).filter((p: any) => p.condo_id === c.id);
                const cRes = (residentsData || []).filter((r: any) => unitCondoMap.get(r.unit_id) === c.id).length;
                return {
                  id: c.id,
                  name: c.name,
                  address: c.address || '',
                  phone: c.phone || '',
                  created_at: c.created_at,
                  license: lic ? {
                    id: lic.id,
                    plan: lic.plan,
                    status: lic.status,
                    expires_at: lic.expires_at,
                    max_apartments: lic.max_apartments || 250,
                    created_at: lic.created_at,
                  } : null,
                  syndic: null,
                  stats: {
                    units_count: cUnits,
                    max_units: lic?.max_apartments || 250,
                    residents_count: cRes,
                    packages_count: cPkgs.length,
                    pending_packages: cPkgs.filter((p: any) => p.status === 'RECEIVED' || p.status === 'NOTIFIED').length,
                    staff_count: 0,
                  }
                };
              });
              setAccounts(mappedAccounts);
              globalAccountsCache = mappedAccounts;
              try {
                sessionStorage.setItem('condobox_master_accounts', JSON.stringify(mappedAccounts));
              } catch {}
            }
          } catch (fbErr) {
            console.warn('Erro no fallback do Supabase:', fbErr);
          }
        }

        // LIBERAÇÃO IMEDIATA: Assim que as contas chegam, encerra o spinner roxo!
        setLoadingData(false);
      })();

      // 2. TAREFAS DE SEGUNDO PLANO: Executadas de forma assíncrona e desacoplada
      const backgroundTasks = async () => {
        // Anúncios
        try {
          const { data: adsData } = await supabase.from('ads').select('*').order('created_at', { ascending: false });
          if (adsData) {
            setAds(adsData);
            globalAdsCache = adsData;
          }
        } catch {}

        // Versões OTA
        try {
          await loadVersions();
        } catch {}

        // Gestão Financeira (silencioso)
        try {
          await loadFinancialData(true);
        } catch {}

        // Armazenamento em Nuvem e Trava Anti-Cobrança
        try {
          const res = await fetch('/api/super-admin/storage-status', { headers: { ...authHeaders } });
          if (res.ok) {
            const qData = await res.json();
            if (qData?.quota) {
              setStorageQuota(qData.quota);
              globalStorageQuotaCache = qData.quota;
            }
          }
        } catch {}
      };

      backgroundTasks();

      // Aguarda apenas as contas para retorno do método
      await accountsPromise;
    } catch (e) {
      console.error('Erro ao carregar dados:', e);
    } finally {
      setLoadingData(false);
    }
  };

  const handleSaveCondoPrice = async (condoId: string) => {
    const edit = condoPriceEdits[condoId];
    if (!edit) return;

    setCondoPriceEdits(prev => ({
      ...prev,
      [condoId]: { ...prev[condoId], saving: true, msg: undefined }
    }));

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/financial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          action: 'SET_CONDO_PRICE',
          condoId,
          monthlyPrice: parseFloat(String(edit.price).replace(',', '.')) || 0,
          billingDay: parseInt(String(edit.billingDay), 10) || 10
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar valor.');

      setCondoPriceEdits(prev => ({
        ...prev,
        [condoId]: { ...prev[condoId], saving: false, msg: '✅ Salvo!' }
      }));

      // Atualiza métricas financeiras consolidadas
      loadFinancialData();
    } catch (err: any) {
      setCondoPriceEdits(prev => ({
        ...prev,
        [condoId]: { ...prev[condoId], saving: false, msg: `❌ ${err.message}` }
      }));
    }
  };

  const handleReviewReceipt = async (action: 'APPROVE' | 'REJECT') => {
    if (!selectedReceiptForReview) return;
    setReviewLoading(true);
    setReviewMessage(null);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/financial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          action: 'REVIEW_RECEIPT',
          paymentId: selectedReceiptForReview.id,
          condoId: selectedReceiptForReview.condo_id,
          reviewAction: action,
          extensionDays: reviewExtensionDays,
          rejectionReason: action === 'REJECT' ? reviewRejectionReason : undefined
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao processar comprovante.');

      setReviewMessage(
        action === 'APPROVE'
          ? '✅ Comprovante aprovado e condomínio desbloqueado com sucesso!'
          : '✅ Comprovante marcado como rejeitado.'
      );

      setTimeout(() => {
        setSelectedReceiptForReview(null);
        setReviewRejectionReason('');
        setReviewMessage(null);
        loadFinancialData();
        loadData();
      }, 1200);
    } catch (err: any) {
      setReviewMessage(`❌ ${err.message}`);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleManualReceiptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCondoId) {
      setManualMsg('❌ Selecione um condomínio.');
      return;
    }
    setManualUploading(true);
    setManualMsg(null);

    try {
      if (manualFile) {
        const formData = new FormData();
        formData.append('file', manualFile);
        formData.append('condoId', manualCondoId);
        if (manualAmount) formData.append('amount', manualAmount.replace(',', '.'));
        if (manualNotes) formData.append('notes', manualNotes);

        const uploadRes = await fetch('/api/financial/receipt', {
          method: 'POST',
          body: formData
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Erro no upload do comprovante.');

        // Se o upload foi feito pelo sócio, aprova e desbloqueia automaticamente
        if (uploadData.paymentId) {
          const authHeaders = await getAuthHeaders();
          await fetch('/api/financial', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({
              action: 'REVIEW_RECEIPT',
              paymentId: uploadData.paymentId,
              condoId: manualCondoId,
              reviewAction: 'APPROVE',
              extensionDays: manualExtensionDays
            })
          });
        }
      } else {
        // Registro sem anexo físico
        const authHeaders = await getAuthHeaders();
        const res = await fetch('/api/financial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            action: 'REVIEW_RECEIPT',
            condoId: manualCondoId,
            reviewAction: 'APPROVE',
            extensionDays: manualExtensionDays,
            notes: manualNotes || 'Pagamento registrado diretamente pelo Sócio Proprietário'
          })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Erro ao registrar pagamento.');
        }
      }

      setManualMsg('✅ Pagamento registrado, aprovado e condomínio desbloqueado/estendido com sucesso!');
      setTimeout(() => {
        setIsManualReceiptModalOpen(false);
        setManualCondoId('');
        setManualAmount('');
        setManualNotes('');
        setManualFile(null);
        setManualMsg(null);
        loadFinancialData();
        loadData();
      }, 1200);
    } catch (err: any) {
      setManualMsg(`❌ ${err.message}`);
    } finally {
      setManualUploading(false);
    }
  };

  const handleSaveBillingSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBillingSettings(true);
    setBillingSettingsMsg(null);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/financial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          action: 'UPDATE_BILLING_SETTINGS',
          ...billingSettings
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao salvar chave Pix.');

      setBillingSettingsMsg('✅ Dados de cobrança e Chave Pix oficial salvos com sucesso!');
      setTimeout(() => {
        setBillingSettingsMsg(null);
      }, 3500);
    } catch (err: any) {
      setBillingSettingsMsg(`❌ ${err.message}`);
    } finally {
      setSavingBillingSettings(false);
    }
  };

  const handlePurgeStorage = async (days = 0) => {
    const confirmText = days === 0
      ? `Deseja realmente apagar TODAS as fotos (${storageQuota?.fileCount || 0} fotos, ${storageQuota?.usedMB || 0} MB) do armazenamento em nuvem para ZERAR o espaço e o contador? As encomendas e o histórico de moradores continuarão 100% salvos no banco.`
      : `Deseja limpar fotos antigas (+${days} dias) do armazenamento em nuvem para liberar espaço? As encomendas e o histórico continuarão 100% salvos no banco.`;

    if (!confirm(confirmText)) {
      return;
    }
    setPurgingStorage(true);
    setPurgeResultMsg(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/super-admin/storage-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao executar limpeza');
      if (data.quota) setStorageQuota(data.quota);
      setPurgeResultMsg(data.message || `${data.purgedCount} fotos removidas, liberando ${data.freedMB} MB!`);
    } catch (err: any) {
      alert(`Erro na limpeza: ${err.message}`);
    } finally {
      setPurgingStorage(false);
    }
  };

  const handleSaveVersion = async (appName: 'condobox-desktop' | 'condobox-master') => {
    setSavingVersionApp(appName);
    setVersionStatusMessage(null);
    try {
      const form = versionForm[appName];
      if (!form.version.trim()) {
        throw new Error('Informe o número da versão (ex: 1.0.1)');
      }

      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/app-version', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          app: appName,
          latest_version: form.version.trim(),
          download_url: form.url.trim(),
          release_notes: form.notes.trim(),
          is_mandatory: form.mandatory,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao publicar versão');
      }

      setVersionStatusMessage({
        app: appName,
        text: `Versão v${form.version.trim()} publicada com sucesso! Notificação com opções "Atualizar Agora" e "Depois" ativada nos computadores ao iniciarem.`,
        success: true,
      });
      await loadVersions();
    } catch (err: any) {
      setVersionStatusMessage({
        app: appName,
        text: err.message || 'Falha ao salvar versão',
        success: false,
      });
    } finally {
      setSavingVersionApp(null);
    }
  };

  // Abrir Modal de Edição de Plano
  const handleOpenEditModal = (account: AccountItem) => {
    setEditingAccount(account);
    setEditPlan(account.license?.plan || 'TRIAL');
    setEditMaxApartments(account.license?.max_apartments || 250);
    setEditStatus(account.license?.status || 'ACTIVE');

    if (account.license?.expires_at) {
      // Formato YYYY-MM-DD para input date
      const d = new Date(account.license.expires_at);
      setEditExpiresAt(d.toISOString().split('T')[0]);
    } else {
      setEditExpiresAt('');
    }
    setEditMessage(null);
  };

  // Salvar Alteração de Plano & Limites
  const handleSaveLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAccount) return;

    setEditLoading(true);
    setEditMessage(null);

    try {
      const authHeaders = await getAuthHeaders();
      let success = false;
      let errorMsg = '';

      try {
        const res = await fetch('/api/super-admin/accounts', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify({
            condoId: editingAccount.id,
            plan: editPlan,
            status: editStatus,
            maxApartments: editMaxApartments,
            expiresAt: editExpiresAt ? new Date(editExpiresAt).toISOString() : null,
          }),
        });

        if (res.ok) {
          success = true;
        } else {
          const data = await res.json().catch(() => ({}));
          errorMsg = data.error || 'Erro ao salvar licença.';
        }
      } catch (fetchErr: any) {
        console.warn('API endpoint indisponível, acionando gravação direta no Supabase:', fetchErr);
      }

      // Fallback resiliente direto no Supabase se a chamada de rede falhou
      if (!success) {
        const { data: existingLicense } = await supabase
          .from('licenses')
          .select('id')
          .eq('condo_id', editingAccount.id)
          .maybeSingle();

        const licensePayload = {
          condo_id: editingAccount.id,
          plan: editPlan,
          status: editStatus,
          max_apartments: Number(editMaxApartments),
          expires_at: editExpiresAt ? new Date(editExpiresAt).toISOString() : null,
          updated_at: new Date().toISOString(),
        };

        let directErr = null;
        if (existingLicense?.id) {
          const { error } = await supabase
            .from('licenses')
            .update(licensePayload)
            .eq('id', existingLicense.id);
          directErr = error;
        } else {
          const { error } = await supabase
            .from('licenses')
            .insert(licensePayload);
          directErr = error;
        }

        if (directErr) {
          throw new Error(errorMsg || directErr.message || 'Erro ao salvar alterações no banco.');
        }
      }

      setEditMessage('✅ Plano e limites atualizados com sucesso!');
      setTimeout(() => {
        setEditingAccount(null);
        loadData();
      }, 800);
    } catch (err: any) {
      setEditMessage(`❌ ${err.message}`);
    } finally {
      setEditLoading(false);
    }
  };

  // Criar Nova Conta
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCondoName.trim()) {
      setCreateError('Informe o nome do condomínio.');
      return;
    }

    setCreateLoading(true);
    setCreateError(null);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch('/api/super-admin/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          name: newCondoName.trim(),
          address: newCondoAddress.trim(),
          phone: newCondoPhone.trim(),
          plan: newCondoPlan,
          maxApartments: newCondoMaxUnits,
          syndicName: newSyndicName.trim() || undefined,
          syndicEmail: newSyndicEmail.trim() || undefined,
          syndicPassword: newSyndicPassword || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao cadastrar condomínio.');
      }

      setIsCreateModalOpen(false);
      setNewCondoName('');
      setNewCondoAddress('');
      setNewCondoPhone('');
      setNewSyndicName('');
      setNewSyndicEmail('');
      setNewSyndicPassword('');
      loadData();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  // Impersonar Condomínio
  const handleImpersonate = (account: AccountItem) => {
    impersonateCondo({ id: account.id, name: account.name });
    router.push('/admin');
  };

  // Abrir Modal de Exclusão de Condomínio
  const handleDeleteAccount = (account: AccountItem) => {
    setCondoToDelete(account);
    setDeleteConfirmName('');
    setDeleteError(null);
  };

  // Confirmar e Executar Exclusão Definitiva do Condomínio
  const handleConfirmDeleteCondo = async () => {
    if (!condoToDelete) return;

    const typed = deleteConfirmName.trim().toLowerCase();
    const expected = condoToDelete.name.trim().toLowerCase();

    if (typed !== expected) {
      setDeleteError(`O nome digitado não corresponde. Por favor, digite "${condoToDelete.name}".`);
      return;
    }

    setDeletingCondo(true);
    setDeleteError(null);

    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`/api/super-admin/accounts?condoId=${condoToDelete.id}`, {
        method: 'DELETE',
        headers: {
          ...authHeaders,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao excluir condomínio');
      }

      setCondoToDelete(null);
      setDeleteConfirmName('');
      await loadData();
    } catch (err: any) {
      console.error('Erro ao excluir condomínio:', err);
      setDeleteError(err.message || 'Erro ao processar exclusão.');
    } finally {
      setDeletingCondo(false);
    }
  };

  // Anúncios Handlers
  const handleCreateAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adImage) return;
    setAdLoading(true);
    try {
      await supabase.from('ads').insert({
        image_url: adImage,
        link_url: adLink,
        active: true,
      });
      setAdImage('');
      setAdLink('');
      loadData();
    } finally {
      setAdLoading(false);
    }
  };

  const handleToggleAd = async (id: string, active: boolean) => {
    await supabase.from('ads').update({ active }).eq('id', id);
    loadData();
  };

  const handleDeleteAd = async (id: string) => {
    if (confirm('Deletar anúncio?')) {
      await supabase.from('ads').delete().eq('id', id);
      loadData();
    }
  };

  // Filtros de contas
  const filteredAccounts = accounts.filter(acc => {
    const q = searchQuery.toLowerCase();
    const matchSearch =
      !searchQuery.trim() ||
      acc.name.toLowerCase().includes(q) ||
      acc.address.toLowerCase().includes(q) ||
      (acc.syndic?.name && acc.syndic.name.toLowerCase().includes(q)) ||
      (acc.syndic?.email && acc.syndic.email.toLowerCase().includes(q));

    const matchPlan =
      planFilter === 'ALL' ||
      (acc.license?.plan || 'TRIAL').toUpperCase() === planFilter.toUpperCase();

    const matchStatus =
      statusFilter === 'ALL' ||
      (acc.license?.status || 'ACTIVE').toUpperCase() === statusFilter.toUpperCase();

    return matchSearch && matchPlan && matchStatus;
  });

  // Nunca desaponta a tela se já houver contas carregadas em memória/cache
  if (accounts.length === 0 && (loading || loadingData)) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="animate-spin text-purple-500 w-9 h-9" />
        <p className="text-xs text-slate-400 font-medium">Carregando painel master SaaS...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-2xl text-white shadow-lg shadow-purple-950/50">
              <ShieldAlert size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                Painel do Sócio Proprietário <span className="text-xs px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono font-bold">MASTER SaaS</span>
              </h1>
              <p className="text-slate-400 text-xs mt-0.5">
                Controle global de contas de condomínios, licenciamento, limites de capacidade, pagamentos e suporte.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => loadData()}
            className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
            title="Atualizar dados"
          >
            <RefreshCw size={15} />
          </button>

          <button
            type="button"
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-purple-950/50 active:scale-95"
          >
            <Plus size={16} /> Nova Conta de Condomínio
          </button>
        </div>
      </div>

      {/* Bloquinhos Executivos do Dono do SaaS (Métricas de Negócio) */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* 1. Faturamento Mensal (MRR) */}
          <div className="bg-slate-900/90 border border-slate-800/90 hover:border-emerald-500/40 rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Faturamento Mensal
              </span>
              <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20 group-hover:scale-110 transition-transform">
                <DollarSign size={20} />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-black text-emerald-400 tracking-tight block">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(metrics.estimated_mrr || 0)}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">
                Receita recorrente (MRR)
              </span>
            </div>
          </div>

          {/* 2. Assinaturas Ativas */}
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE')}
            className={`text-left bg-slate-900/90 border rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group ${
              statusFilter === 'ACTIVE'
                ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-950/20'
                : 'border-slate-800/90 hover:border-blue-500/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Assinaturas Ativas
              </span>
              <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/20 group-hover:scale-110 transition-transform">
                <CheckCircle2 size={20} />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-black text-white tracking-tight block">
                {metrics.active_condos}
              </span>
              <span className="text-[11px] text-blue-400 font-semibold mt-1 block">
                Em dia • Acesso liberado
              </span>
            </div>
          </button>

          {/* 3. Em Teste (Trial) */}
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'TRIAL' ? 'ALL' : 'TRIAL')}
            className={`text-left bg-slate-900/90 border rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group ${
              statusFilter === 'TRIAL'
                ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-950/20'
                : 'border-slate-800/90 hover:border-amber-500/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Em Teste (Trial)
              </span>
              <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20 group-hover:scale-110 transition-transform">
                <Clock size={20} />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-black text-amber-400 tracking-tight block">
                {metrics.trial_condos}
              </span>
              <span className="text-[11px] text-slate-400 mt-1 block">
                Avaliação gratuita ativa
              </span>
            </div>
          </button>

          {/* 4. Pausados por Falta de Pagamento */}
          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === 'EXPIRED' ? 'ALL' : 'EXPIRED')}
            className={`text-left bg-slate-900/90 border rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group ${
              statusFilter === 'EXPIRED' || statusFilter === 'BLOCKED'
                ? 'border-rose-500 ring-2 ring-rose-500/20 bg-rose-950/20'
                : 'border-slate-800/90 hover:border-rose-500/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Pausados / Atrasados
              </span>
              <div className="p-2.5 bg-rose-500/10 text-rose-400 rounded-2xl border border-rose-500/20 group-hover:scale-110 transition-transform">
                <AlertTriangle size={20} />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-black text-rose-400 tracking-tight block">
                {metrics.paused_condos}
              </span>
              <span className="text-[11px] text-rose-400/90 font-medium mt-1 block">
                Falta de pagamento / Expirado
              </span>
            </div>
          </button>

          {/* 5. Total de Condomínios */}
          <button
            type="button"
            onClick={() => { setStatusFilter('ALL'); setPlanFilter('ALL'); setSearchQuery(''); }}
            className={`text-left bg-slate-900/90 border rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group ${
              statusFilter === 'ALL' && planFilter === 'ALL' && !searchQuery
                ? 'border-purple-500/60 bg-purple-950/20'
                : 'border-slate-800/90 hover:border-purple-500/40'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Total Condomínios
              </span>
              <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-2xl border border-purple-500/20 group-hover:scale-110 transition-transform">
                <Building2 size={20} />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-2xl sm:text-3xl font-black text-white tracking-tight block">
                {metrics.total_condos}
              </span>
              <span className="text-[11px] text-purple-300 font-semibold mt-1 block">
                Base total cadastrada
              </span>
            </div>
          </button>
        </div>
      )}

      {/* ⚠️ Alerta de Contas Expiradas & Contatos Oficiais de Suporte */}
      {metrics && metrics.paused_condos > 0 && (
        <div className="bg-gradient-to-r from-rose-950/40 via-red-950/30 to-slate-900/90 border border-rose-500/40 rounded-3xl p-5 sm:p-6 shadow-2xl backdrop-blur-xl animate-fade-in space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-rose-500/20 text-rose-400 rounded-2xl border border-rose-500/30 shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-base font-bold text-white tracking-tight">
                    {metrics.paused_condos} {metrics.paused_condos === 1 ? 'Condomínio Expirado' : 'Condomínios Expirados'} • Falta de Pagamento
                  </h3>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 uppercase">
                    Acesso Interrompido
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                  Para as contas onde o tempo acabou, os usuários visualizam a tela de bloqueio pedindo para <strong>efetuar o pagamento</strong> ou <strong>entrar em contato com o suporte para desbloqueio</strong>.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <a
                href={buildSupportWhatsAppUrl('5573998419901')}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <Phone size={13} />
                <span>WhatsApp: (73) 99841-9901</span>
              </a>
              <a
                href={buildSupportWhatsAppUrl('5521971966473')}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <Phone size={13} />
                <span>WhatsApp: (21) 97196-6473</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* 🛡️ Cartão de Proteção Anti-Cobrança & Armazenamento em Nuvem */}
      {storageQuota && (
        <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 shadow-2xl relative overflow-hidden backdrop-blur-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className={`p-3 rounded-2xl border ${
                storageQuota.status === 'SAFE'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : storageQuota.status === 'WARNING'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-400'
              }`}>
                <ShieldCheck size={26} />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    Proteção Anti-Cobrança & Armazenamento
                  </h2>
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                    storageQuota.status === 'SAFE'
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : storageQuota.status === 'WARNING'
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                      : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                  }`}>
                    {storageQuota.status === 'SAFE'
                      ? '🟢 100% Gratuito (Zero Risco de Cobrança)'
                      : storageQuota.status === 'WARNING'
                      ? '🟡 Atenção: 75%+ da Cota Segura'
                      : '🔴 Trava Ativa: Upload Nuvem Pausado (Custo Zero Garantido)'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 max-w-2xl">
                  {storageQuota.message} Imagens salvas em <strong className="text-slate-200">WebP super compactado (~60 KB)</strong> com rotação automática de 30 dias.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap self-start md:self-center">
              <select
                value={purgeDaysSelect}
                onChange={e => setPurgeDaysSelect(Number(e.target.value))}
                className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 font-semibold focus:outline-none focus:border-rose-500"
              >
                <option value={0}>🗑️ Todas as Fotos (Zerar Armazenamento)</option>
                <option value={7}>Fotos com mais de 7 dias</option>
                <option value={15}>Fotos com mais de 15 dias</option>
                <option value={30}>Fotos com mais de 30 dias</option>
              </select>

              <button
                type="button"
                onClick={() => handlePurgeStorage(purgeDaysSelect)}
                disabled={purgingStorage}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50 ${
                  purgeDaysSelect === 0
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/50'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
                title="Executar limpeza do armazenamento em nuvem"
              >
                {purgingStorage ? (
                  <Loader2 size={14} className="animate-spin text-white" />
                ) : (
                  <Trash2 size={14} className={purgeDaysSelect === 0 ? 'text-white' : 'text-rose-400'} />
                )}
                <span>{purgeDaysSelect === 0 ? 'Zerar Armazenamento Agora' : 'Limpar Fotos'}</span>
              </button>
            </div>
          </div>

          {/* Barra de Progresso de Consumo */}
          <div className="mt-4 pt-4 border-t border-slate-800/80">
            <div className="flex items-center justify-between text-xs mb-1.5 font-medium">
              <span className="text-slate-300">
                Uso do Storage em Nuvem: <strong className="text-white">{storageQuota.usedMB} MB</strong> de <strong className="text-slate-400">{storageQuota.limitMB} MB</strong> cota segura
              </span>
              <span className={`font-bold ${
                storageQuota.percentUsed < 70 ? 'text-emerald-400' : storageQuota.percentUsed < 90 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {storageQuota.percentUsed}% utilizado ({storageQuota.fileCount} fotos)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  storageQuota.percentUsed < 70
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    : storageQuota.percentUsed < 90
                    ? 'bg-gradient-to-r from-amber-500 to-orange-400'
                    : 'bg-gradient-to-r from-rose-600 to-red-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(2, storageQuota.percentUsed))}%` }}
              />
            </div>
          </div>

          {purgeResultMsg && (
            <div className="mt-3 text-xs px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl flex items-center justify-between">
              <span>{purgeResultMsg}</span>
              <button type="button" onClick={() => setPurgeResultMsg(null)} className="text-emerald-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Navegação entre Abas (Contas, Financeiro, Anúncios, Versões) */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('ACCOUNTS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'ACCOUNTS'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Building2 size={15} />
          Contas & Licenciamento ({accounts.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('FINANCIAL')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap relative ${
            activeTab === 'FINANCIAL'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <DollarSign size={15} className={activeTab === 'FINANCIAL' ? 'text-white' : 'text-emerald-400'} />
          <span>Gestão Financeira & Assinaturas</span>
          {pendingReceipts.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-black text-[10px] animate-pulse">
              {pendingReceipts.length} para aprovar
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ADS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'ADS'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <ImageIcon size={15} />
          Rede de Anúncios / Ads ({ads.length})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('VERSIONS')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
            activeTab === 'VERSIONS'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-950/40'
              : 'text-slate-400 hover:text-white hover:bg-slate-900'
          }`}
        >
          <Download size={15} />
          Versões & Atualizações OTA
        </button>
      </div>

      {/* ABA 1: GESTÃO DE CONTAS */}
      {activeTab === 'ACCOUNTS' && (
        <div className="space-y-4">
          {/* Barra de Busca e Filtros */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-900/70 p-3 rounded-2xl border border-slate-800">
            <div className="relative w-full md:w-80">
              <Search size={14} className="text-slate-500 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Buscar por condomínio, cidade, síndico..."
                className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
              <select
                value={planFilter}
                onChange={e => setPlanFilter(e.target.value)}
                className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-semibold focus:outline-none"
              >
                <option value="ALL">Todos os Planos</option>
                <option value="TRIAL">Trial (30 dias)</option>
                <option value="BASIC">Basic (Com Ads)</option>
                <option value="PRO">Pro (Sem Ads)</option>
                <option value="PRO_MAX">Pro Max (600 Aps)</option>
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 text-xs font-semibold focus:outline-none"
              >
                <option value="ALL">Todos os Status</option>
                <option value="ACTIVE">Ativo</option>
                <option value="TRIAL">Em Teste</option>
                <option value="EXPIRED">Expirado</option>
                <option value="BLOCKED">Bloqueado</option>
              </select>
            </div>
          </div>

          {/* Tabela de Contas de Condomínio */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-4">Condomínio & Localização</th>
                    <th className="p-4">Síndico / Contato</th>
                    <th className="p-4">Plano</th>
                    <th className="p-4">Capacidade (Aptos)</th>
                    <th className="p-4">Status & Validade</th>
                    <th className="p-4 text-right">Ações Master</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredAccounts.map(account => {
                    const plan = account.license?.plan || 'TRIAL';
                    const status = account.license?.status || 'ACTIVE';
                    const maxUnits = account.license?.max_apartments || 250;
                    const usedUnits = account.stats.units_count;
                    const percentUnits = Math.min(Math.round((usedUnits / maxUnits) * 100), 100);

                    // Formatação de expiração
                    let expiresFormatted = 'Vitalício';
                    let isExpired = false;
                    if (account.license?.expires_at) {
                      const expDate = new Date(account.license.expires_at);
                      expiresFormatted = expDate.toLocaleDateString('pt-BR');
                      isExpired = expDate.getTime() < Date.now();
                    }

                    return (
                      <tr key={account.id} className="hover:bg-slate-850/50 transition">
                        {/* Condomínio */}
                        <td className="p-4">
                          <div className="font-bold text-sm text-slate-100 flex items-center gap-2">
                            <Building2 size={16} className="text-purple-400 shrink-0" />
                            <span>{account.name}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-xs">
                            {account.address || 'Endereço não informado'}
                          </p>
                          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                            ID: {account.id}
                          </p>
                        </td>

                        {/* Síndico */}
                        <td className="p-4">
                          {account.syndic ? (
                            <div className="space-y-0.5">
                              <p className="font-semibold text-slate-200 flex items-center gap-1.5">
                                <Users size={12} className="text-indigo-400" />
                                {account.syndic.name}
                              </p>
                              {account.syndic.email && (
                                <p className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                                  <Mail size={11} className="text-slate-500" />
                                  {account.syndic.email}
                                </p>
                              )}
                              {account.syndic.phone && (
                                <p className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono font-semibold">
                                  <Phone size={11} />
                                  {account.syndic.phone}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-500 italic text-[11px]">Nenhum síndico vinculado</span>
                          )}
                        </td>

                        {/* Plano */}
                        <td className="p-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold uppercase tracking-wide border ${
                              plan === 'PRO_MAX'
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                : plan === 'PRO'
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                : plan === 'BASIC'
                                ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            }`}
                          >
                            <Sparkles size={11} />
                            {plan === 'PRO_MAX' ? 'Pro Max' : plan}
                          </span>
                        </td>

                        {/* Capacidade e Limite de Aptos */}
                        <td className="p-4">
                          <div className="space-y-1.5 w-36">
                            <div className="flex justify-between text-[11px] font-semibold">
                              <span className="text-slate-200">{usedUnits} aptos</span>
                              <span className="text-slate-500">/ {maxUnits}</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  percentUnits >= 100
                                    ? 'bg-rose-500'
                                    : percentUnits >= 80
                                    ? 'bg-amber-400'
                                    : 'bg-indigo-500'
                                }`}
                                style={{ width: `${percentUnits}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-slate-500">
                              {account.stats.residents_count} moradores • {account.stats.packages_count} encomendas
                            </p>
                          </div>
                        </td>

                        {/* Status e Validade */}
                        <td className="p-4">
                          {isExpired || status === 'EXPIRED' || status === 'BLOCKED' ? (
                            <div className="space-y-1">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-rose-500/15 text-rose-300 border border-rose-500/30 animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                                {status === 'BLOCKED' ? 'Bloqueado' : 'Tempo Esgotado'}
                              </span>
                              <p className="text-[10px] text-rose-400 font-semibold">
                                Pagamento / Suporte Pendente
                              </p>
                              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                                <Calendar size={11} className="text-slate-500" />
                                Validade: <strong className="text-rose-300">{expiresFormatted}</strong>
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                  status === 'ACTIVE'
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${status === 'ACTIVE' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                {status === 'ACTIVE' ? 'Liberado' : status}
                              </span>
                              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                                <Calendar size={11} className="text-slate-500" />
                                Validade: <strong className="text-slate-300">{expiresFormatted}</strong>
                              </p>
                            </div>
                          )}
                        </td>

                        {/* Ações Master */}
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Botão de WhatsApp de Suporte / Pagamento para contas expiradas */}
                            {(isExpired || status === 'EXPIRED' || status === 'BLOCKED') && (
                              <a
                                href={buildSupportWhatsAppUrl('5573998419901', account.name, account.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 rounded-xl transition border border-emerald-500/30"
                                title="Abrir WhatsApp com suporte de desbloqueio para este condomínio"
                              >
                                <Phone size={14} />
                              </a>
                            )}

                            {/* Botão de Impersonação */}
                            <button
                              type="button"
                              onClick={() => handleImpersonate(account)}
                              className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm active:scale-95"
                              title={`Impersonar condomínio ${account.name} e navegar como Síndico`}
                            >
                              <Eye size={13} />
                              <span>Impersonar</span>
                            </button>

                            {/* Botão de Alterar Plano & Limites */}
                            <button
                              type="button"
                              onClick={() => handleOpenEditModal(account)}
                              className="p-1.5 text-slate-400 hover:text-purple-300 hover:bg-slate-800 rounded-xl transition border border-transparent hover:border-slate-700"
                              title="Alterar plano, limites e expiração"
                            >
                              <SlidersHorizontal size={15} />
                            </button>

                            {/* Botão de Excluir */}
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(account)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition"
                              title="Excluir condomínio"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAccounts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 text-xs">
                        Nenhum condomínio encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA: GESTÃO FINANCEIRA & ASSINATURAS (MODELO NETFLIX) */}
      {activeTab === 'FINANCIAL' && (
        <div className="space-y-6 animate-fade-in">
          {/* Cabeçalho & Botões de Ação */}
          <div className="bg-gradient-to-r from-emerald-950/40 via-slate-900/90 to-slate-900/90 border border-emerald-500/30 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-2xl shrink-0">
                <Wallet size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-lg font-black text-white tracking-tight">
                    Gestão Financeira & Assinaturas • Modelo Netflix
                  </h2>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 uppercase">
                    Cobrança Recorrente SaaS
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
                  Cada condomínio é um assinante do seu sistema. Defina o valor mensal que você cobra de cada condomínio, o dia de vencimento, confira os comprovantes anexados para desbloqueio e anexe pagamentos externos.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <button
                type="button"
                onClick={() => setIsManualReceiptModalOpen(true)}
                className="px-3.5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-emerald-950/40 active:scale-95"
              >
                <Plus size={15} />
                <span>Anexar Comprovante Manualmente</span>
              </button>

              <button
                type="button"
                onClick={() => loadFinancialData()}
                disabled={loadingFinancial}
                className="p-2.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
                title="Atualizar dados financeiros"
              >
                <RefreshCw size={15} className={loadingFinancial ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {financialError && (
            <div className="p-3.5 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs font-semibold flex items-center justify-between">
              <span>{financialError}</span>
              <button type="button" onClick={() => setFinancialError(null)} className="text-rose-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Cards de Métricas Financeiras Executivas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. MRR Real Consolidado */}
            <div className="bg-slate-900/90 border border-slate-800/90 hover:border-emerald-500/40 rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  MRR Real Consolidado
                </span>
                <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20 group-hover:scale-110 transition-transform">
                  <DollarSign size={20} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-2xl sm:text-3xl font-black text-emerald-400 tracking-tight block">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                    financialMetrics?.totalMonthlyRecurring || 0
                  )}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Soma dos valores fixados por condomínio
                </span>
              </div>
            </div>

            {/* 2. Total Recebido no Mês */}
            <div className="bg-slate-900/90 border border-slate-800/90 hover:border-blue-500/40 rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Total Recebido (Mês Atual)
                </span>
                <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-2xl border border-blue-500/20 group-hover:scale-110 transition-transform">
                  <CheckCircle2 size={20} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-2xl sm:text-3xl font-black text-blue-400 tracking-tight block">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                    financialMetrics?.totalReceivedThisMonth || 0
                  )}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Pagamentos aprovados e confirmados
                </span>
              </div>
            </div>

            {/* 3. Total Pendente / Atrasado */}
            <div className="bg-slate-900/90 border border-slate-800/90 hover:border-rose-500/40 rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Total Pendente / Atrasado
                </span>
                <div className="p-2.5 bg-rose-500/10 text-rose-400 rounded-2xl border border-rose-500/20 group-hover:scale-110 transition-transform">
                  <AlertTriangle size={20} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-2xl sm:text-3xl font-black text-rose-400 tracking-tight block">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                    financialMetrics?.totalPending || 0
                  )}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Condomínios com acesso bloqueado
                </span>
              </div>
            </div>

            {/* 4. Comprovantes Aguardando Sua Aprovação */}
            <div className={`border rounded-3xl p-5 shadow-xl transition-all relative overflow-hidden group ${
              (financialMetrics?.pendingReceiptsCount || 0) > 0
                ? 'bg-amber-950/25 border-amber-500/50 ring-2 ring-amber-500/20 animate-pulse'
                : 'bg-slate-900/90 border-slate-800/90 hover:border-slate-700'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Aguardando Sua Aprovação
                </span>
                <div className={`p-2.5 rounded-2xl border ${
                  (financialMetrics?.pendingReceiptsCount || 0) > 0
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  <FileCheck size={20} />
                </div>
              </div>
              <div className="mt-3">
                <span className={`text-2xl sm:text-3xl font-black tracking-tight block ${
                  (financialMetrics?.pendingReceiptsCount || 0) > 0 ? 'text-amber-400' : 'text-slate-300'
                }`}>
                  {financialMetrics?.pendingReceiptsCount || 0} {financialMetrics?.pendingReceiptsCount === 1 ? 'comprovante' : 'comprovantes'}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  {(financialMetrics?.pendingReceiptsCount || 0) > 0
                    ? 'Clique para analisar e desbloquear'
                    : 'Tudo em dia! Nenhum pendente'}
                </span>
              </div>
            </div>
          </div>

          {/* SEÇÃO 1: COMPROVANTES AGUARDANDO APROVAÇÃO (DESTAQUE) */}
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-xl">
                  <FileCheck size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    <span>Comprovantes de Pagamento Aguardando Aprovação</span>
                    {pendingReceipts.length > 0 && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold">
                        {pendingReceipts.length} PENDENTE(S)
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">
                    O condomínio só é desbloqueado após você conferir e clicar em Aprovar.
                  </p>
                </div>
              </div>
            </div>

            {pendingReceipts.length === 0 ? (
              <div className="p-8 text-center bg-slate-950/60 border border-slate-800/80 rounded-2xl space-y-2">
                <CheckCircle2 size={32} className="mx-auto text-emerald-400" />
                <p className="text-sm font-bold text-slate-200">
                  Nenhum comprovante aguardando conferência no momento.
                </p>
                <p className="text-xs text-slate-500">
                  Quando um condomínio enviar um comprovante pela tela de bloqueio, ele aparecerá aqui com foto em alta resolução para sua liberação.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pendingReceipts.map((receipt: any) => (
                  <div
                    key={receipt.id}
                    className="p-4 bg-slate-950 border border-amber-500/40 rounded-2xl space-y-3.5 shadow-lg relative overflow-hidden"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
                          Comprovante Recebido • Aguarda Desbloqueio
                        </span>
                        <h4 className="text-sm font-black text-white mt-0.5">
                          {receipt.condo_name || receipt.condoId || 'Condomínio'}
                        </h4>
                        <p className="text-[11px] text-slate-400 font-mono">
                          ID: {receipt.condo_id}
                        </p>
                      </div>

                      <span className="text-xs font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 rounded-xl">
                        {receipt.amount ? `R$ ${Number(receipt.amount).toFixed(2)}` : 'Valor não informado'}
                      </span>
                    </div>

                    {/* Preview do Comprovante (Miniatura Clicável com Zoom) */}
                    <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                      {receipt.receipt_url ? (
                        receipt.receipt_url.toLowerCase().endsWith('.pdf') ? (
                          <a
                            href={receipt.receipt_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-16 h-16 bg-slate-800 rounded-lg flex flex-col items-center justify-center text-rose-400 border border-slate-700 hover:border-purple-500 transition shrink-0 group"
                            title="Abrir PDF em nova aba"
                          >
                            <FileText size={24} />
                            <span className="text-[9px] font-bold text-slate-300 mt-1">PDF</span>
                          </a>
                        ) : (
                          <div
                            onClick={() => setSelectedReceiptForReview(receipt)}
                            className="w-16 h-16 rounded-lg border border-slate-700 hover:border-emerald-500 cursor-pointer overflow-hidden shrink-0 relative group"
                            title="Clique para ampliar em tela cheia"
                          >
                            <img
                              src={receipt.receipt_url}
                              alt="Comprovante"
                              className="w-full h-full object-cover group-hover:scale-110 transition duration-300"
                            />
                            <div className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                              <Maximize2 size={14} className="text-white" />
                            </div>
                          </div>
                        )
                      ) : (
                        <div className="w-16 h-16 bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 shrink-0">
                          <Receipt size={24} />
                        </div>
                      )}

                      <div className="min-w-0 flex-1 space-y-1 text-xs">
                        <p className="text-slate-300 font-semibold truncate">
                          {receipt.notes || 'Sem observações adicionais'}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Enviado em: {new Date(receipt.created_at).toLocaleString('pt-BR')}
                        </p>
                        {receipt.receipt_url && (
                          <button
                            type="button"
                            onClick={() => setSelectedReceiptForReview(receipt)}
                            className="text-[11px] text-purple-400 hover:text-purple-300 font-bold flex items-center gap-1 transition"
                          >
                            <Eye size={12} />
                            <span>Visualizar Comprovante & Analisar</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Botões de Ação Imediata */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReceiptForReview(receipt);
                          setReviewExtensionDays(30);
                        }}
                        className="flex-1 py-2 px-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 active:scale-95"
                      >
                        <CheckCircle2 size={14} />
                        <span>Aprovar & Desbloquear</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedReceiptForReview(receipt);
                          setReviewRejectionReason('Comprovante não identificado ou valor divergente');
                        }}
                        className="py-2 px-3 bg-slate-900 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-500/40 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1"
                        title="Rejeitar comprovante"
                      >
                        <XCircle size={14} />
                        <span>Rejeitar</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SEÇÃO 2: TABELA DE ASSINANTES (MODELO NETFLIX) & DEFINIÇÃO DE VALORES */}
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <Building2 size={18} className="text-purple-400" />
                  <span>Assinantes (Condomínios) • Definição de Valores Cobrados</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Defina o valor em R$ cobrado de cada condomínio e o dia do vencimento. Os valores são salvos individualmente.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">
                  Total de Assinantes: <strong className="text-white">{financialSubscribers.length}</strong>
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950/70 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-3.5 font-bold">Condomínio</th>
                    <th className="p-3.5 font-bold">Status da Assinatura</th>
                    <th className="p-3.5 font-bold">Vigência / Vencimento</th>
                    <th className="p-3.5 font-bold">Valor Cobrado Mensal (R$)</th>
                    <th className="p-3.5 font-bold">Dia Vencimento</th>
                    <th className="p-3.5 font-bold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {financialSubscribers.map((sub: any) => {
                    const editState = condoPriceEdits[sub.condoId] || {
                      price: String(sub.monthlyPrice || 149),
                      billingDay: String(sub.billingDay || 10)
                    };

                    const isSaving = Boolean(editState.saving);

                    // Formata a data de expiração
                    let expiryText = 'Não definida';
                    let isExpired = false;
                    if (sub.expiresAt) {
                      const expDate = new Date(sub.expiresAt);
                      const diffMs = expDate.getTime() - Date.now();
                      const diffDays = Math.ceil(diffMs / 86400000);
                      if (diffDays <= 0) {
                        expiryText = `Expirado (${expDate.toLocaleDateString('pt-BR')})`;
                        isExpired = true;
                      } else {
                        expiryText = `${expDate.toLocaleDateString('pt-BR')} (em ${diffDays}d)`;
                      }
                    }

                    return (
                      <tr key={sub.condoId} className="hover:bg-slate-800/30 transition">
                        {/* Condomínio */}
                        <td className="p-3.5">
                          <div className="font-bold text-white text-sm">{sub.condoName}</div>
                          <div className="text-[10px] text-slate-500 font-mono">ID: {sub.condoId}</div>
                          <div className="text-[10px] text-purple-400 font-semibold mt-0.5">
                            Plano: {sub.plan || 'TRIAL'} • {sub.unitsCount || 0} aptos
                          </div>
                        </td>

                        {/* Status */}
                        <td className="p-3.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                              sub.status === 'ACTIVE'
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                : sub.status === 'TRIAL'
                                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                                : sub.status === 'UNDER_REVIEW'
                                ? 'bg-orange-500/15 border-orange-500/30 text-orange-300'
                                : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                            }`}
                          >
                            {sub.status === 'ACTIVE'
                              ? '🟢 Em Dia / Ativo'
                              : sub.status === 'TRIAL'
                              ? '🟡 Em Teste'
                              : sub.status === 'UNDER_REVIEW'
                              ? '🟠 Comprovante em Análise'
                              : '🔴 Expirado / Bloqueado'}
                          </span>
                        </td>

                        {/* Vigência / Vencimento */}
                        <td className="p-3.5">
                          <span className={`font-mono text-xs ${isExpired ? 'text-rose-400 font-bold' : 'text-slate-300'}`}>
                            {expiryText}
                          </span>
                        </td>

                        {/* Campo Definido: Valor Cobrado Mensal (R$) */}
                        <td className="p-3.5">
                          <div className="flex items-center gap-1.5 w-32">
                            <span className="text-slate-400 text-xs font-bold">R$</span>
                            <input
                              type="text"
                              value={editState.price}
                              onChange={e => {
                                const val = e.target.value;
                                setCondoPriceEdits(prev => ({
                                  ...prev,
                                  [sub.condoId]: {
                                    ...prev[sub.condoId],
                                    price: val
                                  }
                                }));
                              }}
                              className="w-full px-2.5 py-1.5 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg text-white font-mono text-xs font-bold focus:outline-none"
                              placeholder="149,00"
                            />
                          </div>
                        </td>

                        {/* Campo Definido: Dia de Vencimento */}
                        <td className="p-3.5">
                          <select
                            value={editState.billingDay}
                            onChange={e => {
                              const val = e.target.value;
                              setCondoPriceEdits(prev => ({
                                ...prev,
                                [sub.condoId]: {
                                  ...prev[sub.condoId],
                                  billingDay: val
                                }
                              }));
                            }}
                            className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded-lg text-slate-200 font-mono text-xs focus:outline-none"
                          >
                            {[5, 10, 15, 20, 25, 30].map(day => (
                              <option key={day} value={day}>
                                Dia {day < 10 ? `0${day}` : day}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Ações */}
                        <td className="p-3.5 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => handleSaveCondoPrice(sub.condoId)}
                            disabled={isSaving}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition inline-flex items-center gap-1 shadow-sm active:scale-95"
                          >
                            {isSaving ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <Check size={12} />
                            )}
                            <span>{editState.msg || 'Salvar Valor'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setManualCondoId(sub.condoId);
                              setManualAmount(editState.price || '149');
                              setIsManualReceiptModalOpen(true);
                            }}
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold border border-slate-700 transition inline-flex items-center gap-1"
                            title="Anexar comprovante para este condomínio"
                          >
                            <Receipt size={12} />
                            <span>Anexar</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {financialSubscribers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 text-xs">
                        Nenhum condomínio cadastrado no momento.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* SEÇÃO 3: CONFIGURAÇÕES DA CHAVE PIX OFICIAL DO SAAS */}
          <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
              <div className="p-2 bg-purple-500/15 text-purple-400 border border-purple-500/30 rounded-xl">
                <QrCode size={18} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white tracking-tight">
                  Chave Pix Oficial para Recebimento das Mensalidades
                </h3>
                <p className="text-xs text-slate-400">
                  Esta é a chave Pix exibida para os condomínios na tela de pagamento e bloqueio.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveBillingSettings} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Tipo da Chave Pix *</label>
                  <select
                    value={billingSettings.pixKeyType}
                    onChange={e => setBillingSettings(prev => ({ ...prev, pixKeyType: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="TELEFONE">Telefone / Celular</option>
                    <option value="CNPJ">CNPJ</option>
                    <option value="CPF">CPF</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="ALEATORIA">Chave Aleatória (EVP)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Chave Pix *</label>
                  <input
                    type="text"
                    required
                    value={billingSettings.pixKey}
                    onChange={e => setBillingSettings(prev => ({ ...prev, pixKey: e.target.value }))}
                    placeholder="Ex: 73998419901"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Nome do Titular / Razão Social</label>
                  <input
                    type="text"
                    value={billingSettings.holderName}
                    onChange={e => setBillingSettings(prev => ({ ...prev, holderName: e.target.value }))}
                    placeholder="Ex: CondoBox Tecnologia Ltda"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Banco / Instituição</label>
                  <input
                    type="text"
                    value={billingSettings.bankName}
                    onChange={e => setBillingSettings(prev => ({ ...prev, bankName: e.target.value }))}
                    placeholder="Ex: Nubank / Inter / Itaú"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                {billingSettingsMsg && (
                  <span className="text-xs font-semibold text-emerald-400">
                    {billingSettingsMsg}
                  </span>
                )}
                <div className="ml-auto">
                  <button
                    type="submit"
                    disabled={savingBillingSettings}
                    className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl font-bold transition flex items-center gap-1.5 shadow-md shadow-purple-950/50"
                  >
                    {savingBillingSettings ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                    <span>Salvar Chave Pix Oficial</span>
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* SEÇÃO 4: HISTÓRICO GERAL DE COMPROVANTES & PAGAMENTOS */}
          {allReceipts.length > 0 && (
            <div className="bg-slate-900/95 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  <Receipt size={18} className="text-slate-400" />
                  <span>Histórico Geral de Comprovantes & Pagamentos ({allReceipts.length})</span>
                </h3>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950/70 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-3">Data</th>
                      <th className="p-3">Condomínio</th>
                      <th className="p-3">Valor</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Comprovante</th>
                      <th className="p-3">Observações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {allReceipts.map((r: any) => (
                      <tr key={r.id} className="hover:bg-slate-800/30 transition text-xs">
                        <td className="p-3 text-slate-400">
                          {new Date(r.created_at).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="p-3 font-sans font-bold text-white">
                          {r.condo_name || r.condo_id}
                        </td>
                        <td className="p-3 text-emerald-400 font-bold">
                          {r.amount ? `R$ ${Number(r.amount).toFixed(2)}` : '-'}
                        </td>
                        <td className="p-3 font-sans">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
                              r.status === 'PAID'
                                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                                : r.status === 'UNDER_REVIEW'
                                ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                                : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                            }`}
                          >
                            {r.status === 'PAID' ? 'Aprovado' : r.status === 'UNDER_REVIEW' ? 'Em Análise' : 'Rejeitado'}
                          </span>
                        </td>
                        <td className="p-3 font-sans">
                          {r.receipt_url ? (
                            <a
                              href={r.receipt_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-purple-400 hover:underline flex items-center gap-1"
                            >
                              <Eye size={12} />
                              <span>Ver anexo</span>
                            </a>
                          ) : (
                            <span className="text-slate-600">Sem anexo</span>
                          )}
                        </td>
                        <td className="p-3 text-slate-400 font-sans max-w-xs truncate">
                          {r.notes || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ABA 2: REDE DE ANÚNCIOS */}
      {activeTab === 'ADS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Formulário Novo Anúncio */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Plus size={18} className="text-purple-400" /> Cadastrar Novo Anúncio (Plano Basic)
            </h2>
            <p className="text-xs text-slate-400">
              Anúncios aparecem no rodapé de mensagens WhatsApp e na página de retirada de pacotes dos condomínios no plano Basic.
            </p>

            <form onSubmit={handleCreateAd} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">URL da Imagem / Banner *</label>
                <input
                  type="text"
                  required
                  placeholder="https://exemplo.com/banner.jpg"
                  value={adImage}
                  onChange={e => setAdImage(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Link de Destino (Site / WhatsApp) *</label>
                <input
                  type="text"
                  placeholder="https://wa.me/55... ou https://meusite.com"
                  value={adLink}
                  onChange={e => setAdLink(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500"
                />
              </div>

              <button
                type="submit"
                disabled={adLoading}
                className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950 disabled:opacity-50"
              >
                {adLoading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Cadastrar Anúncio
              </button>
            </form>
          </div>

          {/* Lista de Anúncios Rodando */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <ImageIcon size={18} className="text-purple-400" /> Anúncios Ativos na Rede
            </h2>

            <div className="space-y-3">
              {ads.map(ad => (
                <div
                  key={ad.id}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3.5 transition ${
                    ad.active ? 'bg-slate-950 border-slate-800' : 'bg-slate-950/40 border-slate-800/40 opacity-50'
                  }`}
                >
                  <img
                    src={ad.image_url}
                    alt="Banner"
                    className="w-20 h-14 object-cover rounded-xl border border-slate-800 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <a
                      href={ad.link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-purple-400 hover:underline truncate block font-mono"
                    >
                      {ad.link_url || 'Sem link externo'}
                    </a>
                    <p className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                      <Eye size={12} className="text-slate-500" /> {ad.views || 0} visualizações
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleAd(ad.id, !ad.active)}
                      className="px-2.5 py-1.5 bg-slate-850 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition"
                    >
                      {ad.active ? 'Pausar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAd(ad.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 rounded-xl transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {ads.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-6">Nenhum anúncio veiculado no momento.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: VERSÕES & ATUALIZAÇÕES OTA */}
      {activeTab === 'VERSIONS' && (
        <div className="space-y-6">
          {/* Header Explicativo */}
          <div className="bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900 p-6 rounded-3xl border border-purple-800/30 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-purple-500/15 border border-purple-500/30 rounded-full text-purple-300 text-[11px] font-bold uppercase tracking-wider mb-1">
                <Sparkles size={12} />
                Sistema OTA (Over-The-Air) Ativo
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">Distribuição & Controle de Versões</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ao lançar uma nova versão aqui, todos os computadores com o aplicativo instalado verificarão automaticamente na nuvem ao iniciar. 
                Se houver uma versão mais recente, uma notificação nativa do Windows será exibida perguntando: 
                <strong className="text-purple-300 font-semibold"> &quot;Atualizar Agora&quot;</strong> ou <strong className="text-slate-300 font-semibold">&quot;Depois&quot;</strong>.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <a
                href="https://isurnvsehvjdslpnxirn.supabase.co/storage/v1/object/public/labels/system/version.json"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
              >
                <ExternalLink size={13} />
                Ver JSON na Nuvem
              </a>
              <button
                type="button"
                onClick={loadVersions}
                className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl border border-slate-800 text-xs font-semibold transition"
                title="Recarregar dados de versão"
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </div>

          {/* Grid com os 2 Aplicativos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* CARD 1: CONDOBOX PORTARIA */}
            <div className="bg-slate-900/90 border border-slate-800/90 hover:border-purple-500/30 rounded-3xl p-6 shadow-xl flex flex-col justify-between space-y-6 transition-all">
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-purple-500/10 text-purple-400 rounded-2xl border border-purple-500/20">
                      <Laptop size={22} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">CondoBox Portaria</h3>
                      <p className="text-xs text-slate-400 font-mono">condobox-desktop</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-purple-500/15 border border-purple-500/30 rounded-full text-purple-300 text-xs font-bold font-mono">
                    v{versionConfig['condobox-desktop']?.latest_version || '1.0.0'}
                  </span>
                </div>

                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800/80 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Versão em produção na nuvem:</span>
                    <strong className="text-purple-400 font-mono">v{versionConfig['condobox-desktop']?.latest_version || '1.0.0'}</strong>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Última atualização:</span>
                    <span className="text-slate-300">
                      {versionConfig['condobox-desktop']?.updated_at
                        ? new Date(versionConfig['condobox-desktop'].updated_at).toLocaleString('pt-BR')
                        : 'Hoje'}
                    </span>
                  </div>
                </div>

                {versionStatusMessage?.app === 'condobox-desktop' && (
                  <div
                    className={`p-3 rounded-xl text-xs font-medium ${
                      versionStatusMessage.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {versionStatusMessage.text}
                  </div>
                )}

                <div className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">
                      Número da Nova Versão (Semântico)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 1.0.1"
                      value={versionForm['condobox-desktop'].version}
                      onChange={e =>
                        setVersionForm(prev => ({
                          ...prev,
                          'condobox-desktop': { ...prev['condobox-desktop'], version: e.target.value }
                        }))
                      }
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500 font-mono font-bold"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Qualquer valor superior à versão instalada acionará o pop-up nos computadores da portaria.
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">
                      Link Direto de Download (.exe ou Releases)
                    </label>
                    <input
                      type="text"
                      placeholder="https://..."
                      value={versionForm['condobox-desktop'].url}
                      onChange={e =>
                        setVersionForm(prev => ({
                          ...prev,
                          'condobox-desktop': { ...prev['condobox-desktop'], url: e.target.value }
                        }))
                      }
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500 font-mono text-xs"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Ao clicar em &quot;Atualizar Agora&quot;, o usuário será redirecionado para este link.
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">
                      Notas da Versão / Novidades
                    </label>
                    <textarea
                      rows={3}
                      placeholder="- Correções na leitura de QR Code&#10;- Melhoria de performance e sincronização"
                      value={versionForm['condobox-desktop'].notes}
                      onChange={e =>
                        setVersionForm(prev => ({
                          ...prev,
                          'condobox-desktop': { ...prev['condobox-desktop'], notes: e.target.value }
                        }))
                      }
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-purple-500 resize-none text-xs"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={versionForm['condobox-desktop'].mandatory}
                      onChange={e =>
                        setVersionForm(prev => ({
                          ...prev,
                          'condobox-desktop': { ...prev['condobox-desktop'], mandatory: e.target.checked }
                        }))
                      }
                      className="rounded border-slate-700 bg-slate-950 text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-slate-300 text-xs font-medium">
                      Atualização crítica recomendada
                    </span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleSaveVersion('condobox-desktop')}
                disabled={savingVersionApp === 'condobox-desktop'}
                className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-2xl text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950/40 disabled:opacity-50"
              >
                {savingVersionApp === 'condobox-desktop' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Publicando Versão na Nuvem...
                  </>
                ) : (
                  <>
                    <Download size={16} /> Publicar Atualização da Portaria
                  </>
                )}
              </button>
            </div>

            {/* CARD 2: CONDOBOX SAAS MASTER */}
            <div className="bg-slate-900/90 border border-slate-800/90 hover:border-amber-500/30 rounded-3xl p-6 shadow-xl flex flex-col justify-between space-y-6 transition-all">
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
                      <Building2 size={22} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">CondoBox SaaS Master</h3>
                      <p className="text-xs text-slate-400 font-mono">condobox-master</p>
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-amber-500/15 border border-amber-500/30 rounded-full text-amber-300 text-xs font-bold font-mono">
                    v{versionConfig['condobox-master']?.latest_version || '1.0.0'}
                  </span>
                </div>

                <div className="bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800/80 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-400">
                    <span>Versão em produção na nuvem:</span>
                    <strong className="text-amber-400 font-mono">v{versionConfig['condobox-master']?.latest_version || '1.0.0'}</strong>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Última atualização:</span>
                    <span className="text-slate-300">
                      {versionConfig['condobox-master']?.updated_at
                        ? new Date(versionConfig['condobox-master'].updated_at).toLocaleString('pt-BR')
                        : 'Hoje'}
                    </span>
                  </div>
                </div>

                {versionStatusMessage?.app === 'condobox-master' && (
                  <div
                    className={`p-3 rounded-xl text-xs font-medium ${
                      versionStatusMessage.success
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {versionStatusMessage.text}
                  </div>
                )}

                <div className="space-y-3.5 text-xs">
                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">
                      Número da Nova Versão (Semântico)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: 1.0.1"
                      value={versionForm['condobox-master'].version}
                      onChange={e =>
                        setVersionForm(prev => ({
                          ...prev,
                          'condobox-master': { ...prev['condobox-master'], version: e.target.value }
                        }))
                      }
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500 font-mono font-bold"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Dispara a notificação de nova versão no aplicativo executivo do proprietário.
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">
                      Link Direto de Download (.exe ou Releases)
                    </label>
                    <input
                      type="text"
                      placeholder="https://..."
                      value={versionForm['condobox-master'].url}
                      onChange={e =>
                        setVersionForm(prev => ({
                          ...prev,
                          'condobox-master': { ...prev['condobox-master'], url: e.target.value }
                        }))
                      }
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500 font-mono text-xs"
                    />
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      Ao clicar em &quot;Atualizar Agora&quot;, o proprietário fará o download da nova compilação.
                    </span>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-bold mb-1.5">
                      Notas da Versão / Novidades
                    </label>
                    <textarea
                      rows={3}
                      placeholder="- Novo dashboard financeiro&#10;- Gestão de licenças aprimorada"
                      value={versionForm['condobox-master'].notes}
                      onChange={e =>
                        setVersionForm(prev => ({
                          ...prev,
                          'condobox-master': { ...prev['condobox-master'], notes: e.target.value }
                        }))
                      }
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-amber-500 resize-none text-xs"
                    />
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={versionForm['condobox-master'].mandatory}
                      onChange={e =>
                        setVersionForm(prev => ({
                          ...prev,
                          'condobox-master': { ...prev['condobox-master'], mandatory: e.target.checked }
                        }))
                      }
                      className="rounded border-slate-700 bg-slate-950 text-amber-500 focus:ring-amber-500"
                    />
                    <span className="text-slate-300 text-xs font-medium">
                      Atualização crítica recomendada
                    </span>
                  </label>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleSaveVersion('condobox-master')}
                disabled={savingVersionApp === 'condobox-master'}
                className="w-full py-3 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 text-white font-bold rounded-2xl text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-amber-950/40 disabled:opacity-50"
              >
                {savingVersionApp === 'condobox-master' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Publicando Versão na Nuvem...
                  </>
                ) : (
                  <>
                    <Download size={16} /> Publicar Atualização do SaaS Master
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR PLANO E LIMITES */}
      {editingAccount && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-fade-in">
            <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-5 sm:p-7 max-w-lg w-full space-y-5 shadow-2xl relative my-auto max-h-[88vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-500/15 border border-purple-500/30 rounded-xl text-purple-400">
                  <SlidersHorizontal size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Alterar Plano & Limites</h3>
                  <p className="text-xs text-slate-400 truncate max-w-xs">{editingAccount.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            {editMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-medium ${
                  editMessage.startsWith('✅')
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                }`}
              >
                {editMessage}
              </div>
            )}

            <form onSubmit={handleSaveLicense} className="space-y-4 text-xs">
              {/* Seletor de Plano */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">Plano de Assinatura *</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'TRIAL', name: 'Trial (30 dias)', desc: 'Até 250 Aps' },
                    { id: 'BASIC', name: 'Basic (Com Ads)', desc: 'Até 250 Aps • R$ 149' },
                    { id: 'PRO', name: 'Pro (Sem Ads)', desc: 'Até 250 Aps • R$ 249' },
                    { id: 'PRO_MAX', name: 'Pro Max', desc: 'Até 600 Aps • R$ 449' },
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setEditPlan(p.id);
                        if (p.id === 'PRO_MAX') setEditMaxApartments(600);
                        else setEditMaxApartments(250);
                      }}
                      className={`p-3 rounded-2xl border text-left transition ${
                        editPlan === p.id
                          ? 'bg-purple-600/20 border-purple-500 text-white font-bold shadow-sm'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{p.name}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Limite de Apartamentos Customizado */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Limite Máximo de Apartamentos (Capacidade) *
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    required
                    value={editMaxApartments}
                    onChange={e => setEditMaxApartments(Number(e.target.value))}
                    className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-bold text-sm focus:outline-none focus:border-purple-500"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditMaxApartments(250)}
                      className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[11px] font-semibold text-slate-300"
                    >
                      250
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditMaxApartments(600)}
                      className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[11px] font-semibold text-slate-300"
                    >
                      600
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditMaxApartments(1000)}
                      className="px-2.5 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[11px] font-semibold text-slate-300"
                    >
                      1000
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Atualmente este condomínio está utilizando <strong>{editingAccount.stats.units_count}</strong> apartamentos.
                </p>
              </div>

              {/* Status da Licença */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Status de Acesso / Licença *</label>
                <select
                  value={editStatus}
                  onChange={e => setEditStatus(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-semibold text-xs focus:outline-none focus:border-purple-500"
                >
                  <option value="ACTIVE">ATIVO (Acesso liberado normal)</option>
                  <option value="TRIAL">EM TESTE (Trial gratuito)</option>
                  <option value="EXPIRED">EXPIRADO (Avisa expiração e pede pagamento)</option>
                  <option value="BLOCKED">BLOQUEADO (Bloqueio total / Suporte)</option>
                </select>

                {(editStatus === 'EXPIRED' || editStatus === 'BLOCKED') && (
                  <div className="mt-2.5 p-3 bg-rose-950/30 border border-rose-500/30 rounded-xl space-y-1.5 text-slate-300">
                    <div className="flex items-center gap-1.5 text-rose-400 font-bold text-xs">
                      <AlertTriangle size={13} />
                      <span>Mensagem de Bloqueio Ativa na Conta</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">
                      Ao acessar, os usuários serão orientados a efetuar o pagamento ou acionar o suporte para desbloqueio:
                      <span className="block font-mono text-white font-bold mt-1">
                        (73) 99841-9901 / (21) 97196-6473
                      </span>
                    </p>
                  </div>
                )}
              </div>

              {/* Data de Expiração */}
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Data de Expiração da Licença</label>
                <input
                  type="date"
                  value={editExpiresAt}
                  onChange={e => setEditExpiresAt(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-purple-500 font-mono"
                />
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setDate(d.getDate() + 30);
                      setEditExpiresAt(d.toISOString().split('T')[0]);
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold"
                  >
                    +30 dias
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() + 6);
                      setEditExpiresAt(d.toISOString().split('T')[0]);
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold"
                  >
                    +6 meses
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const d = new Date();
                      d.setFullYear(d.getFullYear() + 1);
                      setEditExpiresAt(d.toISOString().split('T')[0]);
                    }}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold"
                  >
                    +1 ano
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditExpiresAt('')}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold"
                  >
                    Sem Expiração (Vitalício)
                  </button>
                </div>
              </div>

              {/* Botões do Modal */}
              <div className="flex gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingAccount(null)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950 disabled:opacity-50"
                >
                  {editLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    )}

      {/* MODAL: NOVA CONTA DE CONDOMÍNIO */}
      {isCreateModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-fade-in">
            <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-5 sm:p-7 max-w-lg w-full space-y-5 shadow-2xl relative my-auto max-h-[88vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-purple-500/15 border border-purple-500/30 rounded-xl text-purple-400">
                  <Plus size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Criar Nova Conta de Condomínio</h3>
                  <p className="text-xs text-slate-400">Cadastre o condomínio e configure o plano inicial.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            {createError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 text-rose-300 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateAccount} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nome do Condomínio *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Condomínio Solar das Palmeiras"
                  value={newCondoName}
                  onChange={e => setNewCondoName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Endereço / Cidade</label>
                  <input
                    type="text"
                    placeholder="Ex: Av. Brasil, 500"
                    value={newCondoAddress}
                    onChange={e => setNewCondoAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Telefone da Portaria</label>
                  <input
                    type="text"
                    placeholder="Ex: 5573981953741"
                    value={newCondoPhone}
                    onChange={e => setNewCondoPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Plano Inicial *</label>
                  <select
                    value={newCondoPlan}
                    onChange={e => {
                      setNewCondoPlan(e.target.value);
                      if (e.target.value === 'PRO_MAX') setNewCondoMaxUnits(600);
                      else setNewCondoMaxUnits(250);
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 font-semibold"
                  >
                    <option value="TRIAL">Trial 30 Dias (Grátis)</option>
                    <option value="BASIC">Basic (Com Ads)</option>
                    <option value="PRO">Pro (Sem Ads)</option>
                    <option value="PRO_MAX">Pro Max (600 Aps)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Limite Máximo de Aps *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newCondoMaxUnits}
                    onChange={e => setNewCondoMaxUnits(Number(e.target.value))}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 font-mono font-bold"
                  />
                </div>
              </div>

              {/* Síndico Inicial (Opcional) */}
              <div className="pt-2 border-t border-slate-800 space-y-3">
                <p className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Users size={14} className="text-indigo-400" />
                  Conta do Síndico / Gestor (Opcional)
                </p>

                <div>
                  <label className="block text-slate-400 mb-1">Nome do Síndico</label>
                  <input
                    type="text"
                    placeholder="Ex: Roberto Carlos"
                    value={newSyndicName}
                    onChange={e => setNewSyndicName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 mb-1">E-mail de Acesso</label>
                    <input
                      type="email"
                      placeholder="sindico@condominio.com"
                      value={newSyndicEmail}
                      onChange={e => setNewSyndicEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Senha Inicial</label>
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={newSyndicPassword}
                      onChange={e => setNewSyndicPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>

              {/* Botões do Modal */}
              <div className="flex gap-2.5 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="flex-1 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950 disabled:opacity-50"
                >
                  {createLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Criar Condomínio
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    )}

      {/* MODAL: ANÁLISE E APROVAÇÃO DE COMPROVANTE (COM ZOOM) */}
      {selectedReceiptForReview && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-fade-in">
            <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-5 sm:p-7 max-w-2xl w-full space-y-5 shadow-2xl relative my-auto max-h-[88vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400">
                  <FileCheck size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Analisar Comprovante de Pagamento</h3>
                  <p className="text-xs text-slate-400">
                    Condomínio: <strong className="text-slate-200">{selectedReceiptForReview.condo_name || selectedReceiptForReview.condo_id}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReceiptForReview(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            {reviewMessage && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold ${
                  reviewMessage.startsWith('✅')
                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
                }`}
              >
                {reviewMessage}
              </div>
            )}

            {/* Imagem do Comprovante com Zoom */}
            {selectedReceiptForReview.receipt_url ? (
              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2 flex items-center justify-center max-h-96 overflow-hidden relative group">
                <img
                  src={selectedReceiptForReview.receipt_url}
                  alt="Comprovante de Pagamento"
                  className="max-h-88 w-auto object-contain rounded-xl shadow-md"
                />
                <a
                  href={selectedReceiptForReview.receipt_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-4 right-4 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 border border-slate-700 shadow-lg backdrop-blur-sm transition"
                >
                  <ExternalLink size={13} />
                  <span>Abrir Original em Nova Aba</span>
                </a>
              </div>
            ) : (
              <div className="p-8 text-center bg-slate-950 rounded-2xl border border-slate-800 text-slate-500 text-xs">
                Nenhuma imagem anexada a este registro.
              </div>
            )}

            {/* Detalhes do Pagamento */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-950/80 p-3.5 rounded-2xl border border-slate-800">
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase block">Valor Informado:</span>
                <span className="text-sm font-bold text-emerald-400">
                  {selectedReceiptForReview.amount ? `R$ ${Number(selectedReceiptForReview.amount).toFixed(2)}` : 'Não especificado'}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase block">Data de Envio:</span>
                <span className="text-xs text-slate-200">
                  {new Date(selectedReceiptForReview.created_at).toLocaleString('pt-BR')}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 font-bold uppercase block">Observações:</span>
                <span className="text-xs text-slate-300 truncate block">
                  {selectedReceiptForReview.notes || 'Nenhuma'}
                </span>
              </div>
            </div>

            {/* Seletor do Prazo de Extensão ao Aprovar */}
            <div className="space-y-2">
              <label className="block text-slate-300 font-bold text-xs">
                Estender Vigência da Assinatura por:
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { days: 30, label: '+30 Dias (1 Mês)' },
                  { days: 60, label: '+60 Dias (2 Meses)' },
                  { days: 90, label: '+90 Dias (Trimestral)' },
                  { days: 365, label: '+365 Dias (1 Ano)' }
                ].map(opt => (
                  <button
                    key={opt.days}
                    type="button"
                    onClick={() => setReviewExtensionDays(opt.days)}
                    className={`p-2.5 rounded-xl border text-xs font-bold transition text-center ${
                      reviewExtensionDays === opt.days
                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-950/40'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Campo Opcional para Motivo de Rejeição */}
            <div className="space-y-1.5">
              <label className="block text-slate-400 text-[11px]">
                Motivo (caso deseje rejeitar o comprovante):
              </label>
              <input
                type="text"
                placeholder="Ex: Valor não identificado no extrato / Comprovante sem autenticação"
                value={reviewRejectionReason}
                onChange={e => setReviewRejectionReason(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            {/* Botões de Ação */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                disabled={reviewLoading}
                onClick={() => handleReviewReceipt('APPROVE')}
                className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 active:scale-95"
              >
                {reviewLoading ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                <span>Aprovar Pagamento e Desbloquear (+{reviewExtensionDays} dias)</span>
              </button>

              <button
                type="button"
                disabled={reviewLoading}
                onClick={() => handleReviewReceipt('REJECT')}
                className="py-3 px-4 bg-slate-950 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 rounded-xl text-xs font-bold transition"
              >
                Rejeitar
              </button>
            </div>
          </div>
        </div>
      </ModalPortal>
    )}

      {/* MODAL: ANEXAÇÃO MANUAL DE COMPROVANTE PELO SÓCIO PROPRIETÁRIO */}
      {isManualReceiptModalOpen && (
        <ModalPortal>
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-fade-in">
            <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-5 sm:p-7 max-w-lg w-full space-y-5 shadow-2xl relative my-auto max-h-[88vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-emerald-400">
                  <UploadCloud size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Anexar Comprovante Manualmente</h3>
                  <p className="text-xs text-slate-400">
                    Registre e aprove pagamentos recebidos externamente (WhatsApp/Banco)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsManualReceiptModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition"
              >
                <X size={18} />
              </button>
            </div>

            {manualMsg && (
              <div
                className={`p-3 rounded-xl text-xs font-medium ${
                  manualMsg.startsWith('✅')
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                }`}
              >
                {manualMsg}
              </div>
            )}

            <form onSubmit={handleManualReceiptSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Selecione o Condomínio *</label>
                <select
                  required
                  value={manualCondoId}
                  onChange={e => setManualCondoId(e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium focus:outline-none focus:border-emerald-500"
                >
                  <option value="">-- Escolha um condomínio --</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.license?.status === 'ACTIVE' ? 'Ativo' : 'Expirado / Pendente'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Valor Pago (R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="149.00"
                    value={manualAmount}
                    onChange={e => setManualAmount(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Extensão de Licença *</label>
                  <select
                    value={manualExtensionDays}
                    onChange={e => setManualExtensionDays(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium focus:outline-none focus:border-emerald-500"
                  >
                    <option value={30}>+30 dias (1 mês)</option>
                    <option value={60}>+60 dias (2 meses)</option>
                    <option value={90}>+90 dias (3 meses)</option>
                    <option value={180}>+180 dias (6 meses)</option>
                    <option value={365}>+365 dias (1 ano)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Arquivo do Comprovante (Opcional)</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={e => setManualFile(e.target.files?.[0] || null)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-300 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-500/20 file:text-emerald-300 hover:file:bg-emerald-500/30 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Observações do Recebimento</label>
                <input
                  type="text"
                  placeholder="Ex: Recebido via Pix Banco Inter / Confirmado no extrato"
                  value={manualNotes}
                  onChange={e => setManualNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={manualUploading}
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 active:scale-95"
                >
                  {manualUploading ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  <span>Salvar, Aprovar e Desbloquear Condomínio</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      </ModalPortal>
    )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DE CONDOMÍNIO */}
      {condoToDelete && (
        <ModalPortal>
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-fade-in">
            <div className="bg-slate-900 border border-rose-500/50 rounded-3xl p-5 sm:p-7 max-w-md w-full space-y-5 shadow-2xl relative my-auto max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-rose-400">
                    <Trash2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Excluir Condomínio</h3>
                    <p className="text-xs text-rose-400 font-medium">Ação irreversível e permanente</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!deletingCondo) {
                      setCondoToDelete(null);
                      setDeleteConfirmName('');
                      setDeleteError(null);
                    }
                  }}
                  disabled={deletingCondo}
                  className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition disabled:opacity-40"
                >
                  <X size={18} />
                </button>
              </div>

              {deleteError && (
                <div className="p-3.5 rounded-2xl bg-rose-950/50 border border-rose-500/50 text-rose-300 text-xs font-semibold flex items-start gap-2.5">
                  <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1">{deleteError}</div>
                </div>
              )}

              {/* Alerta de Impacto */}
              <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold">
                  <AlertTriangle size={15} />
                  <span>Atenção: Todos os dados serão apagados</span>
                </div>
                <ul className="text-[11px] text-slate-300 space-y-1 list-disc list-inside">
                  <li>Todas as {condoToDelete.stats?.units_count || 0} unidades deste condomínio</li>
                  <li>Todos os {condoToDelete.stats?.residents_count || 0} moradores e contatos vinculados</li>
                  <li>Todas as {condoToDelete.stats?.packages_count || 0} encomendas e fotos arquivadas</li>
                  <li>Contas de porteiros/síndicos associadas e histórico de licença</li>
                </ul>
              </div>

              {/* Instrução de Confirmação */}
              <div className="space-y-2">
                <label className="block text-xs text-slate-300">
                  Para confirmar a exclusão, digite exatamente o nome do condomínio:{' '}
                  <strong className="text-white select-all font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                    {condoToDelete.name}
                  </strong>
                </label>
                <input
                  type="text"
                  autoFocus
                  disabled={deletingCondo}
                  value={deleteConfirmName}
                  onChange={(e) => {
                    setDeleteConfirmName(e.target.value);
                    if (deleteError) setDeleteError(null);
                  }}
                  placeholder={`Digite "${condoToDelete.name}"`}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 focus:border-rose-500 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none transition font-medium"
                />
              </div>

              {/* Botões */}
              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={deletingCondo}
                  onClick={() => {
                    setCondoToDelete(null);
                    setDeleteConfirmName('');
                    setDeleteError(null);
                  }}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={
                    deletingCondo ||
                    deleteConfirmName.trim().toLowerCase() !== condoToDelete.name.trim().toLowerCase()
                  }
                  onClick={handleConfirmDeleteCondo}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-rose-950/40 active:scale-95"
                >
                  {deletingCondo ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Excluindo condomínio...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      <span>Excluir Definitivamente</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>

  );
}
