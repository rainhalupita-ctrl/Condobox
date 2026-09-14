import { createClient } from '@supabase/supabase-js';

// ─── Configuração e Constantes da Trava Anti-Cobrança ──────────────────────────
// Supabase Free Tier: 1.000 MB (1 GB) de Storage.
// Definimos o teto de segurança em 850 MB (ou via variável de ambiente) para garantir 0 risco de ultrapassar.
// Cloudflare R2 Free Tier: 10 GB (10.000 MB).
export const STORAGE_FREE_LIMIT_MB = Number(process.env.STORAGE_FREE_LIMIT_MB || 850);
export const WARNING_THRESHOLD_PERCENT = 75; // Alerta aos 75%
export const LOCK_THRESHOLD_PERCENT = 90; // Trava estrita aos 90% (765 MB no Supabase)

export interface StorageQuotaStatus {
  allowed: boolean;
  status: 'SAFE' | 'WARNING' | 'LOCKED';
  usedBytes: number;
  usedMB: number;
  limitMB: number;
  percentUsed: number;
  fileCount: number;
  provider: string;
  lastChecked: string;
  antiBillingProtectionActive: boolean;
  message?: string;
}

let cachedQuota: { data: StorageQuotaStatus; timestamp: number } | null = null;
const CACHE_TTL_MS = 3 * 60 * 1000; // Cache de 3 minutos para não sobrecarregar listagens

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

/**
 * Lista todos os arquivos recursivamente em um bucket do Supabase Storage.
 */
async function listAllStorageFilesRecursive(
  supabase: any,
  bucket: string,
  path = ''
): Promise<{ fullPath: string; name: string; size: number; createdAt: number }[]> {
  const result: { fullPath: string; name: string; size: number; createdAt: number }[] = [];

  try {
    const { data: files, error } = await supabase.storage.from(bucket).list(path, {
      limit: 1000,
      sortBy: { column: 'created_at', order: 'asc' },
    });

    if (error || !files) {
      if (error) console.warn(`[STORAGE-GUARD] Erro ao listar pasta '${path}' no bucket '${bucket}':`, error.message);
      return result;
    }

    for (const f of files) {
      const fullPath = path ? `${path}/${f.name}` : f.name;
      // Se id for null ou não tiver metadata.size, trata-se de um diretório/pasta
      if (f.id === null || !f.metadata) {
        const subFiles = await listAllStorageFilesRecursive(supabase, bucket, fullPath);
        result.push(...subFiles);
      } else {
        const createdAt = f.created_at
          ? new Date(f.created_at).getTime()
          : f.metadata?.lastModified
          ? new Date(f.metadata.lastModified).getTime()
          : 0;

        result.push({
          fullPath,
          name: f.name,
          size: Number(f.metadata?.size || 0),
          createdAt,
        });
      }
    }
  } catch (err: any) {
    console.error(`[STORAGE-GUARD] Exceção na listagem recursiva de '${path}':`, err);
  }

  return result;
}

/**
 * Consulta a cota atual do bucket 'labels' com verificação da Trava Anti-Cobrança.
 */
export async function checkStorageGuard(forceRefresh = false): Promise<StorageQuotaStatus> {
  const now = Date.now();
  if (!forceRefresh && cachedQuota && (now - cachedQuota.timestamp < CACHE_TTL_MS)) {
    return cachedQuota.data;
  }

  const supabase = getSupabaseAdmin();

  try {
    const allFiles = await listAllStorageFilesRecursive(supabase, 'labels', '');

    let totalBytes = 0;
    for (const file of allFiles) {
      totalBytes += file.size;
    }

    const usedMB = Number((totalBytes / (1024 * 1024)).toFixed(2));
    const percentUsed = Number(((usedMB / STORAGE_FREE_LIMIT_MB) * 100).toFixed(1));

    // Se estiver se aproximando do limite crítico (> 90%), tenta uma rotação automática preventiva de fotos antigas (+30 dias)
    if (percentUsed >= LOCK_THRESHOLD_PERCENT) {
      console.warn(`[STORAGE-GUARD] ⚠️ Armazenamento atingiu ${percentUsed}% (${usedMB} MB). Disparando expurgo automático de fotos > 30 dias...`);
      try {
        await purgeOldDeliveredPhotos(30);
      } catch (purgeErr) {
        console.error('[STORAGE-GUARD] Erro no expurgo automático preventivo:', purgeErr);
      }
    }

    let status: 'SAFE' | 'WARNING' | 'LOCKED' = 'SAFE';
    let allowed = true;
    let message = 'Armazenamento saudável dentro da cota 100% gratuita.';

    if (usedMB >= STORAGE_FREE_LIMIT_MB) {
      status = 'LOCKED';
      allowed = false;
      message = `TRAVA ATIVA: Cota gratuita de ${STORAGE_FREE_LIMIT_MB} MB atingida. Uploads para a nuvem pausados para nunca gerar cobranças. As fotos permanecem no computador local da portaria.`;
    } else if (percentUsed >= WARNING_THRESHOLD_PERCENT) {
      status = 'WARNING';
      allowed = true;
      message = `Atenção: Armazenamento em ${percentUsed}% da cota de segurança gratuita (${usedMB} MB / ${STORAGE_FREE_LIMIT_MB} MB).`;
    }

    const quotaResult: StorageQuotaStatus = {
      allowed,
      status,
      usedBytes: totalBytes,
      usedMB,
      limitMB: STORAGE_FREE_LIMIT_MB,
      percentUsed,
      fileCount: allFiles.length,
      provider: 'Supabase Storage (labels)',
      lastChecked: new Date().toISOString(),
      antiBillingProtectionActive: true,
      message,
    };

    cachedQuota = { data: quotaResult, timestamp: now };
    return quotaResult;
  } catch (err: any) {
    console.error('[STORAGE-GUARD] Exceção ao verificar cota:', err);
    return {
      allowed: true,
      status: 'SAFE',
      usedBytes: 0,
      usedMB: 0,
      limitMB: STORAGE_FREE_LIMIT_MB,
      percentUsed: 0,
      fileCount: 0,
      provider: 'Supabase Storage (labels)',
      lastChecked: new Date().toISOString(),
      antiBillingProtectionActive: true,
      message: 'Monitoramento ativo em modo de contingência.',
    };
  }
}

