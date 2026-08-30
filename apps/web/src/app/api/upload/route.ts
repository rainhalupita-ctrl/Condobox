import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import Tesseract from 'tesseract.js';

export const dynamic = 'force-dynamic';

// ─── Sanitização centralizada ─────────────────────────────────────────────────
const FORBIDDEN_WORDS = [
  'MERCADO LIVRE', 'SHOPEE', 'AMAZON', 'CORREIOS', 'LOGGI', 'TOTAL EXPRESS',
  'JADLOG', 'SHEIN', 'MAGALU', 'MAGAZINE LUIZA', 'FRAGIL', 'FRÁGIL',
  'DESTINATARIO', 'DESTINATÁRIO', 'REMETENTE', 'DANFE', 'NOTA FISCAL',
  'NF-E', 'ENCOMENDA', 'ENTREGA', 'CONDOMINIO', 'CONDOMÍNIO', 'PORTARIA',
  'PAC', 'SEDEX', 'EXPRESS', 'FULL', 'STANDARD', 'ENVIO', 'DELL',
];

function cleanOcrData(parsed: any) {
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
    if (!rawBlock || rawBlock === 'null') rawBlock = `Bloco ${matchLetterNum[1].toUpperCase()}`;
    rawUnit = matchLetterNum[2];
  }

  const hasUnit = Boolean(rawUnit && rawUnit.replace(/\D/g, '').length >= 1);
  const hasTracking = !!(parsed.trackingCode && String(parsed.trackingCode).trim().length >= 6);
  const detected = hasUnit || !!cleanRecipient || hasTracking;
  const confidence = detected ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.92) : 0;

  return {
    recipientName: cleanRecipient,
    block: rawBlock,
    unitNumber: hasUnit ? rawUnit : null,
    carrier: parsed.carrier || 'Outro',
    trackingCode: parsed.trackingCode ? String(parsed.trackingCode).trim() : null,
    invoiceNumber: parsed.invoiceNumber ? String(parsed.invoiceNumber).trim() : null,
    confidence,
  };
}

// ─── Heurística Tesseract ─────────────────────────────────────────────────────
function parseRawText(text: string) {
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
  return { recipientName, block, unitNumber, carrier: 'Outro', trackingCode, invoiceNumber: null, confidence: detected ? 0.6 : 0 };
}

// ─── Providers ────────────────────────────────────────────────────────────────
const RICH_PROMPT = `Você é especialista em OCR de etiquetas de encomendas residenciais brasileiras (Mercado Livre, Shopee, Amazon, Correios, Loggi, Jadlog, Shein etc.).
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
REGRAS CRÍTICAS:
1. recipientName = APENAS nome da pessoa física destinatária. NUNCA empresa, transportadora ou texto de aviso.
2. unitNumber = número do apartamento/unidade (ex: "101", "805").
3. block = bloco ou torre se presente na etiqueta.
4. carrier = identifique: Mercado Livre, Shopee, Amazon, Correios, Loggi, Jadlog, Shein, Magalu, Total Express, ou Outro.
5. trackingCode = código de rastreio ou barras.
6. invoiceNumber = número da NF/DANFE se visível.`;

async function tryGemini(base64Image: string, mimeType: string, apiKey: string) {
  const models = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite'];
  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: RICH_PROMPT }, { inlineData: { mimeType, data: base64Image } }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 200 },
          }),
          signal: AbortSignal.timeout(5000),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
      const result = cleanOcrData(parsed);
      if (result.confidence > 0) { console.log(`[OCR-UPLOAD] ✅ Gemini [${model}]`, result); return result; }
    } catch {}
  }
  return null;
}

async function tryGroq(base64Image: string, mimeType: string, apiKey: string) {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
        max_tokens: 200,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const result = cleanOcrData(parsed);
    if (result.confidence > 0) { console.log('[OCR-UPLOAD] ✅ Groq Vision', result); return result; }
  } catch {}
  return null;
}

