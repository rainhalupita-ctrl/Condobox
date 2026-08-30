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

// ─── Extração de Unidade e Bloco Brasileira ──────────────────────────────────
function parseBrazilianUnitAndBlock(rawUnit: any, rawBlock: any, rawAddress?: string) {
  let unit = rawUnit ? String(rawUnit).trim() : '';
  let block = rawBlock ? String(rawBlock).trim() : null;
  const full = `${rawAddress || ''} ${unit} ${block || ''}`.trim();

  // Se o bloco capturado for nome de logradouro (ex: "CIVIT I", "RUA"), anula
  if (block && /civit|avenida|rua|alameda|estrada|rodovia|bairro/i.test(block)) {
    block = null;
  }

  // 1. Procura padrão explícito: "Bloco A Apto 805", "Bl. B Ap. 102", "Torre 1 Ap 204"
  const explicitMatch = full.match(/(?:BLOCO?|BL\.?|TORRE?)\s*([A-Za-z0-9]{1,3})[^\d]*(?:APTO?\.?|AP\.?|UNIDADE|UND\.?|APART\.?)\s*(\d{1,5})/i);
  if (explicitMatch) {
    block = `Bloco ${explicitMatch[1].toUpperCase()}`;
    unit = explicitMatch[2];
    return { unit, block };
  }

  // 2. Procura padrão inverso: "Apto 805 Bloco A", "Ap 102 Bl B"
  const reverseExplicit = full.match(/(?:APTO?\.?|AP\.?|UNIDADE|UND\.?|APART\.?)\s*(\d{1,5})[^\w]*(?:BLOCO?|BL\.?|TORRE?)\s*([A-Za-z0-9]{1,3})/i);
  if (reverseExplicit) {
    unit = reverseExplicit[1];
    block = `Bloco ${reverseExplicit[2].toUpperCase()}`;
    return { unit, block };
  }

  // 3. Procura padrão com hífen / traço pós-número predial: "nº 1770 - A805", "1770 - B102", "1770 - 805"
  const streetDashUnit = full.match(/(?:n[ºo°]?\s*\d{1,6}\s*[-–—/]\s*)([A-Za-z])?(\d{1,5})([A-Za-z])?/i);
  if (streetDashUnit) {
    const letter = streetDashUnit[1] || streetDashUnit[3];
    if (letter && (!block || block === 'null')) {
      block = `Bloco ${letter.toUpperCase()}`;
    }
    unit = streetDashUnit[2];
    return { unit, block };
  }

  // 4. Procura padrão "A805", "B102", "C304"
  const letterNumberMatch = unit.match(/^([A-Za-z])\s*(\d{1,5})$/) || full.match(/\b([A-Za-z])(\d{2,5})\b/);
  if (letterNumberMatch) {
    if (!block || block === 'null') {
      block = `Bloco ${letterNumberMatch[1].toUpperCase()}`;
    }
    unit = letterNumberMatch[2];
    return { unit, block };
  }

  // 5. Procura apenas "Apto 805", "Ap 805", "Apt 805"
  const aptMatch = full.match(/(?:APTO?\.?|AP\.?|UNIDADE|UND\.?)\s*[:\-]?\s*(\d{1,5})/i);
  if (aptMatch) {
    unit = aptMatch[1];
    return { unit, block };
  }

  // 6. Se unit contém múltiplos números (ex: "1770 805"), pega o último número como apartamento
  const allNums = unit.match(/\b\d{1,5}\b/g);
  if (allNums && allNums.length > 1) {
    unit = allNums[allNums.length - 1];
  } else if (allNums && allNums.length === 1) {
    unit = allNums[0];
  }

  const cleanDigits = unit.replace(/\D/g, '');
  return { unit: cleanDigits || null, block };
}

// ─── Sanitização e normalização do resultado de OCR ──────────────────────────
function formatOcrResult(parsed: any) {
  const { unit: cleanUnit, block: cleanBlock } = parseBrazilianUnitAndBlock(parsed.unitNumber, parsed.block, parsed.address);
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

  const hasUnit = Boolean(cleanUnit && cleanUnit.length >= 1);
  const hasRecipient = !!recipient && recipient.length >= 3;
  const hasTracking = !!tracking && tracking.length >= 6;
  const detected = hasUnit || hasRecipient || hasTracking;

  return {
    recipientName: recipient,
    block: cleanBlock,
    unitNumber: cleanUnit,
    carrier: sender || 'Outro',
    trackingCode: tracking,
    confidence: detected ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.92) : 0,
  };
}

// ─── Extração via heurísticas regex sobre texto bruto (Tesseract) ─────────────
function parseRawText(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = lines.join(' ').toUpperCase();

  const { unit: unitNumber, block } = parseBrazilianUnitAndBlock(null, null, fullText);

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
  const PROMPT = `Você é especialista em OCR de etiquetas brasileiras.
Extraia dados do DESTINATÁRIO em JSON: {"recipientName":string|null,"block":string|null,"unitNumber":string|null,"carrier":string|null,"trackingCode":string|null,"confidence":0.95}
REGRAS:
- "Avenida Civit I, nº 1770 - A805" -> 1770 é número da rua, o apartamento é "805" e bloco é "Bloco A".
- unitNumber = APENAS o número do apartamento (ex: "805", "101", "204").
- block = bloco/torre (ex: "Bloco A", "Bloco B").
- NUNCA use CEP (ex: 29168-322) como trackingCode.`;

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