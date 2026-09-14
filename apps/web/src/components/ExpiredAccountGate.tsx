'use client';

import React, { useState } from 'react';
import { Lock, PhoneCall, KeyRound, CheckCircle2, RefreshCw, Copy, Check, LogOut, MessageSquare } from 'lucide-react';
import { buildSupportWhatsAppUrl, SUPPORT_CONTACTS } from '@/lib/support-contacts';
import { useAuth } from '@/contexts/auth-context';
import { LocalApiClient } from '@/lib/local-api';
import { CondoReceiptUploader } from './CondoReceiptUploader';

interface ExpiredAccountGateProps {
  condoName?: string;
  condoId?: string;
}

export function ExpiredAccountGate({ condoName, condoId }: ExpiredAccountGateProps) {
  const { signOut, effectiveCondoId } = useAuth();
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [activating, setActivating] = useState(false);
  const [activationMsg, setActivationMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedAccount, setCopiedAccount] = useState(false);

  const activeCondoId = condoId || effectiveCondoId || undefined;

  const waMessage73 = buildSupportWhatsAppUrl('5573998419901', condoName, activeCondoId);
  const waMessage21 = buildSupportWhatsAppUrl('5521971966473', condoName, activeCondoId);

  const handleCopyAccountInfo = () => {
    const textToCopy = `Olá, preciso de suporte para efetuar o pagamento e desbloquear minha conta no CondoBox.\nCondomínio: ${condoName || 'Não especificado'}\nCódigo da Conta: ${activeCondoId || 'Não informado'}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedAccount(true);
    setTimeout(() => setCopiedAccount(false), 2500);
  };

  const handleActivateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKeyInput.trim()) return;

    setActivating(true);
    setActivationMsg(null);

    const baseUrl = LocalApiClient.getBaseUrl();
    if (!baseUrl) {
      setActivationMsg({
        type: 'error',
        text: 'A ativação por chave é feita no aplicativo local da portaria. Para liberação na nuvem, envie o comprovante Pix abaixo.'
      });
      setActivating(false);
      return;
    }

    try {
      const res = await fetch(`${baseUrl}/api/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey: licenseKeyInput.trim(),
          condoId: activeCondoId
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setActivationMsg({
          type: 'success',
          text: data.message || 'Licença ativada com sucesso! Recarregando sistema...'
        });
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        setActivationMsg({
          type: 'error',
          text: data.message || 'Chave de licença inválida ou expirada. Confirme com o suporte.'
        });
      }
    } catch {
      setActivationMsg({
        type: 'error',
        text: 'Não foi possível conectar ao serviço local. Por favor, envie o comprovante ao suporte para liberação na nuvem.'
      });
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4 select-none">
      <div className="max-w-xl w-full bg-slate-900/95 border border-rose-500/40 rounded-3xl p-6 sm:p-9 shadow-2xl space-y-6 text-center backdrop-blur-2xl relative overflow-hidden">
        
        {/* Glow de fundo */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-rose-600/15 blur-3xl rounded-full pointer-events-none" />

        {/* Ícone de bloqueio com animação suave */}
        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gradient-to-br from-rose-500/25 to-red-500/10 border border-rose-500/40 rounded-3xl flex items-center justify-center mx-auto text-rose-400 shadow-xl shadow-rose-950/60 relative">
          <Lock className="w-8 h-8 sm:w-10 sm:h-10 animate-pulse" />
        </div>

        {/* Textos informativos de pagamento e desbloqueio */}
        <div className="space-y-3">
          <span className="inline-block px-3.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] font-bold uppercase tracking-wider">
            Tempo Esgotado • Conta Bloqueada
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Efetue o Pagamento ou Contate o Suporte
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-lg mx-auto">
            O tempo de vigência da sua assinatura ou período de testes no <strong>CondoBox</strong> encerrou. Para liberar o acesso à portaria, encomendas e ao painel, <strong>efetue o pagamento</strong> ou <strong>entre em contato com o suporte para desbloqueio da conta</strong> nos números abaixo:
          </p>
        </div>

        {/* ENVIO DE COMPROVANTE & PIX OFICIAL */}
        <CondoReceiptUploader
          condoId={activeCondoId}
          condoName={condoName}
        />

        {/* CARDS DOS NÚMEROS DE SUPORTE OFICIAIS */}
        <div className="space-y-3 pt-1">
          <div className="text-left flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Canais Oficiais de Desbloqueio & Suporte:
            </span>
            <button
              type="button"
              onClick={handleCopyAccountInfo}
              className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 transition"
              title="Copiar dados para enviar no WhatsApp"
            >
              {copiedAccount ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copiedAccount ? 'Copiado!' : 'Copiar dados da conta'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
            {/* Contato 1: 73 99841-9901 */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 hover:border-emerald-500/40 rounded-2xl transition space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-xl">
                  <PhoneCall size={18} />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                    Suporte & Atendimento
                  </span>
                  <span className="text-sm font-black text-white font-mono">
                    (73) 99841-9901
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <a
                  href={waMessage73}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 active:scale-95"
                >
                  <MessageSquare size={14} />
                  <span>WhatsApp</span>
                </a>
                <a
                  href="tel:+5573998419901"
                  className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
                  title="Ligar para (73) 99841-9901"
                >
                  Ligar
                </a>
              </div>
            </div>

            {/* Contato 2: 21 97196-6473 */}
            <div className="p-4 bg-slate-950/80 border border-slate-800 hover:border-emerald-500/40 rounded-2xl transition space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-xl">
                  <PhoneCall size={18} />
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                    Suporte & Atendimento
                  </span>
                  <span className="text-sm font-black text-white font-mono">
                    (21) 97196-6473
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <a
                  href={waMessage21}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950/40 active:scale-95"
                >
                  <MessageSquare size={14} />
                  <span>WhatsApp</span>
                </a>
                <a
                  href="tel:+5521971966473"
                  className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
                  title="Ligar para (21) 97196-6473"
                >
                  Ligar
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* ATIVAÇÃO POR CHAVE */}
        <form onSubmit={handleActivateKey} className="p-4 sm:p-5 bg-slate-950/80 border border-slate-800 rounded-2xl space-y-3 text-left">
          <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
            <KeyRound className="w-3.5 h-3.5 text-purple-400" />
            <span>Já recebeu a Chave de Desbloqueio do Suporte?</span>
          </label>
          <input
            type="text"
            required
            placeholder="Cole sua chave: CND-..."
            value={licenseKeyInput}
            onChange={e => setLicenseKeyInput(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white font-mono text-xs focus:border-purple-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={activating}
            className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-purple-950/40 active:scale-[0.98] disabled:opacity-50"
          >
            {activating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>Ativar Licença e Desbloquear Imediatamente</span>
          </button>
        </form>

        {activationMsg && (
          <div className={`p-3.5 rounded-xl text-xs font-semibold text-center ${
            activationMsg.type === 'success'
              ? 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-400'
              : 'bg-red-950/40 border border-red-500/40 text-red-400'
          }`}>
            {activationMsg.text}
          </div>
        )}

        {/* Rodapé com identificação da conta e botão de sair */}
        <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="text-left text-slate-400">
            {condoName && <p className="font-semibold text-slate-200">Condomínio: {condoName}</p>}
            {activeCondoId && <p className="text-[10px] text-slate-500 font-mono">ID: {activeCondoId}</p>}
          </div>

          <button
            type="button"
            onClick={() => signOut()}
            className="px-3 py-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition flex items-center gap-1.5 text-xs"
          >
            <LogOut size={13} />
            <span>Trocar de Conta</span>
          </button>
        </div>

      </div>
    </div>
  );
}
