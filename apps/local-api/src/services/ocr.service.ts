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
    const prompt = `
Você é um especialista em OCR e visão computacional de alta precisão para recepção de encomendas em condomínios no Brasil.
Analise a imagem da etiqueta de entrega (Correios, Mercado Livre, Shopee, Amazon, Dell, Total Express, Jadlog, Loggi, etc.) e extraia com a máxima precisão as seguintes informações:

1. "recipientName": Nome completo do destinatário / morador (ex: se na etiqueta diz "DXM KLEBIN", extraia "DXM KLEBIN").
2. "block": Identificação do bloco/torre, se houver (ex: se o endereço contiver "A805", "CIVIT I 1770 A805", "BL A", extraia "Bloco A").
3. "unitNumber": Número do apartamento ou casa (ex: se o endereço contiver "A805", extraia "805").
4. "carrier": Nome da transportadora, marketplace ou remetente (ex: "Dell", "Mercado Livre", "Shopee", "Amazon", "Correios", "Total Express", "Outro").
5. "trackingCode": Código de rastreio, número da Nota Fiscal (NF) ou código do pacote (ex: "7958078", "CPQ 11028199").
6. "confidence": Um número de 0.0 a 1.0 indicando o grau de certeza da leitura.

Responda ESTRITAMENTE em formato JSON:
{
  "recipientName": string | null,
  "block": string | null,
  "unitNumber": string | null,
  "carrier": string,
  "trackingCode": string | null,
  "confidence": number
}
`;

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
            'X-goog-api-key': env.GEMINI_API_KEY
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
              maxOutputTokens: 300
            }
          }),
          signal: AbortSignal.timeout(30000)
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
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
          };
        }
      } catch (error: any) {
        console.warn(`[OCRService] ⚠️ Modelo ${modelName} falhou: ${error?.message?.slice(0, 100)}`);
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
