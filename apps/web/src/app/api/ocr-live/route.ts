import { NextRequest, NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';

export const dynamic = 'force-dynamic';

// ─── Sanitização e normalização do resultado de OCR ──────────────────────────
function formatOcrResult(parsed: any) {
  let rawUnit = parsed.unitNumber ? String(parsed.unitNumber).trim() : '';
  let rawBlock = parsed.block ? String(parsed.block).trim() : null;
  let recipient = parsed.recipientName ? String(parsed.recipientName).trim() : null;
  const tracking = parsed.trackingCode ? String(parsed.trackingCode).trim() : null;

  // Palavras proibidas — nunca são nomes de moradores
  const FORBIDDEN = [
    'MERCADO LIVRE', 'SHOPEE', 'AMAZON', 'CORREIOS', 'LOGGI', 'TOTAL EXPRESS',
    'JADLOG', 'SHEIN', 'MAGALU', 'MAGAZINE LUIZA', 'FRAGIL', 'FRÁGIL',
    'DESTINATARIO', 'DESTINATÁRIO', 'REMETENTE', 'DANFE', 'NOTA FISCAL',
    'NF-E', 'ENCOMENDA', 'ENTREGA', 'CONDOMINIO', 'CONDOMÍNIO', 'PORTARIA',
    'PAC', 'SEDEX', 'EXPRESS', 'FULL', 'STANDARD', 'ENVIO', 'DELL', 'OLHAR',
  ];
  if (recipient) {
    const upper = recipient.toUpperCase();
    if (
      recipient.length < 3 ||
      FORBIDDEN.some(fw => upper === fw || upper.startsWith(fw))
    ) {
      recipient = null;
    }
  }

  // Se unitNumber vier como "A805" ou "B102", separar bloco e número
  const matchLetterNum = rawUnit.match(/^([A-Za-z])\s*(\d{1,5})$/);
  if (matchLetterNum) {
    if (!rawBlock || rawBlock === 'null') rawBlock = `Bloco ${matchLetterNum[1].toUpperCase()}`;
    rawUnit = matchLetterNum[2];
  }

  const unitDigits = rawUnit.replace(/\D/g, '');
  const hasUnit = unitDigits.length >= 1;
  const hasRecipient = !!recipient && recipient.length >= 3;
  const hasTracking = !!tracking && tracking.length >= 6;
  const detected = hasUnit || hasRecipient || hasTracking;

  return {
    recipientName: recipient,
    block: rawBlock,
    unitNumber: hasUnit ? rawUnit : null,
    trackingCode: tracking,
    confidence: detected ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.92) : 0,
  };
}

// ─── Extração via heurísticas regex sobre texto bruto (Tesseract) ─────────────
function parseRawText(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = lines.join(' ').toUpperCase();

  // Busca número de apartamento
  const aptoMatch = fullText.match(/(?:APTO?\.?|AP\.?|UNIDADE|UND\.?|APART\.?)\s*[:\-]?\s*(\d{1,5})/i);
  const unitNumber = aptoMatch ? aptoMatch[1] : null;

  // Busca bloco
  const blocoMatch = fullText.match(/(?:BLOCO?|BL\.?|TORRE?)\s*[:\-]?\s*([A-Z0-9]{1,3})/i);
  const block = blocoMatch ? `Bloco ${blocoMatch[1].toUpperCase()}` : null;

  // Busca código de rastreio (padrão Correios BR e outros)
  const trackMatch = text.match(/\b([A-Z]{2}\d{9,}[A-Z]{2}|\d{13,20})\b/);
  const trackingCode = trackMatch ? trackMatch[1] : null;

  // Busca destinatário — linha após "Destinatário" ou "Para:"
  let recipientName: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (/destinat[aá]rio|para:/i.test(lines[i]) && lines[i + 1]) {
      const cand = lines[i + 1].trim();
      if (cand.length >= 4 && /^[A-Za-zÀ-ÿ\s]+$/.test(cand)) {
        recipientName = cand;
        break;
      }
    }
  }

  const detected = !!(unitNumber || trackingCode);
  return {
    recipientName,
    block,
    unitNumber,
    trackingCode,
    confidence: detected ? 0.6 : 0,
  };
}

