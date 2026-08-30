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
  X,
  History,
  Check,
  Clock,
  ChevronDown
} from 'lucide-react';
import Link from 'next/link';

interface RecentSavedPackage {
  id: string;
  pickupCode: string;
  unitText: string;
  residentName: string;
  carrier: string;
  whatsappStatus: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
  createdAt: Date;
}

export default function NovaEncomendaPage() {
  const router = useRouter();
  const [step, setStep] = useState<'CAPTURE' | 'CONFIRM'>('CAPTURE');
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [ocrData, setOcrData] = useState<OCRResponse | null>(null);

  // Dados do formulário
  const [units, setUnits] = useState<Unit[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<string>('Bloco A');
  const [selectedUnitNumber, setSelectedUnitNumber] = useState<string>('');
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

  // Encomendas recém-cadastradas na sessão para monitoramento em tempo real
  const [recentSaved, setRecentSaved] = useState<RecentSavedPackage[]>([]);
  const [lastNotificationToast, setLastNotificationToast] = useState<{
    id: string;
    pickupCode: string;
    unitText: string;
    carrier: string;
    residentName: string;
    whatsappStatus: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';
  } | null>(null);
  const [showRecentDrawer, setShowRecentDrawer] = useState(true);

  // Modal de Aviso de Duplicidade
  const [duplicateWarning, setDuplicateWarning] = useState<any | null>(null);

  useEffect(() => {
    loadUnitsAndResidents();
  }, []);

  // Escuta enriquecimento em segundo plano (Estágio 2 do OCR live)
  // Atualiza campos que o Estágio 1 (rápido) não preencheu: nome, transportadora, rastreio, morador
  useEffect(() => {
    const handler = (e: Event) => {
      const fullOcr = (e as CustomEvent).detail as OCRResponse;
      if (!fullOcr?.ocr) return;
      // Só enriquece — nunca substitui campos já definidos pelo usuário
      if (fullOcr.ocr.carrier && fullOcr.ocr.carrier !== 'Outro') setCarrier(fullOcr.ocr.carrier);
      if (fullOcr.ocr.trackingCode) setTrackingCode((prev) => prev || fullOcr.ocr.trackingCode || '');
      if ((fullOcr.ocr as any).invoiceNumber) setInvoiceNumber((prev) => prev || (fullOcr.ocr as any).invoiceNumber || '');
      if (fullOcr.ocr.recipientName) setRecipientNameOcr((prev) => prev || fullOcr.ocr.recipientName || '');
      // Se encontrou morador no Supabase e ainda não há seleção do usuário
      if (fullOcr.suggestedMatch?.resident) {
        setSelectedResidentId((prev) => prev || fullOcr.suggestedMatch!.resident!.id);
        setCustomPhone((prev) => prev || fullOcr.suggestedMatch!.resident!.phone);
      }
      if (fullOcr.suggestedMatch?.unit) {
        const u = fullOcr.suggestedMatch.unit;
        setSelectedBlock((prev) => prev || u.block || 'Bloco A');
        setSelectedUnitNumber((prev) => prev || u.unit_number);
        setSelectedUnitId((prev) => prev || u.id);
      }
      setOcrData(fullOcr);
    };
    window.addEventListener('ocr-enriched', handler);
    return () => window.removeEventListener('ocr-enriched', handler);
  }, []);

  // Monitora o status das notificações de WhatsApp em segundo plano a cada 2s + Realtime
  useEffect(() => {
    if (recentSaved.length === 0) return;
    const supabase = createClient();

    const checkStatus = async () => {
      const pendingIds = recentSaved
        .filter((p) => p.whatsappStatus === 'QUEUED' || p.whatsappStatus === 'SENDING')
        .map((p) => p.id);

      if (pendingIds.length === 0) return;

      // 1. Verifica tabela packages (status NOTIFIED ou DELIVERED)
      const { data: pkgs } = await supabase
        .from('packages')
        .select('id, status')
        .in('id', pendingIds);

      // 2. Verifica tabela notifications_log (status SENT, DELIVERED ou FAILED)
      const { data: logs } = await supabase
        .from('notifications_log')
        .select('package_id, status')
        .in('package_id', pendingIds)
        .in('status', ['SENT', 'DELIVERED', 'FAILED']);

      const notifiedPkgIds = new Map<string, 'SENT' | 'FAILED'>();
      
      (pkgs || []).forEach((p) => {
        if (p.status === 'NOTIFIED' || p.status === 'DELIVERED') notifiedPkgIds.set(p.id, 'SENT');
      });
      
      (logs || []).forEach((l) => {
        if (l.status === 'SENT' || l.status === 'DELIVERED') notifiedPkgIds.set(l.package_id, 'SENT');
        else if (l.status === 'FAILED' && !notifiedPkgIds.has(l.package_id)) notifiedPkgIds.set(l.package_id, 'FAILED');
      });

      if (notifiedPkgIds.size > 0) {
        setRecentSaved((prev) =>
          prev.map((p) => (notifiedPkgIds.has(p.id) ? { ...p, whatsappStatus: notifiedPkgIds.get(p.id)! } : p))
        );

        if (lastNotificationToast && notifiedPkgIds.has(lastNotificationToast.id)) {
          setLastNotificationToast((prev) => (prev ? { ...prev, whatsappStatus: notifiedPkgIds.get(prev.id)! } : null));
        }
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 2000);

    // Canal Realtime para atualização instantânea sem esperar o polling
    const channel = supabase
      .channel('nova-packages-notif-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'packages' },
        (payload) => {
          const updated = payload.new as any;
          if (updated && (updated.status === 'NOTIFIED' || updated.status === 'DELIVERED')) {
            setRecentSaved((prev) =>
              prev.map((p) => (p.id === updated.id ? { ...p, whatsappStatus: 'SENT' } : p))
            );
            setLastNotificationToast((prev) =>
              prev && prev.id === updated.id ? { ...prev, whatsappStatus: 'SENT' } : prev
            );
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications_log' },
        (payload) => {
          const newLog = payload.new as any;
          if (newLog) {
            const status = (newLog.status === 'SENT' || newLog.status === 'DELIVERED') ? 'SENT' : (newLog.status === 'FAILED' ? 'FAILED' : null);
            if (status) {
              setRecentSaved((prev) =>
                prev.map((p) => (p.id === newLog.package_id ? { ...p, whatsappStatus: status } : p))
              );
              setLastNotificationToast((prev) =>
                prev && prev.id === newLog.package_id ? { ...prev, whatsappStatus: status } : prev
              );
            }
          }
        }
      )
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [recentSaved, lastNotificationToast]);

  const loadUnitsAndResidents = async () => {
    const supabase = createClient();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/login?redirect=/portaria/nova';
        return;
      }

      const { data: uData } = await supabase.from('units').select('*').order('block').order('unit_number');
      const { data: rData } = await supabase.from('residents').select('*').eq('active', true);
      if (uData) {
        const uniqueMap = new Map<string, Unit>();
        uData.forEach((u) => {
          const key = `${(u.block || 'Bloco A').trim().toUpperCase()}__${(u.unit_number || '').trim()}`;
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, u);
          }
        });
        const dedupedUnits = Array.from(uniqueMap.values());
        setUnits(dedupedUnits);
        if (dedupedUnits.length > 0 && !selectedBlock) {
          setSelectedBlock(dedupedUnits[0].block || 'Bloco A');
        }
      }
      if (rData) setResidents(rData);
    } catch (err) {
      console.error('Erro ao carregar unidades e moradores:', err);
    }
  };

// ─── Extração de Unidade e Bloco Brasileira ──────────────────────────────────
function parseBrazilianUnitAndBlock(rawUnit: any, rawBlock: any, rawAddress?: string) {
  let unit = rawUnit ? String(rawUnit).trim() : '';
  let block = rawBlock ? String(rawBlock).trim() : null;
  const full = `${rawAddress || ''} ${unit} ${block || ''}`.trim();

  if (block && /civit|avenida|rua|alameda|estrada|rodovia|bairro/i.test(block)) {
    block = null;
  }

  const explicitMatch = full.match(/(?:BLOCO?|BL\.?|TORRE?)\s*([A-Za-z0-9]{1,3})[^\d]*(?:APTO?\.?|AP\.?|UNIDADE|UND\.?|APART\.?)\s*(\d{1,5})/i);
  if (explicitMatch) {
    block = `Bloco ${explicitMatch[1].toUpperCase()}`;
    unit = explicitMatch[2];
    return { unit, block };
  }

  const reverseExplicit = full.match(/(?:APTO?\.?|AP\.?|UNIDADE|UND\.?|APART\.?)\s*(\d{1,5})[^\w]*(?:BLOCO?|BL\.?|TORRE?)\s*([A-Za-z0-9]{1,3})/i);
  if (reverseExplicit) {
    unit = reverseExplicit[1];
    block = `Bloco ${reverseExplicit[2].toUpperCase()}`;
    return { unit, block };
  }

  const streetDashUnit = full.match(/(?:n[ºo°]?\s*\d{1,6}\s*[-–—/]\s*)([A-Za-z])?(\d{1,5})([A-Za-z])?/i);
  if (streetDashUnit) {
    const letter = streetDashUnit[1] || streetDashUnit[3];
    if (letter && (!block || block === 'null')) {
      block = `Bloco ${letter.toUpperCase()}`;
    }
    unit = streetDashUnit[2];
    return { unit, block };
  }

  const letterNumberMatch = unit.match(/^([A-Za-z])\s*(\d{1,5})$/) || full.match(/\b([A-Za-z])(\d{2,5})\b/);
  if (letterNumberMatch) {
    if (!block || block === 'null') {
      block = `Bloco ${letterNumberMatch[1].toUpperCase()}`;
    }
    unit = letterNumberMatch[2];
    return { unit, block };
  }

  const aptMatch = full.match(/(?:APTO?\.?|AP\.?|UNIDADE|UND\.?)\s*[:\-]?\s*(\d{1,5})/i);
  if (aptMatch) {
    unit = aptMatch[1];
    return { unit, block };
  }

  const allNums = unit.match(/\b\d{1,5}\b/g);
  if (allNums && allNums.length > 1) {
    unit = allNums[allNums.length - 1];
  } else if (allNums && allNums.length === 1) {
    unit = allNums[0];
  }

  const cleanDigits = unit.replace(/\D/g, '');
  return { unit: cleanDigits || null, block };
}

  const applyOcrData = (ocrResult: OCRResponse) => {
    setOcrData(ocrResult);

    if (ocrResult.ocr.carrier) {
      setCarrier(ocrResult.ocr.carrier);
    }
    if (ocrResult.ocr.trackingCode) {
      setTrackingCode(ocrResult.ocr.trackingCode);
    }
    if ((ocrResult.ocr as any).invoiceNumber) {
      setInvoiceNumber((ocrResult.ocr as any).invoiceNumber);
    }
    if (ocrResult.ocr.recipientName) {
      setRecipientNameOcr(ocrResult.ocr.recipientName);
    }

    // Match inteligente e instantâneo da unidade e bloco
    let targetUnitId = ocrResult.suggestedMatch?.unit?.id;
    const { unit: cleanNum, block: suggestedBlock } = parseBrazilianUnitAndBlock(
      ocrResult.ocr.unitNumber,
      ocrResult.ocr.block
    );

    if (!targetUnitId && cleanNum) {
      // 1. Tenta match exato por número e bloco
      let found = units.find((u) => {
        const uNum = u.unit_number.replace(/\D/g, '');
        const matchNum = uNum === cleanNum;
        if (suggestedBlock) {
          const uBlock = (u.block || '').toLowerCase();
          const sBlock = suggestedBlock.toLowerCase();
          return matchNum && (uBlock.includes(sBlock) || sBlock.includes(uBlock));
        }
        return matchNum;
      });

      // 2. Se não achou com bloco, busca só por número da unidade
      if (!found) {
        found = units.find((u) => u.unit_number.replace(/\D/g, '') === cleanNum);
      }

      if (found) targetUnitId = found.id;
    }

    if (targetUnitId) {
      const matchedUnit = units.find((u) => u.id === targetUnitId);
      if (matchedUnit) {
        setSelectedBlock(matchedUnit.block || 'Bloco A');
        setSelectedUnitNumber(matchedUnit.unit_number);
        setSelectedUnitId(targetUnitId);
      }
      const unitRes = residents.filter((r) => r.unit_id === targetUnitId);
      if (ocrResult.suggestedMatch?.resident) {
        setSelectedResidentId(ocrResult.suggestedMatch.resident.id);
        setCustomPhone(ocrResult.suggestedMatch.resident.phone);
      } else if (unitRes.length > 0) {
        const recipientFirst = (ocrResult.ocr.recipientName || '').toLowerCase().trim().split(/\s+/)[0];
        const matchByName =
          recipientFirst && recipientFirst.length >= 3
            ? unitRes.find((r) => r.name.toLowerCase().includes(recipientFirst))
            : null;
        const chosen = matchByName || unitRes[0];
        setSelectedResidentId(chosen.id);
        setCustomPhone(chosen.phone);
      }
    }
  };

  const handleCapturePhoto = async (blob: Blob, previewUrl: string, precalculatedOcr?: OCRResponse) => {
    setCapturedBlob(blob);
    setCapturedPreview(previewUrl);
    setStep('CONFIRM');

    // Se a IA já analisou ao vivo em segundo plano com a câmera aberta
    if (precalculatedOcr) {
      applyOcrData(precalculatedOcr);
      return;
    }

    // Caso o porteiro tenha clicado manualmente em Fotografar antes da análise automática
    setIsOcrProcessing(true);
    try {
      const ocrResult = await LocalApiClient.uploadLabelAndOCR(blob);
      applyOcrData(ocrResult);
    } catch (err: any) {
      console.error('Falha no OCR:', err);
    } finally {
      setIsOcrProcessing(false);
    }
  };

  // Filtra os moradores da unidade selecionada
  const filteredResidents = residents.filter(r => r.unit_id === selectedUnitId);

  const handleBlockChange = (block: string) => {
    setSelectedBlock(block);
    setSelectedUnitNumber('');
    setSelectedUnitId('');
    setSelectedResidentId('');
    setCustomPhone('');
  };

  const handleUnitNumberChange = (unitNum: string) => {
    setSelectedUnitNumber(unitNum);
    const found = units.find(
      (u) => (u.block || 'Bloco A').trim().toUpperCase() === (selectedBlock || 'Bloco A').trim().toUpperCase() &&
             u.unit_number.trim() === unitNum.trim()
    );
    if (found) {
      handleUnitChange(found.id);
    } else {
      setSelectedUnitId('');
      setSelectedResidentId('');
      setCustomPhone('');
    }
  };

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
      const unitText = selectedUnit ? `Apto ${selectedUnit.unit_number} - ${selectedUnit.block}` : 'Unidade';
      const resName = selectedRes?.name || recipientNameOcr || 'Morador';

      // Concatena nota fiscal nas notas caso preenchida
      const finalNotes = invoiceNumber
        ? `NF: ${invoiceNumber}${notes ? ` | ${notes}` : ''}`
        : (notes || null);

      // Se o path da imagem ainda está vazio (modo ao vivo), faz o upload agora antes de salvar
      let labelImagePath = ocrData?.image?.path || null;
      if (!labelImagePath && capturedBlob) {
        try {
          const uploadData = await LocalApiClient.uploadLabelAndOCR(capturedBlob);
          labelImagePath = uploadData?.image?.path || null;
        } catch (uploadErr) {
          console.warn('[Nova] Falha no upload da imagem antes de salvar:', uploadErr);
        }
      }

      const res = await LocalApiClient.createPackage({
        unitId: selectedUnitId,
        residentId: selectedResidentId || null,
        carrier: carrier,
        trackingCode: trackingCode || null,
        recipientNameOcr: recipientNameOcr || null,
        labelImagePath,
        notes: finalNotes,
        sendWhatsApp: sendWhatsApp,
        residentPhone: customPhone || selectedRes?.phone || null,
        residentName: resName,
        unitInfo: unitText
      });

      const pkgId = res.package?.id;
      const pickupCode = res.package?.pickup_code || '----';

      // Feedback háptico de sucesso
      try {
        navigator.vibrate?.([40, 60, 40]);
      } catch {}

      // Se a criação inicial (pela Vercel ou Local) falhou ao enviar o WhatsApp,
      // tenta disparar a notificação local como fallback.
      if (pkgId && !res.whatsapp?.sent) {
        LocalApiClient.notifyPackage(pkgId, false).catch(() => {});
      }

      // Adiciona na lista de recentes para acompanhamento em tempo real
      const newSavedItem: RecentSavedPackage = {
        id: pkgId,
        pickupCode,
        unitText,
        residentName: resName,
        carrier,
        whatsappStatus: res.whatsapp?.sent ? 'SENT' : 'SENDING',
        createdAt: new Date()
      };

      setRecentSaved(prev => [newSavedItem, ...prev.slice(0, 9)]);
      setLastNotificationToast(newSavedItem);

      // Auto-oculta o toast após 6s
      setTimeout(() => {
        setLastNotificationToast(prev => (prev?.id === pkgId ? null : prev));
      }, 6000);

      // Retorna IMEDIATAMENTE para a câmera para ler o próximo pacote sem travar!
      resetForm();
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
    setSelectedUnitNumber('');
    setCarrier('Mercado Livre');
    setTrackingCode('');
    setInvoiceNumber('');
    setRecipientNameOcr('');
    setNotes('');
    setCustomPhone('');
    setDuplicateWarning(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
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
                A IA está identificando o morador, unidade, NF e remetente na etiqueta.
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
                <span className="text-slate-500">Remetente:</span>
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

      {/* Toast de Notificação Imediata da Última Encomenda Salva */}
      {lastNotificationToast && (
        <div className="bg-slate-900/95 border border-emerald-500/50 rounded-2xl p-4 shadow-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">
                  {lastNotificationToast.unitText}
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-mono font-bold text-xs border border-emerald-500/30">
                  Cód: {lastNotificationToast.pickupCode}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {lastNotificationToast.residentName} • {lastNotificationToast.carrier}
              </p>
            </div>
          </div>

          {/* Status do WhatsApp em Tempo Real */}
          <div className="flex items-center gap-2 self-end sm:self-center">
            {lastNotificationToast.whatsappStatus === 'SENT' ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
                <Phone className="w-3.5 h-3.5 text-emerald-400" /> WhatsApp Enviado
              </span>
            ) : lastNotificationToast.whatsappStatus === 'FAILED' ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/20 text-rose-300 text-xs font-bold border border-rose-500/30">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" /> Erro ao Enviar
              </span>
            ) : (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30 animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" /> Disparando WhatsApp...
              </span>
            )}
            <button
              onClick={() => setLastNotificationToast(null)}
              className="p-1 text-slate-500 hover:text-slate-300 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
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
        <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-3 py-1 rounded-full flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" /> Recepção Contínua
        </span>
      </div>

      {step === 'CAPTURE' ? (
        /* Passo 1: Captura da Foto Imediata */
        <div className="space-y-5 animate-fade-in">
          <CameraCapture
            key={`cam-${step}-${recentSaved.length}`}
            onCapture={handleCapturePhoto}
            onCancel={() => router.push('/portaria')}
          />

          {/* Fila de Encomendas Recebidas Recentemente nesta sessão */}
          {recentSaved.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                  <History className="w-4 h-4 text-indigo-400" />
                  <span>Últimas Encomendas Recebidas ({recentSaved.length})</span>
                </div>
                <span className="text-[10px] text-slate-500 font-medium">Disparos em segundo plano</span>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {recentSaved.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="flex items-center justify-between bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 text-xs hover:border-slate-700 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="px-2.5 py-1 bg-slate-800 border border-slate-700 text-emerald-400 rounded-xl font-black font-mono tracking-wider">
                        {pkg.pickupCode}
                      </div>
                      <div>
                        <span className="font-bold text-white block">{pkg.unitText}</span>
                        <span className="text-slate-400 text-[11px]">
                          {pkg.residentName} • {pkg.carrier}
                        </span>
                      </div>
                    </div>

                    <div>
                      {pkg.whatsappStatus === 'SENT' ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded-xl">
                          <Check className="w-3.5 h-3.5" /> WhatsApp Enviado
                        </span>
                      ) : pkg.whatsappStatus === 'FAILED' ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-950/60 border border-rose-800/60 px-2.5 py-1 rounded-xl">
                          <AlertTriangle className="w-3.5 h-3.5" /> Erro ao Enviar
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-300 bg-amber-950/60 border border-amber-800/60 px-2.5 py-1 rounded-xl animate-pulse">
                          <RefreshCw className="w-3 h-3 animate-spin text-amber-400" /> Enviando...
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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
            {/* Bloco, Apartamento e Morador */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Bloco / Torre <span className="text-rose-400">*</span>
                </label>
                <select
                  value={selectedBlock}
                  onChange={(e) => handleBlockChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500 font-medium"
                >
                  {Array.from(new Set(units.map((u) => u.block || 'Bloco A'))).sort().map((blockName) => (
                    <option key={blockName} value={blockName}>
                      {blockName}
                    </option>
                  ))}
                  {selectedBlock && !units.some((u) => u.block === selectedBlock) && (
                    <option value={selectedBlock}>{selectedBlock}</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Apartamento <span className="text-rose-400">*</span>
                </label>
                <select
                  value={selectedUnitNumber}
                  onChange={(e) => handleUnitNumberChange(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500 font-bold"
                >
                  <option value="">Selecione o apto...</option>
                  {Array.from(
                    new Set(
                      units
                        .filter((u) => (u.block || 'Bloco A').toUpperCase() === (selectedBlock || 'Bloco A').toUpperCase())
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

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Morador Cadastrado
                </label>
                <select
                  value={selectedResidentId}
                  onChange={(e) => handleResidentChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">
                    {filteredResidents.length === 0 ? 'Sem morador cadastrado' : 'Selecione o morador...'}
                  </option>
                  {filteredResidents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.is_primary ? '(Titular)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Nome na Etiqueta e Remetente */}
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
                  Remetente:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    list="remetente-list"
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="Ex: Mercado Livre, Shopee, Amazon, Nike..."
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <datalist id="remetente-list">
                    <option value="Mercado Livre" />
                    <option value="Shopee" />
                    <option value="Amazon" />
                    <option value="Correios" />
                    <option value="Shein" />
                    <option value="Magalu" />
                    <option value="Total Express" />
                    <option value="Loggi" />
                    <option value="Jadlog" />
                    <option value="Dell" />
                    <option value="Nike" />
                    <option value="Drogasil" />
                    <option value="Kabum" />
                    <option value="Zara" />
                    <option value="Outro" />
                  </datalist>
                </div>
                {/* Sugestões Rápidas em Pills */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {['Mercado Livre', 'Shopee', 'Amazon', 'Correios', 'Shein', 'Magalu'].map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      onClick={() => setCarrier(sug)}
                      className={`text-[11px] px-2 py-0.5 rounded-lg border transition ${
                        carrier === sug
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      {sug}
                    </button>
                  ))}
                </div>
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
