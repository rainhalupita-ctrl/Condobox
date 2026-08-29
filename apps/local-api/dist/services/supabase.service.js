import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
export class SupabaseService {
    client = null;
    constructor() {
        if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_URL.includes('placeholder')) {
            this.client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                }
            });
        }
    }
    getClient() {
        if (!this.client) {
            throw new Error('Supabase client não está inicializado com credenciais válidas.');
        }
        return this.client;
    }
    isConfigured() {
        return this.client !== null;
    }
    /**
     * Busca todas as unidades e moradores para auto-complete e match do OCR
     */
    async getUnitsAndResidents(condoId = env.CONDO_ID) {
        if (!this.isConfigured())
            return { units: [], residents: [] };
        const { data: units, error: unitErr } = await this.getClient()
            .from('units')
            .select('id, block, unit_number')
            .eq('condo_id', condoId)
            .order('block', { ascending: true })
            .order('unit_number', { ascending: true });
        if (unitErr) {
            console.error('[SupabaseService] Erro ao buscar unidades:', unitErr);
        }
        const { data: residents, error: resErr } = await this.getClient()
            .from('residents')
            .select('id, unit_id, name, phone, email, is_primary')
            .eq('active', true);
        if (resErr) {
            console.error('[SupabaseService] Erro ao buscar moradores:', resErr);
        }
        return {
            units: units || [],
            residents: residents || []
        };
    }
    /**
     * Encontra unidade e morador por aproximação dos dados do OCR
     */
    async matchResidentFromOCR(params) {
        const { units, residents } = await this.getUnitsAndResidents();
        let matchedUnit = null;
        if (params.unitNumber) {
            const cleanNum = params.unitNumber.replace(/\D/g, '');
            matchedUnit = units.find(u => {
                const uNum = u.unit_number.replace(/\D/g, '');
                const matchNum = uNum === cleanNum;
                if (params.block) {
                    const matchBlock = u.block.toLowerCase().includes(params.block.toLowerCase()) ||
                        params.block.toLowerCase().includes(u.block.toLowerCase());
                    return matchNum && matchBlock;
                }
                return matchNum;
            }) || units.find(u => u.unit_number.replace(/\D/g, '') === cleanNum);
        }
        let matchedResident = null;
        if (matchedUnit) {
            const unitResidents = residents.filter(r => r.unit_id === matchedUnit.id);
            if (params.recipientName) {
                const nameQuery = params.recipientName.toLowerCase().trim();
                matchedResident = unitResidents.find(r => {
                    const rName = r.name.toLowerCase();
                    return rName.includes(nameQuery) || nameQuery.includes(rName) ||
                        rName.split(' ')[0] === nameQuery.split(' ')[0];
                });
            }
            if (!matchedResident && unitResidents.length > 0) {
                matchedResident = unitResidents.find(r => r.is_primary) || unitResidents[0];
            }
        }
        return {
            unit: matchedUnit,
            resident: matchedResident
        };
    }
    /**
     * Cria nova encomenda no Supabase
     */
    async createPackage(input) {
        if (!this.isConfigured()) {
            // Mock para quando não estiver conectado ao Supabase
            const mockId = 'mock-' + Date.now();
            const mockPickupCode = Math.floor(1000 + Math.random() * 9000).toString();
            return {
                id: mockId,
                pickup_code: mockPickupCode,
                qr_token: `pkg_${mockId}_${mockPickupCode}`,
                ...input,
                status: 'RECEIVED',
                received_at: new Date().toISOString()
            };
        }
        // Gera código numérico de 4 dígitos e token único
        const pickupCode = Math.floor(1000 + Math.random() * 9000).toString();
        const qrToken = `pkg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const { data, error } = await this.getClient()
            .from('packages')
            .insert({
            condo_id: input.condoId || env.CONDO_ID,
            unit_id: input.unitId,
            resident_id: input.residentId || null,
            carrier: input.carrier || 'Outro',
            tracking_code: input.trackingCode || null,
            recipient_name_ocr: input.recipientNameOcr || null,
            label_image_path: input.labelImagePath || null,
            pickup_code: pickupCode,
            qr_token: qrToken,
            received_by_user_id: input.receivedByUserId || null,
            notes: input.notes || null,
            status: 'RECEIVED'
        })
            .select()
            .single();
        if (error) {
            console.error('[SupabaseService] Erro ao inserir encomenda:', error);
            throw error;
        }
        return data;
    }
    /**
     * Registra a retirada da encomenda com assinatura
     */
    async deliverPackage(params) {
        if (!this.isConfigured()) {
            return {
                id: params.packageId,
                status: 'DELIVERED',
                delivered_at: new Date().toISOString(),
                delivered_to_name: params.deliveredToName,
                signature_image_path: params.signatureImagePath
            };
        }
        const { data, error } = await this.getClient()
            .from('packages')
            .update({
            status: 'DELIVERED',
            signature_image_path: params.signatureImagePath,
            delivered_to_name: params.deliveredToName,
            delivered_by_user_id: params.deliveredByUserId || null,
            delivered_at: new Date().toISOString()
        })
            .eq('id', params.packageId)
            .select('*, unit:units(*), resident:residents(*)')
            .single();
        if (error) {
            console.error('[SupabaseService] Erro ao atualizar retirada:', error);
            throw error;
        }
        return data;
    }
    /**
     * Registra log de notificação no banco
     */
    async logNotification(params) {
        if (!this.isConfigured())
            return;
        try {
            await this.getClient().from('notifications_log').insert({
                package_id: params.packageId,
                resident_id: params.residentId || null,
                recipient_phone: params.phone,
                message_content: params.message,
                status: params.status,
                error_message: params.error || null,
                sent_at: params.status === 'SENT' ? new Date().toISOString() : null
            });
        }
        catch (e) {
            console.error('[SupabaseService] Erro ao gravar notification log:', e);
        }
    }
}
export const supabaseService = new SupabaseService();
