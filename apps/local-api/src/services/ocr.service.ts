import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

// Tesseract.js import dinâmico para compatibilidade ESM
let TesseractWorker: any = null;

export interface OCRExtractionResult {
  recipientName: string | null;
  block: string | null;
  unitNumber: string | null;
  carrier: string;
  trackingCode: string | null;
  invoiceNumber?: string | null;
  rawText?: string;
  confidence: number;
}

const FORBIDDEN_WORDS = [
  'MERCADO LIVRE', 'SHOPEE', 'AMAZON', 'CORREIOS', 'LOGGI', 'TOTAL EXPRESS',
  'JADLOG', 'SHEIN', 'MAGALU', 'MAGAZINE LUIZA', 'FRAGIL', 'FRÁGIL',
  'DESTINATARIO', 'DESTINATÁRIO', 'REMETENTE', 'DANFE', 'NOTA FISCAL',
  'NF-E', 'ENCOMENDA', 'ENTREGA', 'CONDOMINIO', 'CONDOMÍNIO', 'PORTARIA',
  'PAC', 'SEDEX', 'EXPRESS', 'FULL', 'STANDARD', 'ENVIO', 'DELL',
];

const RICH_PROMPT = `Você é especialista em OCR de etiquetas de encomendas residenciais brasileiras.
Analise a imagem e extraia em JSON estrito:
{
  "recipientName": string|null,
  "block": string|null,
  "unitNumber": string|null,
  "carrier": string,
  "trackingCode": string|null,
  "invoiceNumber": string|null,
  "confidence": number
}
REGRAS:
1. recipientName = APENAS nome da pessoa física destinatária. NUNCA empresa/transportadora/aviso.
2. unitNumber = número do apartamento/unidade (ex: "101", "805").
3. block = bloco ou torre se houver.
4. carrier = Mercado Livre | Shopee | Amazon | Correios | Loggi | Jadlog | Shein | Magalu | Total Express | Outro.
5. trackingCode = código de rastreio ou barras.
6. invoiceNumber = NF/DANFE se visível.
7. confidence = 0.0-1.0 refletindo certeza dos dados extraídos.`;

