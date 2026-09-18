import { z } from 'zod';
import { databaseService } from '../services/database.service.js';
import { supabaseService } from '../services/supabase.service.js';
import { storageService } from '../services/storage.service.js';
import { whatsAppEngineService } from '../services/whatsapp-engine.service.js';
const createPackageSchema = z.object({
    unitId: z.string().min(1),
    residentId: z.string().optional().nullable(),
    carrier: z.string().default('Outro'),
    trackingCode: z.string().optional().nullable(),
    recipientNameOcr: z.string().optional().nullable(),
    labelImagePath: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    sendWhatsApp: z.boolean().default(true),
    residentPhone: z.string().optional().nullable(),
    residentName: z.string().optional().nullable(),
    unitInfo: z.string().optional().nullable()
});
export async function packageRoutes(fastify) {
    /**
     * GET /api/packages/units-residents
     * Retorna lista de unidades e moradores (do SQLite local com fallback Supabase)
     */
    fastify.get('/api/packages/units-residents', async (request, reply) => {
        try {
            const localData = databaseService.getUnitsAndResidents();
            if (localData.units.length > 0) {
                return reply.send(localData);
            }
            if (supabaseService.isConfigured()) {
                const cloudData = await supabaseService.getUnitsAndResidents();
                if (cloudData.units.length > 0) {
                    databaseService.upsertUnitsAndResidents(cloudData.units, cloudData.residents);
                }
                return reply.send(cloudData);
            }
            return reply.send({ units: [], residents: [] });
        }
        catch (err) {
            return reply.status(500).send({ error: err.message });
        }
    });
    /**
     * POST /api/packages
     * Registra a encomenda no SQLite local (tempo de resposta < 5ms) e envia notificação no WhatsApp
     */
    fastify.post('/api/packages', async (request, reply) => {
        try {
            const body = createPackageSchema.parse(request.body);
            let finalLabelPath = body.labelImagePath;
            // Se a imagem veio como Base64 (fallback garantido do frontend), salva em disco imediatamente
            if (body.labelImagePath && body.labelImagePath.startsWith('data:')) {
                try {
                    const base64Data = body.labelImagePath.replace(/^data:image\/\w+;base64,/, '');
                    const buf = Buffer.from(base64Data, 'base64');
                    const stored = await storageService.saveLabelImage(buf, 'jpg');
                    finalLabelPath = stored.relativePath;
                    console.log(`💾 [PackageRoutes] Imagem Base64 persistida com sucesso em disco: ${finalLabelPath}`);
                }
                catch (err) {
                    console.warn('[PackageRoutes] Falha ao persistir imagem Base64 em disco:', err.message);
                }
            }
            // 1. Grava no banco de dados SQLite Local (Offline-First garantido)
            const newPackage = databaseService.createPackage({
                unitId: body.unitId,
                residentId: body.residentId,
                carrier: body.carrier,
                trackingCode: body.trackingCode,
                recipientNameOcr: body.recipientNameOcr,
                labelImagePath: finalLabelPath,
                notes: body.notes
            });
            // 2. Se o Supabase estiver configurado e online, grava em background com o MESMO ID e tokens do SQLite
            if (supabaseService.isConfigured()) {
                supabaseService
                    .createPackage({
                    id: newPackage.id,
                    condoId: newPackage.condo_id,
                    unitId: newPackage.unit_id,
                    residentId: newPackage.resident_id,
                    carrier: newPackage.carrier,
                    trackingCode: newPackage.tracking_code,
                    recipientNameOcr: newPackage.recipient_name_ocr,
                    labelImagePath: newPackage.label_image_path,
                    notes: newPackage.notes,
                    pickupCode: newPackage.pickup_code,
                    qrToken: newPackage.qr_token,
                    receivedAt: newPackage.received_at
                })
                    .then(() => {
                    databaseService.markPackageSynced(newPackage.id);
                })
                    .catch((cloudErr) => {
                    console.warn('[PackageRoutes] Sincronização inicial em nuvem falhou, syncService enviará:', cloudErr?.message);
                });
            }
            let whatsappSent = false;
            let whatsappError = null;
            // 3. Se marcado para enviar WhatsApp, enfileira no worker de envio sequencial
            if (body.sendWhatsApp) {
                try {
                    const { whatsAppQueueWorker } = await import('../services/whatsapp-queue.worker.js');
                    // Enfileira em background para liberar o scanner do porteiro imediatamente
                    whatsAppQueueWorker.dispatchArrivalNotification(newPackage.id, newPackage).catch((err) => {
                        console.warn('[PackageRoutes] Erro na fila de envio de WhatsApp:', err.message);
                    });
                    whatsappSent = true;
                }
                catch (queueErr) {
                    whatsappError = queueErr.message;
                }
            }
            return reply.status(201).send({
                success: true,
                package: newPackage,
                whatsapp: {
                    sent: whatsappSent,
                    error: whatsappError
                }
            });
        }
        catch (err) {
            request.log.error(err);
            return reply.status(400).send({
                error: 'Erro ao registrar encomenda',
                details: err.errors || err.message
            });
        }
    });
    /**
     * GET /api/packages/recent
     * Retorna as últimas encomendas recebidas
     */
    fastify.get('/api/packages/recent', async (request, reply) => {
        try {
            const packages = databaseService.listRecentPackages(50);
            return reply.send({ packages });
        }
        catch (err) {
            return reply.status(500).send({ error: err.message });
        }
    });
    /**
     * GET /api/packages/by-token/:token
     * Busca pacote por QR token ou código numérico de 4 dígitos
     */
    fastify.get('/api/packages/by-token/:token', async (request, reply) => {
        const { token } = request.params;
        const pkg = databaseService.getPackageByQrTokenOrCode(token);
        if (!pkg) {
            return reply.status(404).send({ error: 'Encomenda não encontrada' });
        }
        return reply.send({ package: pkg });
    });
    /**
     * GET /api/packages/search
     * Busca rápida para autocomplete ou checagem na portaria
     */
    fastify.get('/api/packages/search', async (request, reply) => {
        const { q } = request.query;
        const all = databaseService.listRecentPackages(100);
        if (!q || !q.trim()) {
            return reply.send({ packages: all });
        }
        const term = q.toLowerCase().trim();
        const filtered = all.filter(p => {
            const codeMatch = p.pickup_code && p.pickup_code.includes(term);
            const nameMatch = p.recipient_name_ocr && p.recipient_name_ocr.toLowerCase().includes(term);
            const carrierMatch = p.carrier && p.carrier.toLowerCase().includes(term);
            const trackingMatch = p.tracking_code && p.tracking_code.toLowerCase().includes(term);
            const residentMatch = p.resident?.name && p.resident.name.toLowerCase().includes(term);
            const unitMatch = p.unit?.unit_number && p.unit.unit_number.includes(term);
            return codeMatch || nameMatch || carrierMatch || trackingMatch || residentMatch || unitMatch;
        });
        return reply.send({ packages: filtered });
    });
    /**
     * POST /api/packages/:id/notify
     * Reenvia notificação de chegada de encomenda via WhatsApp (Baileys Nativo)
     */
    fastify.post('/api/packages/:id/notify', async (request, reply) => {
        const { id } = request.params;
        try {
            // 1. Busca pacote no SQLite local
            let pkg = databaseService.getPackageById(id) || databaseService.getPackageByQrTokenOrCode(id);
            // 2. Fallback: busca no Supabase
            if (!pkg && supabaseService.isConfigured()) {
                try {
                    const client = supabaseService.getClient();
                    const { data: cloudPkg } = await client
                        .from('packages')
                        .select('*, unit:units(*), resident:residents(*)')
                        .or(`id.eq.${id},pickup_code.eq.${id}`)
                        .limit(1)
                        .maybeSingle();
                    if (cloudPkg)
                        pkg = cloudPkg;
                }
                catch { }
            }
            if (!pkg) {
                return reply.status(404).send({ success: false, error: 'Encomenda não encontrada no sistema' });
            }
            // 🛑 TRAVA DE SEGURANÇA: Valida se a encomenda não foi excluída ou alterada na nuvem
            if (supabaseService.isConfigured()) {
                try {
                    const client = supabaseService.getClient();
                    const { data: cloudPkg, error: cErr } = await client
                        .from('packages')
                        .select('id, status')
                        .eq('id', pkg.id)
                        .maybeSingle();
                    if (!cErr && !cloudPkg) {
                        console.warn(`🛑 [PackageRoutes] Trava acionada: Encomenda ${pkg.id} (${pkg.pickup_code}) foi excluída na nuvem. Removendo do SQLite.`);
                        databaseService.deletePackage(pkg.id);
                        return reply.status(404).send({
                            success: false,
                            error: 'Esta encomenda já foi excluída do sistema.'
                        });
                    }
                    if (cloudPkg && (cloudPkg.status === 'DELIVERED' || cloudPkg.status === 'RETURNED')) {
                        databaseService.updatePackageStatus(pkg.id, cloudPkg.status);
                        return reply.status(400).send({
                            success: false,
                            error: `Esta encomenda já consta como ${cloudPkg.status === 'DELIVERED' ? 'entregue' : 'devolvida'}.`
                        });
                    }
                }
                catch { }
            }
            // 3. Resolve telefone e dados do destinatário
            let phone = pkg.resident?.phone;
            let residentName = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador(a)';
            let unitInfo = pkg.unit ? `Apto ${pkg.unit.unit_number} - ${pkg.unit.block}` : 'sua unidade';
            if (!phone && pkg.resident_id) {
                const res = databaseService.getResidentById(pkg.resident_id);
                if (res?.phone) {
                    phone = res.phone;
                    residentName = res.name;
                }
            }
            if (!phone && pkg.unit_id) {
                const residents = databaseService.getResidentsByUnit(pkg.unit_id);
                const primary = residents.find(r => r.is_primary) || residents[0];
                if (primary?.phone) {
                    phone = primary.phone;
                    if (!pkg.recipient_name_ocr)
                        residentName = primary.name;
                }
            }
            if (!phone) {
                return reply.status(400).send({
                    success: false,
                    error: 'Nenhum telefone de morador cadastrado para esta unidade.'
                });
            }
            // 4. Dispara mensagem via Baileys Nativo
            const notifyRes = await whatsAppEngineService.notifyPackageArrival({
                phone,
                residentName,
                unitInfo,
                carrier: pkg.carrier || 'Transportadora',
                pickupCode: pkg.pickup_code,
                qrToken: pkg.qr_token || pkg.pickup_code,
                labelImageUrl: pkg.label_image_path || undefined
            });
            if (notifyRes.success) {
                try {
                    databaseService.updatePackageStatus(pkg.id, 'NOTIFIED');
                }
                catch { }
                return reply.send({
                    success: true,
                    message: `Notificação enviada com sucesso para ${phone}!`,
                    phone
                });
            }
            else {
                return reply.status(500).send({
                    success: false,
                    error: notifyRes.error || 'WhatsApp desconectado ou falha no envio.'
                });
            }
        }
        catch (err) {
            return reply.status(500).send({
                success: false,
                error: `Erro ao enviar notificação: ${err.message}`
            });
        }
    });
    /**
     * POST /api/packages/notify-pending
     * Dispara notificações para todas as encomendas recebidas pendentes
     */
    fastify.post('/api/packages/notify-pending', async (request, reply) => {
        try {
            const recent = databaseService.listRecentPackages(100);
            const pending = recent.filter(p => p.status === 'RECEIVED');
            let sentCount = 0;
            let alreadySentCount = recent.filter(p => p.status !== 'RECEIVED').length;
            let failedCount = 0;
            for (const pkg of pending) {
                // 🛑 TRAVA DE SEGURANÇA: Checa no Supabase se o pacote não foi excluído ou já retirado
                if (supabaseService.isConfigured()) {
                    try {
                        const client = supabaseService.getClient();
                        const { data: cloudPkg, error: cErr } = await client
                            .from('packages')
                            .select('id, status')
                            .eq('id', pkg.id)
                            .maybeSingle();
                        if (!cErr && !cloudPkg) {
                            console.warn(`🛑 [PackageRoutes] Trava acionada: Encomenda ${pkg.id} (${pkg.pickup_code}) excluída na nuvem. Limpando do SQLite local e ignorando.`);
                            databaseService.deletePackage(pkg.id);
                            failedCount++;
                            continue;
                        }
                        if (cloudPkg && cloudPkg.status !== 'RECEIVED') {
                            databaseService.updatePackageStatus(pkg.id, cloudPkg.status);
                            alreadySentCount++;
                            continue;
                        }
                    }
                    catch { }
                }
                let phone = pkg.resident?.phone;
                let residentName = pkg.resident?.name || pkg.recipient_name_ocr || 'Morador(a)';
                let unitInfo = pkg.unit ? `Apto ${pkg.unit.unit_number} - ${pkg.unit.block}` : 'sua unidade';
                if (!phone && pkg.resident_id) {
                    const res = databaseService.getResidentById(pkg.resident_id);
                    if (res?.phone)
                        phone = res.phone;
                }
                if (!phone && pkg.unit_id) {
                    const residents = databaseService.getResidentsByUnit(pkg.unit_id);
                    const primary = residents.find(r => r.is_primary) || residents[0];
                    if (primary?.phone)
                        phone = primary.phone;
                }
                if (phone) {
                    const res = await whatsAppEngineService.notifyPackageArrival({
                        phone,
                        residentName,
                        unitInfo,
                        carrier: pkg.carrier || 'Transportadora',
                        pickupCode: pkg.pickup_code,
                        qrToken: pkg.qr_token || pkg.pickup_code,
                        labelImageUrl: pkg.label_image_path || undefined
                    });
                    if (res.success) {
                        sentCount++;
                        try {
                            databaseService.updatePackageStatus(pkg.id, 'NOTIFIED');
                        }
                        catch { }
                    }
                    else {
                        failedCount++;
                    }
                }
                else {
                    failedCount++;
                }
            }
            return reply.send({
                success: true,
                sentCount,
                alreadySentCount,
                failedCount
            });
        }
        catch (err) {
            return reply.status(500).send({
                success: false,
                error: err.message
            });
        }
    });
    /**
     * DELETE /api/packages/:id
     * Exclui definitivamente a encomenda do SQLite local e sincroniza com o Supabase
     */
    fastify.delete('/api/packages/:id', async (request, reply) => {
        const { id } = request.params;
        try {
            const deletedLocal = databaseService.deletePackage(id);
            // Sincroniza exclusão no Supabase se conectado
            if (supabaseService.isConfigured()) {
                try {
                    const client = supabaseService.getClient();
                    await client.from('packages').delete().eq('id', id);
                }
                catch (cloudErr) {
                    console.warn('[PackageRoutes] Falha ao excluir pacote no Supabase:', cloudErr?.message);
                }
            }
            return reply.send({
                success: true,
                deleted: deletedLocal,
                message: 'Encomenda excluída com sucesso.'
            });
        }
        catch (err) {
            return reply.status(500).send({
                success: false,
                error: `Erro ao excluir encomenda: ${err.message}`
            });
        }
    });
    /**
     * PATCH /api/packages/:id/status
     * Altera status da encomenda (ex: 'RETURNED' / Devolvida ao entregador)
     */
    fastify.patch('/api/packages/:id/status', async (request, reply) => {
        const { id } = request.params;
        const { status, reason } = request.body || {};
        try {
            if (status === 'RETURNED') {
                databaseService.returnPackage(id, reason);
            }
            else if (status) {
                databaseService.updatePackageStatus(id, status);
            }
            // Sincroniza no Supabase se configurado
            if (supabaseService.isConfigured()) {
                try {
                    const client = supabaseService.getClient();
                    const updateData = { status: status || 'RETURNED' };
                    if (reason) {
                        updateData.notes = `[DEVOLVIDA AO ENTREGADOR]: ${reason}`;
                    }
                    await client.from('packages').update(updateData).eq('id', id);
                }
                catch (cloudErr) {
                    console.warn('[PackageRoutes] Falha ao atualizar status no Supabase:', cloudErr?.message);
                }
            }
            return reply.send({
                success: true,
                message: 'Status da encomenda atualizado com sucesso.'
            });
        }
        catch (err) {
            return reply.status(500).send({
                success: false,
                error: `Erro ao atualizar status da encomenda: ${err.message}`
            });
        }
    });
    /**
     * POST /api/packages/:id/resolve-contestation
     * Registra resolução da contestação pela equipe de portaria
     */
    fastify.post('/api/packages/:id/resolve-contestation', async (request, reply) => {
        try {
            const { id } = request.params;
            const { reason } = request.body || {};
            const res = await databaseService.resolveContestation(id, reason);
            if (res.success) {
                return reply.send({ success: true, message: 'Contestação resolvida com sucesso.' });
            }
            else {
                return reply.status(500).send({ success: false, error: res.error || 'Erro ao resolver contestação.' });
            }
        }
        catch (err) {
            return reply.status(500).send({ success: false, error: err.message });
        }
    });
}
