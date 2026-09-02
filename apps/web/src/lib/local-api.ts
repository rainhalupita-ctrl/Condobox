export interface OCRResponse {
  success: boolean;
  image: {
    path: string;
    url: string;
  };
  ocr: {
    recipientName: string | null;
    block: string | null;
    unitNumber: string | null;
    carrier: string;
    trackingCode: string | null;
    invoiceNumber?: string | null;
    confidence: number;
  };
  suggestedMatch: {
    unit: { id: string; block: string; unit_number: string } | null;
    resident: { id: string; name: string; phone: string; email?: string } | null;
  };
}

export class LocalApiClient {
  private static getBaseUrl(): string {
    if (typeof window !== 'undefined') {
      const savedIp = localStorage.getItem('condo_local_api_url');
      if (savedIp) return savedIp.replace(/\/$/, '');
    }
    return (process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:3001').replace(/\/$/, '');
  }

  public static setCustomBaseUrl(url: string) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('condo_local_api_url', url);
    }
  }

  public static getCurrentImageBaseUrl(): string {
    return this.getBaseUrl();
  }

  public static getImageUrl(path?: string | null): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;

    // Se for caminho relativo gravado no Supabase Storage ('labels/...' ou 'signatures/...')
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && (path.startsWith('labels/') || path.startsWith('signatures/'))) {
      const bucket = path.startsWith('labels/') ? 'labels' : 'signatures';
      const cleanPath = path.replace(/^(labels|signatures)\//, '');
      return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${cleanPath}`;
    }

    const base = this.getBaseUrl() || 'http://localhost:3001';
    return `${base}/images/${path}`;
  }

  public static getLocalFallbackUrl(path?: string | null): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
    const base = this.getBaseUrl() || 'http://localhost:3001';
    return `${base}/images/${path}`;
  }

  /**
   * Envia a foto da etiqueta para processar e extrair com Gemini OCR (com fallback nuvem automático)
   */
  static async uploadLabelAndOCR(file: File | Blob): Promise<OCRResponse> {
    const baseUrl = this.getBaseUrl();
    const formData = new FormData();
    formData.append('file', file, 'label.jpg');

    try {
      const targetUrl = baseUrl ? `${baseUrl}/api/upload` : '/api/upload';
      const res = await fetch(targetUrl, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        return await res.json();
      }
    } catch (localErr) {
      console.warn('[LocalApiClient] API local indisponível, tentando OCR em nuvem /api/upload...');
    }

    // Fallback garantido na nuvem Vercel
    const fallbackRes = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!fallbackRes.ok) {
      const err = await fallbackRes.json().catch(() => ({ error: 'Erro no servidor' }));
      throw new Error(err.details || err.error || 'Falha ao processar etiqueta via OCR');
    }

    return fallbackRes.json();
  }

  /**
   * Registra a encomenda e envia notificação no WhatsApp
   */
  static async createPackage(payload: {
    unitId: string;
    residentId?: string | null;
    carrier: string;
    trackingCode?: string | null;
    recipientNameOcr?: string | null;
    labelImagePath?: string | null;
    notes?: string | null;
    sendWhatsApp?: boolean;
    residentPhone?: string | null;
    residentName?: string | null;
    unitInfo?: string | null;
  }) {
    const baseUrl = this.getBaseUrl();

    // 1. Tenta diretamente na API local (computador da portaria — mais rápido e completo)
    try {
      const targetUrl = baseUrl ? `${baseUrl}/api/packages` : null;
      if (targetUrl) {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(8000)
        });
        if (res.ok) return await res.json();
      }
    } catch {
      console.info('[LocalApiClient] API local offline — publicando na fila do Supabase...');
    }

    // 2. Fallback: publica na fila do Supabase (o local-api vai consumir via Realtime)
    const queueRes = await fetch('/api/packages/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!queueRes.ok) {
      // 3. Último fallback: rota padrão Next.js
      const fallbackRes = await fetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!fallbackRes.ok) {
        const err = await fallbackRes.json().catch(() => ({ error: 'Erro ao salvar' }));
        throw new Error(err.details || err.error || 'Falha ao registrar encomenda');
      }
      return fallbackRes.json();
    }

    return queueRes.json();
  }

  /**
   * Publica diretamente na fila do Supabase (para uso no PWA mobile sem API local)
   * O local-api vai consumir via Realtime, processar e disparar o WhatsApp
   */
  static async publishToQueue(payload: {
    unitId: string;
    residentId?: string | null;
    carrier: string;
    trackingCode?: string | null;
    recipientNameOcr?: string | null;
    labelImagePath?: string | null;
    phone?: string | null;
    sendWhatsApp?: boolean;
    notes?: string | null;
  }) {
    const res = await fetch('/api/packages/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro na fila' }));
      throw new Error(err.error || 'Falha ao publicar encomenda na fila');
    }
    return res.json();
  }

  /**
   * Envia assinatura de retirada e dá baixa
   */
  static async submitSignature(payload: {
    packageId: string;
    signatureBase64: string;
    deliveredToName: string;
    deliveredByUserId?: string | null;
    sendWhatsAppConfirmation?: boolean;
  }) {
    const baseUrl = this.getBaseUrl();
    try {
      const targetUrl = baseUrl ? `${baseUrl}/api/signature` : '/api/signature';
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) return await res.json();
    } catch {}

    const fallbackRes = await fetch('/api/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!fallbackRes.ok) {
      const err = await fallbackRes.json().catch(() => ({ error: 'Erro ao registrar assinatura' }));
      throw new Error(err.details || err.error || 'Falha ao concluir retirada');
    }

    return fallbackRes.json();
  }

  /**
   * Checagem de saúde da API local
   */
  static async checkHealth() {
    try {
      const baseUrl = this.getBaseUrl();
      const res = await fetch(`${baseUrl}/api/health`, {
        signal: AbortSignal.timeout(3000)
      });
      return await res.json();
    } catch {
      return { status: 'OFFLINE', services: { connected: false } };
    }
  }

  /**
   * Status de conexão do WhatsApp (Baileys Nativo)
   */
  static async getWhatsAppStatus() {
    const baseUrl = this.getBaseUrl();

    // 1. Tenta diretamente na API local (computador da portaria / Electron)
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl}/api/whatsapp/status`, {
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) return await res.json();
      } catch {}
    }

    // 2. Fallback: rota Next.js na nuvem
    try {
      const res = await fetch('/api/whatsapp/status', {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) return await res.json();
    } catch {}

    return { status: 'DISCONNECTED', connected: false, instance: 'portaria' };
  }

  /**
   * Solicita criação de instância e QR Code para pareamento
   */
  static async connectWhatsApp() {
    const baseUrl = this.getBaseUrl();

    // 1. Tenta diretamente na API local
    if (baseUrl) {
      try {
        const directRes = await fetch(`${baseUrl}/api/whatsapp/connect`, {
          method: 'POST',
          signal: AbortSignal.timeout(10000)
        });
        if (directRes.ok) return await directRes.json();
      } catch {}
    }

    // 2. Fallback: rota Next.js
    const fallbackRes = await fetch('/api/whatsapp/connect', {
      method: 'POST',
      signal: AbortSignal.timeout(12000)
    });
    return await fallbackRes.json();
  }

  /**
   * Desconecta o WhatsApp e limpa a sessão para permitir novo pareamento
   */
  static async logoutWhatsApp() {
    const baseUrl = this.getBaseUrl();

    // 1. Tenta diretamente na API local
    if (baseUrl) {
      try {
        const directRes = await fetch(`${baseUrl}/api/whatsapp/logout`, {
          method: 'POST',
          signal: AbortSignal.timeout(8000)
        });
        if (directRes.ok) return await directRes.json();
      } catch {}
    }

    // 2. Fallback: rota Next.js
    const fallbackRes = await fetch('/api/whatsapp/logout', {
      method: 'POST',
      signal: AbortSignal.timeout(10000)
    });
    return await fallbackRes.json();
  }

  /**
   * Envia mensagem de teste para validar o canal
   */
  static async sendTestWhatsApp(phone: string) {
    const baseUrl = this.getBaseUrl();

    // 1. Tenta diretamente na API local
    if (baseUrl) {
      try {
        const directRes = await fetch(`${baseUrl}/api/whatsapp/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
          signal: AbortSignal.timeout(8000)
        });
        if (directRes.ok) return await directRes.json();
      } catch {}
    }

    // 2. Fallback: rota Next.js
    const fallbackRes = await fetch('/api/whatsapp/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(12000)
    });
    return await fallbackRes.json();
  }

  /**
   * Verifica se a notificação da encomenda já foi enviada e envia no WhatsApp
   */
  static async notifyPackage(packageId: string, force = false) {
    const baseUrl = this.getBaseUrl();
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl}/api/packages/${packageId}/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
          signal: AbortSignal.timeout(15000)
        });
        if (res.ok) return await res.json();
      } catch {}
    }

    try {
      const fallbackRes = await fetch(`/api/package/${packageId}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
        signal: AbortSignal.timeout(15000)
      });
      if (fallbackRes.ok) return await fallbackRes.json();
    } catch {}

    return { success: false, error: 'API local da portaria não conectada' };
  }

  /**
   * Dispara notificações para todas as encomendas pendentes que ainda não foram enviadas
   */
  static async notifyPendingPackages() {
    const baseUrl = this.getBaseUrl();
    if (baseUrl) {
      try {
        const res = await fetch(`${baseUrl}/api/packages/notify-pending`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(30000)
        });
        if (res.ok) return await res.json();
      } catch {}
    }

    return { success: false, error: 'API local da portaria não conectada' };
  }
}
