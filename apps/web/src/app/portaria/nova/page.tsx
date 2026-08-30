'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CameraCapture } from '../../../components/camera-capture';
import { LocalApiClient, OCRResponse } from '../../../lib/local-api';
import { createClient } from '../../../lib/supabase/client';
import { Unit, Resident } from '../../../types/database';
import {
  Sparkles,
  Camera,
  CheckCircle2,
  AlertCircle,
  Package,
  Send,
  ArrowLeft,
  RefreshCw,
  Phone,
  FileText,
  AlertTriangle,
  X
} from 'lucide-react';
import Link from 'next/link';

export default function NovaEncomendaPage() {
  const router = useRouter();
  const [step, setStep] = useState<'CAPTURE' | 'CONFIRM'>('CAPTURE');
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [ocrData, setOcrData] = useState<OCRResponse | null>(null);

  // Dados do formulário
  const [units, setUnits] = useState<Unit[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [selectedResidentId, setSelectedResidentId] = useState<string>('');
  const [carrier, setCarrier] = useState<string>('Mercado Livre');
  const [trackingCode, setTrackingCode] = useState<string>('');
  const [invoiceNumber, setInvoiceNumber] = useState<string>('');
  const [recipientNameOcr, setRecipientNameOcr] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [sendWhatsApp, setSendWhatsApp] = useState<boolean>(true);
  const [customPhone, setCustomPhone] = useState<string>('');

  const [isOcrProcessing, setIsOcrProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState<any | null>(null);

  // Modal de Aviso de Duplicidade
  const [duplicateWarning, setDuplicateWarning] = useState<any | null>(null);

  useEffect(() => {
    loadUnitsAndResidents();
  }, []);

  const loadUnitsAndResidents = async () => {
    const supabase = createClient();
    try {
      const { data: uData } = await supabase.from('units').select('*').order('block').order('unit_number');
      const { data: rData } = await supabase.from('residents').select('*').eq('active', true);
      if (uData) setUnits(uData);
      if (rData) setResidents(rData);
    } catch (err) {
      console.error('Erro ao carregar unidades e moradores:', err);
    }
  };

  const handleCapturePhoto = async (blob: Blob, previewUrl: string) => {
    setCapturedBlob(blob);
    setCapturedPreview(previewUrl);
    setStep('CONFIRM');
    setIsOcrProcessing(true);

    try {
      // Processa OCR com Gemini em alta velocidade
      const ocrResult = await LocalApiClient.uploadLabelAndOCR(blob);
      setOcrData(ocrResult);

      // Garante que as unidades e moradores estejam carregados
      let currentUnits = units;
      let currentResidents = residents;
      if (currentUnits.length === 0) {
        const supabase = createClient();
        const { data: uData } = await supabase.from('units').select('*').order('block').order('unit_number');
        const { data: rData } = await supabase.from('residents').select('*').eq('active', true);
        if (uData) { currentUnits = uData; setUnits(uData); }
        if (rData) { currentResidents = rData; setResidents(rData); }
      }

      // Preenche os campos da encomenda sem alterar os dados cadastrais do morador
      if (ocrResult.ocr.carrier) setCarrier(ocrResult.ocr.carrier);
      if (ocrResult.ocr.trackingCode) setTrackingCode(ocrResult.ocr.trackingCode);
      if ((ocrResult.ocr as any).invoiceNumber) setInvoiceNumber((ocrResult.ocr as any).invoiceNumber);
      if (ocrResult.ocr.recipientName) setRecipientNameOcr(ocrResult.ocr.recipientName);

      // Match inteligente da unidade
      let targetUnitId = ocrResult.suggestedMatch?.unit?.id;
      if (!targetUnitId && ocrResult.ocr.unitNumber) {
        const cleanNum = ocrResult.ocr.unitNumber.replace(/\D/g, '');
        const found = currentUnits.find(u => {
          const uNum = u.unit_number.replace(/\D/g, '');
          const matchNum = uNum === cleanNum;
          if (ocrResult.ocr.block) {
            return matchNum && u.block.toLowerCase().includes(ocrResult.ocr.block.toLowerCase());
          }
          return matchNum;
        }) || currentUnits.find(u => u.unit_number.replace(/\D/g, '') === cleanNum);
        if (found) targetUnitId = found.id;
      }

      if (targetUnitId) {
        setSelectedUnitId(targetUnitId);
        const unitRes = currentResidents.filter(r => r.unit_id === targetUnitId);
        if (ocrResult.suggestedMatch?.resident) {
          setSelectedResidentId(ocrResult.suggestedMatch.resident.id);
          setCustomPhone(ocrResult.suggestedMatch.resident.phone);
        } else if (unitRes.length > 0) {
          const matchByName = unitRes.find(r => 
            ocrResult.ocr.recipientName && 
            r.name.toLowerCase().includes(ocrResult.ocr.recipientName.toLowerCase().split(' ')[0])
          ) || unitRes[0];
          setSelectedResidentId(matchByName.id);
          setCustomPhone(matchByName.phone);
        }
      }
    } catch (err: any) {
      console.error('Falha no OCR:', err);
    } finally {
      setIsOcrProcessing(false);
    }
  };

  // Filtra os moradores da unidade selecionada
  const filteredResidents = residents.filter(r => r.unit_id === selectedUnitId);

  const handleUnitChange = (unitId: string) => {
    setSelectedUnitId(unitId);
    const unitRes = residents.filter(r => r.unit_id === unitId);
    if (unitRes.length > 0) {
      setSelectedResidentId(unitRes[0].id);
      setCustomPhone(unitRes[0].phone);
    } else {
      setSelectedResidentId('');
      setCustomPhone('');
    }
  };

  const handleResidentChange = (resId: string) => {
    setSelectedResidentId(resId);
    const res = residents.find(r => r.id === resId);
    if (res) {
      setCustomPhone(res.phone);
    }
  };

  // Verificação de Duplicidade de Cadastro
  const checkDuplicatePackage = async (unitId: string, code?: string, nf?: string) => {
    if (!code && !nf) return null;
    const supabase = createClient();
    try {
      let query = supabase
        .from('packages')
        .select('id, tracking_code, notes, created_at, status, unit:units(block, unit_number), carrier')
        .eq('status', 'RECEIVED');

      if (code && code.trim().length >= 4) {
        query = query.eq('tracking_code', code.trim());
      } else if (nf && nf.trim().length >= 3) {
        query = query.ilike('notes', `%${nf.trim()}%`);
      } else {
        return null;
      }

      const { data } = await query.limit(1);
      if (data && data.length > 0) {
        return data[0];
      }
    } catch (err) {
      console.warn('Erro ao checar duplicidade:', err);
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUnitId) {
      alert('Por favor, selecione a unidade da encomenda.');
      return;
    }

    // Checagem de duplicidade antes de salvar
    const duplicate = await checkDuplicatePackage(selectedUnitId, trackingCode, invoiceNumber);
    if (duplicate) {
      setDuplicateWarning(duplicate);
      return;
    }

    await executeSavePackage();
  };

  const executeSavePackage = async () => {
    setIsSaving(true);
    setDuplicateWarning(null);

    try {
      const selectedUnit = units.find(u => u.id === selectedUnitId);
      const selectedRes = residents.find(r => r.id === selectedResidentId);

      // Concatena nota fiscal nas notas caso preenchida
      const finalNotes = invoiceNumber
        ? `NF: ${invoiceNumber}${notes ? ` | ${notes}` : ''}`
        : (notes || null);

      const res = await LocalApiClient.createPackage({
        unitId: selectedUnitId,
        residentId: selectedResidentId || null,
        carrier: carrier,
        trackingCode: trackingCode || null,
        recipientNameOcr: recipientNameOcr || null,
        labelImagePath: ocrData?.image?.path || null,
        notes: finalNotes,
        sendWhatsApp: sendWhatsApp,
        residentPhone: customPhone || selectedRes?.phone || null,
        residentName: selectedRes?.name || 'Morador(a)',
        unitInfo: selectedUnit ? `Apto ${selectedUnit.unit_number} - ${selectedUnit.block}` : undefined
      });

      setSavedSuccess(res);
    } catch (err: any) {
      alert(`Erro ao registrar encomenda: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const resetForm = () => {
    setStep('CAPTURE');
    setCapturedBlob(null);
    setCapturedPreview(null);
    setOcrData(null);
    setSelectedUnitId('');
    setSelectedResidentId('');
    setCarrier('Mercado Livre');
    setTrackingCode('');
    setInvoiceNumber('');
    setRecipientNameOcr('');
    setNotes('');
    setCustomPhone('');
    setSavedSuccess(null);
    setDuplicateWarning(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Pop-up de Leitura em Andamento */}
      {isOcrProcessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-8 max-w-sm w-full text-center space-y-5 shadow-2xl">
            <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
              <RefreshCw className="w-10 h-10 text-emerald-400 animate-spin relative" />
              <Sparkles className="w-5 h-5 text-amber-400 absolute" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-white">Realizando leitura, aguarde...</h3>
              <p className="text-xs text-slate-400">
                A IA está identificando o morador, unidade, NF e transportadora na etiqueta.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOcrProcessing(false)}
              className="text-xs text-slate-400 hover:text-slate-200 underline pt-2 block mx-auto transition"
            >
              Preencher manualmente agora
            </button>
          </div>
        </div>
      )}

      {/* Modal de Aviso de Duplicidade */}
      {duplicateWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-fade-in">
          <div className="bg-slate-900 border border-amber-500/50 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-5 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400">
              <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Atenção: Possível Duplicidade!</h3>
                <span className="text-xs text-amber-400/80">Esta encomenda já foi registrada no sistema.</span>
              </div>
            </div>

            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs">
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Unidade:</span>
                <span className="font-bold text-slate-200">
                  {duplicateWarning.unit?.block} - Apto {duplicateWarning.unit?.unit_number}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Código / Rastreio:</span>
                <span className="font-mono font-bold text-emerald-400">
                  {duplicateWarning.tracking_code || 'Não informado'}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Transportadora:</span>
                <span className="font-semibold text-slate-200">{duplicateWarning.carrier}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span className="text-slate-500">Cadastrado em:</span>
                <span className="text-slate-400">
                  {new Date(duplicateWarning.created_at).toLocaleString('pt-BR')}
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-400 text-center">
              Deseja registrar essa encomenda novamente ou cancelar?
            </p>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDuplicateWarning(null)}
                className="flex-1 py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={executeSavePackage}
                className="flex-1 py-3 px-4 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-amber-950"
              >
                Cadastrar Mesmo Assim
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header com voltar */}
      <div className="flex items-center justify-between">
        <Link
          href="/portaria"
          className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar ao Painel da Portaria
        </Link>
        <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-3 py-1 rounded-full">
          Recepção de Encomendas
        </span>
      </div>

      {/* Sucesso após cadastro */}
      {savedSuccess ? (
        <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl p-8 text-center space-y-6 shadow-2xl animate-fade-in">
          <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-100">Encomenda Registrada com Sucesso!</h2>
            <p className="text-sm text-slate-400">
              O pacote foi cadastrado e a notificação está pronta.
            </p>
          </div>

          {/* Código de Retirada */}
          <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 inline-block">
            <span className="text-xs text-slate-500 uppercase tracking-wider font-semibold block mb-1">
              Código de Retirada do Morador
            </span>
            <span className="text-4xl font-black font-mono text-emerald-400 tracking-widest">
              {savedSuccess.package?.pickup_code || '----'}
            </span>
          </div>

          {savedSuccess.whatsapp?.sent ? (
            <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 font-medium bg-emerald-950/40 border border-emerald-800/40 p-3 rounded-2xl max-w-md mx-auto">
              <Phone className="w-4 h-4 text-emerald-400" />
              <span>Mensagem com foto e código enviada com sucesso no WhatsApp do morador!</span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 text-xs text-amber-300 font-medium bg-amber-950/30 border border-amber-800/40 p-3.5 rounded-2xl max-w-md mx-auto">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-400" />
                <span>WhatsApp ainda não foi disparado para esta encomenda.</span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (savedSuccess.package?.id) {
                    const res = await LocalApiClient.notifyPackage(savedSuccess.package.id, true);
                    if (res.success) {
                      setSavedSuccess({ ...savedSuccess, whatsapp: { sent: true } });
                    } else {
                      alert(`Erro: ${res.error || 'Falha ao enviar mensagem.'}`);
                    }
                  }
                }}
                className="mt-1 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-950"
              >
                <Send className="w-3.5 h-3.5" /> Enviar WhatsApp Agora
              </button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              onClick={resetForm}
              className="flex items-center justify-center gap-2 py-3 px-6 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-950 transition"
            >
              <Camera className="w-4 h-4" /> Receber Outra Encomenda
            </button>
            <button
              onClick={() => router.push('/portaria')}
              className="py-3 px-6 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold text-sm transition"
            >
              Voltar à Fila da Portaria
            </button>
          </div>
        </div>
      ) : step === 'CAPTURE' ? (
        /* Passo 1: Captura da Foto Imediata */
        <CameraCapture onCapture={handleCapturePhoto} onCancel={() => router.push('/portaria')} />
      ) : (
        /* Passo 2: Confirmação e Ajuste dos Dados */
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 animate-fade-in">
          <div className="flex items-start justify-between pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 rounded-full w-fit mb-1">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Dados Reconhecidos por IA
                </span>
              </div>
              <h2 className="text-xl font-bold text-slate-100">Confirmar Dados da Encomenda</h2>
            </div>
            {capturedPreview && (
              <img
                src={capturedPreview}
                alt="Miniatura etiqueta"
                className="w-16 h-16 object-cover rounded-xl border border-slate-700"
              />
            )}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Unidade & Morador */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Apartamento / Unidade <span className="text-rose-400">*</span>
                </label>
                <select
                  value={selectedUnitId}
                  onChange={(e) => handleUnitChange(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">Selecione a Unidade...</option>
                  {Array.from(new Set(units.map((u) => u.block))).sort().map((blockName) => (
                    <optgroup key={blockName} label={blockName} className="bg-slate-900 text-emerald-400 font-bold">
                      {units
                        .filter((u) => u.block === blockName)
                        .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }))
                        .map((u) => (
                          <option key={u.id} value={u.id} className="text-white font-normal">
                            {u.block} — Apto {u.unit_number}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Morador Cadastrado
                </label>
                <select
                  value={selectedResidentId}
                  onChange={(e) => handleResidentChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">Selecione o morador...</option>
                  {filteredResidents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.is_primary ? '(Principal)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Nome na Etiqueta (Informativo, não altera o morador) e Transportadora */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome na Etiqueta (Lido no Pacote):
                </label>
                <input
                  type="text"
                  value={recipientNameOcr}
                  onChange={(e) => setRecipientNameOcr(e.target.value)}
                  placeholder="Nome impresso no pacote"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Transportadora:
                </label>
                <select
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="Dell">Dell</option>
                  <option value="Mercado Livre">Mercado Livre</option>
                  <option value="Shopee">Shopee</option>
                  <option value="Amazon">Amazon</option>
                  <option value="Correios">Correios</option>
                  <option value="Shein">Shein</option>
                  <option value="Magalu">Magalu</option>
                  <option value="Total Express">Total Express</option>
                  <option value="Loggi">Loggi</option>
                  <option value="Jadlog">Jadlog</option>
                  {carrier && !['Dell', 'Mercado Livre', 'Shopee', 'Amazon', 'Correios', 'Shein', 'Magalu', 'Total Express', 'Loggi', 'Jadlog', 'Outro'].includes(carrier) && (
                    <option value={carrier}>{carrier}</option>
                  )}
                  <option value="Outro">Outro</option>
                </select>
              </div>
            </div>

            {/* Código de Rastreio e Nota Fiscal (NF) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Código de Rastreio / Etiqueta:
                </label>
                <input
                  type="text"
                  value={trackingCode}
                  onChange={(e) => setTrackingCode(e.target.value)}
                  placeholder="Ex: BR123456789 ou ML998822"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nota Fiscal (NF):
                </label>
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Ex: 001.234.567 ou Danfe"
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>
            </div>

            {/* WhatsApp para Notificação */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                WhatsApp para Notificação:
              </label>
              <input
                type="text"
                value={customPhone}
                onChange={(e) => setCustomPhone(e.target.value)}
                placeholder="Ex: 5511999999999"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            {/* Notificação WhatsApp Toggle */}
            <div className="p-3.5 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Send className="w-5 h-5 text-emerald-400" />
                <div>
                  <span className="text-xs font-bold text-slate-200 block">Enviar Alerta no WhatsApp</span>
                  <span className="text-[11px] text-slate-400">
                    Dispara o código de retirada e foto automaticamente para o morador.
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={sendWhatsApp}
                onChange={(e) => setSendWhatsApp(e.target.checked)}
                className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
              />
            </div>

            {/* Ações */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setStep('CAPTURE')}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-semibold transition"
              >
                Tirar Outra Foto
              </button>

              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-emerald-950 transition disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Salvando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Salvar e Notificar
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
