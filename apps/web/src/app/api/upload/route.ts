import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

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

    // 1. OCR com Gemini Flash (suporta chave AI Studio X-goog-api-key)
    const apiKey = process.env.GEMINI_API_KEY || '';
    let ocrResult = {
      recipientName: null as string | null,
      block: null as string | null,
      unitNumber: null as string | null,
      carrier: 'Outro',
      trackingCode: null as string | null,
      confidence: 0.95
    };

    if (apiKey) {
      const prompt = `
Você é um especialista em OCR e visão computacional de alta precisão para recepção de encomendas em condomínios no Brasil.
Analise a imagem da etiqueta de entrega (Correios, Mercado Livre, Shopee, Amazon, Dell, Total Express, Jadlog, Loggi, etc.) e extraia com a máxima precisão as seguintes informações:

1. "recipientName": Nome completo do destinatário / morador (ex: "DXM KLEBIN").
2. "block": Identificação do bloco/torre, se houver (ex: se o endereço contiver "A805", "BL A", extraia "Bloco A").
3. "unitNumber": Número do apartamento ou casa (ex: se o endereço contiver "A805", extraia "805").
4. "carrier": Nome da transportadora, marketplace ou remetente (ex: "Dell", "Mercado Livre", "Shopee", "Amazon", "Correios", "Total Express", "Outro").
5. "trackingCode": Código de rastreio, número da Nota Fiscal (NF) ou código do pacote (ex: "CPQ 11028199").
6. "confidence": Grau de certeza de 0.0 a 1.0.

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

      const modelsToTry = ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.7-flash', 'gemini-3.5-flash'];
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
                        mimeType,
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
            signal: AbortSignal.timeout(8000)
          });

          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
              const parsed = JSON.parse(cleanJson);
              ocrResult = {
                recipientName: parsed.recipientName || null,
                block: parsed.block || null,
                unitNumber: parsed.unitNumber || null,
                carrier: parsed.carrier || 'Outro',
                trackingCode: parsed.trackingCode || null,
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95
              };
              console.log(`[OCR] ✅ Sucesso com [${modelName}]:`, ocrResult);
              break;
            }
          } else {
            const errData = await res.text();
            console.warn(`[OCR] ⚠️ Modelo ${modelName} retornou status ${res.status}:`, errData.slice(0, 150));
          }
        } catch (e: any) {
          console.warn(`[OCR] Modelo ${modelName} exceção:`, e.message?.slice(0, 80));
        }
      }
    }

    // 2. Conexão com Supabase para encontrar Unidade e Morador correspondentes
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
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

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
