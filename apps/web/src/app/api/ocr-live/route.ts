import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return NextResponse.json({ confidence: 0 }, { status: 200 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ confidence: 0 }, { status: 200 });
    }

    const bytes = await file.arrayBuffer();
    const base64Image = Buffer.from(bytes).toString('base64');
    const mimeType = file.type || 'image/jpeg';

    const prompt = 'Analise esta imagem de etiqueta de encomenda. Retorne APENAS um JSON: {"block": "string ou null", "unitNumber": "string ou null", "confidence": 0.0}. REGRAS: Imagem escura/borrada/sem etiqueta retorna {"block":null,"unitNumber":null,"confidence":0}. unitNumber: numero do apartamento/unidade. block: bloco/torre. confidence: 0.0 a 1.0, use 0 se nao encontrou unitNumber. Apenas o JSON.';

    const modelsToTry = [
      'gemini-2.0-flash-lite',
      'gemini-2.0-flash',
      'gemini-1.5-flash-8b',
    ];

    for (const modelName of modelsToTry) {
      try {
        const res = await fetch(
          ['https://generativelanguage.googleapis.com/v1beta/models/', modelName, ':generateContent'].join(''),
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    { inlineData: { mimeType, data: base64Image } },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0,
                maxOutputTokens: 80,
              },
            }),
            signal: AbortSignal.timeout(4000),
          }
        );

        if (!res.ok) {
          const errText = await res.text();
          console.warn('[OCR-LIVE]', modelName, res.status, errText.slice(0, 100));
          continue;
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) continue;

        const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        const unitNumberClean = parsed.unitNumber
          ? String(parsed.unitNumber).replace(/\D/g, '')
          : '';
        const hasUnit = unitNumberClean.length >= 1;
        const confidence = hasUnit
          ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.8)
          : 0;

        console.log('[OCR-LIVE] OK', modelName, 'ap:', parsed.unitNumber, 'bloco:', parsed.block, 'conf:', confidence);

        return NextResponse.json({
          block: parsed.block ? String(parsed.block).trim() : null,
          unitNumber: hasUnit ? String(parsed.unitNumber).trim() : null,
          confidence,
        });
      } catch (e: any) {
        console.warn('[OCR-LIVE]', modelName, 'erro:', e.message?.slice(0, 60));
      }
    }

    return NextResponse.json({ block: null, unitNumber: null, confidence: 0 });
  } catch {
    return NextResponse.json({ block: null, unitNumber: null, confidence: 0 });
  }
}