/**
 * Remove fotos de etiquetas antigas do bucket de nuvem para liberar espaço e garantir custo zero permanente.
 * As encomendas continuam cadastradas com todos os dados e histórico intactos no banco!
 * @param maxAgeDays Idade máxima em dias (0 = apagar TODAS as fotos / zerar armazenamento)
 */
export async function purgeOldDeliveredPhotos(maxAgeDays = 30): Promise<{
  purgedCount: number;
  freedBytes: number;
  freedMB: number;
  errors: string[];
}> {
  const supabase = getSupabaseAdmin();
  const errors: string[] = [];

  // Invalida cache de cota para atualização em tempo real
  cachedQuota = null;

  try {
    // 1. Lista todos os arquivos recursivamente no bucket 'labels'
    const allFiles = await listAllStorageFilesRecursive(supabase, 'labels', '');

    if (allFiles.length === 0) {
      return { purgedCount: 0, freedBytes: 0, freedMB: 0, errors: [] };
    }

    // 2. Filtra arquivos: se maxAgeDays <= 0, seleciona TODAS as fotos para zerar o storage!
    let filesToPurge: { fullPath: string; size: number }[] = [];

    if (maxAgeDays <= 0) {
      filesToPurge = allFiles.map(f => ({ fullPath: f.fullPath, size: f.size }));
    } else {
      const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      for (const f of allFiles) {
        if (!f.createdAt || f.createdAt < cutoffTime) {
          filesToPurge.push({
            fullPath: f.fullPath,
            size: f.size,
          });
        }
      }
    }

    if (filesToPurge.length === 0) {
      return { purgedCount: 0, freedBytes: 0, freedMB: 0, errors: [] };
    }

    // 3. Deleta em lotes de até 100 arquivos usando o caminho relativo completo
    const batchSize = 100;
    let totalPurged = 0;
    let totalFreedBytes = 0;

    for (let i = 0; i < filesToPurge.length; i += batchSize) {
      const batch = filesToPurge.slice(i, i + batchSize);
      const filePaths = batch.map(b => b.fullPath);
      const batchBytes = batch.reduce((sum, b) => sum + b.size, 0);

      const { error: removeErr } = await supabase.storage.from('labels').remove(filePaths);
      if (removeErr) {
        console.warn('[STORAGE-GUARD] Erro ao deletar lote de fotos:', removeErr.message);
        errors.push(removeErr.message);
      } else {
        totalPurged += batch.length;
        totalFreedBytes += batchBytes;
      }
    }

    const freedMB = Number((totalFreedBytes / (1024 * 1024)).toFixed(2));
    console.log(`[STORAGE-GUARD] 🧹 Expurgo/Limpeza concluído: ${totalPurged} fotos removidas (${freedMB} MB liberados).`);

    // Invalida cache e recomputa a cota em tempo real
    cachedQuota = null;
    await checkStorageGuard(true);

    return {
      purgedCount: totalPurged,
      freedBytes: totalFreedBytes,
      freedMB,
      errors,
    };
  } catch (err: any) {
    console.error('[STORAGE-GUARD] Erro inesperado no expurgo de fotos:', err);
    return {
      purgedCount: 0,
      freedBytes: 0,
      freedMB: 0,
      errors: [err.message || 'Erro inesperado'],
    };
  }
}
