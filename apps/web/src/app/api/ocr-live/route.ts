import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

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

    const prompt = 'Extraia o destinatário, apartamento e bloco desta etiqueta. Retorne JSON {"recipientName":"...","block":"...","unitNumber":"...","trackingCode":"...","confidence":0.95}';

    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
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
            maxOutputTokens: 120,
          },
        }),
        signal: AbortSignal.timeout(12000),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[OCR-LIVE] Gemini status:', res.status, errText.slice(0, 100));
      return NextResponse.json({ recipientName: null, block: null, unitNumber: null, trackingCode: null, confidence: 0 });
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return NextResponse.json({ recipientName: null, block: null, unitNumber: null, trackingCode: null, confidence: 0 });
    }

    const cleanJson = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    let rawUnit = parsed.unitNumber ? String(parsed.unitNumber).trim() : '';
    let rawBlock = parsed.block ? String(parsed.block).trim() : null;
    const recipient = parsed.recipientName ? String(parsed.recipientName).trim() : null;
    const tracking = parsed.trackingCode ? String(parsed.trackingCode).trim() : null;

    // Se o unitNumber vier como A805 ou B102, separa bloco e número
    const matchLetterNum = rawUnit.match(/^([A-Za-z])\s*(\d{1,5})$/);
    if (matchLetterNum) {
      if (!rawBlock || rawBlock === 'null') rawBlock = `Bloco ${matchLetterNum[1].toUpperCase()}`;
      rawUnit = matchLetterNum[2];
    }

    const unitNumberDigits = rawUnit.replace(/\D/g, '');
    const hasUnit = unitNumberDigits.length >= 1;
    const hasRecipient = !!recipient && recipient.length >= 3;
    const hasTracking = !!tracking && tracking.length >= 6;

    const detected = hasUnit || hasRecipient || hasTracking;
    const confidence = detected
      ? (typeof parsed.confidence === 'number' ? parsed.confidence : 0.95)
      : 0;

    console.log('[OCR-LIVE] ✅ SUCESSO ap:', rawUnit, 'bloco:', rawBlock, 'morador:', recipient, 'conf:', confidence);

    return NextResponse.json({
      recipientName: recipient,
      block: rawBlock,
      unitNumber: hasUnit ? rawUnit : null,
      trackingCode: tracking,
      confidence,
    });
  } catch (e: any) {
    console.warn('[OCR-LIVE] erro:', e.message?.slice(0, 80));
    return NextResponse.json({ recipientName: null, block: null, unitNumber: null, trackingCode: null, confidence: 0 });
  }
}