'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { QRScanner } from '../../../components/qr-scanner';
import { SignaturePad } from '../../../components/signature-pad';
import { PackageCard } from '../../../components/package-card';
import { LocalApiClient } from '../../../lib/local-api';
import { createClient } from '../../../lib/supabase/client';
import { Package as PackageType } from '../../../types/database';
import {
  ArrowLeft,
  QrCode,
  CheckCircle2,
  AlertCircle,
  Search,
  Package,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';

export default function RetiradaPage() {
  const router = useRouter();
  const [step, setStep] = useState<'SCAN' | 'SIGN' | 'SUCCESS'>('SCAN');
  const [scannedPackage, setScannedPackage] = useState<PackageType | null>(null);
  const [deliveredToName, setDeliveredToName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<any | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = '/login?redirect=/portaria/retirada';
      }
    };
    checkAuth();
  }, []);

  const handleScanCode = async (codeOrToken: string) => {
    setIsLoading(true);
    setErrorMessage(null);

    let cleanCode = codeOrToken.trim();
    if (cleanCode.includes('/p/')) {
      cleanCode = cleanCode.split('/p/')[1].split('?')[0].trim();
    } else if (cleanCode.includes('/encomenda/')) {
      cleanCode = cleanCode.split('/encomenda/')[1].split('?')[0].trim();
    }

    try {
      const supabase = createClient();
      let found: PackageType | null = null;

      if (supabase) {
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanCode);
        let query = supabase.from('packages').select('*, unit:units(*), resident:residents(*)');
        
        if (isUUID) {
          query = query.eq('id', cleanCode);
        } else {
          // Fallback seguro: se não encontrar com qr_token, vai tentar encontrar com pickup_code no or
          query = query.or(`pickup_code.eq.${cleanCode},qr_token.eq.${cleanCode}`);
        }
        
        const { data, error } = await query.maybeSingle();

        if (error) {
          console.error('[handleScanCode] Supabase query error:', error);
        } else if (data) {
          found = data as PackageType;
        }
      }

      // Se não encontrou via Supabase, tenta buscar na API local
      if (!found) {
        try {
          console.log('[handleScanCode] Tentando buscar na API local...');
          // Evita travamento da UI se a API local estiver fora do ar
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          
          const res = await fetch(`${LocalApiClient.getCurrentImageBaseUrl()}/api/packages/search?q=${cleanCode}`, {
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);

          if (res.ok) {
            const json = await res.json();
            if (json.packages && json.packages.length > 0) {
              found = json.packages[0];
            }
          } else {
            console.warn('[handleScanCode] Local API retornou status não-ok:', res.status);
          }
        } catch (fetchErr) {
          console.warn('[handleScanCode] Fallback Local API falhou:', fetchErr);
        }
      }

      if (!found) {
        setErrorMessage(`Nenhuma encomenda encontrada com o código "${cleanCode}". Verifique e tente novamente.`);
        return;
      }

      if (found.status === 'DELIVERED') {
        setErrorMessage(`Esta encomenda (${found.carrier} - Apto ${found.unit?.unit_number}) já foi entregue anteriormente.`);
        return;
      }

      setScannedPackage(found);
      setDeliveredToName(found.resident?.name || found.recipient_name_ocr || '');
      setStep('SIGN');
    } catch (err: any) {
      console.error('[handleScanCode] Unexpected error:', err);
      setErrorMessage(`Erro ao consultar encomenda: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSignature = async (signatureBase64: string) => {
    if (!scannedPackage) return;
    setIsLoading(true);

    try {
      const res = await LocalApiClient.submitSignature({
        packageId: scannedPackage.id,
        signatureBase64,
        deliveredToName: deliveredToName || 'Morador',
        sendWhatsAppConfirmation: true
      });

      // Dispara broadcast em tempo real para o site do morador
      const supabase = createClient();
      await supabase.channel(`public-package-${scannedPackage.id}`).send({
        type: 'broadcast',
        event: 'status-updated',
        payload: { status: 'DELIVERED' }
      });

      setReceiptData(res);
      setStep('SUCCESS');
    } catch (err: any) {
      alert(`Erro ao concluir retirada: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const resetFlow = () => {
    setStep('SCAN');
    setScannedPackage(null);
    setDeliveredToName('');
    setReceiptData(null);
    setErrorMessage(null);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header com voltar */}
      <div className="flex items-center justify-between">
        <Link
          href="/portaria"
          className="flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar ao Painel da Portaria
        </Link>
        <span className="text-xs font-bold uppercase tracking-wider text-sky-400 bg-sky-950/60 border border-sky-800/60 px-3 py-1 rounded-full">
          Retirada Segura
        </span>
      </div>

      {step === 'SCAN' && (
        <div className="space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-black text-slate-100">Retirada de Encomenda</h1>
            <p className="text-xs text-slate-400">
              Aponte a câmera para o QR Code do morador ou digite o código de 4 dígitos.
            </p>
          </div>

          {errorMessage && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-2xl text-xs flex items-center gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isLoading ? (
            <div className="py-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-sky-400" />
              <p className="text-sm">Buscando encomenda...</p>
            </div>
          ) : (
            <QRScanner onScanSuccess={handleScanCode} />
          )}
        </div>
      )}

      {step === 'SIGN' && scannedPackage && (
        <div className="space-y-6 animate-fade-in">
          {/* Card da Encomenda Localizada */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-sky-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-sky-400">Encomenda Localizada</span>
              </div>
              <span className="text-xs font-mono font-bold bg-sky-950 text-sky-300 border border-sky-800 px-2.5 py-0.5 rounded-lg">
                Código: {scannedPackage.pickup_code}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-950 p-3 rounded-xl">
              <div>
                <span className="text-slate-500 block">Unidade:</span>
                <span className="font-bold text-slate-100 text-sm">
                  {scannedPackage.unit ? `${scannedPackage.unit.block} - Apto ${scannedPackage.unit.unit_number}` : 'Unidade'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Remetente:</span>
                <span className="font-bold text-slate-100">{scannedPackage.carrier}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                Nome da Pessoa que está Retirando:
              </label>
              <input
                type="text"
                value={deliveredToName}
                onChange={(e) => setDeliveredToName(e.target.value)}
                placeholder="Ex: Carlos Silva ou Maria (Esposa)"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Assinatura Touch */}
          <SignaturePad
            recipientName={deliveredToName}
            onSave={handleSaveSignature}
            onCancel={resetFlow}
          />
        </div>
      )}

      {step === 'SUCCESS' && (
        <div className="bg-slate-900 border border-emerald-500/40 rounded-3xl p-8 text-center space-y-6 shadow-2xl animate-fade-in">
          <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto">
            <ShieldCheck className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-black text-slate-100">Baixa Realizada com Sucesso!</h2>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              A encomenda foi entregue, a assinatura digital foi arquivada localmente com segurança e o morador foi notificado.
            </p>
          </div>

          {receiptData?.signature?.url && (
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 max-w-xs mx-auto">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold block mb-2">
                Assinatura Coletada
              </span>
              <img
                src={receiptData.signature.url}
                alt="Comprovante de Assinatura"
                className="h-20 w-auto mx-auto object-contain bg-slate-900 rounded-lg p-2 border border-slate-800"
              />
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <button
              onClick={resetFlow}
              className="flex items-center justify-center gap-2 py-3 px-6 bg-sky-600 hover:bg-sky-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-sky-950 transition"
            >
              <QrCode className="w-4 h-4" /> Realizar Outra Retirada
            </button>
            <button
              onClick={() => router.push('/portaria')}
              className="py-3 px-6 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-semibold text-sm transition"
            >
              Voltar ao Painel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
