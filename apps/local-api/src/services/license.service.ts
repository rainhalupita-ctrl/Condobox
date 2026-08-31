import crypto from 'crypto';
import { databaseService } from './database.service.js';
import { supabaseService } from './supabase.service.js';
import { env } from '../config/env.js';

export interface SubscriptionPlan {
  id: 'TRIAL' | 'BASIC' | 'PRO' | 'PRO_MAX';
  name: string;
  max_units: number;
  has_ads: boolean;
  default_price_monthly: number;
  description?: string;
}

export interface CondoSubscription {
  condo_id: string;
  plan_id: 'TRIAL' | 'BASIC' | 'PRO' | 'PRO_MAX';
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  custom_price_monthly?: number;
  trial_starts_at?: string;
  trial_ends_at?: string;
  current_period_starts_at: string;
  current_period_ends_at: string;
  license_key?: string | null;
  notes?: string | null;
  plan?: SubscriptionPlan;
}

const DEFAULT_PLANS: Record<string, SubscriptionPlan> = {
  TRIAL: {
    id: 'TRIAL',
    name: 'Teste Grátis 30 Dias',
    max_units: 250,
    has_ads: false,
    default_price_monthly: 0,
    description: 'Período experimental de 30 dias com todas as funções liberadas'
  },
  BASIC: {
    id: 'BASIC',
    name: 'Plano Basic (Com Ads)',
    max_units: 250,
    has_ads: true,
    default_price_monthly: 149,
    description: 'Até 250 apartamentos com publicidade da portaria nos links e WhatsApp'
  },
  PRO: {
    id: 'PRO',
    name: 'Plano Pro (Sem Ads)',
    max_units: 250,
    has_ads: false,
    default_price_monthly: 249,
    description: 'Até 250 apartamentos exclusivo sem nenhum anúncio'
  },
  PRO_MAX: {
    id: 'PRO_MAX',
    name: 'Plano Pro Max',
    max_units: 600,
    has_ads: false,
    default_price_monthly: 449,
    description: 'Até 600 apartamentos para grandes condomínios sem anúncios'
  }
};

const SECRET_LICENSE_SALT = 'condobox_master_license_salt_2026_super_secure';

