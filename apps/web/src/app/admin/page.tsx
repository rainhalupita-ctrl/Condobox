'use client';

import React, { useState, useEffect } from 'react';
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
  X
} from 'lucide-react';
import { BatchResidentImportModal } from '../../components/batch-resident-import-modal';
import { VoiceService } from '../../lib/voice';

export default function AdminPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [packages, setPackages] = useState<PackageType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'METRICS' | 'RESIDENTS' | 'UNITS' | 'STAFF' | 'SYSTEM' | 'AUTOMATIONS'>('METRICS');

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
  const [batchFloors, setBatchFloors] = useState(8);
  const [batchStartUnit, setBatchStartUnit] = useState(0);
  const [batchEndUnit, setBatchEndUnit] = useState(7);
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
  const [staffRole, setStaffRole] = useState<'GUARD' | 'SYNDIC'>('GUARD');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffSuccess, setStaffSuccess] = useState('');
  const [staffError, setStaffError] = useState('');
  const [staffList, setStaffList] = useState<any[]>([]);
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

  // Formulário de novo morador e importação em lote
  const [isAddResidentModalOpen, setIsAddResidentModalOpen] = useState(false);
  const [isBatchImportModalOpen, setIsBatchImportModalOpen] = useState(false);
  const [residentSearchQuery, setResidentSearchQuery] = useState('');
  const [newResName, setNewResName] = useState('');
  const [newResPhone, setNewResPhone] = useState('');
  const [newResEmail, setNewResEmail] = useState('');
  const [newResBlock, setNewResBlock] = useState('Bloco A');
  const [newResUnitNumber, setNewResUnitNumber] = useState('');

  useEffect(() => {
    loadData();
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
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [activeTab, whatsappQrCode]);

  const loadData = async () => {
    setLoading(true);
    const supabase = createClient();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/login?redirect=/admin';
        return;
      }

      const health = await LocalApiClient.checkHealth();
      setHealthStatus(health);

      const wa = await LocalApiClient.getWhatsAppStatus();
      setWhatsappState(wa);

      const { data: uData } = await supabase.from('units').select('*').order('block').order('unit_number');
      const { data: rData } = await supabase.from('residents').select('*, unit:units(*)').order('name');
      const { data: pData } = await supabase.from('packages').select('*, unit:units(*), resident:residents(*)');
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
      }
      if (rData) setResidents(rData);
      if (pData) setPackages(pData);
    } catch (err) {
      console.error('Erro ao carregar dados do admin:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectWhatsApp = async () => {
    setWhatsappLoading(true);
    setWhatsappQrCode(null);
    setWhatsappPairingCode(null);
    setWhatsappError(null);
    try {
      const res = await LocalApiClient.connectWhatsApp();
      if (res?.qrcode) {
        setWhatsappQrCode(res.qrcode);
      } else if (res?.pairingCode) {
        setWhatsappPairingCode(res.pairingCode);
      } else if (res?.connected) {
        // Já está conectado
      } else if (res?.error && !res?.qrcode) {
        // Tenta checar status imediatamente antes de reportar erro
        const fallbackSt = await LocalApiClient.getWhatsAppStatus();
        if (fallbackSt?.qrcode) {
          setWhatsappQrCode(fallbackSt.qrcode);
          setWhatsappState(fallbackSt);
          return;
        }
        setWhatsappError(res.error);
      }

      const st = await LocalApiClient.getWhatsAppStatus();
      setWhatsappState(st);
      if (st?.qrcode && !res?.qrcode) {
        setWhatsappQrCode(st.qrcode);
      }
    } catch (err: any) {
      console.error('Erro ao conectar WhatsApp:', err);
      // Tenta fallback rápido de status
      try {
        const st = await LocalApiClient.getWhatsAppStatus();
        setWhatsappState(st);
        if (st?.qrcode) {
          setWhatsappQrCode(st.qrcode);
          return;
        }
      } catch {}
      setWhatsappError('Motor do WhatsApp em inicialização. Aguarde 2 segundos e tente novamente.');
    } finally {
      setWhatsappLoading(false);
    }
  };

  const handleLogoutWhatsApp = async () => {
    if (!confirm('Deseja realmente desconectar e deslogar o WhatsApp da Portaria? Será necessário escanear o QR Code novamente.')) {
      return;
    }
    setWhatsappLoading(true);
    setWhatsappQrCode(null);
    setWhatsappPairingCode(null);
    setWhatsappError(null);
    try {
      const res = await LocalApiClient.logoutWhatsApp();
      const st = await LocalApiClient.getWhatsAppStatus();
      setWhatsappState(st);
      alert(res?.message || 'Sessão do WhatsApp desconectada com sucesso!');
    } catch (err: any) {
      console.error('Erro ao desconectar WhatsApp:', err);
      setWhatsappError('Erro ao desconectar WhatsApp.');
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
    const supabase = createClient();
    const { data } = await supabase
      .from('profiles')
      .select('id, name, phone, role')
      .in('role', ['GUARD', 'SYNDIC', 'ADMIN'])
      .order('role');
    if (data) setStaffList(data);
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
    const supabase = createClient();

    // Criar via Auth (anon key só pode se email confirmation estiver desligado no Supabase)
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: staffEmail,
      password: staffPassword,
      options: {
        data: { name: staffName, phone: staffPhone.replace(/\D/g, ''), role: staffRole },
      },
    });

    if (authError || !authData.user) {
      setStaffError(authError?.message || 'Erro ao criar conta. Tente novamente.');
      setStaffLoading(false);
      return;
    }

    // Atualizar role no profile (o trigger cria com RESIDENT por padrão, atualizamos)
    await supabase
      .from('profiles')
      .update({ role: staffRole })
      .eq('id', authData.user.id);

    setStaffSuccess(`Conta de ${staffRole === 'GUARD' ? 'Porteiro' : 'Síndico'} criada para ${staffName}!`);
    setStaffName('');
    setStaffEmail('');
    setStaffPhone('');
    setStaffPassword('');
    setStaffLoading(false);
    loadStaff();
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
      setBatchError('Configure os parâmetros corretamente.');
      return;
    }

    setBatchLoading(true);
    const supabase = createClient();

    const unitsToInsert: { block: string; unit_number: string }[] = [];
    for (let floor = 1; floor <= batchFloors; floor++) {
      for (let apt = batchStartUnit; apt <= batchEndUnit; apt++) {
        const unitNum = `${floor * 100 + apt}`;
        unitsToInsert.push({
          block: batchBlock.trim(),
          unit_number: unitNum,
        });
      }
    }

    try {
      const { data, error } = await supabase
        .from('units')
        .upsert(unitsToInsert, { onConflict: 'condo_id,block,unit_number', ignoreDuplicates: true })
        .select();

      if (error) {
        setBatchError(`Erro ao gerar unidades: ${error.message}`);
      } else {
        setBatchSuccess(`${unitsToInsert.length} unidades criadas/atualizadas com sucesso para o ${batchBlock.trim()}!`);
        loadData();
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

    setSingleLoading(true);
    const supabase = createClient();
    const { error } = await supabase.from('units').insert({
      block: singleBlock.trim(),
      unit_number: singleUnitNumber.trim(),
    });

    if (error) {
      alert(`Erro ao adicionar unidade: ${error.message}`);
    } else {
      setSingleUnitNumber('');
      loadData();
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
      loadData();
    }
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
          .insert({ block, unit_number: unitNum })
          .select()
          .single();

        if (uErr) {
          alert(`Erro ao criar unidade: ${uErr.message}`);
          return;
        }
        unit = newUnit;
      }

      if (!unit) {
        alert('Falha ao vincular unidade.');
        return;
      }

      // 3. Cadastra o morador
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
      setNewResName('');
      setNewResPhone('');
      setNewResEmail('');
      setNewResUnitNumber('');
      loadData();
    } catch (err: any) {
      alert(`Erro: ${err.message}`);
    }
  };

  const pendingCount = packages.filter(p => p.status !== 'DELIVERED').length;
  const deliveredCount = packages.filter(p => p.status === 'DELIVERED').length;
  const totalCount = packages.length;

  return (
    <div className="space-y-6">
      {/* Header do Painel */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">Administração Geral</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-100 mt-1">Painel do Síndico</h1>
        </div>

        <div className="flex flex-wrap items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('METRICS')}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold transition ${
              activeTab === 'METRICS'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4 h-4" /> Métricas
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
            <Cpu className="w-4 h-4" /> Automações & JS/Python
          </button>
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

      {/* ABA 1: MÉTRICAS E INDICADORES */}
      {activeTab === 'METRICS' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Aguardando Retirada</span>
                <span className="text-3xl font-black text-amber-400 mt-1 block">{pendingCount}</span>
                <span className="text-[11px] text-slate-500">Na portaria agora</span>
              </div>
              <div className="p-3 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
                <Clock className="w-6 h-6" />
              </div>
            </div>

            {/* Card 2 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Entregues com Sucesso</span>
                <span className="text-3xl font-black text-emerald-400 mt-1 block">{deliveredCount}</span>
                <span className="text-[11px] text-slate-500">Com assinatura</span>
              </div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-2xl border border-emerald-500/20">
                <CheckCircle2 className="w-6 h-6" />
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Total de Encomendas</span>
                <span className="text-3xl font-black text-sky-400 mt-1 block">{totalCount}</span>
                <span className="text-[11px] text-slate-500">Histórico registrado</span>
              </div>
              <div className="p-3 bg-sky-500/10 text-sky-400 rounded-2xl border border-sky-500/20">
                <Package className="w-6 h-6" />
              </div>
            </div>

            {/* Card 4 */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-slate-400 block">Moradores Ativos</span>
                <span className="text-3xl font-black text-indigo-400 mt-1 block">{residents.length}</span>
                <span className="text-[11px] text-slate-500">Em {units.length} unidades</span>
              </div>
              <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-2xl border border-indigo-500/20">
                <Users className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Relatório de Retenção e Armazenamento */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-400" />
              Estatísticas do Armazenamento Local da Portaria
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-slate-500 block">Política de Retenção:</span>
                <span className="text-slate-200 font-bold text-sm">90 Dias (Automático)</span>
                <p className="text-[11px] text-slate-500 mt-1">Fotos de etiquetas antigas são excluídas pelo cron local.</p>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-slate-500 block">Assinaturas Digitais:</span>
                <span className="text-emerald-400 font-bold text-sm">Retenção Permanente</span>
                <p className="text-[11px] text-slate-500 mt-1">Garantia jurídica e segurança para o condomínio.</p>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-slate-500 block">Custo de Servidor/Nuvem:</span>
                <span className="text-emerald-400 font-bold text-sm">$0.00 / mês</span>
                <p className="text-[11px] text-slate-500 mt-1">Tudo roda no PC local + Free Tier do Supabase.</p>
              </div>
            </div>
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

              {/* Filtro por Bloco */}
              <div className="flex items-center gap-1.5 flex-wrap">
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
                        <span className="text-xs text-slate-500 font-medium">
                          {blockUnits.length} apartamentos
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2">
                        {blockUnits.map(u => (
                          <div
                            key={u.id}
                            className="group relative bg-slate-900 hover:bg-slate-800/90 border border-slate-800 hover:border-indigo-500/40 rounded-xl p-2.5 text-center transition flex flex-col items-center justify-between gap-1"
                          >
                            <span className="font-mono font-bold text-xs text-slate-200">{u.unit_number}</span>
                            <button
                              onClick={() => handleDeleteUnit(u.id, `${u.block} - Apto ${u.unit_number}`)}
                              className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-300 transition"
                              title="Excluir unidade"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
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
                onClick={() => setIsBatchImportModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950 transition active:scale-95 whitespace-nowrap"
                title="Importar moradores em lote via Planilha Excel ou Lista"
              >
                <FileSpreadsheet className="w-4 h-4" /> Importar
              </button>

              <button
                type="button"
                onClick={() => setIsAddResidentModalOpen(true)}
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
                      <tr key={r.id} className="hover:bg-slate-800/40 transition">
                        <td className="p-4 font-semibold text-slate-100">
                          {r.name} {r.is_primary && <span className="text-[10px] text-indigo-400 ml-1">(Titular)</span>}
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
                        <td className="p-4 text-right">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(`Deseja remover o morador ${r.name}?`)) return;
                              const supabase = createClient();
                              await supabase.from('residents').delete().eq('id', r.id);
                              loadData();
                            }}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                            title="Excluir Morador"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
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
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-400" />
              Status dos Serviços da Arquitetura
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Local API (Porta 3001)</span>
                  <span className="text-emerald-400 font-semibold">Online</span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Executando no PC da portaria, cuidando do OCR Gemini, uploads em disco e servidor estático.
                </p>
              </div>

              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Motor WhatsApp Nativo (Baileys All-in-One)</span>
                  <span className={whatsappState.connected ? 'text-emerald-400 font-semibold flex items-center gap-1' : 'text-amber-400 font-semibold flex items-center gap-1'}>
                    <span className={`w-2 h-2 rounded-full ${whatsappState.connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`}></span>
                    {whatsappState.connected ? 'WhatsApp Conectado' : 'Pronto para Pareamento'}
                  </span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Motor Baileys 100% integrado ao aplicativo. Zero Docker, zero containers e custo R$0.
                </p>
              </div>

              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Banco Supabase (PostgreSQL)</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    Sincronizado
                  </span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Tabelas com Row Level Security (RLS) e Realtime para atualização instantânea dos dashboards.
                </p>
              </div>

              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">Google Gemini Vision OCR</span>
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    Ativo (Gemini 3.5)
                  </span>
                </div>
                <p className="text-slate-400 text-[11px]">
                  Visão computacional processando etiquetas em alta velocidade ($0 de custo).
                </p>
              </div>
            </div>

            {/* PAINEL DE PAREAMENTO DO WHATSAPP */}
            <div className="mt-6 pt-6 border-t border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <MessageSquare size={16} className="text-emerald-400" />
                    Conexão do WhatsApp da Portaria
                  </h4>
                  <p className="text-slate-400 text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>Instância: <code className="text-emerald-300 font-mono">portaria</code></span>
                    <span>|</span>
                    <span>Status: <span className={whatsappState.connected ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>{whatsappState.connected ? '● CONECTADO' : '○ DESCONECTADO'}</span></span>
                    {whatsappState.phone && (
                      <span className="text-slate-300 font-mono text-[11px] bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-md">
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

              {/* Caixa Informativa do Motor Nativo */}
              <div className="bg-slate-950/60 border border-emerald-500/20 rounded-2xl p-4 text-[11px] text-slate-400 space-y-2">
                <p className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Sparkles size={14} className="text-emerald-400" />
                  Conexão Nativa Direta (Sem Docker):
                </p>
                <p className="text-slate-300 text-xs leading-relaxed">
                  O CondoBox utiliza o motor <strong>Baileys Nativo</strong> 100% embutido. Não requer Docker Desktop nem configurações complexas. Basta clicar em <strong>"Gerar QR Code de Conexão"</strong> e apontar a câmera do WhatsApp para autenticar o computador da portaria.
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStaffRole('GUARD')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                      staffRole === 'GUARD'
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    🛡️ Porteiro
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffRole('SYNDIC')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                      staffRole === 'SYNDIC'
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
                    }`}
                  >
                    👑 Síndico
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
                  placeholder="Senha que você vai informar ao porteiro"
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
                } ${staffRole === 'SYNDIC' ? 'bg-purple-600' : 'bg-blue-600'}`}
              >
                {staffLoading ? <Loader2 size={16} className="animate-spin" /> : <UserPlus size={16} />}
                {staffLoading ? 'Criando conta...' : `Criar conta de ${staffRole === 'GUARD' ? 'Porteiro' : 'Síndico'}`}
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
                    <span className={`text-xs px-2.5 py-1 rounded-lg font-bold ${
                      member.role === 'ADMIN' ? 'bg-red-500/20 text-red-400' :
                      member.role === 'SYNDIC' ? 'bg-purple-500/20 text-purple-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>
                      {member.role === 'ADMIN' ? 'Admin' : member.role === 'SYNDIC' ? 'Síndico' : 'Porteiro'}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
                      VoiceService.playSuccessBeep();
                      VoiceService.speak('Alertas de voz ativados no CondoBox');
                    }
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    voiceActive ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-slate-800 text-slate-400'
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
                    VoiceService.playSuccessBeep();
                    VoiceService.speak('Teste do sistema de voz: Encomenda registrada para o Bloco A, Apartamento 805.');
                  }}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
                >
                  🔊 Testar Fala de Cadastro
                </button>
                <button
                  type="button"
                  onClick={() => {
                    VoiceService.playSuccessBeep();
                    VoiceService.speak('Entrega concluída com sucesso para o morador.');
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
          </div>
        </div>
      )}

      {/* Modal de Cadastro Individual de Morador */}
      {isAddResidentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-500/15 border border-indigo-500/30 rounded-xl text-indigo-400">
                  <UserPlus className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-white">Cadastrar Novo Morador</h3>
              </div>
              <button
                onClick={() => setIsAddResidentModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddResident} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  value={newResName}
                  onChange={(e) => setNewResName(e.target.value)}
                  placeholder="Ex: Carlos Eduardo da Silva"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Bloco e Apartamento Separados */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Bloco / Torre *</label>
                  <select
                    required
                    value={newResBlock}
                    onChange={(e) => {
                      setNewResBlock(e.target.value);
                      setNewResUnitNumber('');
                    }}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
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

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Apartamento *</label>
                  <select
                    required
                    value={newResUnitNumber}
                    onChange={(e) => setNewResUnitNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 font-bold"
                  >
                    <option value="">Selecione o apartamento...</option>
                    {Array.from(
                      new Set(
                        units
                          .filter((u) => (u.block || 'Bloco A').toUpperCase() === (newResBlock || 'Bloco A').toUpperCase())
                          .map((u) => u.unit_number)
                      )
                    )
                      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                      .map((num) => (
                        <option key={num} value={num}>
                          Apto {num}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">WhatsApp para Notificações *</label>
                <input
                  type="text"
                  required
                  value={newResPhone}
                  onChange={(e) => setNewResPhone(e.target.value)}
                  placeholder="Ex: 11988887777 ou 73981953741"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">E-mail (Opcional)</label>
                <input
                  type="email"
                  value={newResEmail}
                  onChange={(e) => setNewResEmail(e.target.value)}
                  placeholder="morador@exemplo.com"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddResidentModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-semibold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold transition shadow-lg shadow-indigo-950"
                >
                  Salvar Morador
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
