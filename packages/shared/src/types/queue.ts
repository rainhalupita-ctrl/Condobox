/**
 * @condobox/shared — Tipos de Fila (Queue Payloads)
 * 
 * Estes tipos definem os contratos de dados entre o PWA mobile (apps/web)
 * e o backend local (apps/local-api) via tabelas de fila do Supabase.
 * O Supabase atua exclusivamente como buffer temporário — os dados são
 * processados e deletados imediatamente pelo local-api.
 */

// ─────────────────────────────────────────────────────────────────────────────
// FILA DE ENCOMENDAS
// Publicado pelo: apps/web (porteiro mobile ao registrar chegada de encomenda)
// Consumido por: apps/local-api (QueueConsumerService via Supabase Realtime)
// ─────────────────────────────────────────────────────────────────────────────

export interface FilaEncomenda {
  id: string;
  condo_id?: string | null;
  unit_id: string;
  resident_id?: string | null;
  carrier: string;
  tracking_code?: string | null;
  recipient_name_ocr?: string | null;
  label_image_path?: string | null;
  phone?: string | null;
  send_whatsapp: boolean;
  notes?: string | null;
  created_at?: string;
}

/** Payload enviado pelo apps/web ao inserir na fila */
export interface InsertFilaEncomendaPayload {
  condo_id?: string;
  unit_id: string;
  resident_id?: string | null;
  carrier: string;
  tracking_code?: string | null;
  recipient_name_ocr?: string | null;
  label_image_path?: string | null;
  phone?: string | null;
  send_whatsapp?: boolean;
  notes?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILA DE MENSAGENS AVULSAS
// Para envios de WhatsApp que não são sobre encomendas
// ─────────────────────────────────────────────────────────────────────────────

export type TipoMensagem = 'CHEGADA' | 'RETIRADA' | 'AVISO' | 'TESTE';

export interface FilaMensagem {
  id: string;
  package_id?: string | null;
  phone: string;
  message: string;
  tipo: TipoMensagem;
  created_at?: string;
}

export interface InsertFilaMensagemPayload {
  package_id?: string | null;
  phone: string;
  message: string;
  tipo?: TipoMensagem;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS GERAIS DE DOMÍNIO (compartilhados entre web e local-api)
// ─────────────────────────────────────────────────────────────────────────────

export type PackageStatus = 'RECEIVED' | 'NOTIFIED' | 'DELIVERED';
export type WhatsAppNotifStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED';

export interface QueueProcessResult {
  success: boolean;
  packageId?: string;
  whatsappSent?: boolean;
  error?: string;
}
