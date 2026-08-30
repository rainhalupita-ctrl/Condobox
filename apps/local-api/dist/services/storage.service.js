import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ABSOLUTE_STORAGE_DIR, env } from '../config/env.js';
import { supabaseService } from './supabase.service.js';
export class StorageService {
    labelsDir;
    signaturesDir;
    constructor() {
        this.labelsDir = path.join(ABSOLUTE_STORAGE_DIR, 'labels');
        this.signaturesDir = path.join(ABSOLUTE_STORAGE_DIR, 'signatures');
        this.ensureDirectories();
    }
    ensureDirectories() {
        if (!fsSync.existsSync(this.labelsDir)) {
            fsSync.mkdirSync(this.labelsDir, { recursive: true });
        }
        if (!fsSync.existsSync(this.signaturesDir)) {
            fsSync.mkdirSync(this.signaturesDir, { recursive: true });
        }
    }
    /**
     * Salva imagem da etiqueta da encomenda
     */
    async saveLabelImage(buffer, originalExt = 'jpg') {
        const ext = originalExt.replace('.', '') || 'jpg';
        const datePrefix = new Date().toISOString().slice(0, 7); // YYYY-MM
        const targetFolder = path.join(this.labelsDir, datePrefix);
        if (!fsSync.existsSync(targetFolder)) {
            await fs.mkdir(targetFolder, { recursive: true });
        }
        const filename = `${uuidv4()}.${ext}`;
        const fullPath = path.join(targetFolder, filename);
        const relativePath = `labels/${datePrefix}/${filename}`;
        await fs.writeFile(fullPath, buffer);
        let url = `${env.LOCAL_BASE_URL}/images/${relativePath}`;
        // Faz upload espelhado para o Supabase Storage (bucket 'labels') para acesso público global
        try {
            if (supabaseService.isConfigured()) {
                const { data, error } = await supabaseService.getClient().storage
                    .from('labels')
                    .upload(`${datePrefix}/${filename}`, buffer, {
                    contentType: `image/${ext === 'png' ? 'png' : 'jpeg'}`,
                    upsert: true
                });
                if (!error && data) {
                    const { data: pubData } = supabaseService.getClient().storage.from('labels').getPublicUrl(`${datePrefix}/${filename}`);
                    if (pubData?.publicUrl) {
                        url = pubData.publicUrl;
                        return {
                            relativePath: pubData.publicUrl,
                            fullPath,
                            url: pubData.publicUrl,
                            filename
                        };
                    }
                }
            }
        }
        catch (e) {
            console.warn('[StorageService] Falha ao espelhar imagem no Supabase Storage:', e.message);
        }
        return {
            relativePath,
            fullPath,
            url,
            filename
        };
    }
    /**
     * Salva a assinatura digital de retirada (PNG Base64 ou Buffer)
     */
    async saveSignatureImage(data) {
        const datePrefix = new Date().toISOString().slice(0, 7);
        const targetFolder = path.join(this.signaturesDir, datePrefix);
        if (!fsSync.existsSync(targetFolder)) {
            await fs.mkdir(targetFolder, { recursive: true });
        }
        const filename = `${uuidv4()}.png`;
        const fullPath = path.join(targetFolder, filename);
        const relativePath = `signatures/${datePrefix}/${filename}`;
        let buffer;
        if (typeof data === 'string') {
            // Remove data URL prefix se presente
            const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
            buffer = Buffer.from(base64Data, 'base64');
        }
        else {
            buffer = data;
        }
        await fs.writeFile(fullPath, buffer);
        let url = `${env.LOCAL_BASE_URL}/images/${relativePath}`;
        // Faz upload espelhado para o Supabase Storage (bucket 'signatures') para acesso público global
        try {
            if (supabaseService.isConfigured()) {
                const { data: uploadData, error } = await supabaseService.getClient().storage
                    .from('signatures')
                    .upload(`${datePrefix}/${filename}`, buffer, {
                    contentType: 'image/png',
                    upsert: true
                });
                if (!error && uploadData) {
                    const { data: pubData } = supabaseService.getClient().storage.from('signatures').getPublicUrl(`${datePrefix}/${filename}`);
                    if (pubData?.publicUrl) {
                        url = pubData.publicUrl;
                        return {
                            relativePath: pubData.publicUrl,
                            fullPath,
                            url: pubData.publicUrl,
                            filename
                        };
                    }
                }
            }
        }
        catch (e) {
            console.warn('[StorageService] Falha ao espelhar assinatura no Supabase Storage:', e.message);
        }
        return {
            relativePath,
            fullPath,
            url,
            filename
        };
    }
    /**
     * Limpeza de arquivos de etiquetas com mais de N dias
     */
    async cleanupOldLabels(retentionDays = 90) {
        let deletedCount = 0;
        const now = Date.now();
        const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
        async function walkAndClean(dir) {
            if (!fsSync.existsSync(dir))
                return;
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await walkAndClean(fullPath);
                    // Remove pasta vazia se aplicável
                    const subEntries = await fs.readdir(fullPath);
                    if (subEntries.length === 0) {
                        await fs.rmdir(fullPath);
                    }
                }
                else if (entry.isFile()) {
                    const stats = await fs.stat(fullPath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        await fs.unlink(fullPath);
                        deletedCount++;
                    }
                }
            }
        }
        await walkAndClean(this.labelsDir);
        return { deletedCount };
    }
}
export const storageService = new StorageService();
