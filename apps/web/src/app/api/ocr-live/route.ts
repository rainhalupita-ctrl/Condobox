import { NextRequest, NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';

export const dynamic = 'force-dynamic';

// ─── Sanitização de Código de Rastreio (Filtra e Rejeita CEPs de 8 dígitos) ───
function sanitizeTrackingCode(rawTracking: any): string | null {
  if (!rawTracking) return null;
  const clean = String(rawTracking).trim();
  if (clean.length < 5) return null;

  // Rejeita se for CEP brasileiro (5 dígitos + hífen opcional + 3 dígitos)
  if (/^\d{5}-?\d{3}$/.test(clean)) return null;

  // Rejeita se for apenas 8 dígitos numéricos (CEP desformatado)
  const digitsOnly = clean.replace(/\D/g, '');
  if (digitsOnly.length === 8 && /^\d+$/.test(clean.replace(/[-\s]/g, ''))) return null;

  // Rejeita se começar com CEP ou termos de endereço
  const upper = clean.toUpperCase();
  if (
    upper.startsWith('CEP') ||
    upper.includes('CIDADE') ||
    upper.includes('BAIRRO') ||
    upper.includes('RUA') ||
    upper.includes('AVENIDA') ||
    upper.includes('ESTADO')
  ) {
    return null;
  }

  return clean;
}

// ─── Sanitização e normalização do resultado de OCR ──────────────────────────
function formatOcrResult(parsed: any) {
  let rawUnit = parsed.unitNumber ? String(parsed.unitNumber).trim() : '';
  let rawBlock = parsed.block ? String(parsed.block).trim() : null;
  let recipient = parsed.recipientName ? String(parsed.recipientName).trim() : null;
  const tracking = sanitizeTrackingCode(parsed.trackingCode);
  const sender = parsed.carrier || parsed.sender ? String(parsed.carrier || parsed.sender).trim() : null;

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
    carrier: sender || 'Outro',
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

  // Busca código de rastreio (padrão Correios BR ou códigos com letras/números — NUNCA CEP)
  const trackMatch = text.match(/\b([A-Z]{2}\d{9}[A-Z]{2}|[A-Z]{2,4}\s*\d{6,14}|\d{12,20})\b/);
  const trackingCode = sanitizeTrackingCode(trackMatch ? trackMatch[1] : null);

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
    carrier: 'Outro',
    trackingCode,
    confidence: detected ? 0.6 : 0,
  };
}

// ─── Provider: Google Gemini Flash-Lite (Ultra-Rápido ~1.2s) ─────────────────
async function tryGemini(base64Image: string, mimeType: string, apiKey: string) {
  const PROMPT = 'Extraia destinatario, apto, bloco, remetente (ex: Mercado Livre, Shopee, Amazon, Nike, etc) e codigo de rastreio em JSON: {"recipientName":string|null,"block":string|null,"unitNumber":string|null,"carrier":string|null,"trackingCode":string|null,"confidence":0.95}. AVISO: NUNCA coloque CEP (8 digitos como 29168-074) no trackingCode.';

  const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType, data: base64Image } }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 80 },
          }),
          signal: AbortSignal.timeout(3000),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
      const result = formatOcrResult(parsed);
      if (result.confidence > 0) {
        console.log(`[OCR-LIVE] ✅ Gemini [${model}]`, result);
        return result;
      }
    } catch {}
  }
  return null;
}

// ─── Provider: NVIDIA NIM (Llama 3.2 Vision) ──────────────────────────────────
async function tryNvidia(base64Image: string, mimeType: string, apiKey: string) {
  const PROMPT = 'Extraia destinatario, apto, bloco, remetente e rastreio em JSON: {"recipientName":string|null,"block":string|null,"unitNumber":string|null,"carrier":string|null,"trackingCode":string|null,"confidence":0.9}. NUNCA use CEP no trackingCode.';
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'meta/llama-3.2-11b-vision-instruct',
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
      signal: AbortSignal.timeout(3500),
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

// ─── Handler principal (Ultra Rápido, Fail-Fast) ──────────────────────────────
export async function POST(request: NextRequest) {
  const EMPTY = { recipientName: null, block: null, unitNumber: null, trackingCode: null, confidence: 0 };
  try {
    const geminiKey = process.env.GEMINI_API_KEY || '';
    const nvidiaKey = process.env.NVIDIA_API_KEY || '';

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json(EMPTY);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';

    // ── 1. Gemini 3.5 Flash-Lite (Principal, ~1.2s) ──
    if (geminiKey) {
      const geminiResult = await tryGemini(base64Image, mimeType, geminiKey);
      if (geminiResult && geminiResult.confidence > 0) {
        return NextResponse.json(geminiResult);
      }
    }

    // ── 2. NVIDIA NIM Vision (Fallback Imediato) ──
    if (nvidiaKey) {
      const nvidiaResult = await tryNvidia(base64Image, mimeType, nvidiaKey);
      if (nvidiaResult && nvidiaResult.confidence > 0) {
        return NextResponse.json(nvidiaResult);
      }
    }

    return NextResponse.json(EMPTY);
  } catch {
    return NextResponse.json(EMPTY);
  }
}