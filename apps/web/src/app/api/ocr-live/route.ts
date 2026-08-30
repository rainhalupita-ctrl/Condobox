import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function formatOcrResult(parsed: any) {
  let rawUnit = parsed.unitNumber ? String(parsed.unitNumber).trim() : '';
  let rawBlock = parsed.block ? String(parsed.block).trim() : null;
  let recipient = parsed.recipientName ? String(parsed.recipientName).trim() : null;
  const tracking = parsed.trackingCode ? String(parsed.trackingCode).trim() : null;

  // Limpeza de palavras proibidas no nome
  if (recipient) {
    const upper = recipient.toUpperCase();
    if (
      upper.includes('MERCADO LIVRE') ||
      upper.includes('SHOPEE') ||
      upper.includes('CORREIOS') ||
      upper.includes('DESTINAT') ||
      upper.includes('REMETENTE') ||
      recipient.length < 3
    ) {
      recipient = null;
    }
  }

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

  return {
    recipientName: recipient,
    block: rawBlock,
    unitNumber: hasUnit ? rawUnit : null,
    trackingCode: tracking,
    confidence,
  };
}

export async function POST(request: NextRequest) {
  try {
    const geminiKey = process.env.GEMINI_API_KEY || '';
    const nvidiaKey = process.env.NVIDIA_API_KEY || '';

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ confidence: 0 }, { status: 200 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64Image = buffer.toString('base64');
    const mimeType = file.type || 'image/jpeg';
    const dataUrl = `data:${mimeType};base64,${base64Image}`;

    // ─── 1. Tentar Google Gemini Vision (Ultra-Rápido ~2s) ───────────────────────
    if (geminiKey) {
      const geminiModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];
      for (const modelName of geminiModels) {
        try {
          const prompt = 'Extraia o destinatário, apartamento e bloco desta etiqueta. Retorne JSON {"recipientName":"...","block":"...","unitNumber":"...","trackingCode":"...","confidence":0.95}';
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-goog-api-key': geminiKey },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: base64Image } }] }],
                generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 120 },
              }),
              signal: AbortSignal.timeout(4500),
            }
          );

          if (res.ok) {
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
              const parsedRes = formatOcrResult(parsed);
              if (parsedRes.confidence > 0) {
                console.log(`[OCR-LIVE] ✅ Gemini [${modelName}] SUCESSO:`, parsedRes);
                return NextResponse.json(parsedRes);
              }
            }
          }
        } catch {}
      }
    }

    // ─── 2. Fallback Imediato: NVIDIA NIM Vision (Llama 3.2 11B Vision) ───────────
    if (nvidiaKey) {
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
                  { type: 'text', text: 'Extraia o destinatario, apartamento e bloco desta etiqueta. Retorne APENAS um JSON: {"recipientName":"...","block":"...","unitNumber":"...","trackingCode":"...","confidence":0.95}' },
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
            const parsedRes = formatOcrResult(parsed);
            if (parsedRes.confidence > 0) {
              console.log('[OCR-LIVE] ✅ NVIDIA NIM Vision SUCESSO:', parsedRes);
              return NextResponse.json(parsedRes);
            }
          }
        }
      } catch (e: any) {
        console.warn('[OCR-LIVE] NVIDIA NIM falhou:', e.message?.slice(0, 80));
      }
    }

    return NextResponse.json({ recipientName: null, block: null, unitNumber: null, trackingCode: null, confidence: 0 });
  } catch {
    return NextResponse.json({ recipientName: null, block: null, unitNumber: null, trackingCode: null, confidence: 0 });
  }
}