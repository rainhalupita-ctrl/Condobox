'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  UploadCloud,
  FileCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  QrCode,
  Copy,
  Check,
  Eye,
  RefreshCw,
  X,
  FileText,
  ShieldCheck,
  MessageSquare,
  Lock
} from 'lucide-react';
import { buildSupportWhatsAppUrl } from '@/lib/support-contacts';

interface CondoReceiptUploaderProps {
  condoId?: string;
  condoName?: string;
  compact?: boolean;
  onSuccess?: () => void;
}

export function CondoReceiptUploader({
  condoId,
  condoName,
  compact = false,
  onSuccess
}: CondoReceiptUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState<{
    id: string;
    amount?: number;
    status: string;
    receipt_url?: string;
    created_at?: string;
    notes?: string;
  } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [pixSettings, setPixSettings] = useState<{
    pixKey: string;
    pixKeyType: string;
    holderName: string;
    bankName: string;
  }>({
    pixKey: '73998419901',
    pixKeyType: 'TELEFONE',
    holderName: 'CondoBox Tecnologia & Gestão',
    bankName: 'Banco Digital / Pix Oficial'
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Carrega status de comprovante pendente e chave Pix
  useEffect(() => {
    fetchStatusAndPix();
  }, [condoId]);

  const fetchStatusAndPix = async () => {
    if (!condoId) return;
    setCheckingStatus(true);
    try {
      const res = await fetch(`/api/financial/receipt?condoId=${encodeURIComponent(condoId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.latestReceipt && data.latestReceipt.status === 'UNDER_REVIEW') {
          setPendingReceipt(data.latestReceipt);
        } else {
          setPendingReceipt(null);
        }
        if (data.pixSettings) {
          setPixSettings(data.pixSettings);
        }
      }
    } catch {
      // Falha silenciosa em checagem inicial
    } finally {
      setCheckingStatus(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    // Checa tamanho máximo (10MB)
    if (selected.size > 10 * 1024 * 1024) {
      setStatusMsg({ type: 'error', text: 'O arquivo deve ter no máximo 10MB.' });
      return;
    }

    setFile(selected);
    setStatusMsg(null);

    if (selected.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        setFilePreview(reader.result as string);
      };
      reader.readAsDataURL(selected);
    } else {
      setFilePreview(null);
    }
  };

  const handleCopyPix = () => {
    if (!pixSettings.pixKey) return;
    navigator.clipboard.writeText(pixSettings.pixKey);
    setCopiedPix(true);
    setTimeout(() => setCopiedPix(false), 2500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setStatusMsg({ type: 'error', text: 'Selecione a foto ou PDF do comprovante.' });
      return;
    }

    if (!condoId) {
      setStatusMsg({ type: 'error', text: 'Identificador do condomínio não encontrado.' });
      return;
    }

    setUploading(true);
    setStatusMsg(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('condoId', condoId);
      if (condoName) formData.append('condoName', condoName);
      if (notes.trim()) formData.append('notes', notes.trim());
      if (amountPaid.trim()) formData.append('amount', amountPaid.replace(',', '.'));

      const res = await fetch('/api/financial/receipt', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao enviar comprovante.');
      }

      setStatusMsg({
        type: 'success',
        text: 'Comprovante enviado com sucesso! Está em análise pelo Sócio Proprietário para liberação.'
      });

      setPendingReceipt({
        id: data.paymentId || 'new',
        status: 'UNDER_REVIEW',
        receipt_url: data.receiptUrl,
        notes: notes.trim(),
        created_at: new Date().toISOString()
      });

      setFile(null);
      setFilePreview(null);
      setNotes('');
      setAmountPaid('');
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (onSuccess) onSuccess();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Falha ao enviar comprovante.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full bg-slate-950/80 border border-slate-800/90 rounded-2xl p-4 sm:p-5 text-left space-y-4 shadow-xl">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-xl">
            <QrCode size={18} />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
              <span>Pagamento & Envio de Comprovante</span>
              <span className="text-[10px] font-semibold px-2 py-0.2 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                PIX Oficial
              </span>
            </h3>
            <p className="text-[11px] text-slate-400">
              Pague via Pix e anexe o comprovante para análise do Sócio Proprietário
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={fetchStatusAndPix}
          disabled={checkingStatus}
          className="p-1.5 text-slate-400 hover:text-slate-200 transition"
          title="Atualizar status"
        >
          <RefreshCw size={13} className={checkingStatus ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Caixa da Chave Pix */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 sm:p-3.5 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <span className="font-semibold uppercase tracking-wider text-slate-300">
            Chave Pix ({pixSettings.pixKeyType}):
          </span>
          {pixSettings.holderName && (
            <span className="text-slate-400 truncate max-w-[200px]" title={pixSettings.holderName}>
              {pixSettings.holderName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 font-mono text-xs sm:text-sm text-emerald-400 font-bold select-all break-all">
            {pixSettings.pixKey}
          </div>
          <button
            type="button"
            onClick={handleCopyPix}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shrink-0 active:scale-95 shadow-md shadow-emerald-950/40"
          >
            {copiedPix ? <Check size={14} className="text-white" /> : <Copy size={14} />}
            <span>{copiedPix ? 'Copiado!' : 'Copiar Pix'}</span>
          </button>
        </div>

        {pixSettings.bankName && (
          <p className="text-[10px] text-slate-500">
            Favorecido: {pixSettings.holderName} • {pixSettings.bankName}
          </p>
        )}
      </div>

      {/* Se já houver comprovante em análise pelo Sócio Proprietário */}
      {pendingReceipt && (
        <div className="bg-gradient-to-r from-amber-950/40 to-slate-900/80 border border-amber-500/40 rounded-xl p-3.5 space-y-2.5 animate-fade-in">
          <div className="flex items-start gap-2.5">
            <div className="p-2 bg-amber-500/20 text-amber-400 rounded-lg border border-amber-500/30 shrink-0">
              <Clock size={16} className="animate-spin" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-amber-300">
                  Comprovante em Análise pelo Sócio Proprietário
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/30 uppercase">
                  Aguardando Aprovação
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Seu comprovante foi recebido e aguarda a conferência e aprovação do Sócio Proprietário para a liberação do condomínio.
              </p>
              {pendingReceipt.created_at && (
                <p className="text-[10px] text-slate-400">
                  Enviado em: {new Date(pendingReceipt.created_at).toLocaleString('pt-BR')}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            {pendingReceipt.receipt_url && (
              <a
                href={pendingReceipt.receipt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-medium flex items-center gap-1 border border-slate-700 transition"
              >
                <Eye size={12} />
                <span>Ver comprovante enviado</span>
              </a>
            )}

            <a
              href={buildSupportWhatsAppUrl('5573998419901', condoName, condoId)}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg text-[11px] font-bold flex items-center gap-1 transition ml-auto"
            >
              <MessageSquare size={12} />
              <span>Avisar no WhatsApp</span>
            </a>
          </div>
        </div>
      )}

      {/* Formulário de Envio de Comprovante */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <UploadCloud size={13} className="text-emerald-400" />
              <span>Anexar Foto ou PDF do Comprovante</span>
            </span>
            {file && (
              <span className="text-[10px] text-emerald-400 font-mono">
                {(file.size / 1024).toFixed(0)} KB
              </span>
            )}
          </label>

          <input
            type="file"
            ref={fileInputRef}
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            className="hidden"
            id="receipt-file-input"
          />

          {!file ? (
            <label
              htmlFor="receipt-file-input"
              className="border-2 border-dashed border-slate-700 hover:border-emerald-500/60 bg-slate-900/60 hover:bg-slate-900 rounded-xl p-4 flex flex-col items-center justify-center cursor-pointer transition text-center group"
            >
              <UploadCloud size={24} className="text-slate-500 group-hover:text-emerald-400 group-hover:scale-110 transition mb-1.5" />
              <span className="text-xs font-semibold text-slate-200 group-hover:text-white">
                Clique para selecionar foto da galeria ou PDF
              </span>
              <span className="text-[10px] text-slate-500 mt-0.5">
                Formatos aceitos: JPG, PNG, WebP ou PDF (máx. 10MB)
              </span>
            </label>
          ) : (
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {filePreview ? (
                  <img
                    src={filePreview}
                    alt="Preview comprovante"
                    className="w-12 h-12 object-cover rounded-lg border border-slate-700 shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 bg-slate-800 rounded-lg flex items-center justify-center text-slate-400 shrink-0">
                    <FileText size={20} />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{file.name}</p>
                  <p className="text-[10px] text-emerald-400 font-medium">Arquivo pronto para envio</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setFilePreview(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                title="Remover arquivo"
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>

        {/* Campos Opcionais: Valor e Observação */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="text-[10px] font-semibold text-slate-400 block mb-1">
              Valor Pago (R$) <span className="text-slate-500 font-normal">(opcional)</span>:
            </label>
            <input
              type="text"
              placeholder="Ex: 150,00"
              value={amountPaid}
              onChange={e => setAmountPaid(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-400 block mb-1">
              Nome do Pagador / Obs <span className="text-slate-500 font-normal">(opcional)</span>:
            </label>
            <input
              type="text"
              placeholder="Ex: Síndico João / Conta Nubank"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={uploading || !file}
          className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          {uploading ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              <span>Enviando Comprovante...</span>
            </>
          ) : (
            <>
              <FileCheck size={14} />
              <span>Enviar Comprovante para Análise</span>
            </>
          )}
        </button>

        <p className="text-[10px] text-slate-500 text-center flex items-center justify-center gap-1">
          <ShieldCheck size={11} className="text-purple-400" />
          <span>Após o envio, o Sócio Proprietário confere o valor e faz o desbloqueio da conta.</span>
        </p>
      </form>

      {statusMsg && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold flex items-center justify-between gap-2 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-950/40 border border-emerald-500/40 text-emerald-300'
              : statusMsg.type === 'error'
              ? 'bg-rose-950/40 border border-rose-500/40 text-rose-300'
              : 'bg-blue-950/40 border border-blue-500/40 text-blue-300'
          }`}
        >
          <span>{statusMsg.text}</span>
          <button
            type="button"
            onClick={() => setStatusMsg(null)}
            className="text-slate-400 hover:text-white"
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