export class LicenseService {
  /**
   * Obtém a assinatura atual do condomínio (Local / Cloud)
   */
  public async getSubscription(condoId?: string): Promise<CondoSubscription> {
    const targetCondoId = condoId || env.CONDO_ID;

    // 1. Tenta buscar no Supabase se configurado
    if (supabaseService.isConfigured()) {
      try {
        const { data, error } = await supabaseService.getClient()
          .from('condo_subscriptions')
          .select('*, plan:subscription_plans(*)')
          .eq('condo_id', targetCondoId)
          .single();

        if (data && !error) {
          const now = new Date();
          const periodEnd = new Date(data.current_period_ends_at);
          let status = data.status;

          // Se passou da data final e não foi suspenso manualmente, marca como expirado
          if (now > periodEnd && status !== 'SUSPENDED') {
            status = 'EXPIRED';
          }

          return {
            ...data,
            status,
            plan: data.plan || DEFAULT_PLANS[data.plan_id] || DEFAULT_PLANS.TRIAL
          };
        }
      } catch {}
    }

    // 2. Fallback Padrão: 30 Dias de Teste Grátis
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      condo_id: targetCondoId,
      plan_id: 'TRIAL',
      status: 'TRIAL',
      custom_price_monthly: 0,
      trial_starts_at: now.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      current_period_starts_at: now.toISOString(),
      current_period_ends_at: trialEnd.toISOString(),
      plan: DEFAULT_PLANS.TRIAL
    };
  }

  /**
   * Verifica se o condomínio pode cadastrar mais unidades de acordo com o plano
   */
  public async canRegisterMoreUnits(currentCount: number, condoId?: string): Promise<{
    allowed: boolean;
    maxUnits: number;
    currentCount: number;
    planId: string;
    message?: string;
  }> {
    const sub = await this.getSubscription(condoId);
    const maxUnits = sub.plan?.max_units || 250;

    if (currentCount >= maxUnits) {
      return {
        allowed: false,
        maxUnits,
        currentCount,
        planId: sub.plan_id,
        message: `Limite de ${maxUnits} apartamentos atingido para o plano ${sub.plan?.name || sub.plan_id}. Faça upgrade para o Plano Pro Max (até 600 Aps).`
      };
    }

    return {
      allowed: true,
      maxUnits,
      currentCount,
      planId: sub.plan_id
    };
  }

  /**
   * Gera uma Chave de Licença (License Key) criptográfica para ativação offline ou online
   */
  public generateLicenseKey(condoId: string, planId: 'BASIC' | 'PRO' | 'PRO_MAX', daysValid: number): string {
    const expiresAtTimestamp = Math.floor(Date.now() / 1000) + daysValid * 86400;
    const payload = `${condoId}:${planId}:${expiresAtTimestamp}`;
    const hmac = crypto.createHmac('sha256', SECRET_LICENSE_SALT).update(payload).digest('hex').substring(0, 12).toUpperCase();

    // Formato: CND-[PLAN]-[EXPIRES]-[HMAC]
    const encodedPayload = Buffer.from(payload).toString('base64url');
    return `CND-${planId}-${encodedPayload}-${hmac}`;
  }

  /**
   * Ativa uma Chave de Licença
   */
  public async activateLicenseKey(licenseKey: string, condoId?: string): Promise<{
    success: boolean;
    message: string;
    subscription?: CondoSubscription;
  }> {
    try {
      const parts = licenseKey.trim().split('-');
      if (parts.length !== 4 || parts[0] !== 'CND') {
        return { success: false, message: 'Formato de Chave de Licença inválido.' };
      }

      const [_, planId, encodedPayload, receivedHmac] = parts;
      const decodedPayload = Buffer.from(encodedPayload, 'base64url').toString('utf-8');
      const [keyCondoId, keyPlanId, expiresAtTimestampStr] = decodedPayload.split(':');

      // Validar HMAC
      const expectedHmac = crypto.createHmac('sha256', SECRET_LICENSE_SALT).update(decodedPayload).digest('hex').substring(0, 12).toUpperCase();
      if (receivedHmac !== expectedHmac) {
        return { success: false, message: 'Chave de Licença inválida ou corrompida.' };
      }

      const expiresAtTimestamp = parseInt(expiresAtTimestampStr, 10);
      const expiresAtDate = new Date(expiresAtTimestamp * 1000);

      if (Date.now() > expiresAtDate.getTime()) {
        return { success: false, message: 'Esta Chave de Licença já expirou.' };
      }

      const targetCondoId = condoId || keyCondoId || env.CONDO_ID;
      const nowIso = new Date().toISOString();
      const expiresIso = expiresAtDate.toISOString();

      if (supabaseService.isConfigured()) {
        await supabaseService.getClient()
          .from('condo_subscriptions')
          .upsert({
            condo_id: targetCondoId,
            plan_id: keyPlanId,
            status: 'ACTIVE',
            current_period_starts_at: nowIso,
            current_period_ends_at: expiresIso,
            license_key: licenseKey,
            updated_at: nowIso
          });
      }

      const sub: CondoSubscription = {
        condo_id: targetCondoId,
        plan_id: keyPlanId as any,
        status: 'ACTIVE',
        current_period_starts_at: nowIso,
        current_period_ends_at: expiresIso,
        license_key: licenseKey,
        plan: DEFAULT_PLANS[keyPlanId] || DEFAULT_PLANS.PRO
      };

      return {
        success: true,
        message: `Licença ativada com sucesso! Plano ${sub.plan?.name} válido até ${expiresAtDate.toLocaleDateString('pt-BR')}.`,
        subscription: sub
      };
    } catch (err: any) {
      return { success: false, message: `Erro ao processar chave: ${err.message}` };
    }
  }
}

export const licenseService = new LicenseService();
