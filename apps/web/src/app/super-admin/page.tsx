'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { 
  ShieldAlert, ShieldCheck, Plus, Trash2, 
  Settings, CreditCard, Image as ImageIcon, Loader2 
} from 'lucide-react';

export default function SuperAdminPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [licenses, setLicenses] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // Formulário nova licença
  const [newCondoId, setNewCondoId] = useState('');
  const [newPlan, setNewPlan] = useState('TRIAL');
  
  // Formulário novo anúncio
  const [adImage, setAdImage] = useState('');
  const [adLink, setAdLink] = useState('');

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else {
        loadData();
      }
    }
  }, [user, loading, router]);

  const loadData = async () => {
    setLoadingData(true);
    try {
      const { data: licData } = await supabase.from('licenses').select('*').order('created_at', { ascending: false });
      if (licData) setLicenses(licData);

      const { data: adsData } = await supabase.from('ads').select('*').order('created_at', { ascending: false });
      if (adsData) setAds(adsData);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  const handleCreateLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCondoId) return;

    let expires = new Date();
    if (newPlan === 'TRIAL') expires.setDate(expires.getDate() + 30);
    else expires.setFullYear(expires.getFullYear() + 1);

    await supabase.from('licenses').insert({
      condo_id: newCondoId,
      plan: newPlan,
      status: 'ACTIVE',
      expires_at: expires.toISOString(),
      max_apartments: newPlan === 'PRO_MAX' ? 600 : 250
    });
    
    setNewCondoId('');
    loadData();
  };

  const handleUpdateLicenseStatus = async (id: string, newStatus: string) => {
    await supabase.from('licenses').update({ status: newStatus }).eq('id', id);
    loadData();
  };
  
  const handleUpdateLicensePlan = async (id: string, plan: string) => {
    await supabase.from('licenses').update({ 
      plan: plan,
      max_apartments: plan === 'PRO_MAX' ? 600 : 250 
    }).eq('id', id);
    loadData();
  };

  const handleCreateAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adImage) return;

    await supabase.from('ads').insert({
      image_url: adImage,
      link_url: adLink,
      active: true
    });
    
    setAdImage('');
    setAdLink('');
    loadData();
  };

  const handleToggleAd = async (id: string, active: boolean) => {
    await supabase.from('ads').update({ active }).eq('id', id);
    loadData();
  };

  const handleDeleteAd = async (id: string) => {
    if (confirm('Deletar anúncio?')) {
      await supabase.from('ads').delete().eq('id', id);
      loadData();
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-emerald-500 w-8 h-8" /></div>;
  }

  return (
    <div className="space-y-8 p-4">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ShieldAlert className="text-purple-500" /> Super Admin - Painel de Controle SaaS
        </h1>
        <p className="text-slate-400 text-sm mt-1">Gerencie os planos de assinatura dos condomínios e a rede de anúncios.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* LICENÇAS */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-emerald-400" /> Licenças e Condomínios
          </h2>
          
          <form onSubmit={handleCreateLicense} className="flex gap-2 mb-6">
            <input 
              type="text" placeholder="ID do Condomínio (UUID)" 
              value={newCondoId} onChange={e => setNewCondoId(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
            <select 
              value={newPlan} onChange={e => setNewPlan(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="TRIAL">TRIAL (30 dias)</option>
              <option value="BASIC">BASIC (Com Ads)</option>
              <option value="PRO">PRO</option>
              <option value="PRO_MAX">PRO MAX</option>
            </select>
            <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg text-sm font-bold transition">Add</button>
          </form>

          <div className="space-y-3">
            {licenses.map(lic => (
              <div key={lic.id} className="bg-slate-800/50 p-4 rounded-xl border border-slate-700">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-xs text-slate-400 font-mono">{lic.condo_id}</p>
                    <p className="text-sm font-bold text-white mt-1">
                      {lic.plan} <span className="text-xs font-normal text-slate-400">({lic.max_apartments} aptos)</span>
                    </p>
                  </div>
                  <span className={`px-2 py-1 text-[10px] font-bold rounded ${
                    lic.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {lic.status}
                  </span>
                </div>
                
                <div className="flex gap-2 mt-4">
                  <select 
                    value={lic.plan} 
                    onChange={e => handleUpdateLicensePlan(lic.id, e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded text-xs px-2 py-1 text-white"
                  >
                    <option value="TRIAL">TRIAL</option>
                    <option value="BASIC">BASIC</option>
                    <option value="PRO">PRO</option>
                    <option value="PRO_MAX">PRO MAX</option>
                  </select>
                  
                  <select 
                    value={lic.status} 
                    onChange={e => handleUpdateLicenseStatus(lic.id, e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded text-xs px-2 py-1 text-white"
                  >
                    <option value="ACTIVE">Ativar</option>
                    <option value="EXPIRED">Expirar</option>
                    <option value="BLOCKED">Bloquear</option>
                  </select>
                </div>
              </div>
            ))}
            {licenses.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Nenhuma licença cadastrada</p>}
          </div>
        </div>

        {/* ANÚNCIOS */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2 mb-4">
            <ImageIcon className="w-5 h-5 text-indigo-400" /> Rede de Anúncios
          </h2>
          
          <form onSubmit={handleCreateAd} className="space-y-3 mb-6 bg-slate-800/30 p-4 rounded-xl border border-slate-700">
            <input 
              type="text" placeholder="URL da Imagem (Banner)" 
              value={adImage} onChange={e => setAdImage(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
            <input 
              type="text" placeholder="Link de Destino (Ex: https://whatsapp...)" 
              value={adLink} onChange={e => setAdLink(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            />
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg text-sm font-bold transition flex items-center justify-center gap-2">
              <Plus size={16} /> Cadastrar Anúncio
            </button>
          </form>

          <div className="space-y-3">
            {ads.map(ad => (
              <div key={ad.id} className={`p-4 rounded-xl border flex items-center gap-4 ${ad.active ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-800/20 border-slate-700/50 opacity-60'}`}>
                <img src={ad.image_url} alt="Ad" className="w-20 h-14 object-cover rounded" />
                <div className="flex-1">
                  <a href={ad.link_url} target="_blank" className="text-sm text-indigo-400 hover:underline truncate block max-w-[200px]">{ad.link_url || 'Sem Link'}</a>
                  <p className="text-xs text-slate-500 mt-1">👁️ {ad.views || 0} views</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleToggleAd(ad.id, !ad.active)}
                    className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                    title={ad.active ? 'Pausar' : 'Ativar'}
                  >
                    {ad.active ? 'Pausar' : 'Ativar'}
                  </button>
                  <button 
                    onClick={() => handleDeleteAd(ad.id)}
                    className="p-2 bg-red-900/50 hover:bg-red-500/50 rounded text-red-400"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {ads.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Nenhum anúncio rodando</p>}
          </div>
        </div>

      </div>
    </div>
  );
}
