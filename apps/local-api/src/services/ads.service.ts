import { supabaseService } from './supabase.service.js';

export interface AdCampaign {
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

const DEFAULT_FALLBACK_AD: AdCampaign = {
  id: 'default-condo-ad',
  title: 'Anuncie aqui na Portaria',
  description: 'Divulgue seu comércio local, delivery ou serviços diretamente para todos os moradores do condomínio.',
  cta_text: 'Quero Anunciar',
  cta_url: 'https://wa.me/5511999999999?text=Ol%C3%A1%2C+quero+anunciar+na+portaria+do+condom%C3%ADnio',
  whatsapp_footer_text: '📢 *Publicidade:* Anuncie seu comércio para os moradores! Saiba mais: wa.me/5511999999999',
  active: true,
  priority: 1,
  views_count: 0,
  clicks_count: 0
};

export class AdsService {
  /**
   * Obtém o anúncio ativo prioritário para veiculação no Plano BASIC
   */
  public async getActiveAd(): Promise<AdCampaign> {
    if (!supabaseService.isConfigured()) {
      return DEFAULT_FALLBACK_AD;
    }

    try {
      const { data, error } = await supabaseService.getClient()
        .from('ads_campaigns')
        .select('*')
        .eq('active', true)
        .order('priority', { ascending: false })
        .limit(5);

      if (data && data.length > 0) {
        // Escolhe um aleatório entre os de maior prioridade para rotatividade justa
        const randomAd = data[Math.floor(Math.random() * data.length)];

        // Incrementa view de forma assíncrona
        supabaseService.getClient()
          .from('ads_campaigns')
          .update({ views_count: (randomAd.views_count || 0) + 1 })
          .eq('id', randomAd.id)
          .then(() => {});

        return randomAd;
      }
    } catch {}

    return DEFAULT_FALLBACK_AD;
  }

  /**
   * Registra clique no anúncio
   */
  public async registerClick(adId: string): Promise<void> {
    if (!supabaseService.isConfigured()) return;
    try {
      const client = supabaseService.getClient();
      const { data } = await client
        .from('ads_campaigns')
        .select('clicks_count')
        .eq('id', adId)
        .single();

      if (data) {
        await client
          .from('ads_campaigns')
          .update({ clicks_count: (data.clicks_count || 0) + 1 })
          .eq('id', adId);
      }
    } catch {}
  }
}

export const adsService = new AdsService();
