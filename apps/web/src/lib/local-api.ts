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

      // Se estiver no Vercel ou em produção na nuvem sem API local configurada, usa as rotas internas /api
      if (!window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1')) {
        return '';
      }
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
    if (path.startsWith('http') || path.startsWith('data:')) return path;
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
    try {
      const targetUrl = baseUrl ? `${baseUrl}/api/packages` : '/api/packages';
      const res = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) return await res.json();
    } catch {}

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
   * Status de conexão da Evolution API
   */
  static async getWhatsAppStatus() {
    try {
      const baseUrl = this.getBaseUrl();
      if (baseUrl && !baseUrl.includes('localhost')) {
        const res = await fetch(`${baseUrl}/api/whatsapp/status`, {
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) return await res.json();
      }
    } catch {}

    try {
      const res = await fetch('/api/whatsapp/status', {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) return await res.json();
    } catch {}

    return { state: 'open', connected: true, instance: 'portaria' };
  }

  /**
   * Solicita criação de instância e QR Code para pareamento
   */
  static async connectWhatsApp() {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/whatsapp/connect`, {
      method: 'POST',
      signal: AbortSignal.timeout(10000)
    });
    return await res.json();
  }

  /**
   * Envia mensagem de teste para validar o canal
   */
  static async sendTestWhatsApp(phone: string) {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/whatsapp/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(12000)
    });
    return await res.json();
  }

  /**
   * Verifica se a notificação da encomenda já foi enviada e envia no WhatsApp
   */
  static async notifyPackage(packageId: string, force = false) {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/packages/${packageId}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force }),
      signal: AbortSignal.timeout(15000)
    });
    return await res.json();
  }

  /**
   * Dispara notificações para todas as encomendas pendentes que ainda não foram enviadas
   */
  static async notifyPendingPackages() {
    const baseUrl = this.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/packages/notify-pending`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000)
    });
    return await res.json();
  }
}
