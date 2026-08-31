import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { databaseService } from '../services/database.service.js';
import { supabaseService } from '../services/supabase.service.js';
import { whatsappService } from '../services/whatsapp.service.js';

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

export async function packageRoutes(fastify: FastifyInstance) {
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
    } catch (err: any) {
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

      // 1. Grava no banco de dados SQLite Local (Offline-First garantido)
      const newPackage = databaseService.createPackage({
        unitId: body.unitId,
        residentId: body.residentId,
        carrier: body.carrier,
        trackingCode: body.trackingCode,
        recipientNameOcr: body.recipientNameOcr,
        labelImagePath: body.labelImagePath,
        notes: body.notes
      });

      // 2. Se o Supabase estiver configurado e online, grava em background
      if (supabaseService.isConfigured()) {
        supabaseService
          .createPackage({
            unitId: body.unitId,
            residentId: body.residentId,
            carrier: body.carrier,
            trackingCode: body.trackingCode,
            recipientNameOcr: body.recipientNameOcr,
            labelImagePath: body.labelImagePath,
            notes: body.notes
          })
          .then((cloudPkg) => {
            databaseService.markPackageSynced(newPackage.id);
          })
          .catch(() => {
            // Ficará PENDING no SQLite e o syncService enviará quando houver internet
          });
      }

      let whatsappSent = false;
      let whatsappError = null;

      // 3. Se marcado para enviar WhatsApp e temos os dados de contato
      if (body.sendWhatsApp) {
        let phone = body.residentPhone;
        let name = body.residentName || 'Morador';
        let unitText = body.unitInfo || 'sua unidade';

        // Se não tem telefone direto, busca no SQLite local
        if (!phone && body.residentId) {
          const { residents } = databaseService.getUnitsAndResidents();
          const res = residents.find(r => r.id === body.residentId);
          if (res) {
            phone = res.phone;
            name = res.name;
          }
        }

        if (!phone && body.unitId) {
          const { residents } = databaseService.getUnitsAndResidents();
          const unitResidents = residents.filter(r => r.unit_id === body.unitId);
          if (unitResidents.length > 0) {
            const primary = unitResidents.find(r => r.is_primary === 1) || unitResidents[0];
            phone = primary.phone;
            if (!body.residentName) name = primary.name;
          }
        }

        if (phone) {
          const publicBase = whatsappService.getPublicWebUrl().replace(/\/$/, '');
          const labelUrl = body.labelImagePath
            ? (body.labelImagePath.startsWith('http')
                ? body.labelImagePath
                : `${publicBase}/images/${body.labelImagePath}`)
            : undefined;

          const notifyRes = await whatsappService.notifyPackageArrival({
            phone,
            residentName: name,
            unitInfo: unitText,
            carrier: body.carrier,
            pickupCode: newPackage.pickup_code,
            qrToken: newPackage.qr_token || newPackage.pickup_code,
            labelImageUrl: labelUrl
          });

          whatsappSent = notifyRes.success;
          whatsappError = notifyRes.error;
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
    } catch (err: any) {
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
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * GET /api/packages/by-token/:token
   * Busca pacote por QR token ou código numérico de 4 dígitos
   */
  fastify.get('/api/packages/by-token/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
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
    const { q } = request.query as { q?: string };
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
}