// ─── Provider: Google Gemini Flash (Paralelo Ultra-Rápido) ──────────────────
async function tryGemini(base64Image: string, mimeType: string, apiKey: string) {
  const PROMPT = 'Extraia destinatario, apto e bloco em JSON estrito: {"recipientName":string|null,"block":string|null,"unitNumber":string|null,"trackingCode":string|null,"confidence":0.95}';

  const models = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
  const promises = models.map(async (model) => {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType, data: base64Image } }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 80 },
          }),
          signal: AbortSignal.timeout(3200),
        }
      );
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
      const result = formatOcrResult(parsed);
      if (result.confidence > 0) {
        console.log(`[OCR-LIVE] ✅ Gemini [${model}]`, result);
        return result;
      }
    } catch {}
    return null;
  });

  return Promise.any(
    promises.map((p) => p.then((r) => (r && r.confidence > 0 ? r : Promise.reject(new Error('no data')))))
  ).catch(() => null);
}

// ─── Provider: Groq Vision (llama-4-scout) ────────────────────────────────────
async function tryGroq(base64Image: string, mimeType: string, apiKey: string) {
  const PROMPT = 'Extraia destinatario, apto e bloco em JSON estrito: {"recipientName":string|null,"block":string|null,"unitNumber":string|null,"trackingCode":string|null,"confidence":0.95}';
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 80,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(3200),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const result = formatOcrResult(parsed);
    if (result.confidence > 0) {
      console.log('[OCR-LIVE] ✅ Groq Vision', result);
      return result;
    }
  } catch {}
  return null;
}

// ─── Provider: NVIDIA NIM (Llama 3.2 Vision) ──────────────────────────────────
async function tryNvidia(base64Image: string, mimeType: string, apiKey: string) {
  const PROMPT = `Extraia o destinatario, apartamento e bloco desta etiqueta. Retorne APENAS JSON: {"recipientName":string|null,"block":string|null,"unitNumber":string|null,"trackingCode":string|null,"confidence":0.9}`;
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'meta/llama-3.2-11b-vision-instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        }],
        temperature: 0,
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const result = formatOcrResult(parsed);
    if (result.confidence > 0) {
      console.log('[OCR-LIVE] ✅ NVIDIA NIM', result);
      return result;
    }
  } catch (e: any) {
    console.warn('[OCR-LIVE] NVIDIA falhou:', e.message?.slice(0, 80));
  }
  return null;
}

// ─── Provider: Tesseract.js (local, sem rede) ─────────────────────────────────
async function tryTesseract(buffer: Buffer) {
  try {
    const { data: { text } } = await Tesseract.recognize(buffer, 'por+eng', { logger: () => {} });
    if (!text || text.trim().length < 5) return null;
    const result = parseRawText(text);
    if (result.confidence > 0) {
      console.log('[OCR-LIVE] ✅ Tesseract (local)', result);
      return result;
    }
  } catch (e: any) {
    console.warn('[OCR-LIVE] Tesseract falhou:', e.message?.slice(0, 80));
  }
  return null;
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const EMPTY = { recipientName: null, block: null, unitNumber: null, trackingCode: null, confidence: 0 };
  try {
    const geminiKey = process.env.GEMINI_API_KEY || '';
    const groqKey = process.env.GROQ_API_KEY || '';
    const nvidiaKey = process.env.NVIDIA_API_KEY || '';

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json(EMPTY);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';

    // ── TIER 0: Gemini e Groq em paralelo (Race — vence quem responder primeiro) ──
    const tier0Promises: Promise<any>[] = [];
    if (geminiKey) tier0Promises.push(tryGemini(base64Image, mimeType, geminiKey));
    if (groqKey) tier0Promises.push(tryGroq(base64Image, mimeType, groqKey));

    if (tier0Promises.length > 0) {
      // race que ignora nulos — retorna o primeiro resultado válido
      const tier0Result = await Promise.any(
        tier0Promises.map(p =>
          p.then(r => (r && r.confidence > 0 ? r : Promise.reject(new Error('no data'))))
        )
      ).catch(() => null);

      if (tier0Result) return NextResponse.json(tier0Result);
    }

    // ── TIER 1: NVIDIA NIM Vision ──────────────────────────────────────────────
    if (nvidiaKey) {
      const nvidiaResult = await tryNvidia(base64Image, mimeType, nvidiaKey);
      if (nvidiaResult) return NextResponse.json(nvidiaResult);
    }

    // ── TIER 2: Tesseract.js — offline, sem limite ─────────────────────────────
    const tesseractResult = await tryTesseract(buffer);
    if (tesseractResult) return NextResponse.json(tesseractResult);

    return NextResponse.json(EMPTY);
  } catch {
    return NextResponse.json(EMPTY);
  }
}