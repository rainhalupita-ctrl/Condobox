import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { rawText } = await req.json();

    if (!rawText || typeof rawText !== 'string' || rawText.trim() === '') {
      return NextResponse.json({ error: 'Texto não fornecido.' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      return NextResponse.json({ error: 'Chave do Gemini não configurada.' }, { status: 500 });
    }

    const prompt = `Você é um extrator de dados cadastrais de condomínio.
Analise a lista ou texto abaixo (que pode conter nomes, telefones, e-mails, blocos/torres e apartamentos em formatos variados) e extraia para um array JSON estrito contendo cada morador.

Formato esperado:
[
  {
    "name": string (Nome completo do morador),
    "block": string (Nome ou letra do bloco/torre, ex: "Bloco A", "Torre 1" ou "Bloco A" se não especificado),
    "unitNumber": string (Número do apartamento/unidade, ex: "101", "805", "32"),
    "phone": string (Telefone/WhatsApp limpo somente dígitos com DDD, ex: "11988887777" ou "73981953741"),
    "email": string ou null (E-mail do morador)
  }
]

Texto para extrair:
"""
${rawText.slice(0, 15000)}
"""`;

    const modelsToTry = [
      'gemini-3.6-flash',
      'gemini-3.1-flash-lite',
      'gemini-3.7-flash',
      'gemini-3.5-flash'
    ];

    for (const model of modelsToTry) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1
            }
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed) ? parsed : (parsed.residents || parsed.data || []);
            return NextResponse.json({ success: true, residents: list });
          }
        }
      } catch (err: any) {
        console.warn(`[BatchParse] Modelo ${model} falhou:`, err.message);
      }
    }

    return NextResponse.json({ error: 'Não foi possível interpretar os registros.' }, { status: 500 });
  } catch (error: any) {
    console.error('Erro no batch-parse:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