async function tryNvidia(base64Image: string, mimeType: string, apiKey: string) {
  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const result = cleanOcrData(parsed);
    if (result.confidence > 0) { console.log('[OCR-UPLOAD] ✅ NVIDIA NIM', result); return result; }
  } catch (e: any) {
    console.warn('[OCR-UPLOAD] NVIDIA falhou:', e.message?.slice(0, 80));
  }
  return null;
}

async function tryTesseract(buffer: Buffer) {
  try {
    const { data: { text } } = await Tesseract.recognize(buffer, 'por+eng', { logger: () => {} });
    if (!text || text.trim().length < 5) return null;
    const result = parseRawText(text);
    if (result.confidence > 0) { console.log('[OCR-UPLOAD] ✅ Tesseract (local)', result); return result; }
  } catch (e: any) {
    console.warn('[OCR-UPLOAD] Tesseract falhou:', e.message?.slice(0, 80));
  }
  return null;
}

// ─── Handler principal ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const geminiKey = process.env.GEMINI_API_KEY || '';
    const groqKey = process.env.GROQ_API_KEY || '';
    const nvidiaKey = process.env.NVIDIA_API_KEY || '';

    let ocrResult: ReturnType<typeof cleanOcrData> | null = null;

    // ── TIER 0: Gemini + Groq em paralelo ──────────────────────────────────────
    const tier0: Promise<ReturnType<typeof cleanOcrData> | null>[] = [];
    if (geminiKey) tier0.push(tryGemini(base64Image, mimeType, geminiKey));
    if (groqKey) tier0.push(tryGroq(base64Image, mimeType, groqKey));

    if (tier0.length > 0) {
      ocrResult = await Promise.any(
        tier0.map(p => p.then(r => (r && r.confidence > 0 ? r : Promise.reject(new Error('no data')))))
      ).catch(() => null);
    }

    // ── TIER 1: NVIDIA NIM ─────────────────────────────────────────────────────
    if (!ocrResult && nvidiaKey) {
      ocrResult = await tryNvidia(base64Image, mimeType, nvidiaKey);
    }

    // ── TIER 2: Tesseract.js local ─────────────────────────────────────────────
    if (!ocrResult) {
      ocrResult = await tryTesseract(buffer);
    }

    const finalOcr = ocrResult ?? {
      recipientName: null, block: null, unitNumber: null,
      carrier: 'Outro', trackingCode: null, invoiceNumber: null, confidence: 0.95,
    };

    // ── Supabase: encontra unidade e morador correspondentes ───────────────────
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );

    let matchedUnit: any = null;
    let matchedResident: any = null;

    if (finalOcr.unitNumber) {
      let query = supabase.from('units').select('id, block, unit_number');
      if (finalOcr.block) query = query.ilike('block', `%${finalOcr.block.replace(/bloco\s*/i, '').trim()}%`);
      query = query.ilike('unit_number', `%${finalOcr.unitNumber.trim()}%`);
      const { data: units } = await query.limit(1);
      if (units && units.length > 0) matchedUnit = units[0];
    }

    if (matchedUnit) {
      const { data: residents } = await supabase
        .from('residents')
        .select('id, name, phone, email, is_primary')
        .eq('unit_id', matchedUnit.id);

      if (residents && residents.length > 0) {
        if (finalOcr.recipientName) {
          const normOCR = finalOcr.recipientName.toLowerCase();
          const best = residents.find(r => normOCR.includes(r.name.toLowerCase().split(' ')[0]));
          matchedResident = best || residents.find(r => r.is_primary) || residents[0];
        } else {
          matchedResident = residents.find(r => r.is_primary) || residents[0];
        }
      }
    }

    const filename = `label_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;

    return NextResponse.json({
      success: true,
      image: { path: `labels/${filename}`, url: `data:${mimeType};base64,${base64Image}` },
      ocr: finalOcr,
      suggestedMatch: { unit: matchedUnit, resident: matchedResident },
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Falha ao processar etiqueta', details: error.message }, { status: 500 });
  }
}
