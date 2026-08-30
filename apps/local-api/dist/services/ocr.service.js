import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
export class OCRService {
    genAI = null;
    constructor() {
        this.initClient();
    }
    initClient() {
        if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim() !== '') {
            this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
        }
    }
    /**
     * Processa a foto da etiqueta utilizando Gemini Flash Vision com fallback inteligente de modelos
     */
    async extractPackageInfo(imageBuffer, mimeType = 'image/jpeg') {
        this.initClient();
        if (!this.genAI || !env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim() === '') {
            console.warn('[OCRService] Chave GEMINI_API_KEY não configurada. Usando fallback.');
            return this.fallbackHeuristic(imageBuffer);
        }
        const base64Image = imageBuffer.toString('base64');
        const apiKey = env.GEMINI_API_KEY;
        const prompt = `Você é um especialista em OCR e leitura de etiquetas de encomendas brasileiras (Mercado Livre, Shopee, Amazon, Correios, Magalu, Shein, Jadlog, Loggi, etc.).
Analise a imagem da etiqueta e extraia APENAS dados válidos e legíveis em formato JSON estrito:
{
  "recipientName": string ou null,
  "block": string ou null,
  "unitNumber": string ou null,
  "carrier": string,
  "trackingCode": string ou null,
  "invoiceNumber": string ou null,
  "confidence": number
}

REGRAS CRÍTICAS DE PRECISÃO:
1. "recipientName": Extraia APENAS o nome da pessoa física (destinatário/morador). NUNCA coloque nomes de empresas, remetentes, avisos (ex: "FRÁGIL", "DOCS", "DESTINATÁRIO", "REMETENTE", "DANFE", transportadoras) nem textos cortados ou ilegíveis. Se não tiver certeza absoluta do nome do morador, retorne null.
2. "unitNumber": Número do apartamento/unidade residencial (ex: "101", "805", "402", "12"). Procure por termos como "Apto", "Ap", "Unidade", "Casa", "Apto.", "Ap.". Se não estiver legível, retorne null.
3. "block": Identificação do bloco/torre (ex: "Bloco A", "Torre 1", "Bloco B"). Se não houver bloco na etiqueta, retorne null.
4. "carrier": Identifique a transportadora: Mercado Livre, Shopee, Amazon, Correios, Dell, Total Express, Loggi, Jadlog, Shein, Magalu ou Outro.
5. "trackingCode": Código de rastreio ou código de barras da entrega.
6. "invoiceNumber": Número da Nota Fiscal ou DANFE se visível na etiqueta.`;
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
                    const data = (await res.json());
                    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    const parsed = JSON.parse(responseText);
                    console.log(`[OCRService] ✅ Extração com sucesso usando [${modelName}]:`, parsed);
                    // Sanitização rigorosa do nome do destinatário para evitar ruídos ou nomes de transportadora
                    let cleanRecipient = (parsed.recipientName || '').trim();
                    const forbiddenWords = [
                        'MERCADO LIVRE', 'SHOPEE', 'AMAZON', 'CORREIOS', 'LOGGI', 'TOTAL EXPRESS',
                        'JADLOG', 'SHEIN', 'MAGALU', 'MAGAZINE LUIZA', 'FRAGIL', 'FRÁGIL',
                        'DESTINATARIO', 'DESTINATÁRIO', 'REMETENTE', 'DANFE', 'NOTA FISCAL',
                        'NF-E', 'ENCOMENDA', 'ENTREGA', 'CONDOMINIO', 'CONDOMÍNIO', 'PORTARIA',
                        'PAC', 'SEDEX', 'EXPRESS', 'FULL', 'STANDARD', 'ENVIO'
                    ];
                    if (!cleanRecipient ||
                        cleanRecipient.length < 3 ||
                        forbiddenWords.some(fw => cleanRecipient.toUpperCase() === fw || cleanRecipient.toUpperCase().startsWith(fw))) {
                        cleanRecipient = null;
                    }
                    return {
                        recipientName: cleanRecipient,
                        block: parsed.block ? String(parsed.block).trim() : null,
                        unitNumber: parsed.unitNumber ? String(parsed.unitNumber).trim() : null,
                        carrier: parsed.carrier || 'Outro',
                        trackingCode: parsed.trackingCode ? String(parsed.trackingCode).trim() : null,
                        invoiceNumber: parsed.invoiceNumber ? String(parsed.invoiceNumber).trim() : null,
                        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
                    };
                }
            }
            catch (error) {
                console.warn(`[OCRService] Tentativa com ${modelName} falhou:`, error.message?.slice(0, 100));
            }
        }
        console.error('[OCRService] Todos os modelos do Gemini falharam.');
        return this.fallbackHeuristic(imageBuffer);
    }
    fallbackHeuristic(imageBuffer) {
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
