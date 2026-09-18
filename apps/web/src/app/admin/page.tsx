'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Unit, Resident, Package as PackageType } from '../../types/database';
import { createClient } from '../../lib/supabase/client';
import { LocalApiClient } from '../../lib/local-api';
import {
  Shield,
  Users,
  Building2,
  TrendingUp,
  Package,
  Clock,
  Phone,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  Server,
  UserPlus,
  KeyRound,
  Loader2,
  BadgeCheck,
  MessageSquare,
  QrCode,
  Send,
  Smartphone,
  Terminal,
  FileSpreadsheet,
  Mail,
  Sparkles,
  Printer,
  Volume2,
  VolumeX,
  Database,
  FileText,
  Cpu,
  LogOut,
  X,
  Check,
  ChevronDown,
  Pencil,
  Eye,
  Copy,
  ExternalLink,
  ShieldCheck,
  Download
} from 'lucide-react';
import { BatchResidentImportModal } from '../../components/batch-resident-import-modal';
import { PackageCard } from '../../components/package-card';
import { VoiceService } from '../../lib/voice';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/contexts/auth-context';
import { exportCondoSpreadsheet } from '../../lib/export-excel';

export default function AdminPage() {
  const { user, profile, isGuard, isAdmin, effectiveCondoId, isImpersonating, impersonatedCondo, isSuperAdmin, impersonateCondo, loading: authLoading } = useAuth();
  const router = useRouter();
  const [availableCondos, setAvailableCondos] = useState<{ id: string; name: string }[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'PACKAGES' | 'RESIDENTS' | 'UNITS' | 'STAFF' | 'SYSTEM' | 'AUTOMATIONS'>('PACKAGES');
  const [packageSearchQuery, setPackageSearchQuery] = useState('');
  const [packageStatusFilter, setPackageStatusFilter] = useState<'ALL' | 'PENDING' | 'DELIVERED' | 'RETURNED'>('ALL');

  // Automações & Utilidades (Python & JS)
  const [reportResult, setReportResult] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportPhone, setReportPhone] = useState('');
  const [reportSendStatus, setReportSendStatus] = useState<string | null>(null);
  const [backupList, setBackupList] = useState<any[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupSuccessMsg, setBackupSuccessMsg] = useState<string | null>(null);
  const [printerStatus, setPrinterStatus] = useState<string | null>(null);
  const [voiceActive, setVoiceActive] = useState(true);

  // Gerenciamento e Gerador de Unidades/Blocos
  const [batchBlock, setBatchBlock] = useState('Bloco A');
  const [batchFloors, setBatchFloors] = useState(4);
  const [batchStartUnit, setBatchStartUnit] = useState(1);
  const [batchEndUnit, setBatchEndUnit] = useState(4);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchSuccess, setBatchSuccess] = useState('');
  const [batchError, setBatchError] = useState('');

  const [singleBlock, setSingleBlock] = useState('Bloco A');
  const [singleUnitNumber, setSingleUnitNumber] = useState('');
  const [singleLoading, setSingleLoading] = useState(false);
  const [selectedBlockFilter, setSelectedBlockFilter] = useState<string>('ALL');

  // Formulário de criar porteiro/síndico
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffRole, setStaffRole] = useState<'GUARD' | 'SYNDIC' | 'ADMIN'>('GUARD');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffSuccess, setStaffSuccess] = useState('');
  const [staffError, setStaffError] = useState('');
  const [staffList, setStaffList] = useState<any[]>([]);
  const [staffDeleteLoading, setStaffDeleteLoading] = useState<string | null>(null);
  const [staffQrLoading, setStaffQrLoading] = useState<string | null>(null);
  const [staffQrData, setStaffQrData] = useState<{link: string, name: string, otp?: string | null} | null>(null);
  const [healthStatus, setHealthStatus] = useState<any | null>(null);

  // WhatsApp Evolution API State
  const [whatsappState, setWhatsappState] = useState<{ state?: string; status?: string; connected: boolean; phone?: string | null }>({ state: 'OFFLINE', connected: false });
  const [whatsappQrCode, setWhatsappQrCode] = useState<string | null>(null);
  const [whatsappPairingCode, setWhatsappPairingCode] = useState<string | null>(null);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('73981953741');
  const [testMsgResult, setTestMsgResult] = useState<string | null>(null);
  const [testMsgLoading, setTestMsgLoading] = useState(false);

  // Formulário de novo morador / edição e importação em lote
  const [isAddResidentModalOpen, setIsAddResidentModalOpen] = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [isBatchImportModalOpen, setIsBatchImportModalOpen] = useState(false);
  const [residentSearchQuery, setResidentSearchQuery] = useState('');
  const [isExportingSpreadsheet, setIsExportingSpreadsheet] = useState(false);
  const [newResName, setNewResName] = useState('');
  const [newResPhone, setNewResPhone] = useState('');
  const [newResEmail, setNewResEmail] = useState('');
  const [newResBlock, setNewResBlock] = useState('Bloco A');
  const [newResUnitNumber, setNewResUnitNumber] = useState('');
  const [isUnitDropdownOpen, setIsUnitDropdownOpen] = useState(false);
  const unitDropdownRef = React.useRef<HTMLDivElement>(null);
  const residentNameInputRef = React.useRef<HTMLInputElement>(null);

  // Foca automaticamente no campo Nome Completo ao abrir o modal de cadastro de morador
  useEffect(() => {
    if (isAddResidentModalOpen) {
      const timer = setTimeout(() => {
        residentNameInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isAddResidentModalOpen]);

  // Fecha o dropdown de unidades ao clicar fora (sem precisar de overlay em tela cheia)
  useEffect(() => {
    if (!isUnitDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (unitDropdownRef.current && !unitDropdownRef.current.contains(e.target as Node)) {
        setIsUnitDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isUnitDropdownOpen]);

  // Fecha modal de cadastro individual com ESC
  useEffect(() => {
    if (!isAddResidentModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsAddResidentModalOpen(false);
        setEditingResident(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddResidentModalOpen]);

  // Modal de Perfil Completo do Morador
  const [selectedResidentProfile, setSelectedResidentProfile] = useState<Resident | null>(null);
  const [profilePackageFilter, setProfilePackageFilter] = useState<'ALL' | 'PENDING' | 'DELIVERED' | 'RETURNED'>('ALL');
  const [profilePackageSearch, setProfilePackageSearch] = useState('');
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Modal de Detalhes da Unidade / Moradores do Apartamento
  const [selectedUnitModal, setSelectedUnitModal] = useState<Unit | null>(null);
  const [isUnitAddResidentOpen, setIsUnitAddResidentOpen] = useState(false);
  const [unitResName, setUnitResName] = useState('');
  const [unitResPhone, setUnitResPhone] = useState('');
  const [unitResEmail, setUnitResEmail] = useState('');
  const [unitResLoading, setUnitResLoading] = useState(false);
  const [unitResError, setUnitResError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !effectiveCondoId) return;

    loadData();

    // Revalidação imediata ao focar na janela (ex: voltando do painel master ou de outra aba)
    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    // Canal Realtime para Pacotes, Moradores e Unidades
    const supabase = createClient();
    const ch = supabase
      .channel(`admin-data-sync-${effectiveCondoId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'packages' },
        (payload: any) => {
          const pCondo = payload.new?.condo_id || payload.old?.condo_id;
          if (!pCondo || pCondo === effectiveCondoId) {
            loadData(true);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'residents' },
        () => {
          loadData(true);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'units' },
        (payload: any) => {
          const uCondo = payload.new?.condo_id || payload.old?.condo_id;
          if (!uCondo || uCondo === effectiveCondoId) {
            loadData(true);
          }
        }
      )
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          loadData(true);
        }
      });

    // Polling de contingência a cada 15 segundos
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    }, 15000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
      clearInterval(poll);
      supabase.removeChannel(ch);
    };
  }, [authLoading, effectiveCondoId]);

  // Sincroniza estado do sintetizador de voz com o localStorage persistido
  useEffect(() => {
    setVoiceActive(VoiceService.isVoiceEnabled());

    const handleVoiceChange = () => {
      setVoiceActive(VoiceService.isVoiceEnabled());
    };

    window.addEventListener('storage', handleVoiceChange);
    window.addEventListener('condobox_voice_changed', handleVoiceChange);
    return () => {
      window.removeEventListener('storage', handleVoiceChange);
      window.removeEventListener('condobox_voice_changed', handleVoiceChange);
    };
  }, []);

  // Fecha modal de perfil de morador com ESC
  useEffect(() => {
    if (!selectedResidentProfile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedResidentProfile(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedResidentProfile]);

  // Ponte Supabase Realtime para WhatsApp (comunicação instantânea nuvem <-> portaria)
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase.channel('whatsapp_bridge', { config: { broadcast: { self: false } } });

    ch.on('broadcast', { event: 'status_sync' }, ({ payload }: any) => {
      if (payload) {
        setWhatsappState(payload);
        if (payload.qrcode) {
          setWhatsappQrCode(payload.qrcode);
          setWhatsappError(null);
        }
        if (payload.connected) {
          setWhatsappQrCode(null);
          setWhatsappPairingCode(null);
          setWhatsappError(null);
        }
      }
    });

    ch.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'request_status', payload: {} });
      }
    });

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  // Polling de status do WhatsApp enquanto na aba SYSTEM ou com QR Code aberto
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeTab === 'SYSTEM' || whatsappQrCode) {
      interval = setInterval(async () => {
        const st = await LocalApiClient.getWhatsAppStatus();
        setWhatsappState(st);
        if (st.connected) {
          setWhatsappQrCode(null);
          setWhatsappPairingCode(null);
          setWhatsappError(null);
        } else if (st.qrcode) {
          setWhatsappQrCode(st.qrcode);
          setWhatsappError(null);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [activeTab, whatsappQrCode]);

  useEffect(() => {
    if (!authLoading && isSuperAdmin && !isImpersonating) {
      router.replace('/super-admin');
      return;
    }

    // Se for Porteiro (GUARD) ou não for Administrador/Síndico, bloqueia acesso a /admin e redireciona para a Portaria
    const isPorteiro = isGuard || profile?.role === 'GUARD';
    if (!authLoading && (isPorteiro || (!isAdmin && !isSuperAdmin))) {
      router.replace('/portaria');
      return;
    }

    if (isSuperAdmin) {
      const fetchCondos = async () => {
        const supabase = createClient();
        const { data } = await supabase.from('condos').select('id, name').order('name');
        if (data && data.length > 0) {
          setAvailableCondos(data);
        }
      };
      fetchCondos();
    }
  }, [isSuperAdmin, isImpersonating, authLoading, isGuard, profile?.role, isAdmin, router]);

  // Regra obrigatória: no celular e no computador, a Portaria deve abrir primeiro!
  // Se o usuário acessar /admin diretamente no celular sem ter clicado na aba de administração (?tab=admin),
  // redireciona para a Portaria imediatamente.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
    const params = new URLSearchParams(window.location.search);
    const hasExplicitTab = params.get('tab') === 'admin';
    const isTabNavigated = sessionStorage.getItem('condobox_admin_tab_active') === 'true';

    if (hasExplicitTab) {
      sessionStorage.setItem('condobox_admin_tab_active', 'true');
    } else if (isMobile && !isTabNavigated) {
      router.replace('/portaria');
      return;
    }
  }, [router]);

  useEffect(() => {
    const handleUnitsChanged = () => {
      loadData();
    };
    window.addEventListener('condo_units_changed', handleUnitsChanged);
    return () => window.removeEventListener('condo_units_changed', handleUnitsChanged);
  }, [effectiveCondoId]);

  const loadLocalStatus = async () => {
    try {
      const health = await LocalApiClient.checkHealth();
      setHealthStatus(health);

      const wa = await LocalApiClient.getWhatsAppStatus();
      setWhatsappState(wa);
      if (!wa.connected && wa.qrcode) {
        setWhatsappQrCode(wa.qrcode);
      }
    } catch {}
  };

  const loadData = async (options?: boolean | any) => {
    const isBackground = options === true;
    if (authLoading) return;
    if (!effectiveCondoId) {
      setUnits([]);
      setResidents([]);
      setPackages([]);
      if (!isBackground) setLoading(false);
      return;
    }
    if (!isBackground) setLoading(true);
    const supabase = createClient();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUser = user || session?.user;
      if (!currentUser) {
        router.replace('/admin/login?redirect=/portaria');
        return;
      }

      const isPorteiro = isGuard || profile?.role === 'GUARD';
      if (isPorteiro || (!isAdmin && !isSuperAdmin)) {
        router.replace('/portaria');
        return;
      }

      // Executa status do WhatsApp e API local em segundo plano (não bloqueia unidades e moradores)
      loadLocalStatus();

      const { data: uData } = await supabase
        .from('units')
        .select('*')
        .eq('condo_id', effectiveCondoId)
        .order('block')
        .order('unit_number');

      const { data: rData } = await supabase
        .from('residents')
        .select('*, unit:units!inner(*)')
        .eq('unit.condo_id', effectiveCondoId)
        .order('name');

      const { data: pData } = await supabase
        .from('packages')
        .select('*, unit:units(*), resident:residents(*)')
        .eq('condo_id', effectiveCondoId)
        .order('received_at', { ascending: false });

      if (uData) {
        // Deduplica unidades caso existam registros repetidos
        const uniqueMap = new Map<string, Unit>();
        uData.forEach(u => {
          const key = `${(u.block || 'Bloco A').trim().toUpperCase()}__${(u.unit_number || '').trim()}`;
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, u);
          }
        });
        setUnits(Array.from(uniqueMap.values()));
      } else {
        setUnits([]);
      }
      setResidents(rData || []);
      setPackages(pData || []);
    } catch (err) {
      console.error('Erro ao carregar dados do admin:', err);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const handleConnectWhatsApp = async () => {
    setWhatsappLoading(true);
    setWhatsappError(null);

    // 1. Dispara solicitação imediata via Supabase Realtime Bridge
    try {
      const supabase = createClient();
      const ch = supabase.channel('whatsapp_bridge');
      ch.send({ type: 'broadcast', event: 'request_connect', payload: {} }).catch(() => {});
    } catch {}

    // 2. Tenta também via HTTP direto como contingência
    try {
      const res = await LocalApiClient.connectWhatsApp();
      if (res?.qrcode) {
        setWhatsappQrCode(res.qrcode);
        setWhatsappError(null);
      } else if (res?.pairingCode) {
        setWhatsappPairingCode(res.pairingCode);
        setWhatsappError(null);
      } else if (res?.connected) {
        setWhatsappQrCode(null);
        setWhatsappError(null);
      } else {
        // Polling curto de contingência caso o QR Code esteja sendo finalizado
        for (let i = 0; i < 6; i++) {
          await new Promise(r => setTimeout(r, 600));
          const fallbackSt = await LocalApiClient.getWhatsAppStatus();
          if (fallbackSt?.qrcode) {
            setWhatsappQrCode(fallbackSt.qrcode);
            setWhatsappState(fallbackSt);
            setWhatsappError(null);
            return;
          }
          if (fallbackSt?.connected) {
            setWhatsappState(fallbackSt);
            setWhatsappQrCode(null);
            setWhatsappError(null);
            return;
          }
        }
      }

      const st = await LocalApiClient.getWhatsAppStatus();
      setWhatsappState(st);
      if (st?.qrcode && !res?.qrcode) {
        setWhatsappQrCode(st.qrcode);
        setWhatsappError(null);
      }
    } catch (err: any) {
      console.error('Erro ao conectar WhatsApp via HTTP:', err);
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleLogoutWhatsApp = async () => {
    if (!confirm('Deseja realmente desconectar e deslogar o WhatsApp da Portaria? Um novo QR Code será gerado imediatamente para pareamento.')) {
      return;
    }
    setWhatsappLoading(true);
    setWhatsappError(null);

    try {
      const supabase = createClient();
      const ch = supabase.channel('whatsapp_bridge');
      ch.send({ type: 'broadcast', event: 'request_logout', payload: {} }).catch(() => {});
    } catch {}

    try {
      const res = await LocalApiClient.logoutWhatsApp();
      if (res?.qrcode) {
        setWhatsappQrCode(res.qrcode);
        setWhatsappState(prev => ({ ...prev, qrcode: res.qrcode, connected: false, status: 'DISCONNECTED', phone: null }));
      } else {
        const st = await LocalApiClient.getWhatsAppStatus();
        setWhatsappState(st);
        if (st?.qrcode) {
          setWhatsappQrCode(st.qrcode);
        } else {
          setWhatsappQrCode(null);
        }
      }
      alert(res?.message || 'Sessão do WhatsApp desconectada com sucesso! Um novo QR Code foi gerado para pareamento.');
    } catch (err: any) {
      console.error('Erro ao desconectar WhatsApp:', err);
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleSendTestWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestMsgLoading(true);
    setTestMsgResult(null);
    try {
      const res = await LocalApiClient.sendTestWhatsApp(testPhone);
      if (res.success) {
        setTestMsgResult('✅ Mensagem enviada com sucesso para o WhatsApp!');
      } else {
        setTestMsgResult(`❌ Falha: ${res.error || 'Não foi possível enviar a mensagem.'}`);
      }
    } catch (err: any) {
      setTestMsgResult(`❌ Erro de comunicação: ${err.message}`);
    } finally {
      setTestMsgLoading(false);
    }
  };

  const loadStaff = async () => {
    if (!effectiveCondoId) {
      setStaffList([]);
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from('profiles')
      .select('id, name, phone, role')
      .eq('condo_id', effectiveCondoId)
      .in('role', ['GUARD', 'SYNDIC', 'ADMIN'])
      .order('role');
    if (data) setStaffList(data);
    else setStaffList([]);
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffError('');
    setStaffSuccess('');

    if (staffPassword.length < 8) {
      setStaffError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }

    setStaffLoading(true);
    // Criar via API Server-side (usando service_role key para ignorar RLS e garantir condo_id)
    try {
      const res = await fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: staffName,
          email: staffEmail,
          phone: staffPhone,
          password: staffPassword,
          role: staffRole,
          condoId: effectiveCondoId,
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setStaffError(data.error || 'Erro ao criar conta. Tente novamente.');
        setStaffLoading(false);
        return;
      }

      setStaffSuccess(data.message || `Conta de ${staffRole === 'GUARD' ? 'Porteiro' : staffRole === 'ADMIN' ? 'Administrador' : 'Síndico'} criada para ${staffName}!`);
      setStaffName('');
      setStaffEmail('');
      setStaffPhone('');
      setStaffPassword('');
      loadStaff();
    } catch (err: any) {
      setStaffError('Falha de conexão ao criar a conta.');
    } finally {
      setStaffLoading(false);
    }
  };

  const handleDeleteStaff = async (userId: string, userName: string) => {
    if (!confirm(`Tem certeza que deseja remover ${userName} da equipe?`)) {
      return;
    }
    
    setStaffDeleteLoading(userId);
    try {
      const res = await fetch(`/api/staff?userId=${userId}&condoId=${effectiveCondoId || ''}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      
      if (!res.ok) {
        alert(data.error || 'Erro ao excluir membro da equipe.');
      } else {
        alert(data.message || 'Membro removido com sucesso!');
        loadStaff();
      }
    } catch (err) {
      alert('Erro de conexão ao excluir membro.');
    } finally {
      setStaffDeleteLoading(null);
    }
  };

  const handleGenerateQR = async (userId: string, userName: string) => {
    setStaffQrLoading(userId);
    const targetCondo = effectiveCondoId || '';
    const endpoint = `/api/staff/qr?userId=${userId}&condoId=${targetCondo}&_t=${Date.now()}`;

    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(endpoint, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        });
        const data = await res.json();
        
        if (!res.ok) {
          alert(data.error || 'Erro ao gerar o QR Code de acesso.');
        } else {
          setStaffQrData({ link: data.actionLink, name: userName, otp: data.otp });
        }
        setStaffQrLoading(null);
        return;
      } catch (err: any) {
        lastError = err;
        console.warn(`[StaffQR] Tentativa ${attempt} falhou:`, err);
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    alert(`Erro de conexão ao gerar o QR Code (${lastError?.message || 'Falha de rede/DNS'}). Por favor, verifique a conexão e tente novamente.`);
    setStaffQrLoading(null);
  };

  // Funções da Aba Automações & Utilidades
  const handleGenerateReport = async () => {
    setReportLoading(true);
    setReportSendStatus(null);
    try {
      const res = await fetch('http://localhost:3001/api/reports/generate').catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        setReportResult(data);
      } else {
        // Fallback local caso a API não responda
        const pending = packages.filter(p => p.status !== 'DELIVERED').length;
        const delivered = packages.filter(p => p.status === 'DELIVERED').length;
        const text = `📊 *RELATÓRIO DE FLUXO DA PORTARIA - CONDOBOX*\n🗓️ Data: ${new Date().toLocaleString('pt-BR')}\n\n📦 *ENCOMENDAS:*\n• Total Registradas: ${packages.length}\n• Entregues: ${delivered}\n• Pendentes: ${pending}\n\n🏢 *CADASTROS:*\n• Apartamentos: ${units.length}\n• Moradores: ${residents.length}\n\n_Sistema CondoBox Portaria Inteligente_`;
        setReportResult({
          generatedAt: new Date().toLocaleString('pt-BR'),
          metrics: { totalPackages: packages.length, delivered, pending, units: units.length, residents: residents.length, topCarriers: [] },
          reportText: text
        });
      }
    } catch {
      setReportSendStatus('Erro ao gerar relatório.');
    } finally {
      setReportLoading(false);
    }
  };

  const handleSendReportWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportPhone.trim()) return;
    setReportLoading(true);
    setReportSendStatus(null);
    try {
      const res = await fetch('http://localhost:3001/api/reports/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: reportPhone })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setReportSendStatus('✅ Relatório enviado com sucesso para o WhatsApp informado!');
      } else {
        setReportSendStatus(`❌ Falha no envio: ${data.error || 'Verifique a conexão do WhatsApp.'}`);
      }
    } catch (err: any) {
      setReportSendStatus(`❌ Erro: ${err.message}`);
    } finally {
      setReportLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    setBackupLoading(true);
    setBackupSuccessMsg(null);
    try {
      const res = await fetch('http://localhost:3001/api/backup/create', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setBackupSuccessMsg(`✅ Backup gerado com sucesso: ${data.filename} (${data.sizeKb} KB)`);
        handleLoadBackups();
      } else {
        setBackupSuccessMsg(`❌ Falha ao criar backup: ${data.error || 'Erro interno'}`);
      }
    } catch (err: any) {
      setBackupSuccessMsg(`❌ Erro ao conectar com API de backup: ${err.message}`);
    } finally {
      setBackupLoading(false);
    }
  };

  const handleLoadBackups = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/backup/list');
      if (res.ok) {
        const data = await res.json();
        if (data.backups) setBackupList(data.backups);
      }
    } catch {}
  };

  const handleTestPrint = async () => {
    setPrinterStatus('Enviando etiqueta de teste...');
    try {
      const res = await fetch('http://localhost:3001/api/printer/print-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickupCode: '9087',
          unit: '805',
          block: 'Bloco A',
          recipientName: 'Jhen',
          carrier: 'Mercado Livre',
          trackingCode: 'ML987654321BR',
          receivedAt: new Date().toLocaleString('pt-BR')
        })
      });
      const data = await res.json();
      setPrinterStatus(data.message || 'Comando ESC/POS enviado!');
      VoiceService.playSuccessBeep();
      setTimeout(() => setPrinterStatus(null), 4000);
    } catch (err: any) {
      setPrinterStatus(`Erro de impressão: ${err.message}`);
    }
  };

  const handleBatchGenerateUnits = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchError('');
    setBatchSuccess('');

    if (!batchBlock.trim() || batchFloors < 1 || batchEndUnit < batchStartUnit) {
      setBatchError('Configure os parâmetros corretamente. O último apto deve ser maior ou igual ao primeiro.');
      return;
    }
    if (!effectiveCondoId) {
      setBatchError('Condomínio não identificado. Selecione um condomínio no topo.');
      return;
    }

    setBatchLoading(true);
    const supabase = createClient();

    const unitsToInsert: { condo_id: string; block: string; unit_number: string }[] = [];
    for (let floor = 1; floor <= batchFloors; floor++) {
      for (let apt = batchStartUnit; apt <= batchEndUnit; apt++) {
        const aptStr = String(apt).padStart(2, '0');
        const unitNum = `${floor}${aptStr}`;
        unitsToInsert.push({
          condo_id: effectiveCondoId,
          block: batchBlock.trim(),
          unit_number: unitNum,
        });
      }
    }

    try {
      const existingKeys = new Set(
        units
          .filter((u) => (u.block || 'Bloco A').trim().toUpperCase() === batchBlock.trim().toUpperCase())
          .map((u) => u.unit_number.trim())
      );

      const alreadyExisting = unitsToInsert.filter((u) => existingKeys.has(u.unit_number.trim())).length;
      const newCount = unitsToInsert.length - alreadyExisting;

      const { data, error } = await supabase
        .from('units')
        .upsert(unitsToInsert, { onConflict: 'condo_id,block,unit_number', ignoreDuplicates: true })
        .select();

      if (error) {
        setBatchError(`Erro ao gerar unidades: ${error.message}`);
      } else {
        if (newCount === 0) {
          setBatchSuccess(`Todas as ${unitsToInsert.length} unidades do ${batchBlock.trim()} já estavam cadastradas e continuam ativas.`);
        } else {
          setBatchSuccess(
            `${newCount} nova(s) unidade(s) adicionada(s) com sucesso para o ${batchBlock.trim()}!${
              alreadyExisting > 0 ? ` (${alreadyExisting} já existiam e foram mantidas)` : ''
            }`
          );
        }
        await loadData();
        window.dispatchEvent(new CustomEvent('condo_units_changed'));
      }
    } catch (err: any) {
      setBatchError(`Erro: ${err.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  const handleAddSingleUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singleBlock.trim() || !singleUnitNumber.trim()) return;
    if (!effectiveCondoId) {
      alert('Condomínio não identificado.');
      return;
    }

    setSingleLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from('units').insert({
      condo_id: effectiveCondoId,
      block: singleBlock.trim(),
      unit_number: singleUnitNumber.trim(),
    });

    if (error) {
      alert(`Erro ao adicionar unidade: ${error.message}`);
    } else {
      setSingleUnitNumber('');
      await loadData();
      window.dispatchEvent(new CustomEvent('condo_units_changed'));
    }
    setSingleLoading(false);
  };

  const handleDeleteUnit = async (unitId: string, unitLabel: string) => {
    if (!confirm(`Deseja realmente excluir a unidade ${unitLabel}?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from('units').delete().eq('id', unitId);
    if (error) {
      alert(`Erro ao excluir: ${error.message}`);
    } else {
      await loadData();
      window.dispatchEvent(new CustomEvent('condo_units_changed'));
    }
  };

  const handleDeleteBlock = async (blockName: string) => {
    const blockUnits = units.filter((u) => (u.block || 'Bloco A').toUpperCase() === blockName.toUpperCase());
    const hasResidents = residents.some((r) => blockUnits.some((u) => u.id === r.unit_id));
    if (hasResidents) {
      alert(`Não é possível excluir o ${blockName} inteiro pois há moradores vinculados a apartamentos deste bloco. Remova ou transfira os moradores primeiro.`);
      return;
    }
    if (!confirm(`Deseja realmente excluir todos os ${blockUnits.length} apartamentos do ${blockName}?`)) return;

    const supabase = createClient();
    const { error } = await supabase.from('units').delete().eq('condo_id', effectiveCondoId).eq('block', blockName);
    if (error) {
      alert(`Erro ao excluir bloco: ${error.message}`);
    } else {
      await loadData();
      window.dispatchEvent(new CustomEvent('condo_units_changed'));
    }
  };

  const handleDeleteResident = async (residentId: string, residentName: string) => {
    if (!confirm(`Deseja realmente remover o morador ${residentName}?`)) return;
    const supabase = createClient();
    const { error } = await supabase.from('residents').delete().eq('id', residentId);
    if (error) {
      alert(`Erro ao excluir morador: ${error.message}`);
    } else {
      setResidents((prev) => prev.filter((r) => r.id !== residentId));
      if (selectedResidentProfile?.id === residentId) {
        setSelectedResidentProfile(null);
      }
      loadData();
    }
  };

  const handleAddResidentToUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUnitModal) return;
    if (!unitResName.trim() || !unitResPhone.trim()) {
      setUnitResError('Preencha os campos obrigatórios (Nome e WhatsApp).');
      return;
    }

    setUnitResLoading(true);
    setUnitResError(null);

    const supabase = createClient();
    try {
      const unitResidents = residents.filter(
        (r) =>
          r.unit_id === selectedUnitModal.id ||
          (r.unit &&
            (r.unit.block || 'Bloco A').toUpperCase() === (selectedUnitModal.block || 'Bloco A').toUpperCase() &&
            r.unit.unit_number === selectedUnitModal.unit_number)
      );

      const { data, error } = await supabase
        .from('residents')
        .insert({
          name: unitResName.trim(),
          phone: unitResPhone.trim(),
          email: unitResEmail.trim() || null,
          unit_id: selectedUnitModal.id,
          is_authorized_receiver: true,
          is_primary: unitResidents.length === 0,
          active: true
        })
        .select('*, unit:units(*)')
        .single();

      if (error) {
        setUnitResError(`Erro ao cadastrar: ${error.message}`);
        return;
      }

      if (data) {
        setResidents((prev) => [...prev, data as Resident]);
      }

      setUnitResName('');
      setUnitResPhone('');
      setUnitResEmail('');
      setIsUnitAddResidentOpen(false);
      loadData();
    } catch (err: any) {
      setUnitResError(err.message || 'Erro inesperado ao salvar morador.');
    } finally {
      setUnitResLoading(false);
    }
  };

  const handleExportSpreadsheet = () => {
    try {
      setIsExportingSpreadsheet(true);
      const activeCondoName =
        impersonatedCondo?.name ||
        availableCondos.find((c) => c.id === effectiveCondoId)?.name ||
        (profile as any)?.condo?.name ||
        'Condominio';

      exportCondoSpreadsheet(activeCondoName, units, residents);
    } catch (err: any) {
      console.error('Erro ao exportar planilha:', err);
      alert(`Erro ao exportar planilha: ${err?.message || err}`);
    } finally {
      setIsExportingSpreadsheet(false);
    }
  };

  const handleOpenNewResidentModal = () => {
    setEditingResident(null);
    setNewResName('');
    setNewResPhone('');
    setNewResEmail('');
    setNewResBlock(units[0]?.block || 'Bloco A');
    setNewResUnitNumber('');
    setIsUnitDropdownOpen(false);
    setIsAddResidentModalOpen(true);
  };

  const handleOpenEditResidentModal = (resident: Resident) => {
    setEditingResident(resident);
    setNewResName(resident.name || '');
    setNewResPhone(resident.phone || '');
    setNewResEmail(resident.email || '');
    setNewResBlock(resident.unit?.block || 'Bloco A');
    setNewResUnitNumber(resident.unit?.unit_number || '');
    setIsUnitDropdownOpen(false);
    setIsAddResidentModalOpen(true);
  };

  const handleAddResident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResName.trim() || !newResPhone.trim() || !newResUnitNumber.trim()) {
      alert('Preencha os campos obrigatórios (Nome, Bloco, Apartamento e WhatsApp).');
      return;
    }

    const supabase = createClient();
    try {
      const block = (newResBlock || 'Bloco A').trim();
      const unitNum = newResUnitNumber.trim();

      // 1. Procura unidade existente
      let unit = units.find(
        (u) => (u.block || 'Bloco A').trim().toUpperCase() === block.toUpperCase() && u.unit_number.trim() === unitNum
      );

      // 2. Se não existir, cria a unidade automaticamente no banco
      if (!unit && supabase) {
        const { data: newUnit, error: uErr } = await supabase
          .from('units')
          .insert({
            condo_id: effectiveCondoId,
            block,
            unit_number: unitNum
          })
          .select()
          .single();

        if (uErr) {
          alert(`Erro ao criar unidade: ${uErr.message}`);
          return;
        }
        unit = newUnit;
        setUnits((prev) => [...prev, newUnit as Unit]);
      }

      if (!unit) {
        alert('Falha ao vincular unidade.');
        return;
      }

      // 3. Se estiver editando morador existente:
      if (editingResident && supabase) {
        const { data: updatedData, error: uError } = await supabase
          .from('residents')
          .update({
            name: newResName.trim(),
            phone: newResPhone.trim(),
            email: newResEmail.trim() || null,
            unit_id: unit.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingResident.id)
          .select('*, unit:units(*)')
          .single();

        if (uError) {
          alert(`Erro ao atualizar morador: ${uError.message}`);
          return;
        }

        if (updatedData) {
          setResidents((prev) =>
            prev.map((r) => (r.id === editingResident.id ? (updatedData as Resident) : r))
          );
        }

        setIsAddResidentModalOpen(false);
        setEditingResident(null);
        setNewResName('');
        setNewResPhone('');
        setNewResEmail('');
        setNewResUnitNumber('');
        loadData();
        return;
      }

      // 4. Cadastra novo morador
      if (supabase) {
        const { data, error } = await supabase
          .from('residents')
          .insert({
            name: newResName.trim(),
            phone: newResPhone.trim(),
            email: newResEmail.trim() || null,
            unit_id: unit.id,
            is_authorized_receiver: true,
            is_primary: true,
            active: true
          })
          .select('*, unit:units(*)')
          .single();

        if (error) {
          alert(`Erro ao cadastrar morador: ${error.message}`);
          return;
        }

        if (data) {
          setResidents((prev) => [...prev, data as Resident]);
        }
      }

      setIsAddResidentModalOpen(false);
      setEditingResident(null);
      setNewResName('');
      setNewResPhone('');
      setNewResEmail('');
      setNewResUnitNumber('');
      loadData();
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    }
  };

  const pendingCount = packages.filter(p => p.status !== 'DELIVERED' && p.status !== 'RETURNED').length;
  const deliveredCount = packages.filter(p => p.status === 'DELIVERED').length;
  const returnedCount = packages.filter(p => p.status === 'RETURNED').length;
  const totalCount = packages.length;

  const filteredPackages = packages.filter((pkg) => {
    if (packageStatusFilter === 'PENDING' && (pkg.status === 'DELIVERED' || pkg.status === 'RETURNED')) return false;
    if (packageStatusFilter === 'DELIVERED' && pkg.status !== 'DELIVERED') return false;
    if (packageStatusFilter === 'RETURNED' && pkg.status !== 'RETURNED') return false;

    if (!packageSearchQuery.trim()) return true;
    const q = packageSearchQuery.toLowerCase();
    const unitMatch = pkg.unit ? `${pkg.unit.block} ${pkg.unit.unit_number}`.toLowerCase().includes(q) : false;
    const nameMatch = (pkg.resident?.name || pkg.recipient_name_ocr || '').toLowerCase().includes(q);
    const codeMatch = (pkg.pickup_code || '').toLowerCase().includes(q) || (pkg.tracking_code || '').toLowerCase().includes(q);
    const carrierMatch = (pkg.carrier || '').toLowerCase().includes(q);
    return unitMatch || nameMatch || codeMatch || carrierMatch;
  });

  const isPorteiro = isGuard || profile?.role === 'GUARD';
  if (!authLoading && (isPorteiro || (!isAdmin && !isSuperAdmin))) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
        <p className="text-slate-400 text-sm font-medium">Redirecionando para a Portaria...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header do Painel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Administração Geral</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-100 mt-1 flex items-center gap-2 flex-wrap">
            <span>{profile?.role === 'ADMIN' ? 'Painel de Administração' : 'Painel do Síndico'}</span>
            {isSuperAdmin && availableCondos.length > 0 ? (
              <div className="flex items-center gap-2 bg-slate-900 border border-indigo-500/40 rounded-xl px-3 py-1.5 text-xs shadow-inner">
                <span className="text-indigo-400 font-bold">Condomínio:</span>
                <select
                  value={effectiveCondoId || ''}
                  onChange={(e) => {
                    const found = availableCondos.find((c) => c.id === e.target.value);
                    if (found) {
                      impersonateCondo({ id: found.id, name: found.name });
                    }
                  }}
                  className="bg-transparent text-slate-100 font-bold focus:outline-none cursor-pointer"
                >
                  {availableCondos.map((c) => (
                    <option key={c.id} value={c.id} className="bg-slate-900 text-slate-100">
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              isImpersonating && impersonatedCondo && (
                <span className="text-sm font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-xl">
                  {impersonatedCondo.name}
                </span>
              )
            )}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('PACKAGES')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition ${
              activeTab === 'PACKAGES'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Package className="w-4 h-4" /> Encomendas ({packages.length})
          </button>
          <button
            onClick={() => setActiveTab('UNITS')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition ${
              activeTab === 'UNITS'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" /> Blocos & Unidades ({units.length})
          </button>
          <button
            onClick={() => setActiveTab('RESIDENTS')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition ${
              activeTab === 'RESIDENTS'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-4 h-4" /> Moradores ({residents.length})
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => { setActiveTab('STAFF'); loadStaff(); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition ${
                  activeTab === 'STAFF'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Shield className="w-4 h-4" /> Equipe
              </button>
              <button
                onClick={() => { setActiveTab('AUTOMATIONS'); handleLoadBackups(); }}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition ${
                  activeTab === 'AUTOMATIONS'
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Cpu className="w-4 h-4" /> Automações
              </button>
            </>
          )}
          <button
            onClick={() => setActiveTab('SYSTEM')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition ${
              activeTab === 'SYSTEM'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" /> Diagnóstico
          </button>
        </div>
      </div>

      {/* ABA ENCOMENDAS */}
      {activeTab === 'PACKAGES' && (
        <div className="space-y-6 animate-fade-in">
          {/* Métricas do Condomínio (Cards Interativos com Filtro Rápido) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Aguardando Retirada */}
            <button
              type="button"
              onClick={() => setPackageStatusFilter(packageStatusFilter === 'PENDING' ? 'ALL' : 'PENDING')}
              className={`text-left bg-slate-900 border rounded-3xl p-5 shadow-xl transition flex items-center justify-between group ${
                packageStatusFilter === 'PENDING'
                  ? 'border-amber-500 ring-2 ring-amber-500/20 bg-amber-950/20'
                  : 'border-slate-800 hover:border-amber-500/40'
              }`}
              title="Filtrar apenas encomendas aguardando retirada"
            >
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Aguardando Retirada</span>
                <span className="text-3xl font-black text-amber-400 mt-1 block">{pendingCount}</span>
                <span className="text-[11px] text-slate-500">Na portaria agora</span>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20 group-hover:scale-110 transition-transform">
                <Clock className="w-6 h-6" />
              </div>
            </button>

            {/* Card 2: Entregues com Sucesso */}
            <button
              type="button"
              onClick={() => setPackageStatusFilter(packageStatusFilter === 'DELIVERED' ? 'ALL' : 'DELIVERED')}
              className={`text-left bg-slate-900 border rounded-3xl p-5 shadow-xl transition flex items-center justify-between group ${
                packageStatusFilter === 'DELIVERED'
                  ? 'border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-950/20'
                  : 'border-slate-800 hover:border-emerald-500/40'
              }`}
              title="Filtrar apenas encomendas entregues"
            >
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Entregues com Sucesso</span>
                <span className="text-3xl font-black text-emerald-400 mt-1 block">{deliveredCount}</span>
                <span className="text-[11px] text-slate-500">Com assinatura</span>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </button>

            {/* Card 3: Total de Encomendas */}
            <button
              type="button"
              onClick={() => { setPackageStatusFilter('ALL'); setPackageSearchQuery(''); }}
              className={`text-left bg-slate-900 border rounded-3xl p-5 shadow-xl transition flex items-center justify-between group ${
                packageStatusFilter === 'ALL' && !packageSearchQuery
                  ? 'border-sky-500/60 bg-sky-950/20'
                  : 'border-slate-800 hover:border-sky-500/40'
              }`}
              title="Exibir todas as encomendas"
            >
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Total de Encomendas</span>
                <span className="text-3xl font-black text-sky-400 mt-1 block">{totalCount}</span>
                <span className="text-[11px] text-slate-500">Histórico registrado</span>
              </div>
              <div className="p-3 bg-sky-500/10 text-sky-400 rounded-2xl border border-sky-500/20 group-hover:scale-110 transition-transform">
                <Package className="w-6 h-6" />
              </div>
            </button>

            {/* Card 4: Moradores Ativos */}
            <button
              type="button"
              onClick={() => setActiveTab('RESIDENTS')}
              className="text-left bg-slate-900 border border-slate-800 hover:border-indigo-500/40 rounded-3xl p-5 shadow-xl transition flex items-center justify-between group"
              title="Ver lista de moradores"
            >
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Moradores Ativos</span>
                <span className="text-3xl font-black text-indigo-400 mt-1 block">{residents.length}</span>
                <span className="text-[11px] text-slate-500">Em {units.length} unidades</span>
              </div>
              <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20 group-hover:scale-110 transition-transform">
                <Users className="w-6 h-6" />
              </div>
            </button>
          </div>

          {/* Painel Completo de Encomendas do Condomínio */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            {/* Header do Card com Título e Ação de Atualização */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
              <div className="flex items-start sm:items-center gap-3">
                <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20 shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                    Encomendas do Condomínio ({packages.length})
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Histórico completo com fotos da etiqueta, assinaturas de retirada, transportadora e avisos de WhatsApp.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="self-start sm:self-center px-3.5 py-2 bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white rounded-xl border border-slate-800 hover:border-slate-700 transition flex items-center gap-2 text-xs font-semibold shadow-sm shrink-0 active:scale-95 disabled:opacity-50 group"
                title="Atualizar lista de encomendas"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 group-hover:rotate-180 transition-transform duration-500 ${loading ? 'animate-spin' : ''}`} />
                <span>Atualizar</span>
              </button>
            </div>

            {/* Barra de Filtros e Busca */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* Campo de Busca */}
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar morador, apto, código..."
                  value={packageSearchQuery}
                  onChange={(e) => setPackageSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
                {packageSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setPackageSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    title="Limpar busca"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Filtros de Status em Tabs */}
              <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs overflow-x-auto max-w-full">
                <button
                  type="button"
                  onClick={() => setPackageStatusFilter('ALL')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap ${
                    packageStatusFilter === 'ALL'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Todas ({totalCount})
                </button>
                <button
                  type="button"
                  onClick={() => setPackageStatusFilter('PENDING')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap ${
                    packageStatusFilter === 'PENDING'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Aguardando ({pendingCount})
                </button>
                <button
                  type="button"
                  onClick={() => setPackageStatusFilter('DELIVERED')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap ${
                    packageStatusFilter === 'DELIVERED'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Entregues ({deliveredCount})
                </button>
                <button
                  type="button"
                  onClick={() => setPackageStatusFilter('RETURNED')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition whitespace-nowrap ${
                    packageStatusFilter === 'RETURNED'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Devolvidas ({returnedCount})
                </button>
              </div>
            </div>

            {/* Grid de Encomendas */}
            {filteredPackages.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPackages.map((pkg) => (
                  <PackageCard
                    key={pkg.id}
                    pkg={pkg}
                    onPackageUpdated={loadData}
                    showActions={true}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border border-dashed border-slate-800 rounded-2xl bg-slate-950/40">
                <Package className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-300">Nenhuma encomenda encontrada</p>
                <p className="text-xs text-slate-500 mt-1">
                  {packageSearchQuery || packageStatusFilter !== 'ALL'
                    ? 'Tente ajustar os filtros ou o termo de busca.'
                    : 'As encomendas registradas na portaria aparecerão aqui automaticamente.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ABA: BLOCOS & UNIDADES */}
      {activeTab === 'UNITS' && (
        <div className="space-y-6 animate-fade-in">
          {/* Top banner / Ferramentas */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Card 1: Gerador em Lote de Andares e Apartamentos */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-slate-100">Gerador em Lote de Andares & Unidades</h3>
              </div>
              <p className="text-xs text-slate-400">
                Gere automaticamente todos os apartamentos de um bloco especificando a quantidade de andares e números por andar.
              </p>

              {batchSuccess && (
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs px-4 py-3 rounded-xl">
                  <CheckCircle2 size={16} />
                  {batchSuccess}
                </div>
              )}
              {batchError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-4 py-3 rounded-xl">
                  {batchError}
                </div>
              )}

              <form onSubmit={handleBatchGenerateUnits} className="space-y-3.5 text-xs">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Nome do Bloco / Torre:</label>
                  <input
                    type="text"
                    required
                    value={batchBlock}
                    onChange={(e) => setBatchBlock(e.target.value)}
                    placeholder="Ex: Bloco A, Torre 1, Bloco B"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Qtd. Andares:</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      required
                      value={batchFloors}
                      onChange={(e) => setBatchFloors(parseInt(e.target.value) || 1)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">1º Apto/Andar:</label>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      required
                      value={batchStartUnit}
                      onChange={(e) => setBatchStartUnit(parseInt(e.target.value) || 0)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-300 font-semibold mb-1">Último Apto:</label>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      required
                      value={batchEndUnit}
                      onChange={(e) => setBatchEndUnit(parseInt(e.target.value) || 0)}
                      className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Prévia */}
                <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400">
                  <span className="font-semibold text-slate-300 block">Prévia da Configuração:</span>
                  <span className="text-indigo-400 font-mono">
                    {batchFloors * (batchEndUnit - batchStartUnit + 1)} unidades: 1{String(batchStartUnit).padStart(2, '0')}-1{String(batchEndUnit).padStart(2, '0')}, ..., {batchFloors}{String(batchStartUnit).padStart(2, '0')}-{batchFloors}{String(batchEndUnit).padStart(2, '0')}
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={batchLoading}
                  className="w-full py-2.5 rounded-xl font-bold text-white text-xs bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center gap-2 transition"
                >
                  {batchLoading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  {batchLoading ? 'Gerando...' : 'Gerar Unidades em Lote'}
                </button>
              </form>
            </div>

            {/* Card 2: Adicionar Unidade Individual */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-slate-100">Adicionar Unidade Individual</h3>
              </div>
              <p className="text-xs text-slate-400">
                Cadastre unidades especiais, coberturas, casas ou áreas comuns separadamente.
              </p>

              <form onSubmit={handleAddSingleUnit} className="space-y-3.5 text-xs pt-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Bloco / Setor:</label>
                  <input
                    type="text"
                    required
                    value={singleBlock}
                    onChange={(e) => setSingleBlock(e.target.value)}
                    placeholder="Ex: Bloco A, Torre 2, Geral"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Identificação / Número do Apto:</label>
                  <input
                    type="text"
                    required
                    value={singleUnitNumber}
                    onChange={(e) => setSingleUnitNumber(e.target.value)}
                    placeholder="Ex: Cobertura 01, Apto 808, Portaria"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={singleLoading}
                  className="w-full py-2.5 rounded-xl font-bold text-white text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 flex items-center justify-center gap-2 transition"
                >
                  {singleLoading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  Adicionar Unidade
                </button>
              </form>
            </div>
          </div>

          {/* Lista e Visualização de Blocos e Apartamentos */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-indigo-400" />
                  Unidades Cadastradas ({units.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Visualização de todos os blocos e seus respectivos apartamentos.
                </p>
              </div>

              {/* Filtro por Bloco e Exportação */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleExportSpreadsheet}
                  disabled={isExportingSpreadsheet}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow-md transition active:scale-95 whitespace-nowrap disabled:opacity-50"
                  title="Baixar planilha completa (.xlsx) com todos os Blocos, Apartamentos, Moradores, Telefones e E-mails"
                >
                  {isExportingSpreadsheet ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  <span>Baixar Planilha</span>
                </button>

                <div className="h-4 w-px bg-slate-800 hidden sm:block" />

                <button
                  onClick={() => setSelectedBlockFilter('ALL')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                    selectedBlockFilter === 'ALL'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Todos ({units.length})
                </button>
                {Array.from(new Set(units.map(u => u.block))).sort().map(blockName => {
                  const count = units.filter(u => u.block === blockName).length;
                  return (
                    <button
                      key={blockName}
                      onClick={() => setSelectedBlockFilter(blockName)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                        selectedBlockFilter === blockName
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {blockName} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Grid de Unidades */}
            <div className="space-y-6 pt-2">
              {Array.from(new Set(units.map(u => u.block)))
                .filter(b => selectedBlockFilter === 'ALL' || selectedBlockFilter === b)
                .sort()
                .map(blockName => {
                  const blockUnits = units
                    .filter(u => u.block === blockName)
                    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));

                  return (
                    <div key={blockName} className="bg-slate-950/80 rounded-2xl p-4 border border-slate-800/80 space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="font-bold text-sm text-indigo-300 flex items-center gap-1.5">
                          <Building2 size={16} />
                          {blockName}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-slate-500 font-medium">
                            {blockUnits.length} apartamentos
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteBlock(blockName)}
                            className="text-[11px] text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1 transition opacity-70 hover:opacity-100 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-0.5 rounded-lg border border-rose-500/20"
                            title={`Excluir todos os apartamentos do ${blockName}`}
                          >
                            <Trash2 size={12} />
                            Excluir Bloco
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
                        {blockUnits.map(u => {
                          const unitResCount = residents.filter(
                            r =>
                              r.unit_id === u.id ||
                              (r.unit &&
                                (r.unit.block || 'Bloco A').toUpperCase() === (u.block || 'Bloco A').toUpperCase() &&
                                r.unit.unit_number === u.unit_number)
                          ).length;

                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => {
                                setSelectedUnitModal(u);
                                setIsUnitAddResidentOpen(false);
                                setUnitResName('');
                                setUnitResPhone('');
                                setUnitResEmail('');
                                setUnitResError(null);
                              }}
                              className={`group relative bg-slate-900 hover:bg-slate-800/90 border ${
                                unitResCount > 0 ? 'border-emerald-500/30 hover:border-emerald-500' : 'border-slate-800 hover:border-indigo-500'
                              } rounded-xl p-2.5 text-center transition flex flex-col items-center justify-between gap-1 cursor-pointer hover:shadow-lg hover:shadow-indigo-950/40 active:scale-95`}
                              title={`Clique para ver moradores do ${u.block} - Apto ${u.unit_number}`}
                            >
                              <div className="flex items-center justify-between w-full">
                                <span className="font-mono font-bold text-xs text-slate-200">{u.unit_number}</span>
                                {unitResCount > 0 ? (
                                  <span
                                    className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded-md border border-emerald-500/30"
                                    title={`${unitResCount} morador(es) cadastrado(s)`}
                                  >
                                    <Users size={10} />
                                    {unitResCount}
                                  </span>
                                ) : (
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-700 group-hover:bg-indigo-400/50 transition" title="Sem moradores" />
                                )}
                              </div>

                              <div className="w-full flex items-center justify-between pt-0.5">
                                <span className="text-[9px] text-slate-500 group-hover:text-indigo-300 font-medium transition">
                                  {unitResCount > 0 ? 'Moradores' : '+ Adicionar'}
                                </span>
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteUnit(u.id, `${u.block} - Apto ${u.unit_number}`);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 rounded transition"
                                  title="Excluir unidade"
                                >
                                  <Trash2 size={11} />
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

              {units.length === 0 && (
                <div className="text-center py-12 px-4 bg-slate-950/50 rounded-2xl border border-dashed border-slate-800 space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
                    <Building2 size={24} />
                  </div>
                  <h4 className="text-sm font-bold text-slate-200">Nenhuma unidade cadastrada neste condomínio</h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Utilize o <strong>Gerador em Lote</strong> acima ou adicione unidades individuais para popular os apartamentos e blocos.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ABA 2: CADASTRO DE MORADORES */}
      {activeTab === 'RESIDENTS' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-400" />
                Moradores e Unidades ({residents.length})
              </h3>
              <p className="text-xs text-slate-400">
                Gerencie todos os moradores cadastrados no sistema.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportSpreadsheet}
                disabled={isExportingSpreadsheet}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-950 transition active:scale-95 whitespace-nowrap disabled:opacity-50"
                title="Baixar planilha completa (.xlsx) com todos os Blocos, Apartamentos, Moradores, Telefones e E-mails"
              >
                {isExportingSpreadsheet ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                <span>Baixar Planilha</span>
              </button>

              <button
                type="button"
                onClick={() => setIsBatchImportModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950 transition active:scale-95 whitespace-nowrap"
                title="Importar moradores em lote via Planilha Excel ou Lista"
              >
                <FileSpreadsheet className="w-4 h-4" /> Importar
              </button>

              <button
                type="button"
                onClick={handleOpenNewResidentModal}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition whitespace-nowrap"
              >
                <Plus className="w-4 h-4" /> Novo Morador
              </button>
            </div>
          </div>

          {/* Barra de Busca de Moradores */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              value={residentSearchQuery}
              onChange={(e) => setResidentSearchQuery(e.target.value)}
              placeholder="Buscar por nome, bloco, apartamento ou WhatsApp..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 font-bold border-b border-slate-800 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="p-4">Morador</th>
                    <th className="p-4">Unidade</th>
                    <th className="p-4">WhatsApp</th>
                    <th className="p-4">E-mail</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {residents
                    .filter((r) => {
                      if (!residentSearchQuery.trim()) return true;
                      const q = residentSearchQuery.toLowerCase();
                      const nameMatch = r.name?.toLowerCase().includes(q);
                      const unitMatch = r.unit && `${r.unit.block} ${r.unit.unit_number}`.toLowerCase().includes(q);
                      const phoneMatch = r.phone?.includes(q);
                      const emailMatch = r.email?.toLowerCase().includes(q);
                      return nameMatch || unitMatch || phoneMatch || emailMatch;
                    })
                    .map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => {
                          setSelectedResidentProfile(r);
                          setProfilePackageFilter('ALL');
                          setProfilePackageSearch('');
                        }}
                        className="hover:bg-slate-800/60 transition group cursor-pointer"
                        title={`Clique para ver o perfil completo e histórico de encomendas de ${r.name}`}
                      >
                        <td className="p-4 font-semibold text-slate-100">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 font-bold text-xs shrink-0 group-hover:scale-105 group-hover:border-indigo-500/60 transition">
                              {r.name ? r.name.substring(0, 2).toUpperCase() : <Users size={14} />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="group-hover:text-indigo-400 transition font-bold truncate">
                                  {r.name}
                                </span>
                                {r.is_primary && (
                                  <span className="text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded font-semibold shrink-0">
                                    Titular
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 font-medium text-slate-200">
                          {r.unit ? `${r.unit.block} - Apto ${r.unit.unit_number}` : 'Sem Unidade'}
                        </td>
                        <td className="p-4 font-mono text-slate-300">
                          {r.phone}
                        </td>
                        <td className="p-4 text-slate-400">
                          {r.email || '—'}
                        </td>
                        <td className="p-4">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Ativo
                          </span>
                        </td>
                        <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedResidentProfile(r);
                                setProfilePackageFilter('ALL');
                                setProfilePackageSearch('');
                              }}
                              className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition"
                              title="Ver Perfil e Encomendas"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEditResidentModal(r)}
                              className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition"
                              title="Editar Morador"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteResident(r.id, r.name)}
                              className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                              title="Excluir Morador"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ABA 3: DIAGNÓSTICO DO SISTEMA */}
      {activeTab === 'SYSTEM' && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            {/* PAINEL DE PAREAMENTO DO WHATSAPP */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <MessageSquare size={16} className="text-emerald-400" />
                    Conexão do WhatsApp da Portaria
                  </h4>
                  <p className="text-slate-400 text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>Status: <span className={whatsappState.connected ? 'text-emerald-400 font-bold' : (whatsappState.status === 'CONNECTING' ? 'text-amber-300 font-bold' : 'text-rose-400 font-bold')}>
                      {whatsappState.connected ? '● CONECTADO' : (whatsappState.status === 'CONNECTING' ? '⏳ CONECTANDO...' : '○ DESCONECTADO')}
                    </span></span>
                    {whatsappState.phone && (
                      <span className="text-slate-200 font-mono text-[11px] bg-slate-800 border border-emerald-500/30 px-2 py-0.5 rounded-md font-semibold">
                        📱 +{whatsappState.phone}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Botão de Conectar / Gerar QR Code (Logar) */}
                  <button
                    type="button"
                    onClick={handleConnectWhatsApp}
                    disabled={whatsappLoading}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md transition disabled:opacity-50"
                  >
                    {whatsappLoading ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                    {whatsappLoading ? 'Buscando...' : whatsappState.connected ? 'Reconectar / QR Code' : 'Logar / Gerar QR Code'}
                  </button>

                  {/* Botão de Desconectar / Deslogar */}
                  <button
                    type="button"
                    onClick={handleLogoutWhatsApp}
                    disabled={whatsappLoading}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold transition disabled:opacity-50"
                    title="Desconectar e limpar a sessão do WhatsApp da portaria para conectar outro número"
                  >
                    <LogOut size={14} />
                    Deslogar
                  </button>
                </div>
              </div>

              {/* Erro de conexão com Docker / Evolution */}
              {whatsappError && (
                <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs px-4 py-3 rounded-xl flex items-center gap-2">
                  <AlertCircle size={16} className="text-amber-400 shrink-0" />
                  <span>{whatsappError}</span>
                </div>
              )}

              {/* QR Code Display */}
              {whatsappQrCode && (
                <div className="bg-slate-950 border border-emerald-500/30 rounded-2xl p-6 text-center space-y-3">
                  <div className="inline-block p-4 bg-white rounded-2xl shadow-xl">
                    <img
                      src={whatsappQrCode.startsWith('data:') ? whatsappQrCode : `data:image/png;base64,${whatsappQrCode}`}
                      alt="WhatsApp QR Code"
                      className="w-56 h-56 mx-auto object-contain"
                    />
                  </div>
                  {whatsappPairingCode && (
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 max-w-xs mx-auto">
                      <p className="text-xs text-slate-400">Código de pareamento:</p>
                      <p className="text-lg font-mono font-bold text-emerald-400 tracking-widest">{whatsappPairingCode}</p>
                    </div>
                  )}
                  <p className="text-xs text-slate-300">
                    Abra o WhatsApp no celular da portaria → <strong>Aparelhos Conectados</strong> → <strong>Conectar um aparelho</strong> e aponte a câmera.
                  </p>
                </div>
              )}

              {/* Formulário de Teste de Mensagem */}
              <form onSubmit={handleSendTestWhatsApp} className="bg-slate-950 border border-slate-800/80 rounded-2xl p-4 space-y-3">
                <h5 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Send size={13} className="text-indigo-400" />
                  Testar Disparo de Mensagem no WhatsApp
                </h5>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    required
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="Ex: 5573981953741 (com DDD)"
                    className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={testMsgLoading}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {testMsgLoading ? <Loader2 size={13} className="animate-spin" /> : <Smartphone size={13} />}
                    {testMsgLoading ? 'Enviando...' : 'Enviar Alerta de Teste'}
                  </button>
                </div>
                {testMsgResult && (
                  <p className={`text-xs font-medium ${testMsgResult.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>
                    {testMsgResult}
                  </p>
                )}
              </form>

              {/* Caixa Informativa do WhatsApp */}
              <div className="bg-slate-950/60 border border-emerald-500/20 rounded-2xl p-4 text-[11px] text-slate-400 space-y-2">
                <p className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-emerald-400" />
                  Instruções de Conexão:
                </p>
                <p className="text-slate-300 text-xs leading-relaxed">
                  Basta clicar em <strong>&quot;Gerar QR Code de Conexão&quot;</strong> e apontar a câmera do WhatsApp para autenticar o computador da portaria e habilitar o envio de avisos aos moradores.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== ABA EQUIPE ===== */}
      {activeTab === 'STAFF' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Formulário de Criar Conta */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <UserPlus size={18} className="text-indigo-400" />
              <h2 className="text-lg font-bold text-slate-100">Criar conta da Equipe</h2>
            </div>

            {staffSuccess && (
              <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 text-sm px-4 py-3 rounded-xl mb-4">
                <BadgeCheck size={16} />
                {staffSuccess}
              </div>
            )}
            {staffError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl mb-4">
                {staffError}
              </div>
            )}

            <form onSubmit={handleCreateStaff} className="space-y-4">
              {/* Tipo de conta */}
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-2">Tipo de conta</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setStaffRole('GUARD')}
                    className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-semibold border transition flex items-center justify-center gap-1.5 ${
                      staffRole === 'GUARD'
                        ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    🛡️ Porteiro
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffRole('SYNDIC')}
                    className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-semibold border transition flex items-center justify-center gap-1.5 ${
                      staffRole === 'SYNDIC'
                        ? 'bg-purple-600 border-purple-500 text-white shadow-md'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    👑 Síndico
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffRole('ADMIN')}
                    className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-semibold border transition flex items-center justify-center gap-1.5 ${
                      staffRole === 'ADMIN'
                        ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    💼 Administrador
                  </button>
                </div>
              </div>

              {/* Nome */}
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-1">Nome completo</label>
                <input
                  type="text" required
                  value={staffName}
                  onChange={e => setStaffName(e.target.value)}
                  placeholder="Ex: João Porteiro"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              {/* Telefone */}
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-1">Telefone / WhatsApp</label>
                <input
                  type="tel"
                  value={staffPhone}
                  onChange={e => setStaffPhone(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              {/* E-mail */}
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-1">E-mail de login</label>
                <input
                  type="email" required
                  value={staffEmail}
                  onChange={e => setStaffEmail(e.target.value)}
                  placeholder="porteiro@condominio.com"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
                />
              </div>

              {/* Senha */}
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-1">
                  <KeyRound size={12} className="inline mr-1" />
                  Senha provisória (mín. 8 caracteres)
                </label>
                <input
                  type="text" required
                  value={staffPassword}
                  onChange={e => setStaffPassword(e.target.value)}
                  placeholder="Senha que você vai informar ao funcionário"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-mono transition"
                />
                <p className="text-xs text-slate-500 mt-1">
                  ⚠️ Anote esta senha para entregar ao funcionário. Ele poderá alterá-la depois.
                </p>
              </div>

              <button
                type="submit"
                disabled={staffLoading}
                className={`w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all ${
                  staffLoading ? 'opacity-60 cursor-not-allowed' : 'hover:brightness-110'
                } ${staffRole === 'ADMIN' ? 'bg-emerald-600' : staffRole === 'SYNDIC' ? 'bg-purple-600' : 'bg-blue-600'}`}
              >
                {staffLoading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                {staffLoading ? 'Criando conta...' : `Criar conta de ${staffRole === 'GUARD' ? 'Porteiro' : staffRole === 'ADMIN' ? 'Administrador' : 'Síndico'}`}
              </button>
            </form>
          </div>

          {/* Lista da equipe atual */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Shield size={18} className="text-indigo-400" />
                <h2 className="text-lg font-bold text-slate-100">Equipe atual</h2>
              </div>
              <button onClick={loadStaff} className="text-slate-500 hover:text-white transition">
                <RefreshCw size={15} />
              </button>
            </div>

            {staffList.length === 0 ? (
              <div className="text-center py-10 text-slate-500">
                <Shield size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Nenhuma conta de equipe encontrada.</p>
                <p className="text-xs mt-1">Crie a primeira conta ao lado.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {staffList.map((member: any) => (
                  <div key={member.id} className="flex items-center justify-between bg-slate-800/60 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-white text-sm font-medium">{member.name}</p>
                      <p className="text-slate-500 text-xs">{member.phone || 'Sem telefone'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2.5 py-1 rounded-lg font-bold ${
                        member.role === 'ADMIN' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                        member.role === 'SYNDIC' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' :
                        'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      }`}>
                        {member.role === 'ADMIN' ? 'Administrador' : member.role === 'SYNDIC' ? 'Síndico' : 'Porteiro'}
                      </span>
                      {member.id !== user?.id && (
                        <>
                          <button
                            onClick={() => handleGenerateQR(member.id, member.name)}
                            disabled={staffQrLoading === member.id}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
                            title="Gerar QR Code de Acesso"
                          >
                            {staffQrLoading === member.id ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                          </button>
                          <button
                            onClick={() => handleDeleteStaff(member.id, member.name)}
                            disabled={staffDeleteLoading === member.id}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                            title="Remover membro"
                          >
                            {staffDeleteLoading === member.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de QR Code do Staff */}
      {staffQrData && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl relative">
            <button 
              onClick={() => setStaffQrData(null)}
              className="absolute top-4 right-4 p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-full transition-colors z-10"
            >
              <X size={20} />
            </button>
            <div className="p-6 text-center pt-10">
              <QrCode size={40} className="mx-auto text-blue-400 mb-3" />
              <h2 className="text-xl font-bold text-white mb-2">QR Code de Login</h2>
              <p className="text-slate-400 text-sm mb-6 leading-relaxed">
                Acesse a tela de login no celular do porteiro, escolha <strong>Login via QR Code</strong> e aponte a câmera para esta tela.
              </p>
              <div className="bg-white p-4 rounded-xl inline-block shadow-lg mx-auto mb-4">
                <QRCodeSVG value={staffQrData.link} size={200} level="H" includeMargin={false} />
              </div>
              <p className="text-white font-medium mt-1">{staffQrData.name}</p>
              {staffQrData.otp && (
                <div className="mt-3 bg-slate-800/80 border border-slate-700/80 rounded-xl py-2 px-3 inline-block">
                  <span className="text-slate-400 text-[11px] uppercase tracking-wider block font-semibold">Código Numérico Rápido</span>
                  <span className="text-emerald-400 font-mono font-black text-xl tracking-widest">{staffQrData.otp}</span>
                </div>
              )}
            </div>
            <div className="bg-slate-800 p-4 border-t border-slate-700 flex justify-center">
              <button 
                onClick={() => setStaffQrData(null)}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white font-medium py-2 rounded-xl transition"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== ABA AUTOMAÇÕES & JS/PYTHON ===== */}
      {activeTab === 'AUTOMATIONS' && (
        <div className="space-y-6 animate-fade-in">
          {/* Top Banner */}
          <div className="bg-gradient-to-r from-indigo-900/40 via-purple-900/30 to-slate-900 border border-indigo-500/20 rounded-3xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider mb-1">
                <Cpu size={16} /> Motor Nativo All-in-One
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white">Automações, Relatórios e Recursos do Sistema</h2>
              <p className="text-slate-400 text-xs mt-1">Recursos executados diretamente no computador da portaria via Node.js e scripts Python.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Node.js & Python Ativos
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 1. RELATÓRIOS INTELIGENTES EM PYTHON */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-2xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Relatório de Fluxo da Portaria</h3>
                    <p className="text-xs text-slate-400">Gera resumo em Python e dispara no WhatsApp</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateReport}
                  disabled={reportLoading}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50 shadow-md shadow-indigo-950"
                >
                  {reportLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Gerar Resumo
                </button>
              </div>

              {reportResult && (
                <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3 font-mono text-xs text-slate-300">
                  <pre className="whitespace-pre-wrap font-sans text-xs text-slate-200 leading-relaxed">
                    {reportResult.reportText}
                  </pre>

                  {/* Disparo no WhatsApp do Síndico */}
                  <form onSubmit={handleSendReportWhatsApp} className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      required
                      value={reportPhone}
                      onChange={(e) => setReportPhone(e.target.value)}
                      placeholder="WhatsApp do Síndico (Ex: 73981953741)"
                      className="flex-1 px-3.5 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={reportLoading}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-md shadow-emerald-950 whitespace-nowrap"
                    >
                      {reportLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Enviar no WhatsApp
                    </button>
                  </form>

                  {reportSendStatus && (
                    <p className={`text-xs font-semibold ${reportSendStatus.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>
                      {reportSendStatus}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 2. BACKUP AUTOMÁTICO DO BANCO DE DADOS */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                    <Database size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Backups do Sistema</h3>
                    <p className="text-xs text-slate-400">Cópia compactada do SQLite e Sessão WhatsApp</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreateBackup}
                  disabled={backupLoading}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50 shadow-md shadow-emerald-950"
                >
                  {backupLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Fazer Backup Agora
                </button>
              </div>

              {backupSuccessMsg && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs rounded-xl font-semibold">
                  {backupSuccessMsg}
                </div>
              )}

              {/* Lista de backups */}
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {backupList.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4 text-center">Nenhum arquivo de backup gerado ainda. Clique em "Fazer Backup Agora".</p>
                ) : (
                  backupList.map((bkp, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800/80 rounded-xl text-xs">
                      <div>
                        <p className="font-semibold text-slate-200 font-mono">{bkp.filename}</p>
                        <p className="text-[10px] text-slate-500">{new Date(bkp.createdAt).toLocaleString('pt-BR')}</p>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono text-[10px]">
                        {bkp.sizeKb} KB
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 3. ALERTAS DE VOZ & SINTETIZADOR TEXT-TO-SPEECH */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
                <div className="p-2.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                  <Volume2 size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Alertas Sonoros e Fala em Voz Alta</h3>
                  <p className="text-xs text-slate-400">Text-to-Speech e bips de confirmação para o porteiro</p>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-800 rounded-2xl">
                <div>
                  <p className="text-xs font-bold text-slate-200">Sintetizador de Voz Nativo</p>
                  <p className="text-[11px] text-slate-400">Fala em voz alta ao registrar e entregar encomendas</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const nextState = !voiceActive;
                    setVoiceActive(nextState);
                    VoiceService.setVoiceEnabled(nextState);
                    if (nextState) {
                      VoiceService.playSuccessBeep(true);
                      VoiceService.speak('Alertas de voz ativados no CondoBox', true);
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    voiceActive
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm'
                      : 'bg-slate-850 text-slate-400 border border-slate-750 hover:text-slate-300'
                  }`}
                >
                  {voiceActive ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  {voiceActive ? 'Ativado' : 'Silenciado'}
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    VoiceService.playSuccessBeep(true);
                    VoiceService.speak('Teste do sistema de voz: Encomenda registrada para o Bloco A, Apartamento 805.', true);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
                >
                  🔊 Testar Fala de Cadastro
                </button>
                <button
                  type="button"
                  onClick={() => {
                    VoiceService.playSuccessBeep(true);
                    VoiceService.speak('Entrega concluída com sucesso para o morador.', true);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
                >
                  ✅ Testar Fala de Retirada
                </button>
              </div>
            </div>

            {/* 4. IMPRESSÃO TÉRMICA ESC/POS */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
                <div className="p-2.5 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
                  <Printer size={20} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Impressora Térmica Direta (ESC/POS)</h3>
                  <p className="text-xs text-slate-400">Impressão automática de etiquetas de 58mm / 80mm</p>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Suporta impressoras térmicas conectadas na porta USB ou rede (Bematech, Elgin, Epson). O sistema formata comandos ESC/POS para guilhotina e códigos de barras.
              </p>

              <button
                type="button"
                onClick={handleTestPrint}
                className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-cyan-950"
              >
                <Printer size={15} />
                Testar Impressão de Etiqueta Térmica
              </button>

              {printerStatus && (
                <p className="text-xs text-cyan-300 font-semibold text-center bg-cyan-950/40 p-2.5 rounded-xl border border-cyan-800/40">
                  {printerStatus}
                </p>
              )}
            </div>

            {/* 5. EXPORTAR CADASTRO GERAL EM PLANILHA EXCEL */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-400">
                    <FileSpreadsheet size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white">Exportar Cadastro em Planilha (.xlsx)</h3>
                    <p className="text-xs text-slate-400">Download de todos os blocos, unidades, moradores, WhatsApp e e-mails</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleExportSpreadsheet}
                  disabled={isExportingSpreadsheet}
                  className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 disabled:opacity-50 shadow-md shadow-cyan-950"
                >
                  {isExportingSpreadsheet ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Baixar Planilha Agora
                </button>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Gera um arquivo Excel compatível com Microsoft Excel, Google Sheets e LibreOffice contendo todos os dados do condomínio estruturados por Bloco, Número da Unidade, Nome do Morador, Número/WhatsApp e E-mail.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Detalhes da Unidade / Moradores do Apartamento */}
      {selectedUnitModal && (() => {
        const unitResidents = residents.filter(
          (r) =>
            r.unit_id === selectedUnitModal.id ||
            (r.unit &&
              (r.unit.block || 'Bloco A').toUpperCase() === (selectedUnitModal.block || 'Bloco A').toUpperCase() &&
              r.unit.unit_number === selectedUnitModal.unit_number)
        );

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fade-in">
            <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 sm:p-7 max-w-lg w-full space-y-5 shadow-2xl relative max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 bg-indigo-500/15 border border-indigo-500/30 rounded-2xl text-indigo-400">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      {selectedUnitModal.block} - Apto {selectedUnitModal.unit_number}
                      <span className="text-[11px] font-semibold px-2 py-0.5 bg-slate-800 text-indigo-300 border border-indigo-500/20 rounded-full">
                        {unitResidents.length} {unitResidents.length === 1 ? 'morador' : 'moradores'}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Moradores cadastrados e notificações para esta unidade.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedUnitModal(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 rounded-xl hover:bg-slate-800 transition"
                  title="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Lista de Moradores (com scroll caso haja vários) */}
              <div className="space-y-3 overflow-y-auto pr-1 flex-1">
                {unitResidents.length === 0 ? (
                  <div className="text-center py-8 px-4 bg-slate-950/60 rounded-2xl border border-slate-800/80 space-y-2">
                    <Users className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="text-xs text-slate-300 font-semibold">Nenhum morador cadastrado neste apartamento</p>
                    <p className="text-[11px] text-slate-500">
                      Cadastre o morador abaixo para habilitar o envio automático de avisos de encomendas via WhatsApp.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {unitResidents.map((r) => (
                      <div
                        key={r.id}
                        onClick={() => {
                          setSelectedResidentProfile(r);
                          setProfilePackageFilter('ALL');
                          setProfilePackageSearch('');
                        }}
                        className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800/80 hover:border-indigo-500/50 hover:bg-slate-900/80 transition flex items-center justify-between gap-3 cursor-pointer group"
                        title={`Clique para ver o perfil completo e encomendas de ${r.name}`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center text-indigo-400 font-bold text-xs shrink-0 group-hover:border-indigo-500/50 transition">
                            {r.name ? r.name.substring(0, 2).toUpperCase() : <Users size={16} />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-slate-100 group-hover:text-indigo-300 transition truncate">{r.name}</span>
                              {r.is_primary && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-md">
                                  Titular
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                              <span className="flex items-center gap-1 font-mono text-emerald-400 font-semibold">
                                <Phone size={11} /> {r.phone}
                              </span>
                              {r.email && (
                                <span className="flex items-center gap-1 text-slate-500 truncate">
                                  <Mail size={11} /> {r.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedResidentProfile(r);
                              setProfilePackageFilter('ALL');
                              setProfilePackageSearch('');
                            }}
                            className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition"
                            title="Ver Perfil e Encomendas"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditResidentModal(r)}
                            className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition"
                            title="Editar Morador"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteResident(r.id, r.name)}
                            className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-xl transition shrink-0"
                            title="Excluir Morador"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Formulário Inline para Adicionar Morador */}
                {isUnitAddResidentOpen ? (
                  <form onSubmit={handleAddResidentToUnit} className="bg-slate-950 p-4 rounded-2xl border border-indigo-500/30 space-y-3.5 text-xs animate-fade-in">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                      <span className="font-bold text-slate-100 flex items-center gap-1.5">
                        <UserPlus size={14} className="text-indigo-400" />
                        Novo Morador ({selectedUnitModal.block} - Apto {selectedUnitModal.unit_number})
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsUnitAddResidentOpen(false)}
                        className="text-slate-500 hover:text-slate-300 text-[11px]"
                      >
                        Cancelar
                      </button>
                    </div>

                    {unitResError && (
                      <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-xl text-[11px] flex items-center gap-2">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>{unitResError}</span>
                      </div>
                    )}

                    <div>
                      <label className="block text-slate-300 font-semibold mb-1">Nome Completo *</label>
                      <input
                        type="text"
                        required
                        value={unitResName}
                        onChange={(e) => setUnitResName(e.target.value)}
                        placeholder="Ex: Carlos Eduardo"
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">WhatsApp *</label>
                        <input
                          type="text"
                          required
                          value={unitResPhone}
                          onChange={(e) => setUnitResPhone(e.target.value)}
                          placeholder="Ex: 73981953741"
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-300 font-semibold mb-1">E-mail (opcional)</label>
                        <input
                          type="email"
                          value={unitResEmail}
                          onChange={(e) => setUnitResEmail(e.target.value)}
                          placeholder="morador@email.com"
                          className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-100 text-xs focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsUnitAddResidentOpen(false)}
                        className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
                      >
                        Fechar
                      </button>
                      <button
                        type="submit"
                        disabled={unitResLoading}
                        className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition flex items-center justify-center gap-1.5 disabled:opacity-50 shadow-md"
                      >
                        {unitResLoading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                        {unitResLoading ? 'Salvando...' : 'Salvar Morador'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsUnitAddResidentOpen(true);
                      setUnitResError(null);
                    }}
                    className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-indigo-950 active:scale-98"
                  >
                    <UserPlus size={15} /> Adicionar Morador neste Apartamento
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal de Perfil Completo do Morador */}
      {selectedResidentProfile && (() => {
        const activeProfile = residents.find((r) => r.id === selectedResidentProfile.id) || selectedResidentProfile;

        // Encomendas vinculadas ao morador (por resident_id OU pela unidade)
        const profilePackages = packages.filter((p) => {
          if (p.resident_id && p.resident_id === activeProfile.id) return true;
          if (activeProfile.unit_id && p.unit_id === activeProfile.unit_id) return true;
          if (
            activeProfile.unit &&
            p.unit &&
            (p.unit.block || 'Bloco A').toUpperCase() === (activeProfile.unit.block || 'Bloco A').toUpperCase() &&
            p.unit.unit_number === activeProfile.unit.unit_number
          ) {
            return true;
          }
          return false;
        });

        const pendingPkgs = profilePackages.filter((p) => p.status === 'RECEIVED' || p.status === 'NOTIFIED');
        const deliveredPkgs = profilePackages.filter((p) => p.status === 'DELIVERED');
        const returnedPkgs = profilePackages.filter((p) => p.status === 'RETURNED');

        const filteredProfilePkgs = profilePackages.filter((p) => {
          if (profilePackageFilter === 'PENDING' && p.status !== 'RECEIVED' && p.status !== 'NOTIFIED') return false;
          if (profilePackageFilter === 'DELIVERED' && p.status !== 'DELIVERED') return false;
          if (profilePackageFilter === 'RETURNED' && p.status !== 'RETURNED') return false;

          if (profilePackageSearch.trim()) {
            const q = profilePackageSearch.toLowerCase();
            const carrierMatch = p.carrier?.toLowerCase().includes(q);
            const codeMatch = p.pickup_code?.toLowerCase().includes(q);
            const trackMatch = p.tracking_code?.toLowerCase().includes(q);
            const notesMatch = p.notes?.toLowerCase().includes(q);
            const recipientMatch = p.recipient_name_ocr?.toLowerCase().includes(q);
            return carrierMatch || codeMatch || trackMatch || notesMatch || recipientMatch;
          }
          return true;
        });

        const rawPhone = activeProfile.phone || '';
        let cleanPhone = rawPhone.replace(/\D/g, '');
        if (cleanPhone && !cleanPhone.startsWith('55') && cleanPhone.length >= 10) {
          cleanPhone = `55${cleanPhone}`;
        }
        const waUrl = cleanPhone ? `https://wa.me/${cleanPhone}` : null;

        const otherResidents = residents.filter(
          (r) => r.unit_id === activeProfile.unit_id && r.id !== activeProfile.id
        );

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-3 sm:p-6 animate-fade-in">
            <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
              {/* Header do Perfil */}
              <div className="p-5 sm:p-6 border-b border-slate-800 bg-slate-950/60 flex items-start sm:items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/30 to-purple-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-black text-xl shadow-inner shrink-0">
                    {activeProfile.name ? activeProfile.name.substring(0, 2).toUpperCase() : <Users size={24} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight truncate">
                        {activeProfile.name}
                      </h2>
                      {activeProfile.is_primary ? (
                        <span className="text-[11px] font-bold px-2.5 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-full shadow-sm">
                          Titular
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded-full">
                          Dependente
                        </span>
                      )}
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
                        Ativo
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 flex-wrap">
                      <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                        <Building2 size={13} className="text-indigo-400" />
                        {activeProfile.unit ? `${activeProfile.unit.block} - Apto ${activeProfile.unit.unit_number}` : 'Sem Unidade'}
                      </span>
                      <span className="text-slate-600">•</span>
                      <span>ID: <span className="font-mono text-slate-400">{activeProfile.id.slice(0, 8)}</span></span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenEditResidentModal(activeProfile)}
                    className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-950/50 active:scale-95 cursor-pointer"
                    title="Editar dados cadastrais deste morador"
                  >
                    <Pencil size={13} />
                    <span>Editar Cadastro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedResidentProfile(null)}
                    className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition cursor-pointer"
                    title="Fechar perfil"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Corpo do Perfil (Scrollable) */}
              <div className="overflow-y-auto p-5 sm:p-6 space-y-6 flex-1">
                {/* Card de Informações do Morador e Contatos */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Contato Principal: WhatsApp & Telefone */}
                  <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <MessageSquare size={14} className="text-emerald-400" /> WhatsApp / Celular
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeProfile.phone) {
                            navigator.clipboard.writeText(activeProfile.phone);
                            setCopiedPhone(true);
                            setTimeout(() => setCopiedPhone(false), 2000);
                          }
                        }}
                        className="text-[11px] font-semibold text-slate-400 hover:text-indigo-400 transition flex items-center gap-1 cursor-pointer"
                        title="Copiar telefone"
                      >
                        {copiedPhone ? (
                          <>
                            <Check size={12} className="text-emerald-400" />
                            <span className="text-emerald-400">Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="font-mono text-lg font-bold text-emerald-400">
                      {activeProfile.phone || 'Sem telefone'}
                    </div>

                    {waUrl && (
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2 px-3 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-sm"
                      >
                        <MessageSquare size={14} className="text-emerald-400" />
                        <span>Conversar no WhatsApp</span>
                        <ExternalLink size={12} className="opacity-70" />
                      </a>
                    )}
                  </div>

                  {/* E-mail e Notificações */}
                  <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 sm:p-5 space-y-3">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Mail size={14} className="text-indigo-400" /> E-mail
                    </span>

                    <div className="text-sm font-semibold text-slate-200 truncate">
                      {activeProfile.email || 'Não cadastrado'}
                    </div>

                    {activeProfile.email ? (
                      <a
                        href={`mailto:${activeProfile.email}`}
                        className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2"
                      >
                        <Mail size={14} />
                        <span>Enviar E-mail</span>
                      </a>
                    ) : (
                      <div className="text-[11px] text-slate-500 italic py-1">
                        E-mail opcional para avisos e comprovantes.
                      </div>
                    )}
                  </div>

                  {/* Status e Permissões */}
                  <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 sm:p-5 space-y-3">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <ShieldCheck size={14} className="text-sky-400" /> Permissões & Retirada
                    </span>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="text-slate-200 font-semibold">Receptor Autorizado</span>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Autorizado a retirar encomendas do condomínio vinculadas a esta unidade.
                      </p>
                    </div>

                    <div className="sm:hidden pt-1">
                      <button
                        type="button"
                        onClick={() => handleOpenEditResidentModal(activeProfile)}
                        className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5"
                      >
                        <Pencil size={13} />
                        <span>Editar Cadastro</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Outros Moradores da Mesma Unidade (se houver) */}
                {otherResidents.length > 0 && (
                  <div className="bg-slate-950/40 border border-slate-800/80 rounded-2xl p-3.5 sm:p-4">
                    <div className="flex items-center gap-2 mb-2.5">
                      <Users size={14} className="text-indigo-400" />
                      <span className="text-xs font-bold text-slate-300">
                        Outros moradores deste apartamento ({otherResidents.length}):
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {otherResidents.map((other) => (
                        <button
                          key={other.id}
                          type="button"
                          onClick={() => {
                            setSelectedResidentProfile(other);
                            setProfilePackageFilter('ALL');
                            setProfilePackageSearch('');
                          }}
                          className="flex items-center gap-2 px-3 py-1.5 bg-slate-900 hover:bg-indigo-950/50 border border-slate-800 hover:border-indigo-500/40 rounded-xl text-xs text-slate-300 transition group cursor-pointer"
                          title={`Ver perfil de ${other.name}`}
                        >
                          <div className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold flex items-center justify-center">
                            {other.name ? other.name.substring(0, 1).toUpperCase() : '?'}
                          </div>
                          <span className="group-hover:text-indigo-300 font-semibold">{other.name}</span>
                          {other.is_primary && (
                            <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1 py-0.2 rounded font-bold">
                              Titular
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Métricas / Estatísticas de Encomendas do Morador */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                      <Package size={16} className="text-indigo-400" />
                      Histórico de Encomendas ({profilePackages.length})
                    </h3>
                    <span className="text-xs text-slate-500">
                      Vinculadas a este morador e ao apartamento
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {/* Todas */}
                    <button
                      type="button"
                      onClick={() => setProfilePackageFilter('ALL')}
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                        profilePackageFilter === 'ALL'
                          ? 'bg-sky-950/40 border-sky-500/60 ring-2 ring-sky-500/20'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-slate-400 block">Total</span>
                      <span className="text-2xl font-black text-sky-400 mt-0.5 block">{profilePackages.length}</span>
                      <span className="text-[10px] text-slate-500">Registradas</span>
                    </button>

                    {/* Aguardando Retirada */}
                    <button
                      type="button"
                      onClick={() => setProfilePackageFilter('PENDING')}
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                        profilePackageFilter === 'PENDING'
                          ? 'bg-amber-950/40 border-amber-500/60 ring-2 ring-amber-500/20'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-slate-400 block">Aguardando</span>
                      <span className="text-2xl font-black text-amber-400 mt-0.5 block">{pendingPkgs.length}</span>
                      <span className="text-[10px] text-slate-500">Na portaria</span>
                    </button>

                    {/* Entregues */}
                    <button
                      type="button"
                      onClick={() => setProfilePackageFilter('DELIVERED')}
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                        profilePackageFilter === 'DELIVERED'
                          ? 'bg-emerald-950/40 border-emerald-500/60 ring-2 ring-emerald-500/20'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-slate-400 block">Entregues</span>
                      <span className="text-2xl font-black text-emerald-400 mt-0.5 block">{deliveredPkgs.length}</span>
                      <span className="text-[10px] text-slate-500">Com comprovante</span>
                    </button>

                    {/* Devolvidas */}
                    <button
                      type="button"
                      onClick={() => setProfilePackageFilter('RETURNED')}
                      className={`p-3.5 rounded-2xl border text-left transition cursor-pointer ${
                        profilePackageFilter === 'RETURNED'
                          ? 'bg-rose-950/40 border-rose-500/60 ring-2 ring-rose-500/20'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <span className="text-[11px] font-semibold text-slate-400 block">Devolvidas</span>
                      <span className="text-2xl font-black text-rose-400 mt-0.5 block">{returnedPkgs.length}</span>
                      <span className="text-[10px] text-slate-500">Canceladas/Devolvidas</span>
                    </button>
                  </div>
                </div>

                {/* Filtros e Busca de Encomendas */}
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                    {/* Barra de Filtros rápidos */}
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                      <button
                        type="button"
                        onClick={() => setProfilePackageFilter('ALL')}
                        className={`px-3 py-1.5 rounded-xl font-semibold transition cursor-pointer ${
                          profilePackageFilter === 'ALL'
                            ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Todas ({profilePackages.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setProfilePackageFilter('PENDING')}
                        className={`px-3 py-1.5 rounded-xl font-semibold transition cursor-pointer ${
                          profilePackageFilter === 'PENDING'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Pendentes ({pendingPkgs.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setProfilePackageFilter('DELIVERED')}
                        className={`px-3 py-1.5 rounded-xl font-semibold transition cursor-pointer ${
                          profilePackageFilter === 'DELIVERED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Entregues ({deliveredPkgs.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setProfilePackageFilter('RETURNED')}
                        className={`px-3 py-1.5 rounded-xl font-semibold transition cursor-pointer ${
                          profilePackageFilter === 'RETURNED'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Devolvidas ({returnedPkgs.length})
                      </button>
                    </div>

                    {/* Campo de Busca */}
                    <div className="relative min-w-[220px]">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={profilePackageSearch}
                        onChange={(e) => setProfilePackageSearch(e.target.value)}
                        placeholder="Buscar por código, rastreio..."
                        className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Listagem das Encomendas */}
                  {filteredProfilePkgs.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredProfilePkgs.map((pkg) => (
                        <PackageCard
                          key={pkg.id}
                          pkg={pkg}
                          onPackageUpdated={loadData}
                          showActions={true}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12 border border-dashed border-slate-800/80 rounded-3xl bg-slate-950/40 space-y-2">
                      <Package className="w-10 h-10 text-slate-600 mx-auto" />
                      <p className="text-sm font-bold text-slate-300">Nenhuma encomenda encontrada</p>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        {profilePackageSearch || profilePackageFilter !== 'ALL'
                          ? 'Tente ajustar os filtros ou a busca de encomendas.'
                          : 'Ainda não há encomendas registradas na portaria para este morador ou apartamento.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Rodapé de Ações */}
              <div className="p-4 sm:p-5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Deseja realmente remover o morador ${activeProfile.name}?`)) {
                      handleDeleteResident(activeProfile.id, activeProfile.name);
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition cursor-pointer"
                >
                  <Trash2 size={14} />
                  <span>Excluir Morador</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenEditResidentModal(activeProfile)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-indigo-950 active:scale-95 cursor-pointer"
                  >
                    <Pencil size={13} />
                    <span>Editar Cadastro</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedResidentProfile(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal de Cadastro Individual de Morador */}
      {isAddResidentModalOpen && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsAddResidentModalOpen(false);
              setEditingResident(null);
            }
          }}
        >
          <div 
            className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-5 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-500/15 border border-indigo-500/30 rounded-xl text-indigo-400">
                  {editingResident ? <Pencil className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {editingResident ? 'Editar Morador' : 'Cadastrar Novo Morador'}
                  </h3>
                  {editingResident && (
                    <p className="text-[11px] text-slate-400">
                      Alterando cadastro de <span className="text-indigo-300 font-semibold">{editingResident.name}</span>
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAddResidentModalOpen(false);
                  setEditingResident(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition cursor-pointer"
                title="Fechar janela"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddResident} className="space-y-4 text-xs">
              <div>
                <label htmlFor="res-name" className="block text-slate-300 font-semibold mb-1 cursor-pointer">
                  Nome Completo *
                </label>
                <input
                  ref={residentNameInputRef}
                  id="res-name"
                  type="text"
                  required
                  autoFocus
                  autoComplete="name"
                  value={newResName}
                  onChange={(e) => setNewResName(e.target.value)}
                  placeholder="Ex: Carlos Eduardo da Silva"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition select-text"
                />
              </div>

              {/* Bloco e Apartamento Separados */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="res-block" className="block text-slate-300 font-semibold mb-1 cursor-pointer">
                    Bloco / Torre *
                  </label>
                  <select
                    id="res-block"
                    required
                    value={newResBlock}
                    onChange={(e) => {
                      setNewResBlock(e.target.value);
                      setNewResUnitNumber('');
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 cursor-pointer transition"
                  >
                    {Array.from(new Set(units.map((u) => u.block || 'Bloco A'))).sort().map((blockName) => (
                      <option key={blockName} value={blockName}>
                        {blockName}
                      </option>
                    ))}
                    {newResBlock && !units.some((u) => u.block === newResBlock) && (
                      <option value={newResBlock}>{newResBlock}</option>
                    )}
                  </select>
                </div>

                <div className="relative" ref={unitDropdownRef}>
                  <label htmlFor="res-unit" className="block text-slate-300 font-semibold mb-1 cursor-pointer">
                    Apartamento *
                  </label>
                  <div className="relative">
                    <input
                      id="res-unit"
                      type="text"
                      required
                      autoComplete="off"
                      value={newResUnitNumber}
                      onFocus={() => setIsUnitDropdownOpen(true)}
                      onChange={(e) => {
                        setNewResUnitNumber(e.target.value);
                        setIsUnitDropdownOpen(true);
                      }}
                      placeholder="Digite ou selecione o apto..."
                      className="w-full pl-3.5 pr-9 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 font-bold transition select-text"
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setIsUnitDropdownOpen((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1 rounded-md transition cursor-pointer"
                      title="Ver todos os apartamentos"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${isUnitDropdownOpen ? 'rotate-180 text-indigo-400' : ''}`} />
                    </button>
                  </div>

                  {/* Dropdown com filtragem em tempo real ao digitar (SEM OVERLAY BLOQUEANTE) */}
                  {isUnitDropdownOpen && (
                    <div className="absolute z-30 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-slate-900 border border-slate-700/90 rounded-xl shadow-2xl py-1 text-slate-100 divide-y divide-slate-800/60 animate-fade-in">
                      {Array.from(
                        new Set(
                          units
                            .filter((u) => (u.block || 'Bloco A').toUpperCase() === (newResBlock || 'Bloco A').toUpperCase())
                            .map((u) => u.unit_number)
                        )
                      )
                        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                        .filter((num) => num.toLowerCase().includes((newResUnitNumber || '').trim().toLowerCase()))
                        .map((num) => (
                          <button
                            key={num}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setNewResUnitNumber(num);
                              setIsUnitDropdownOpen(false);
                            }}
                            className={`w-full text-left px-3.5 py-2 text-xs font-bold transition flex items-center justify-between cursor-pointer ${
                              newResUnitNumber === num
                                ? 'bg-indigo-600/30 text-indigo-300'
                                : 'hover:bg-slate-800 text-slate-200'
                            }`}
                          >
                            <span>Apto {num}</span>
                            {newResUnitNumber === num && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                          </button>
                        ))}

                      {Array.from(
                        new Set(
                          units
                            .filter((u) => (u.block || 'Bloco A').toUpperCase() === (newResBlock || 'Bloco A').toUpperCase())
                            .map((u) => u.unit_number)
                        )
                      ).filter((num) => num.toLowerCase().includes((newResUnitNumber || '').trim().toLowerCase())).length === 0 && (
                        <div className="px-3.5 py-2.5 text-xs text-slate-400 text-center">
                          {newResUnitNumber.trim() ? (
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setIsUnitDropdownOpen(false);
                              }}
                              className="text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer"
                            >
                              Usar &quot;Apto {newResUnitNumber}&quot; (Criará unidade)
                            </button>
                          ) : (
                            'Nenhum apartamento cadastrado neste bloco'
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label htmlFor="res-phone" className="block text-slate-300 font-semibold mb-1 cursor-pointer">
                  WhatsApp para Notificações *
                </label>
                <input
                  id="res-phone"
                  type="text"
                  required
                  autoComplete="tel"
                  value={newResPhone}
                  onChange={(e) => setNewResPhone(e.target.value)}
                  placeholder="Ex: 11988887777 ou 73981953741"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 font-mono transition select-text"
                />
              </div>

              <div>
                <label htmlFor="res-email" className="block text-slate-300 font-semibold mb-1 cursor-pointer">
                  E-mail (Opcional)
                </label>
                <input
                  id="res-email"
                  type="email"
                  autoComplete="email"
                  value={newResEmail}
                  onChange={(e) => setNewResEmail(e.target.value)}
                  placeholder="morador@exemplo.com"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition select-text"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddResidentModalOpen(false);
                    setEditingResident(null);
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition shadow-lg shadow-indigo-950 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {editingResident ? (
                    <>
                      <Check className="w-4 h-4" /> Salvar Alterações
                    </>
                  ) : (
                    'Salvar Morador'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Importação de Moradores em Lote */}
      <BatchResidentImportModal
        isOpen={isBatchImportModalOpen}
        onClose={() => setIsBatchImportModalOpen(false)}
        onSuccess={() => {
          setIsBatchImportModalOpen(false);
          loadData();
        }}
      />
    </div>
  );
}
