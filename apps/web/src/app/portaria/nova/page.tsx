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
  Phone
} from 'lucide-react';
import Link from 'next/link';

export default function NovaEncomendaPage() {
  const router = useRouter();
  const [step, setStep] = useState<'CAPTURE' | 'PROCESSING' | 'CONFIRM'>('CAPTURE');
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
  const [recipientNameOcr, setRecipientNameOcr] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [sendWhatsApp, setSendWhatsApp] = useState<boolean>(true);
  const [customPhone, setCustomPhone] = useState<string>('');

  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState<any | null>(null);

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
    setStep('PROCESSING');

    try {
      // Chama a API Local para salvar a foto e rodar o OCR com Gemini
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

      // Preenche os campos automaticamente com a extração da IA
      if (ocrResult.ocr.carrier) setCarrier(ocrResult.ocr.carrier);
      if (ocrResult.ocr.trackingCode) setTrackingCode(ocrResult.ocr.trackingCode);
      if (ocrResult.ocr.recipientName) setRecipientNameOcr(ocrResult.ocr.recipientName);

      // Se encontrou a unidade correspondente
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
        // Moradores da unidade
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

      setStep('CONFIRM');
    } catch (err: any) {
      console.error('Falha no OCR:', err);
      // Mesmo se o OCR falhar, prossegue para o preenchimento manual
      setStep('CONFIRM');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUnitId) {
      alert('Por favor, selecione a unidade da encomenda.');
      return;
    }

    setIsSaving(true);
    try {
      const selectedUnit = units.find(u => u.id === selectedUnitId);
      const selectedRes = residents.find(r => r.id === selectedResidentId);

      const res = await LocalApiClient.createPackage({
        unitId: selectedUnitId,
        residentId: selectedResidentId || null,
        carrier: carrier,
        trackingCode: trackingCode || null,
        recipientNameOcr: recipientNameOcr || selectedRes?.name || null,
        labelImagePath: ocrData?.image?.path || null,
        notes: notes || null,
        sendWhatsApp: sendWhatsApp,
        residentPhone: customPhone || selectedRes?.phone || null,
        residentName: selectedRes?.name || recipientNameOcr || 'Morador',
        unitInfo: selectedUnit ? `Apto ${selectedUnit.unit_number} - ${selectedUnit.block}` : undefined
      });

      setSavedSuccess(res);
    } catch (err: any) {
      alert(`Erro ao registrar encomenda: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const compressImage = (fileOrBlob: Blob | File): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(fileOrBlob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const maxDim = 1280;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob((b) => {
            resolve(b || fileOrBlob);
          }, 'image/jpeg', 0.85);
        } else {
          resolve(fileOrBlob);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(fileOrBlob);
      };
      img.src = url;
    });
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const compressed = await compressImage(file);
      const previewUrl = URL.createObjectURL(compressed);
      handleCapturePhoto(compressed, previewUrl);
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
    setRecipientNameOcr('');
    setNotes('');
    setCustomPhone('');
    setSavedSuccess(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
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
      ) : step === 'PROCESSING' ? (
        /* Passo 2: Processamento OCR com Gemini */
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center space-y-6 shadow-2xl">
          <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
            <RefreshCw className="w-12 h-12 text-emerald-400 animate-spin" />
            <Sparkles className="w-6 h-6 text-amber-400 absolute" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Analisando Etiqueta com IA Gemini...</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Identificando destinatário, número da unidade, código de rastreio e transportadora automaticamente.
            </p>
          </div>
        </div>
      ) : (
        /* Passo 3: Confirmação e Ajuste dos Dados Extraídos */
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 animate-fade-in">
          <div className="flex items-start justify-between pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                  Dados Reconhecidos por IA
                </span>
              </div>
              <h2 className="text-xl font-bold text-slate-100 mt-1">Confirmar Dados da Encomenda</h2>
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

            {/* Nome da Etiqueta e Transportadora */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Nome no Pacote (OCR):
                </label>
                <input
                  type="text"
                  value={recipientNameOcr}
                  onChange={(e) => setRecipientNameOcr(e.target.value)}
                  placeholder="Nome lido na etiqueta"
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

            {/* Código de Rastreio e Telefone WhatsApp */}
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
