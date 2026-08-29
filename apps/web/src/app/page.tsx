'use client';

import React from 'react';
import Link from 'next/link';
import { Package, Smartphone, Shield, Sparkles, Camera, QrCode, PenTool, CheckCircle2, ArrowRight } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center py-6 sm:py-12 space-y-12">
      {/* Hero Section */}
      <div className="text-center space-y-4 max-w-3xl">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
          <Sparkles className="w-4 h-4" /> Arquitetura Local + Nuvem ($0/mês)
        </div>
        <h1 className="text-3xl sm:text-5xl font-black text-slate-100 tracking-tight leading-tight">
          Gestão Inteligente de <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">Encomendas</span> para Condomínios
        </h1>
        <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
          Recepção por IA com OCR Gemini Vision, notificações instantâneas no WhatsApp via Evolution API local e retirada segura com assinatura digital e QR Code.
        </p>
      </div>

      {/* Cards de Acesso por Perfil */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
        {/* Card 1: Portaria (Tablet) */}
        <Link
          href="/portaria"
          className="group relative bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-emerald-950/30 transition-all flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Modo Tablet / Portaria</span>
              <h2 className="text-xl font-bold text-slate-100 mt-1">Painel da Portaria</h2>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Entrada rápida com foto da etiqueta, OCR automático, notificações no WhatsApp e baixa por assinatura touch.
              </p>
            </div>
            <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
              <li className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-emerald-400" /> Foto + OCR Gemini Vision
              </li>
              <li className="flex items-center gap-2">
                <PenTool className="w-4 h-4 text-emerald-400" /> Assinatura digital na tela
              </li>
            </ul>
          </div>
          <div className="mt-6 flex items-center justify-between text-xs font-bold text-emerald-400 group-hover:translate-x-1 transition">
            <span>Abrir Portaria</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>

        {/* Card 2: Morador */}
        <Link
          href="/morador"
          className="group relative bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-sky-500/50 rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-sky-950/30 transition-all flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-110 transition">
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">Aplicativo PWA</span>
              <h2 className="text-xl font-bold text-slate-100 mt-1">Área do Morador</h2>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Veja suas encomendas recebidas, fotos da etiqueta, código numérico e QR Code para retirada imediata.
              </p>
            </div>
            <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
              <li className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-sky-400" /> QR Code instantâneo de retirada
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-sky-400" /> Histórico de recebimentos
              </li>
            </ul>
          </div>
          <div className="mt-6 flex items-center justify-between text-xs font-bold text-sky-400 group-hover:translate-x-1 transition">
            <span>Acessar Encomendas</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>

        {/* Card 3: Síndico / Admin */}
        <Link
          href="/admin"
          className="group relative bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-3xl p-6 sm:p-7 shadow-xl hover:shadow-indigo-950/30 transition-all flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 group-hover:scale-110 transition">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">Gestão do Condomínio</span>
              <h2 className="text-xl font-bold text-slate-100 mt-1">Painel do Síndico</h2>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Métricas em tempo real, controle de unidades e moradores, logs de WhatsApp e auditoria de segurança.
              </p>
            </div>
            <ul className="space-y-2 text-xs text-slate-300 pt-2 border-t border-slate-800/80">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-400" /> Cadastro de blocos e moradores
              </li>
              <li className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-400" /> Auditoria de retiradas e fotos
              </li>
            </ul>
          </div>
          <div className="mt-6 flex items-center justify-between text-xs font-bold text-indigo-400 group-hover:translate-x-1 transition">
            <span>Painel Administrativo</span>
            <ArrowRight className="w-4 h-4" />
          </div>
        </Link>
      </div>

      {/* Resumo dos Pilares Técnicos */}
      <div className="w-full max-w-5xl bg-slate-900/50 border border-slate-800/80 rounded-3xl p-6 sm:p-8">
        <h3 className="text-base font-bold text-slate-200 mb-4 flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-emerald-400" />
          Como Funciona o Fluxo de Ponta a Ponta
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
            <span className="font-bold text-emerald-400 block mb-1">1. Foto & OCR Gemini</span>
            <p className="text-slate-400">
              Porteiro fotografa a etiqueta. O Gemini Vision extrai o nome, transportadora e casa/apto instantaneamente.
            </p>
          </div>
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
            <span className="font-bold text-emerald-400 block mb-1">2. Armazenamento Local</span>
            <p className="text-slate-400">
              A imagem fica salva no PC da portaria com custo zero de nuvem. As fotos com mais de 90 dias são limpas automaticamente.
            </p>
          </div>
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
            <span className="font-bold text-emerald-400 block mb-1">3. WhatsApp Automático</span>
            <p className="text-slate-400">
              A Evolution API local dispara a notificação no WhatsApp do morador com o código de 4 dígitos e foto.
            </p>
          </div>
          <div className="bg-slate-950/60 p-4 rounded-2xl border border-slate-800">
            <span className="font-bold text-emerald-400 block mb-1">4. Baixa com Assinatura</span>
            <p className="text-slate-400">
              O morador apresenta o QR Code ou código, assina no tablet e o sistema arquiva a assinatura confirmando a entrega.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
