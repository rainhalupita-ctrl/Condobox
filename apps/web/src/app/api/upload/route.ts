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
      invoiceNumber: null as string | null,
      confidence: 0.95
    };

    if (apiKey) {
      const prompt = `Você é um leitor de OCR especializado em etiquetas de encomendas.
Analise a imagem da etiqueta e extraia APENAS dados REAIS e LEGÍVEIS impressos na imagem em JSON estrito:
{
  "recipientName": string ou null,
  "block": string ou null,
  "unitNumber": string ou null,
  "carrier": string,
  "trackingCode": string ou null,
  "invoiceNumber": string ou null,
  "confidence": number
}

REGRAS CRÍTICAS ANTI-ALUCINAÇÃO:
1. Se a imagem estiver preta, escura, borrada, sem texto legível ou não contiver uma etiqueta de encomenda, retorne OBRIGATORIAMENTE todos os campos como null (confidence: 0). NUNCA invente dados fictícios ou nomes de exemplo.
2. "unitNumber": Número do apartamento/unidade residencial. Se não estiver claramente visível e legível, retorne null.
3. "block": Identificação do bloco ou torre. Se não estiver visível, retorne null.
4. "recipientName": Nome do morador/destinatário. NUNCA coloque nomes de empresas, transportadoras (ex: Mercado Livre, Shopee, Amazon, Correios), avisos ("FRAGIL", "DESTINATARIO", "DANFE") nem exemplos fictícios. Se ilegível, retorne null.
5. "carrier": Transportadora identificada (Mercado Livre, Shopee, Amazon, Correios, Dell, Total Express, Loggi, Jadlog, Shein, Magalu ou Outro).`;

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
                maxOutputTokens: 250
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

              // Sanitização do nome do destinatário
              let cleanRecipient: string | null = (parsed.recipientName || '').trim();
              const forbiddenWords = [
                'MERCADO LIVRE', 'SHOPEE', 'AMAZON', 'CORREIOS', 'LOGGI', 'TOTAL EXPRESS',
                'JADLOG', 'SHEIN', 'MAGALU', 'MAGAZINE LUIZA', 'FRAGIL', 'FRÁGIL',
                'DESTINATARIO', 'DESTINATÁRIO', 'REMETENTE', 'DANFE', 'NOTA FISCAL',
                'NF-E', 'ENCOMENDA', 'ENTREGA', 'CONDOMINIO', 'CONDOMÍNIO', 'PORTARIA',
                'PAC', 'SEDEX', 'EXPRESS', 'FULL', 'STANDARD', 'ENVIO', 'MARIA LUIZA DE SOUZA'
              ];
              if (
                !cleanRecipient ||
                cleanRecipient.length < 3 ||
                forbiddenWords.some(fw => cleanRecipient!.toUpperCase() === fw || cleanRecipient!.toUpperCase().startsWith(fw))
              ) {
                cleanRecipient = null;
              }

              // Se não identificou apartamento, reduz a confiança
              const hasUnit = Boolean(parsed.unitNumber && String(parsed.unitNumber).replace(/\D/g, '').length >= 1);
              const confidence = hasUnit ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.95) : 0;

              ocrResult = {
                recipientName: cleanRecipient,
                block: parsed.block ? String(parsed.block).trim() : null,
                unitNumber: hasUnit ? String(parsed.unitNumber).trim() : null,
                carrier: parsed.carrier || 'Outro',
                trackingCode: parsed.trackingCode ? String(parsed.trackingCode).trim() : null,
                invoiceNumber: parsed.invoiceNumber ? String(parsed.invoiceNumber).trim() : null,
                confidence
              };
              console.log(`[OCR] ✅ Extração com [${modelName}]:`, ocrResult);
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
