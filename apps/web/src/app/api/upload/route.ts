import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function cleanOcrData(parsed: any) {
  let cleanRecipient: string | null = (parsed.recipientName || '').trim();
  const forbiddenWords = [
    'MERCADO LIVRE', 'SHOPEE', 'AMAZON', 'CORREIOS', 'LOGGI', 'TOTAL EXPRESS',
    'JADLOG', 'SHEIN', 'MAGALU', 'MAGAZINE LUIZA', 'FRAGIL', 'FRÁGIL',
    'DESTINATARIO', 'DESTINATÁRIO', 'REMETENTE', 'DANFE', 'NOTA FISCAL',
    'NF-E', 'ENCOMENDA', 'ENTREGA', 'CONDOMINIO', 'CONDOMÍNIO', 'PORTARIA',
    'PAC', 'SEDEX', 'EXPRESS', 'FULL', 'STANDARD', 'ENVIO'
  ];
  if (
    !cleanRecipient ||
    cleanRecipient.length < 3 ||
    forbiddenWords.some(fw => cleanRecipient!.toUpperCase() === fw || cleanRecipient!.toUpperCase().startsWith(fw))
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
  const confidence = hasUnit ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.95) : 0;

  return {
    recipientName: cleanRecipient,
    block: rawBlock,
    unitNumber: hasUnit ? rawUnit : null,
    carrier: parsed.carrier || 'Outro',
    trackingCode: parsed.trackingCode ? String(parsed.trackingCode).trim() : null,
    invoiceNumber: parsed.invoiceNumber ? String(parsed.invoiceNumber).trim() : null,
    confidence
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    const geminiKey = process.env.GEMINI_API_KEY || '';
    const nvidiaKey = process.env.NVIDIA_API_KEY || '';

    let ocrResult = {
      recipientName: null as string | null,
      block: null as string | null,
      unitNumber: null as string | null,
      carrier: 'Outro',
      trackingCode: null as string | null,
      invoiceNumber: null as string | null,
      confidence: 0.95
    };

    const prompt = `Você é um leitor de OCR especializado em etiquetas de encomendas residenciais.
Analise a imagem da etiqueta e extraia em JSON estrito:
{
  "recipientName": string ou null,
  "block": string ou null,
  "unitNumber": string ou null,
  "carrier": string,
  "trackingCode": string ou null,
  "invoiceNumber": string ou null,
  "confidence": number
}`;

    // 1. Tentar Gemini Flash
    if (geminiKey) {
      const modelsToTry = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
      for (const modelName of modelsToTry) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-goog-api-key': geminiKey
            },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 200 }
            }),
            signal: AbortSignal.timeout(4500)
          });

          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
              const parsed = JSON.parse(cleanJson);
              ocrResult = cleanOcrData(parsed);
              if (ocrResult.confidence > 0) {
                console.log(`[OCR-UPLOAD] ✅ Gemini [${modelName}]:`, ocrResult);
                break;
              }
            }
          }
        } catch (e: any) {
          console.warn(`[OCR-UPLOAD] Gemini ${modelName} falhou:`, e.message?.slice(0, 80));
        }
      }
    }

    // 2. Fallback: NVIDIA NIM (Llama 3.2 11B Vision)
    if (!ocrResult.unitNumber && nvidiaKey) {
      try {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${nvidiaKey}`,
          },
          body: JSON.stringify({
            model: 'meta/llama-3.2-11b-vision-instruct',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: dataUrl } },
                ],
              },
            ],
            temperature: 0,
            max_tokens: 150,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            ocrResult = cleanOcrData(parsed);
            console.log('[OCR-UPLOAD] ✅ NVIDIA NIM Vision:', ocrResult);
          }
        }
      } catch (e: any) {
        console.warn('[OCR-UPLOAD] NVIDIA NIM falhou:', e.message?.slice(0, 80));
      }
    }

    // 3. Conexão com Supabase para encontrar Unidade e Morador correspondentes
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    let matchedUnit: any = null;
    let matchedResident: any = null;

    // Busca unidade por número e bloco
    if (ocrResult.unitNumber) {
      let query = supabase.from('units').select('id, block, unit_number');
      if (ocrResult.block) {
        query = query.ilike('block', `%${ocrResult.block.replace(/bloco\s*/i, '').trim()}%`);
      }
      query = query.ilike('unit_number', `%${ocrResult.unitNumber.trim()}%`);
      const { data: units } = await query.limit(1);
      if (units && units.length > 0) {
        matchedUnit = units[0];
      }
    }

    // Busca morador na unidade encontrada
    if (matchedUnit) {
      const { data: residents } = await supabase
        .from('residents')
        .select('id, name, phone, email, is_primary')
        .eq('unit_id', matchedUnit.id);

      if (residents && residents.length > 0) {
        if (ocrResult.recipientName) {
          const normOCR = ocrResult.recipientName.toLowerCase();
          const best = residents.find(r => normOCR.includes(r.name.toLowerCase().split(' ')[0]));
          matchedResident = best || residents.find(r => r.is_primary) || residents[0];
        } else {
          matchedResident = residents.find(r => r.is_primary) || residents[0];
        }
      }
    }

    // Gera ID único para o arquivo
    const filename = `label_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
    const imagePath = `labels/${filename}`;

    return NextResponse.json({
      success: true,
      image: {
        path: imagePath,
        url: dataUrl
      },
      ocr: ocrResult,
      suggestedMatch: {
        unit: matchedUnit,
        resident: matchedResident
      }
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Falha ao processar etiqueta', details: error.message },
      { status: 500 }
    );
  }
}
