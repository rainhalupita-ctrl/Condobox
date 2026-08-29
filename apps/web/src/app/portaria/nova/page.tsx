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
    if (supabase) {
      const { data: uData } = await supabase.from('units').select('*').order('block').order('unit_number');
      const { data: rData } = await supabase.from('residents').select('*').eq('active', true);
      if (uData) setUnits(uData);
      if (rData) setResidents(rData);
      return;
    }

    // Unidades de demonstração locais
    const mockUnits: Unit[] = [
      { id: 'u-1', block: 'Bloco A', unit_number: '101' },
      { id: 'u-2', block: 'Bloco A', unit_number: '102' },
      { id: 'u-3', block: 'Bloco A', unit_number: '201' },
      { id: 'u-4', block: 'Bloco A', unit_number: '202' },
      { id: 'u-5', block: 'Bloco B', unit_number: '101' },
      { id: 'u-6', block: 'Bloco B', unit_number: '102' },
    ];
    const mockResidents: Resident[] = [
      { id: 'r-1', unit_id: 'u-1', name: 'Carlos Silva', phone: '5511999990001', is_authorized_receiver: true, is_primary: true, active: true },
      { id: 'r-2', unit_id: 'u-1', name: 'Mariana Silva', phone: '5511999990002', is_authorized_receiver: true, is_primary: false, active: true },
      { id: 'r-3', unit_id: 'u-2', name: 'Roberto Oliveira', phone: '5511999990003', is_authorized_receiver: true, is_primary: true, active: true },
      { id: 'r-4', unit_id: 'u-5', name: 'Fernanda Souza', phone: '5511999990004', is_authorized_receiver: true, is_primary: true, active: true },
      { id: 'r-5', unit_id: 'u-6', name: 'Lucas Pereira', phone: '5511999990005', is_authorized_receiver: true, is_primary: true, active: true },
    ];
    setUnits(mockUnits);
    setResidents(mockResidents);
  };

  const handleCapturePhoto = async (blob: Blob, previewUrl: string) => {
    setCapturedBlob(blob);
    setCapturedPreview(previewUrl);
    setStep('PROCESSING');

    try {
      // Chama a API Local para salvar a foto e rodar o OCR com Gemini
      const ocrResult = await LocalApiClient.uploadLabelAndOCR(blob);
      setOcrData(ocrResult);

      // Preenche os campos automaticamente com a extração da IA
      if (ocrResult.ocr.carrier) setCarrier(ocrResult.ocr.carrier);
      if (ocrResult.ocr.trackingCode) setTrackingCode(ocrResult.ocr.trackingCode);
      if (ocrResult.ocr.recipientName) setRecipientNameOcr(ocrResult.ocr.recipientName);

      // Se encontrou a unidade correspondente
      if (ocrResult.suggestedMatch.unit) {
        setSelectedUnitId(ocrResult.suggestedMatch.unit.id);
      }
      if (ocrResult.suggestedMatch.resident) {
        setSelectedResidentId(ocrResult.suggestedMatch.resident.id);
        setCustomPhone(ocrResult.suggestedMatch.resident.phone);
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

          {savedSuccess.whatsapp?.sent && (
            <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 font-medium">
              <Phone className="w-4 h-4" />
              <span>Mensagem com código enviada com sucesso no WhatsApp do morador!</span>
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
        /* Passo 1: Captura da Foto */
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
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.block} - Apto {u.unit_number}
                    </option>
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
                  <option value="Mercado Livre">Mercado Livre</option>
                  <option value="Shopee">Shopee</option>
                  <option value="Amazon">Amazon</option>
                  <option value="Correios">Correios</option>
                  <option value="Shein">Shein</option>
                  <option value="Magalu">Magalu</option>
                  <option value="Total Express">Total Express</option>
                  <option value="Loggi">Loggi</option>
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
