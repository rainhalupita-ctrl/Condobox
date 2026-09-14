'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../contexts/auth-context';
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
  RefreshCw,
  Users
} from 'lucide-react';

export default function RetiradaPage() {
  const router = useRouter();
  const { effectiveCondoId } = useAuth();
  const [step, setStep] = useState<'SCAN' | 'SIGN' | 'SUCCESS'>('SCAN');
  const [scannedPackage, setScannedPackage] = useState<PackageType | null>(null);
  const [deliveredToName, setDeliveredToName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [receiptData, setReceiptData] = useState<any | null>(null);
  const [additionalPendingPackages, setAdditionalPendingPackages] = useState<PackageType[]>([]);
  const [isFlushingBatch, setIsFlushingBatch] = useState(false);
  const [nextPackageCodeInput, setNextPackageCodeInput] = useState('');
  const [nextPackageCodeError, setNextPackageCodeError] = useState<string | null>(null);

  // Remove marcações internas como CIENTE e DELIVERY_NOTIFIED para exibição amigável
  const getCleanNotes = (notes?: string | null) => {
    if (!notes) return null;
    const clean = notes
      .split(';')
      .filter((n) => !n.startsWith('CIENTE:') && !n.startsWith('DELIVERY_NOTIFIED:') && !n.startsWith('Ciência confirmada'))
      .join(' ')
      .trim();
    return clean || null;
  };

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
        
        if (effectiveCondoId) {
          query = query.eq('condo_id', effectiveCondoId);
        }

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

      // Preenche com o terceiro autorizado (se houver) ou morador/destinatário
      let initialDeliveredTo = found.resident?.name || found.recipient_name_ocr || '';
      const notes = (found as any).notes || '';
      if (notes.includes('TERCEIRO_AUTORIZADO:')) {
        const match = notes.match(/TERCEIRO_AUTORIZADO:\s*([^|;\n(]+)/);
        if (match && match[1]?.trim()) {
          initialDeliveredTo = match[1].trim();
        }
      } else if ((found as any).delivered_to_name) {
        initialDeliveredTo = (found as any).delivered_to_name;
      }

      setDeliveredToName(initialDeliveredTo);
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
      const supabase = createClient();

      // 1. Busca encomendas que realmente NÃO foram recebidas/entregues ainda deste morador
      let otherPending: PackageType[] = [];
      if (supabase && (scannedPackage.resident_id || scannedPackage.unit_id)) {
        try {
          let pendingQuery = supabase
            .from('packages')
            .select('*, unit:units(*), resident:residents(*)')
            .neq('id', scannedPackage.id)
            .in('status', ['RECEIVED', 'NOTIFIED'])
            .is('delivered_at', null);

          if (scannedPackage.condo_id || effectiveCondoId) {
            pendingQuery = pendingQuery.eq('condo_id', scannedPackage.condo_id || effectiveCondoId);
          }

          // Filtra estritamente pelo morador específico que está retirando
          if (scannedPackage.resident_id) {
            pendingQuery = pendingQuery.eq('resident_id', scannedPackage.resident_id);
          } else if (scannedPackage.unit_id) {
            pendingQuery = pendingQuery.eq('unit_id', scannedPackage.unit_id);
          }

          const { data } = await pendingQuery;
          if (data && data.length > 0) {
            otherPending = data as PackageType[];
          }
        } catch (queryErr) {
          console.warn('[handleSaveSignature] Falha ao consultar outras encomendas pendentes:', queryErr);
        }
      }

      const hasMore = otherPending.length > 0;

      // 2. Submete a assinatura passando hasMorePending
      const res = await LocalApiClient.submitSignature({
        packageId: scannedPackage.id,
        signatureBase64,
        deliveredToName: deliveredToName || 'Morador',
        sendWhatsAppConfirmation: true,
        hasMorePending: hasMore
      });

      // 3. Se o morador NÃO possui outras pendentes, garante envio imediato de WhatsApp (sem delay)
      const phone = scannedPackage.resident?.phone || (scannedPackage as any)?.phone;
      if (!hasMore && phone) {
        LocalApiClient.flushDeliveryBatch(phone, (scannedPackage.condo_id || effectiveCondoId) || undefined).catch(() => {});
      }

      // Dispara broadcast em tempo real para o site do morador em todos os canais
      const channelsToNotify = [
        `public-package-${scannedPackage.id}`,
        scannedPackage.qr_token ? `public-package-${scannedPackage.qr_token}` : null,
        scannedPackage.pickup_code ? `public-package-${scannedPackage.pickup_code}` : null,
        'packages-morador-live'
      ].filter(Boolean) as string[];

      channelsToNotify.forEach((chName) => {
        const ch = supabase.channel(chName);
        ch.subscribe(async (status: string) => {
          if (status === 'SUBSCRIBED') {
            await ch.send({
              type: 'broadcast',
              event: 'status-updated',
              payload: {
                status: 'DELIVERED',
                packageId: scannedPackage.id,
                qrToken: scannedPackage.qr_token,
                pickupCode: scannedPackage.pickup_code
              }
            }).catch(() => {});
            setTimeout(() => supabase.removeChannel(ch), 3000);
          }
        });
      });

      setAdditionalPendingPackages(otherPending);
      setReceiptData(res);
      setStep('SUCCESS');
    } catch (err: any) {
      alert(`Erro ao concluir retirada: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleValidateNextCode = async (codeToVerify: string) => {
    const clean = codeToVerify.trim().toUpperCase();
    if (!clean) return;
    setNextPackageCodeError(null);

    // 1. Verifica se o código confere com alguma das encomendas pendentes deste morador
    const match = additionalPendingPackages.find(
      (p) => p.pickup_code?.toUpperCase() === clean || p.qr_token?.toUpperCase() === clean
    );

    if (match) {
      setScannedPackage(match);
      setAdditionalPendingPackages((prev) => prev.filter((p) => p.id !== match.id));
      setReceiptData(null);
      setErrorMessage(null);
      setNextPackageCodeInput('');
      setNextPackageCodeError(null);
      setStep('SIGN');
      return;
    }

    // 2. Se não bateu na lista pendente deste morador, avisa o porteiro
    setNextPackageCodeError(`Código "${clean}" não confere com as encomendas pendentes deste morador.`);
  };

  const handleStartScanningNext = () => {
    setStep('SCAN');
    setScannedPackage(null);
    setErrorMessage(null);
    setNextPackageCodeInput('');
    setNextPackageCodeError(null);
  };

  const handleFinishWithoutOthers = async () => {
    setIsFlushingBatch(true);
    try {
      const phone = scannedPackage?.resident?.phone || (scannedPackage as any)?.phone;
      if (phone) {
        await LocalApiClient.flushDeliveryBatch(phone, (scannedPackage?.condo_id || effectiveCondoId) || undefined);
      }
    } catch (err) {
      console.warn('[handleFinishWithoutOthers] Erro ao disparar flush:', err);
    } finally {
      setIsFlushingBatch(false);
      resetFlow();
    }
  };

  const resetFlow = () => {
    // Se havia encomendas pendentes que o porteiro optou por não retirar agora, dispara o flush imediatamente
    if (additionalPendingPackages.length > 0) {
      const phone = scannedPackage?.resident?.phone || (scannedPackage as any)?.phone;
      if (phone) {
        LocalApiClient.flushDeliveryBatch(phone, (scannedPackage?.condo_id || effectiveCondoId) || undefined).catch(() => {});
      }
    }

    setStep('SCAN');
    setScannedPackage(null);
    setDeliveredToName('');
    setReceiptData(null);
    setErrorMessage(null);
    setAdditionalPendingPackages([]);
    setNextPackageCodeInput('');
    setNextPackageCodeError(null);
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

            {/* Informações de Terceiro Autorizado */}
            {(() => {
              const notes = (scannedPackage as any)?.notes || '';
              const isTP = notes.includes('TERCEIRO_AUTORIZADO:') || Boolean((scannedPackage as any)?.delivered_to_name);
              const match = notes.match(/TERCEIRO_AUTORIZADO:\s*([^|;\n]+)/);
              const tpText = match ? match[1].trim() : ((scannedPackage as any)?.delivered_to_name || '');
              if (!isTP || !tpText) return null;

              return (
                <div className="p-3.5 bg-purple-500/15 border border-purple-500/30 rounded-2xl flex items-start gap-3">
                  <Users className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-purple-300">
                        Retirada Autorizada para Terceiro
                      </span>
                      <span className="text-[10px] uppercase font-black bg-purple-500/30 text-purple-200 px-2 py-0.5 rounded-md">
                        Autorizado
                      </span>
                    </div>
                    <p className="text-white font-bold mt-1 text-sm">
                      {tpText}
                    </p>
                    <p className="text-[11px] text-purple-300/80 mt-0.5">
                      O morador confirmou previamente a liberação para esta pessoa retirar.
                    </p>
                  </div>
                </div>
              );
            })()}

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

          {/* Card Interativo de Encomendas Adicionais Pendentes */}
          {additionalPendingPackages.length > 0 && (
            <div className="p-5 bg-amber-500/10 border-2 border-amber-500/40 rounded-3xl text-left space-y-4 shadow-xl animate-fade-in">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl">
                  <Package className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full">
                    Atenção Porteiro
                  </span>
                  <h3 className="text-sm sm:text-base font-black text-white mt-0.5">
                    O morador possui mais {additionalPendingPackages.length} encomenda(s) aguardando retirada!
                  </h3>
                </div>
              </div>

              {/* Lista das encomendas restantes (sem exibir o código secreto do morador) */}
              <div className="space-y-2">
                {additionalPendingPackages.map((pkg, idx) => {
                  const cleanNotes = getCleanNotes(pkg.notes);
                  const receivedDate = pkg.received_at
                    ? new Date(pkg.received_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })
                    : null;

                  return (
                    <div
                      key={pkg.id}
                      className="flex items-center justify-between p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 font-bold flex items-center justify-center text-[10px] shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <span className="font-bold text-slate-100 block truncate">{pkg.carrier}</span>
                          {receivedDate && (
                            <span className="text-[10px] text-slate-400 block">Recebida em: {receivedDate}</span>
                          )}
                          {cleanNotes && (
                            <span className="text-[10px] text-amber-400/90 block truncate">{cleanNotes}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-amber-400 bg-amber-950/60 border border-amber-800/60 px-2.5 py-1 rounded-lg shrink-0">
                        Aguardando Validação
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="p-4 bg-slate-950/70 border border-amber-500/30 rounded-2xl space-y-3">
                <p className="text-xs font-bold text-amber-200">
                  Para fazer a retirada do outro pacote, bipe o QR Code ou insira o código do morador:
                </p>

                {/* Inserir Código do Morador */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleValidateNextCode(nextPackageCodeInput);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={nextPackageCodeInput}
                    onChange={(e) => {
                      setNextPackageCodeInput(e.target.value.toUpperCase());
                      setNextPackageCodeError(null);
                    }}
                    placeholder="Digite o código (ex: 7E50DB)..."
                    maxLength={10}
                    className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-xl text-amber-300 font-mono font-bold text-center uppercase tracking-widest text-sm outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!nextPackageCodeInput.trim() || isLoading}
                    className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl transition flex items-center gap-1.5 shadow-md shadow-amber-950/50 active:scale-95 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Validar
                  </button>
                </form>

                {nextPackageCodeError && (
                  <p className="text-xs text-rose-400 font-semibold flex items-center gap-1.5 animate-fade-in">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {nextPackageCodeError}
                  </p>
                )}

                {/* Botão de Bipar QR Code com a Câmera */}
                <button
                  type="button"
                  onClick={handleStartScanningNext}
                  className="w-full py-2.5 px-4 bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-300 font-bold text-xs rounded-xl transition flex items-center justify-center gap-2 shadow-sm active:scale-98 cursor-pointer"
                >
                  <QrCode className="w-4 h-4 text-sky-400" />
                  <span>Bipar QR Code com a Câmera</span>
                </button>
              </div>

              {/* Botão Finalizar Atendimento */}
              <div className="pt-1">
                <button
                  type="button"
                  disabled={isFlushingBatch}
                  onClick={handleFinishWithoutOthers}
                  className="w-full py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl border border-slate-700 transition active:scale-[0.98] cursor-pointer"
                >
                  {isFlushingBatch ? 'Enviando WhatsApp...' : 'Finalizar Atendimento (Entregar apenas este)'}
                </button>
              </div>

              <p className="text-[10px] text-center text-slate-500">
                💡 Ao finalizar, o morador receberá a notificação de confirmação da retirada feita.
              </p>
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
              onClick={async () => {
                if (additionalPendingPackages.length > 0) {
                  const phone = scannedPackage?.resident?.phone || (scannedPackage as any)?.phone;
                  if (phone) {
                    await LocalApiClient.flushDeliveryBatch(phone, (scannedPackage?.condo_id || effectiveCondoId) || undefined).catch(() => {});
                  }
                }
                router.push('/portaria');
              }}
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