export class OCRService {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    this.initClient();
  }

  private initClient() {
    if (env.GEMINI_API_KEY?.trim()) {
      this.genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    }
  }

  private sanitize(parsed: any): OCRExtractionResult {
    let cleanRecipient: string | null = (parsed.recipientName || '').trim();
    if (
      !cleanRecipient ||
      cleanRecipient.length < 3 ||
      FORBIDDEN_WORDS.some(fw => cleanRecipient!.toUpperCase() === fw || cleanRecipient!.toUpperCase().startsWith(fw))
    ) {
      cleanRecipient = null;
    }

    let rawUnit = parsed.unitNumber ? String(parsed.unitNumber).trim() : '';
    let rawBlock = parsed.block ? String(parsed.block).trim() : null;

    const matchLetterNum = rawUnit.match(/^([A-Za-z])\s*(\d{1,5})$/);
    if (matchLetterNum) {
      if (!rawBlock) rawBlock = `Bloco ${matchLetterNum[1].toUpperCase()}`;
      rawUnit = matchLetterNum[2];
    }

    const hasUnit = Boolean(rawUnit && rawUnit.replace(/\D/g, '').length >= 1);
    const detected = hasUnit || !!cleanRecipient || !!(parsed.trackingCode?.trim()?.length >= 6);

    return {
      recipientName: cleanRecipient,
      block: rawBlock,
      unitNumber: hasUnit ? rawUnit : null,
      carrier: parsed.carrier || 'Outro',
      trackingCode: parsed.trackingCode ? String(parsed.trackingCode).trim() : null,
      invoiceNumber: parsed.invoiceNumber ? String(parsed.invoiceNumber).trim() : null,
      confidence: detected ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.92) : 0,
    };
  }

  private parseRawText(text: string): OCRExtractionResult {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const fullText = lines.join(' ');

    const aptoMatch = fullText.match(/(?:APTO?\.?|AP\.?|UNIDADE|UND\.?|APART\.?)\s*[:\-]?\s*(\d{1,5})/i);
    const unitNumber = aptoMatch ? aptoMatch[1] : null;

    const blocoMatch = fullText.match(/(?:BLOCO?|BL\.?|TORRE?)\s*[:\-]?\s*([A-Z0-9]{1,3})/i);
    const block = blocoMatch ? `Bloco ${blocoMatch[1].toUpperCase()}` : null;

    const trackMatch = text.match(/\b([A-Z]{2}\d{9,}[A-Z]{2}|\d{13,20})\b/);
    const trackingCode = trackMatch ? trackMatch[1] : null;

    let recipientName: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (/destinat[aá]rio|para:/i.test(lines[i]) && lines[i + 1]) {
        const cand = lines[i + 1].trim();
        if (cand.length >= 4 && /^[A-Za-zÀ-ÿ\s]+$/.test(cand)) { recipientName = cand; break; }
      }
    }

    const detected = !!(unitNumber || trackingCode);
    return {
      recipientName, block, unitNumber, carrier: 'Outro',
      trackingCode, invoiceNumber: null,
      confidence: detected ? 0.6 : 0,
      rawText: text,
    };
  }

  // ── Gemini Vision ──────────────────────────────────────────────────────────
  private async tryGemini(base64Image: string, mimeType: string): Promise<OCRExtractionResult | null> {
    if (!env.GEMINI_API_KEY) return null;
    const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'];
    for (const model of models) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-goog-api-key': env.GEMINI_API_KEY },
            body: JSON.stringify({
              contents: [{ parts: [{ text: RICH_PROMPT }, { inlineData: { mimeType, data: base64Image } }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 250 },
            }),
            signal: AbortSignal.timeout(8000),
          }
        );
        if (!res.ok) continue;
        const data = (await res.json()) as any;
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) continue;
        const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
        const result = this.sanitize(parsed);
        if (result.confidence > 0) { console.log(`[OCRService] ✅ Gemini [${model}]`, result); return result; }
      } catch (e: any) {
        console.warn(`[OCRService] Gemini ${model} falhou:`, e.message?.slice(0, 80));
      }
    }
    return null;
  }

  // ── Groq Vision (llama-4-scout) ────────────────────────────────────────────
  private async tryGroq(base64Image: string, mimeType: string): Promise<OCRExtractionResult | null> {
    const groqKey = env.GROQ_API_KEY;
    if (!groqKey) return null;
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: RICH_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          }],
          temperature: 0,
          max_tokens: 250,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      const result = this.sanitize(parsed);
      if (result.confidence > 0) { console.log('[OCRService] ✅ Groq Vision', result); return result; }
    } catch (e: any) {
      console.warn('[OCRService] Groq falhou:', e.message?.slice(0, 80));
    }
    return null;
  }

  // ── NVIDIA NIM Vision ──────────────────────────────────────────────────────
  private async tryNvidia(base64Image: string, mimeType: string): Promise<OCRExtractionResult | null> {
    const nvidiaKey = env.NVIDIA_API_KEY;
    if (!nvidiaKey) return null;
    try {
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nvidiaKey}` },
        body: JSON.stringify({
          model: 'meta/llama-3.2-11b-vision-instruct',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: RICH_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          }],
          temperature: 0,
          max_tokens: 250,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as any;
      const content = data.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      const result = this.sanitize(parsed);
      if (result.confidence > 0) { console.log('[OCRService] ✅ NVIDIA NIM', result); return result; }
    } catch (e: any) {
      console.warn('[OCRService] NVIDIA falhou:', e.message?.slice(0, 80));
    }
    return null;
  }

  // ── Tesseract.js (local, offline) ──────────────────────────────────────────
  private async tryTesseract(imageBuffer: Buffer, mimeType: string): Promise<OCRExtractionResult | null> {
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('por+eng');
      const { data: { text } } = await worker.recognize(imageBuffer);
      await worker.terminate();
      if (!text || text.trim().length < 5) return null;
      const result = this.parseRawText(text);
      if (result.confidence > 0) { console.log('[OCRService] ✅ Tesseract (local)', result); return result; }
    } catch (e: any) {
      console.warn('[OCRService] Tesseract falhou:', e.message?.slice(0, 80));
    }
    return null;
  }

  /**
   * Extração completa para upload de foto (prompt rico, fallback completo)
   */
  async extractPackageInfo(imageBuffer: Buffer, mimeType: string = 'image/jpeg'): Promise<OCRExtractionResult> {
    const base64Image = imageBuffer.toString('base64');

    // TIER 0: Gemini e Groq em paralelo
    const tier0: Promise<OCRExtractionResult | null>[] = [
      this.tryGemini(base64Image, mimeType),
      this.tryGroq(base64Image, mimeType),
    ];

    const tier0Result = await Promise.any(
      tier0.map(p => p.then(r => (r && r.confidence > 0 ? r : Promise.reject(new Error('no data')))))
    ).catch(() => null);
    if (tier0Result) return tier0Result;

    // TIER 1: NVIDIA NIM
    const nvidiaResult = await this.tryNvidia(base64Image, mimeType);
    if (nvidiaResult) return nvidiaResult;

    // TIER 2: Tesseract.js local
    const tesseractResult = await this.tryTesseract(imageBuffer, mimeType);
    if (tesseractResult) return tesseractResult;

    console.error('[OCRService] Todos os providers falharam. Retornando heurístico.');
    return { recipientName: null, block: 'Bloco A', unitNumber: null, carrier: 'Outro', trackingCode: null, confidence: 0.5 };
  }

  /**
   * Extração rápida para modo ao vivo (câmera)
   */
  async extractLiveOCR(imageBuffer: Buffer, mimeType: string = 'image/jpeg') {
    const base64Image = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    // TIER 0: Gemini e Groq em paralelo
    const tier0Result = await Promise.any([
      this.tryGemini(base64Image, mimeType),
      this.tryGroq(base64Image, mimeType),
    ].map(p => p.then(r => (r && r.confidence > 0 ? r : Promise.reject(new Error('no data')))))).catch(() => null);
    if (tier0Result) return tier0Result;

    // TIER 1: NVIDIA
    const nvidiaResult = await this.tryNvidia(base64Image, mimeType);
    if (nvidiaResult) return nvidiaResult;

    // TIER 2: Tesseract
    const tessResult = await this.tryTesseract(imageBuffer, mimeType);
    if (tessResult) return tessResult;

    return { recipientName: null, block: null, unitNumber: null, trackingCode: null, confidence: 0 };
  }
}

export const ocrService = new OCRService();
