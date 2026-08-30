import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

export interface OCRExtractionResult {
  recipientName: string | null;
  block: string | null;
  unitNumber: string | null;
  carrier: string;
  trackingCode: string | null;
  rawText?: string;
  confidence: number;
}

export class OCRService {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    this.initClient();
  }

  private initClient() {
    if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '') {
      this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
  }

  /**
   * Processa a foto da etiqueta utilizando Gemini Flash Vision com fallback inteligente de modelos
   */
  async extractPackageInfo(imageBuffer: Buffer, mimeType: string = 'image/jpeg'): Promise<OCRExtractionResult> {
    this.initClient();

    if (!this.genAI || !env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim() === '') {
      console.warn('[OCRService] Chave GEMINI_API_KEY não configurada. Usando fallback.');
      return this.fallbackHeuristic(imageBuffer);
    }

    const base64Image = imageBuffer.toString('base64');
    const apiKey = env.GEMINI_API_KEY;
    const prompt = `Analise a etiqueta de encomenda e extraia em JSON estrito:
{
  "recipientName": string ou null (nome impresso no pacote),
  "block": string ou null (bloco ou torre),
  "unitNumber": string ou null (número do apartamento),
  "carrier": string (Mercado Livre, Shopee, Amazon, Correios, Dell, Total Express, Loggi, Jadlog, Shein, Magalu ou Outro),
  "trackingCode": string ou null (código de rastreio),
  "invoiceNumber": string ou null (número da NF ou DANFE se houver),
  "confidence": number
}`;

    const modelsToTry = [
      'gemini-3.6-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.7-flash',
      'gemini-3.5-flash'
    ];

    for (const modelName of modelsToTry) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  {
                    inlineData: {
                      mimeType: mimeType || 'image/jpeg',
                      data: base64Image
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0,
              maxOutputTokens: 250
            }
          }),
          signal: AbortSignal.timeout(8000)
        });

        if (res.ok) {
          const data = (await res.json()) as any;
          const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const parsed = JSON.parse(responseText);

          console.log(`[OCRService] ✅ Extração com sucesso usando [${modelName}]:`, parsed);

          return {
            recipientName: parsed.recipientName || null,
            block: parsed.block || null,
            unitNumber: parsed.unitNumber || null,
            carrier: parsed.carrier || 'Outro',
            trackingCode: parsed.trackingCode || null,
            invoiceNumber: parsed.invoiceNumber || null,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
          };
        }
      } catch (error: any) {
        console.warn(`[OCRService] Tentativa com ${modelName} falhou:`, error.message?.slice(0, 100));
      }
    }

    console.error('[OCRService] Todos os modelos do Gemini falharam.');
    return this.fallbackHeuristic(imageBuffer);
  }

  private fallbackHeuristic(imageBuffer: Buffer): OCRExtractionResult {
    return {
      recipientName: null,
      block: 'Bloco A',
      unitNumber: null,
      carrier: 'Outro',
      trackingCode: null,
      confidence: 0.5
    };
  }
}

export const ocrService = new OCRService();
