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

function cleanOcrData(parsed: any) {
  let cleanRecipient: string | null = (parsed.recipientName || '').trim();
  if (
    !cleanRecipient ||
    cleanRecipient.length < 3 ||
    FORBIDDEN_WORDS.some(fw => cleanRecipient!.toUpperCase() === fw || cleanRecipient!.toUpperCase().startsWith(fw))
  ) {
    cleanRecipient = null;
  }

  const { unit: cleanUnit, block: cleanBlock } = parseBrazilianUnitAndBlock(parsed.unitNumber, parsed.block, parsed.address);
  const cleanTracking = sanitizeTrackingCode(parsed.trackingCode);
  const sender = parsed.carrier || parsed.sender ? String(parsed.carrier || parsed.sender).trim() : null;

  const hasUnit = Boolean(cleanUnit && cleanUnit.length >= 1);
  const hasTracking = !!cleanTracking;
  const detected = hasUnit || !!cleanRecipient || hasTracking;
  const confidence = detected ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.92) : 0;

  return {
    recipientName: cleanRecipient,
    block: cleanBlock,
    unitNumber: cleanUnit,
    carrier: sender || 'Outro',
    trackingCode: cleanTracking,
    invoiceNumber: parsed.invoiceNumber ? String(parsed.invoiceNumber).trim() : null,
    confidence,
  };
}

// ─── Heurística Tesseract ─────────────────────────────────────────────────────
function parseRawText(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = lines.join(' ');

  const { unit: unitNumber, block } = parseBrazilianUnitAndBlock(null, null, fullText);

  const trackMatch = text.match(/\b([A-Z]{2}\d{9}[A-Z]{2}|[A-Z]{2,4}\s*\d{6,14}|\d{12,20})\b/);
  const trackingCode = sanitizeTrackingCode(trackMatch ? trackMatch[1] : null);

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
1. recipientName = APENAS nome da pessoa física destinatária (morador). NUNCA empresa, loja, remetente ou aviso.
2. unitNumber = número do apartamento/unidade (ex: "805", "101"). AVISO: Em "Avenida Civit I, nº 1770 - A805", 1770 é o número do condomínio na rua e o apartamento é "805" com bloco "Bloco A". NUNCA coloque o número da rua como unitNumber!
3. block = bloco ou torre se presente na etiqueta (ex: "Bloco A", "Bloco B").
4. carrier = Remetente, loja ou transportadora de onde veio (ex: "Mercado Livre", "Shopee", "Amazon", "Nike", "Drogasil", "Correios", "Shein", "Magalu", "Zara", "Loggi", etc.).
5. trackingCode = código de rastreio ou código de barras. AVISO CRÍTICO: NUNCA coloque CEP (8 dígitos como 29168-074 ou 29168074) como trackingCode. Se não houver código de rastreio específico, retorne null.
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

    // ── Salva a imagem no Supabase Storage (bucket público 'labels') ──────────
    const filename = `label_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
    let imagePublicUrl = `data:${mimeType};base64,${base64Image}`;

    try {
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from('labels')
        .upload(filename, buffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (!uploadErr && uploadData) {
        const { data: pubData } = supabase.storage.from('labels').getPublicUrl(filename);
        if (pubData?.publicUrl) {
          imagePublicUrl = pubData.publicUrl;
        }
      } else if (uploadErr) {
        console.warn('[OCR-UPLOAD] Erro ao salvar imagem no Supabase Storage:', uploadErr.message);
      }
    } catch (storageErr: any) {
      console.warn('[OCR-UPLOAD] Exceção no Supabase Storage:', storageErr.message);
    }

    return NextResponse.json({
      success: true,
      image: { path: imagePublicUrl, url: imagePublicUrl },
      ocr: finalOcr,
      suggestedMatch: { unit: matchedUnit, resident: matchedResident },
    });
  } catch (error: any) {
    return NextResponse.json({ error: 'Falha ao processar etiqueta', details: error.message }, { status: 500 });
  }
}
