'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Megaphone,
  Plus,
  Eye,
  MousePointerClick,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Image as ImageIcon,
  MessageSquare,
  Link as LinkIcon,
  Trash2,
  Edit2
} from 'lucide-react';

interface AdCampaign {
  id: string;
  title: string;
  description: string;
  banner_url?: string | null;
  cta_text: string;
  cta_url?: string | null;
  whatsapp_footer_text?: string | null;
  active: boolean;
  priority: number;
  views_count: number;
  clicks_count: number;
}

export default function AdminAnunciosPage() {
  const [ads, setAds] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingAd, setEditingAd] = useState<AdCampaign | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [ctaText, setCtaText] = useState('Pedir Agora');
  const [ctaUrl, setCtaUrl] = useState('');
  const [whatsappFooter, setWhatsappFooter] = useState('');
  const [priority, setPriority] = useState(10);
  const [active, setActive] = useState(true);

  useEffect(() => {
    loadAds();
  }, []);

  const loadAds = async () => {
    setLoading(true);
    try {
      // Mock inicial / Dados
      const sampleAds: AdCampaign[] = [
        {
          id: 'ad-1',
          title: 'Pizzaria & Delivery do Bairro',
          description: 'Moradores do condomínio ganham 10% de desconto na primeira pizza com o cupom CONDO10!',
          banner_url: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=600&auto=format&fit=crop&q=60',
          cta_text: 'Pedir no WhatsApp',
          cta_url: 'https://wa.me/5511999999999?text=Ol%C3%A1%2C+quero+meu+desconto+de+morador',
          whatsapp_footer_text: '🍕 *Pizzaria do Bairro:* 10% OFF para moradores com cupom CONDO10! Peça agora: wa.me/5511999999999',
          active: true,
          priority: 10,
          views_count: 342,
          clicks_count: 48
        },
        {
          id: 'ad-2',
          title: 'Lavanderia Express Prime',
          description: 'Buscamos e entregamos suas roupas passadas e higienizadas na portaria.',
          banner_url: 'https://images.unsplash.com/photo-1545173168-9f1947eebb7f?w=600&auto=format&fit=crop&q=60',
          cta_text: 'Agendar Coleta',
          cta_url: 'https://wa.me/5511988887777',
          whatsapp_footer_text: '👕 *Lavanderia Express:* Coleta e entrega grátis na portaria! wa.me/5511988887777',
          active: true,
          priority: 5,
          views_count: 189,
          clicks_count: 22
        }
      ];

      setAds(sampleAds);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenNew = () => {
    setEditingAd(null);
    setTitle('');
    setDescription('');
    setBannerUrl('');
    setCtaText('Pedir Agora');
    setCtaUrl('');
    setWhatsappFooter('');
    setPriority(10);
    setActive(true);
    setShowModal(true);
  };

  const handleEdit = (ad: AdCampaign) => {
    setEditingAd(ad);
    setTitle(ad.title);
    setDescription(ad.description);
    setBannerUrl(ad.banner_url || '');
    setCtaText(ad.cta_text || 'Pedir Agora');
    setCtaUrl(ad.cta_url || '');
    setWhatsappFooter(ad.whatsapp_footer_text || '');
    setPriority(ad.priority);
    setActive(ad.active);
    setShowModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (editingAd) {
      setAds(prev =>
        prev.map(a =>
          a.id === editingAd.id
            ? {
                ...a,
                title,
                description,
                banner_url: bannerUrl || null,
                cta_text: ctaText,
                cta_url: ctaUrl || null,
                whatsapp_footer_text: whatsappFooter || null,
                priority,
                active
              }
            : a
        )
      );
    } else {
      const newAd: AdCampaign = {
        id: 'ad-' + Date.now(),
        title,
        description,
        banner_url: bannerUrl || null,
        cta_text: ctaText,
        cta_url: ctaUrl || null,
        whatsapp_footer_text: whatsappFooter || null,
        priority,
        active,
        views_count: 0,
        clicks_count: 0
      };
      setAds(prev => [newAd, ...prev]);
    }

    setShowModal(false);
  };

  const toggleActive = (id: string) => {
    setAds(prev =>
      prev.map(a => (a.id === id ? { ...a, active: !a.active } : a))
    );
  };

  const handleDelete = (id: string) => {
    setAds(prev => prev.filter(a => a.id !== id));
  };

  // Métricas
  const totalViews = ads.reduce((acc, a) => acc + a.views_count, 0);
  const totalClicks = ads.reduce((acc, a) => acc + a.clicks_count, 0);
  const averageCTR = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* CABEÇALHO */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Link
                href="/admin/licenciamento"
                className="p-2 bg-slate-900 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-white transition"
              >
                <ArrowLeft className="w-4 h-4" />
              </Link>
              <div className="p-2.5 bg-purple-500/10 border border-purple-500/30 rounded-2xl">
                <Megaphone className="w-6 h-6 text-purple-400" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Gestão de Anúncios da Portaria (Ads Manager)
              </h1>
            </div>
            <p className="text-slate-400 text-sm">
              Controle as campanhas e banners que são veiculados no WhatsApp e links de retirada dos condomínios no <strong>Plano Basic</strong>.
            </p>
          </div>

          <button
            onClick={handleOpenNew}
            className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition shadow-lg shadow-purple-600/30"
          >
            <Plus className="w-4 h-4" />
            <span>Criar Novo Anúncio</span>
          </button>
        </div>

        {/* MÉTRICAS DE PUBLICIDADE */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-bold tracking-wider">Visualizações Totais</span>
              <Eye className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {totalViews.toLocaleString('pt-BR')}
              <span className="text-xs font-normal text-slate-400 block mt-0.5">impressões nos links e WhatsApp</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-bold tracking-wider">Cliques nos Anúncios</span>
              <MousePointerClick className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400">
              {totalClicks.toLocaleString('pt-BR')}
              <span className="text-xs font-normal text-slate-400 block mt-0.5">moradores direcionados</span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-2xl">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs uppercase font-bold tracking-wider">Taxa de Conversão (CTR)</span>
              <TrendingUp className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-black text-purple-400">
              {averageCTR}%
              <span className="text-xs font-normal text-slate-400 block mt-0.5">engajamento médio</span>
            </div>
          </div>
        </div>

        {/* LISTA DE ANÚNCIOS ATIVOS */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-3xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2 pb-3 border-b border-slate-800">
            <Sparkles className="w-5 h-5 text-purple-400" />
            <span>Campanhas Cadastradas</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ads.map(ad => (
              <div
                key={ad.id}
                className={`p-5 rounded-2xl border transition flex flex-col justify-between gap-4 ${
                  ad.active
                    ? 'bg-slate-950/70 border-purple-500/30'
                    : 'bg-slate-950/30 border-slate-800/50 opacity-60'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-xs font-bold text-white block">{ad.title}</span>
                      <p className="text-xs text-slate-400 mt-1">{ad.description}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleActive(ad.id)}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase border transition ${
                        ad.active
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}
                    >
                      {ad.active ? 'Ativo' : 'Pausado'}
                    </button>
                  </div>

                  {ad.banner_url && (
                    <img
                      src={ad.banner_url}
                      alt={ad.title}
                      className="w-full h-28 object-cover rounded-xl border border-slate-800"
                    />
                  )}

                  {ad.whatsapp_footer_text && (
                    <div className="p-2.5 bg-slate-900 rounded-xl text-[11px] text-slate-300 border border-slate-800/80">
                      <span className="text-slate-500 font-bold block text-[9px] uppercase mb-0.5">Rodapé no WhatsApp:</span>
                      {ad.whatsapp_footer_text}
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-xs text-slate-400 pt-1">
                    <span>👁️ {ad.views_count} views</span>
                    <span>👆 {ad.clicks_count} cliques</span>
                    <span className="text-purple-400 font-semibold">
                      CTR: {ad.views_count > 0 ? ((ad.clicks_count / ad.views_count) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => handleEdit(ad)}
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>Editar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(ad.id)}
                    className="p-2 bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-500/20 rounded-lg text-xs font-semibold transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* MODAL DE CRIAÇÃO / EDIÇÃO */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-white">
              {editingAd ? 'Editar Campanha de Anúncio' : 'Nova Campanha de Anúncio'}
            </h3>

            <form onSubmit={handleSave} className="space-y-3.5 text-xs">
              <div>
                <label className="text-slate-400 block font-semibold mb-1">Título do Anúncio / Comércio:</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Pizzaria do Bairro"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-400 block font-semibold mb-1">Texto da Oferta / Descrição:</label>
                <textarea
                  rows={2}
                  required
                  placeholder="Ex: Moradores ganham 10% OFF com cupom CONDO10..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-400 block font-semibold mb-1">URL do Banner (Imagem):</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={bannerUrl}
                  onChange={e => setBannerUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block font-semibold mb-1">Texto do Botão (CTA):</label>
                  <input
                    type="text"
                    value={ctaText}
                    onChange={e => setCtaText(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block font-semibold mb-1">Prioridade (1-100):</label>
                  <input
                    type="number"
                    value={priority}
                    onChange={e => setPriority(parseInt(e.target.value, 10) || 1)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block font-semibold mb-1">Link do Botão (WhatsApp / iFood / Site):</label>
                <input
                  type="url"
                  placeholder="https://wa.me/5511999999999 ou https://ifood..."
                  value={ctaUrl}
                  onChange={e => setCtaUrl(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-slate-400 block font-semibold mb-1">Rodapé no WhatsApp:</label>
                <input
                  type="text"
                  placeholder="Ex: 🍕 Pizzaria do Bairro: 10% OFF! wa.me/..."
                  value={whatsappFooter}
                  onChange={e => setWhatsappFooter(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:border-purple-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="activeAd"
                  checked={active}
                  onChange={e => setActive(e.target.checked)}
                  className="rounded border-slate-800 text-purple-600 focus:ring-0"
                />
                <label htmlFor="activeAd" className="text-xs text-slate-300 font-semibold cursor-pointer">
                  Campanha Ativa e Veiculando Imediatamente
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition"
                >
                  Salvar Campanha
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
