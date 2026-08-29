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
    if (path.startsWith('http')) return path;
    return `${this.getBaseUrl()}/images/${path}`;
  }

  /**
   * Envia a foto da etiqueta para a API local para salvar e extrair com Gemini OCR
   */
  static async uploadLabelAndOCR(file: File | Blob): Promise<OCRResponse> {
    const baseUrl = this.getBaseUrl();
    const formData = new FormData();
    formData.append('file', file, 'label.jpg');

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro no servidor' }));
      throw new Error(err.details || err.error || 'Falha ao processar etiqueta');
    }

    return res.json();
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
    const res = await fetch(`${baseUrl}/api/packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro ao salvar' }));
      throw new Error(err.details || err.error || 'Falha ao registrar encomenda');
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
    const res = await fetch(`${baseUrl}/api/signature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erro ao registrar assinatura' }));
      throw new Error(err.details || err.error || 'Falha ao concluir retirada');
    }

    return res.json();
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
}
