'use client';

import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  FileSpreadsheet,
  ClipboardList,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Plus,
  RefreshCw,
  X,
  Building2,
  Users,
  Phone,
  Mail,
  FileText
} from 'lucide-react';

interface ParsedResident {
  id?: string;
  name: string;
  block: string;
  unitNumber: string;
  phone: string;
  email?: string;
  isValid?: boolean;
}

interface BatchResidentImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function BatchResidentImportModal({ isOpen, onClose, onSuccess }: BatchResidentImportModalProps) {
  const [activeMode, setActiveMode] = useState<'FILE' | 'PASTE'>('FILE');
  const [file, setFile] = useState<File | null>(null);
  const [rawPastedText, setRawPastedText] = useState('');
  const [defaultBlock, setDefaultBlock] = useState('Bloco A');

  const [parsedList, setParsedList] = useState<ParsedResident[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  // Processamento de Planilha Excel (.xlsx, .xls, .csv)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setIsParsing(true);
    setParseError(null);

    try {
      const data = await uploadedFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonRows = XLSX.utils.sheet_to_json<any>(worksheet, { defval: '' });

      if (!jsonRows || jsonRows.length === 0) {
        setParseError('A planilha selecionada está vazia.');
        setIsParsing(false);
        return;
      }

      const extracted: ParsedResident[] = [];

      jsonRows.forEach((row, index) => {
        const keys = Object.keys(row);
        let name = '';
        let block = defaultBlock;
        let unitNumber = '';
        let phone = '';
        let email = '';

        keys.forEach((key) => {
          const val = String(row[key]).trim();
          const cleanKey = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

          if (cleanKey.includes('nome') || cleanKey.includes('morador') || cleanKey.includes('condomino') || cleanKey === 'name') {
            name = val;
          } else if (cleanKey.includes('bloco') || cleanKey.includes('torre') || cleanKey.includes('block')) {
            if (val) block = val;
          } else if (cleanKey.includes('apto') || cleanKey.includes('apartamento') || cleanKey.includes('unidade') || cleanKey.includes('unit') || cleanKey.includes('numero') || cleanKey === 'ap') {
            unitNumber = val;
          } else if (cleanKey.includes('tel') || cleanKey.includes('cel') || cleanKey.includes('phone') || cleanKey.includes('whats') || cleanKey.includes('fone')) {
            phone = val;
          } else if (cleanKey.includes('mail')) {
            email = val;
          }
        });

        // Caso as colunas não tenham cabeçalhos reconhecidos, usa as primeiras colunas por índice
        if (!name && keys.length >= 2) {
          name = String(row[keys[0]]).trim();
          unitNumber = String(row[keys[1]]).trim();
          if (keys[2]) phone = String(row[keys[2]]).trim();
          if (keys[3]) email = String(row[keys[3]]).trim();
        }

        if (name || unitNumber) {
          extracted.push({
            id: `row-${index}`,
            name,
            block: block || defaultBlock,
            unitNumber,
            phone,
            email: email || undefined
          });
        }
      });

      if (extracted.length === 0) {
        setParseError('Não foi possível identificar colunas de Nome e Apartamento na planilha.');
      } else {
        setParsedList(extracted);
      }
    } catch (err: any) {
      console.error('Erro ao ler planilha:', err);
      setParseError(`Erro ao abrir a planilha: ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  // Processamento de Texto Colado com Heurística e IA Gemini
  const handleParseText = async (useAI = false) => {
    if (!rawPastedText.trim()) {
      setParseError('Cole o texto ou tabela antes de processar.');
      return;
    }

    setIsParsing(true);
    setParseError(null);

    if (useAI) {
      try {
        const res = await fetch('/api/residents/batch-parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawText: rawPastedText })
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.residents)) {
          setParsedList(
            data.residents.map((r: any, i: number) => ({
              id: `ai-${i}`,
              name: r.name || '',
              block: r.block || defaultBlock,
              unitNumber: String(r.unitNumber || ''),
              phone: String(r.phone || ''),
              email: r.email || ''
            }))
          );
        } else {
          setParseError(data.error || 'Falha ao processar com IA.');
        }
      } catch (err: any) {
        setParseError(`Erro na IA: ${err.message}`);
      } finally {
        setIsParsing(false);
      }
      return;
    }

    // Heurística rápida local por linhas e delimitadores (tabulação, vírgula, ponto e vírgula, traço)
    try {
      const lines = rawPastedText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const extracted: ParsedResident[] = [];

      lines.forEach((line, idx) => {
        // Ignora linha de cabeçalho óbvia
        if (idx === 0 && (line.toLowerCase().includes('nome') || line.toLowerCase().includes('morador'))) {
          return;
        }

        // Tenta separar por Tabulação (Excel copy-paste), Ponto-e-Vírgula ou Vírgula
        let parts = line.split('\t');
        if (parts.length < 2) parts = line.split(';');
        if (parts.length < 2) parts = line.split(',');
        if (parts.length < 2) parts = line.split(' - ');

        if (parts.length >= 2) {
          const name = parts[0]?.trim() || '';
          let unitNumber = parts[1]?.trim() || '';
          let block = defaultBlock;
          let phone = parts[2]?.trim() || '';
          let email = parts[3]?.trim() || '';

          // Se a unidade contiver o bloco (ex: "Bloco B 304")
          if (unitNumber.toLowerCase().includes('bloco') || unitNumber.toLowerCase().includes('torre')) {
            const blockMatch = unitNumber.match(/(bloco\s+[a-z0-9]+|torre\s+[a-z0-9]+)/i);
            if (blockMatch) {
              block = blockMatch[0];
              unitNumber = unitNumber.replace(blockMatch[0], '').replace(/\D/g, '').trim();
            }
          }

          if (name) {
            extracted.push({
              id: `paste-${idx}`,
              name,
              block: block || defaultBlock,
              unitNumber,
              phone,
              email
            });
          }
        }
      });

      if (extracted.length === 0) {
        // Se a heurística simples não achou, aciona automaticamente a IA Gemini
        await handleParseText(true);
        return;
      } else {
        setParsedList(extracted);
      }
    } catch (err: any) {
      setParseError(`Erro ao interpretar texto: ${err.message}`);
    } finally {
      setIsParsing(false);
    }
  };

  // Modificação de registros na tabela de pré-visualização
  const handleUpdateItem = (index: number, field: keyof ParsedResident, value: string) => {
    const updated = [...parsedList];
    updated[index] = { ...updated[index], [field]: value };
    setParsedList(updated);
  };

  const handleRemoveItem = (index: number) => {
    setParsedList(parsedList.filter((_, i) => i !== index));
  };

  const handleAddNewRow = () => {
    setParsedList([
      ...parsedList,
      {
        id: `new-${Date.now()}`,
        name: '',
        block: defaultBlock,
        unitNumber: '',
        phone: '',
        email: ''
      }
    ]);
  };

  const handleApplyDefaultBlock = () => {
    setParsedList(parsedList.map((p) => ({ ...p, block: defaultBlock })));
  };

  // Envio final para o Supabase em Lote
  const handleExecuteImport = async () => {
    if (parsedList.length === 0) return;

    setIsSaving(true);
    setParseError(null);

    try {
      const res = await fetch('/api/residents/batch-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ residents: parsedList })
      });

      const data = await res.json();
      if (data.success) {
        setImportResult(data);
        onSuccess();
      } else {
        setParseError(data.error || 'Falha ao salvar moradores no banco de dados.');
      }
    } catch (err: any) {
      setParseError(`Erro de conexão: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setRawPastedText('');
    setParsedList([]);
    setImportResult(null);
    setParseError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 sm:p-6 overflow-y-auto animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl p-6 sm:p-8 max-w-4xl w-full max-h-[90vh] flex flex-col space-y-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-400">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white">Importar Moradores em Lote</h2>
              <p className="text-xs text-slate-400">
                Cadastre dezenas de moradores e unidades instantaneamente por planilha ou lista copiada.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-200 rounded-xl hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sucesso após Importação */}
        {importResult ? (
          <div className="p-8 text-center space-y-6 animate-fade-in my-auto">
            <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-2xl flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black text-white">Importação Concluída com Sucesso!</h3>
              <p className="text-sm text-slate-400">
                Os moradores e apartamentos foram cadastrados e atualizados no condomínio.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto text-left">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-center">
                <span className="text-xs text-slate-400 block mb-1">Novos Moradores</span>
                <span className="text-2xl font-black text-emerald-400">+{importResult.createdCount}</span>
              </div>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-center">
                <span className="text-xs text-slate-400 block mb-1">Atualizados</span>
                <span className="text-2xl font-black text-sky-400">{importResult.updatedCount}</span>
              </div>
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 text-center">
                <span className="text-xs text-slate-400 block mb-1">Novas Unidades</span>
                <span className="text-2xl font-black text-amber-400">+{importResult.unitsCreatedCount}</span>
              </div>
            </div>

            {importResult.errors && importResult.errors.length > 0 && (
              <div className="p-3 bg-amber-950/30 border border-amber-800/40 rounded-xl text-xs text-amber-300 text-left max-h-32 overflow-y-auto">
                <span className="font-bold block mb-1">Avisos na importação:</span>
                {importResult.errors.map((err: string, i: number) => (
                  <div key={i}>• {err}</div>
                ))}
              </div>
            )}

            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={handleReset}
                className="py-2.5 px-5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition"
              >
                Importar Mais
              </button>
              <button
                onClick={onClose}
                className="py-2.5 px-6 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-950"
              >
                Fechar e Concluir
              </button>
            </div>
          </div>
        ) : parsedList.length === 0 ? (
          /* Passo 1: Upload ou Colar Lista */
          <div className="space-y-5 overflow-y-auto pr-1">
            {/* Seletor de Modo */}
            <div className="flex p-1 bg-slate-950 rounded-2xl border border-slate-800 w-fit">
              <button
                type="button"
                onClick={() => setActiveMode('FILE')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${activeMode === 'FILE' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <FileSpreadsheet className="w-4 h-4" /> Enviar Planilha (.xlsx, .csv)
              </button>
              <button
                type="button"
                onClick={() => setActiveMode('PASTE')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${activeMode === 'PASTE' ? 'bg-emerald-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <ClipboardList className="w-4 h-4" /> Colar Texto / Tabela
              </button>
            </div>

            {/* Configuração de Bloco Padrão */}
            <div className="flex items-center gap-3 p-3 bg-slate-950 rounded-2xl border border-slate-800">
              <Building2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs text-slate-300">Bloco / Torre padrão se não informado:</span>
              <input
                type="text"
                value={defaultBlock}
                onChange={(e) => setDefaultBlock(e.target.value)}
                placeholder="Ex: Bloco A"
                className="px-3 py-1 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white font-medium focus:outline-none focus:border-emerald-500 w-36"
              />
            </div>

            {activeMode === 'FILE' ? (
              /* Upload de Planilha */
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-emerald-500 bg-slate-950/50 hover:bg-slate-950 rounded-3xl p-8 sm:p-12 text-center space-y-4 cursor-pointer transition group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xlsx, .xls, .csv, .tsv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="w-16 h-16 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition duration-300">
                  <Upload className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <span className="text-sm font-bold text-slate-200 block">
                    Clique para selecionar ou arraste sua planilha aqui
                  </span>
                  <span className="text-xs text-slate-500 block">
                    Suporta arquivos Excel (.xlsx, .xls) e CSV (.csv) com colunas: Nome, Bloco, Apto, WhatsApp, Email.
                  </span>
                </div>
              </div>
            ) : (
              /* Colar Texto / Tabela */
              <div className="space-y-3">
                <textarea
                  rows={7}
                  value={rawPastedText}
                  onChange={(e) => setRawPastedText(e.target.value)}
                  placeholder={`Cole aqui os dados copiados do Excel, WhatsApp, Bloco de Notas ou PDF. Exemplo:
Carlos Silva	Bloco A	101	11988887777	carlos@email.com
Maria Oliveira	Bloco A	102	11977776666
João Souza - Ap 201 - 73981953741`}
                  className="w-full p-4 bg-slate-950 border border-slate-800 rounded-2xl text-slate-200 text-xs font-mono focus:outline-none focus:border-emerald-500 resize-none leading-relaxed"
                />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[11px] text-slate-500">
                    💡 O sistema reconhece automaticamente colunas separadas por tabulação, vírgulas ou texto livre.
                  </span>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isParsing || !rawPastedText.trim()}
                      onClick={() => handleParseText(false)}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition disabled:opacity-50"
                    >
                      {isParsing ? 'Processando...' : 'Processar Texto'}
                    </button>
                    <button
                      type="button"
                      disabled={isParsing || !rawPastedText.trim()}
                      onClick={() => handleParseText(true)}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-emerald-950 disabled:opacity-50"
                    >
                      <Sparkles className="w-3.5 h-3.5" /> Extrair com IA Gemini
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Mensagem de Erro */}
            {parseError && (
              <div className="p-3.5 bg-rose-950/40 border border-rose-800/60 rounded-2xl text-xs text-rose-300 flex items-center gap-2 animate-fade-in">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{parseError}</span>
              </div>
            )}
          </div>
        ) : (
          /* Passo 2: Pré-visualização, Edição e Confirmação */
          <div className="flex-1 flex flex-col space-y-4 min-h-0">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-slate-200">
                  {parsedList.length} Moradores Prontos para Cadastro
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyDefaultBlock}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 rounded-lg text-[11px] font-semibold transition"
                >
                  Aplicar "{defaultBlock}" em Todos
                </button>
                <button
                  type="button"
                  onClick={handleAddNewRow}
                  className="flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 rounded-lg text-[11px] font-bold transition"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar Linha
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 rounded-lg text-[11px] transition"
                >
                  Limpar / Outro Arquivo
                </button>
              </div>
            </div>

            {/* Tabela Editável de Moradores */}
            <div className="flex-1 border border-slate-800 rounded-2xl overflow-y-auto max-h-72 bg-slate-950/40">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-950 sticky top-0 border-b border-slate-800 text-slate-400 font-semibold z-10">
                  <tr>
                    <th className="p-2.5">Nome do Morador</th>
                    <th className="p-2.5 w-28">Bloco</th>
                    <th className="p-2.5 w-24">Apto</th>
                    <th className="p-2.5 w-36">WhatsApp / Tel</th>
                    <th className="p-2.5">E-mail (Opcional)</th>
                    <th className="p-2.5 w-10 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {parsedList.map((row, idx) => {
                    const isMissingRequired = !row.name.trim() || !row.unitNumber.trim();
                    return (
                      <tr
                        key={row.id || idx}
                        className={`hover:bg-slate-800/30 transition ${isMissingRequired ? 'bg-amber-950/15' : ''}`}
                      >
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) => handleUpdateItem(idx, 'name', e.target.value)}
                            placeholder="Nome Completo *"
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 font-medium text-xs"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={row.block}
                            onChange={(e) => handleUpdateItem(idx, 'block', e.target.value)}
                            placeholder="Bloco"
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 text-xs"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={row.unitNumber}
                            onChange={(e) => handleUpdateItem(idx, 'unitNumber', e.target.value)}
                            placeholder="Apto *"
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 font-bold text-xs"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="text"
                            value={row.phone}
                            onChange={(e) => handleUpdateItem(idx, 'phone', e.target.value)}
                            placeholder="Ex: 11988887777"
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-100 font-mono text-xs"
                          />
                        </td>
                        <td className="p-1.5">
                          <input
                            type="email"
                            value={row.email || ''}
                            onChange={(e) => handleUpdateItem(idx, 'email', e.target.value)}
                            placeholder="email@exemplo.com"
                            className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-800 focus:border-emerald-500 rounded-lg text-slate-300 text-xs"
                          />
                        </td>
                        <td className="p-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(idx)}
                            className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                            title="Remover Linha"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mensagem de Erro de Validação */}
            {parseError && (
              <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-xl text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{parseError}</span>
              </div>
            )}

            {/* Ações Finais */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800 shrink-0">
              <span className="text-[11px] text-slate-400">
                As unidades inexistentes serão criadas automaticamente.
              </span>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={isSaving || parsedList.length === 0}
                  onClick={handleExecuteImport}
                  className="flex items-center gap-2 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-950 transition disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Cadastrando {parsedList.length} Moradores...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> Confirmar e Cadastrar {parsedList.length} Moradores
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
