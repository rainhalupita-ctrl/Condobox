import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

export type AIIntentCategory = 'CONFIRM_SCIENCE' | 'CONTEST_PACKAGE' | 'REQUEST_CODE' | 'UNRELATED';

export interface AIIntentResult {
  intent: AIIntentCategory;
  confidence: number;
  reasoning: string;
  extractedCode: string | null;
  conciergeAlert?: string | null;
  source: 'groq' | 'gemini' | 'nvidia' | 'heuristic';
}

interface ClassifyOptions {
  quotedText?: string;
  residentName?: string;
  packagesInfo?: string;
}

const SYSTEM_PROMPT = `Você é o classificador de inteligência artificial da portaria inteligente CondoBox.
Sua função é analisar as mensagens enviadas por moradores pelo WhatsApp após serem notificados sobre encomendas na portaria.

Classifique a mensagem do morador ESTRITAMENTE em uma destas 4 categorias:

1. "CONFIRM_SCIENCE":
   O morador confirma ciência, agradece, informa que vai retirar ou recebeu a notificação.
   Exemplos: "ok", "obrigado", "obrigada", "ciente", "estou ciente", "valeu", "vlw", "já vou buscar", "tô descendo", "vou pegar mais tarde", "show", "beleza", "blz", "👍", "confirmado", "sim", "entendido".

2. "CONTEST_PACKAGE":
   O morador afirma que NÃO tem ciência, NÃO pediu nada, NÃO reconhece o pacote, que não é dele, que veio errado, que houve engano, ou que não comprou nada.
   Exemplos: "não tenho ciência disso", "não é meu", "não é minha", "não pedi nada", "encomenda errada", "deve ser engano", "estou fora e não comprei nada", "veio errado", "não sou eu", "não reconheço esse pacote", "número errado".

3. "REQUEST_CODE":
   O morador pede o código de retirada, link do QR Code ou como retirar.
   Exemplos: "qual meu código?", "manda o qr code", "perdi o código", "onde vejo o código?", "como retiro?".

4. "UNRELATED":
   A mensagem NÃO é sobre ciência da encomenda nem contestação. Trata de outros assuntos condominiais (garagem, vaga, portão, interfone, síndico, boleto, visita, diarista, ou saudação isolada como "bom dia", "olá").
   Exemplos: "Tem vaga de visitante?", "O portão abriu?", "Bom dia", "Autorizo a diarista", "Qual o ramal do síndico?".

IMPORTANTE:
- Se for "CONTEST_PACKAGE", formule um resumo claro no campo "conciergeAlert" para alertar o porteiro (ex: "Morador alega que não reconhece o pacote e não pediu nada").
- Retorne EXCLUSIVAMENTE um objeto JSON válido, sem formatação markdown em volta:
{
  "intent": "CONFIRM_SCIENCE" | "CONTEST_PACKAGE" | "REQUEST_CODE" | "UNRELATED",
  "confidence": 0.0 a 1.0,
  "reasoning": "breve explicação",
  "extractedCode": "código alfanumérico se o morador digitou, ou null",
  "conciergeAlert": "resumo do alerta se for contestação, ou null"
}`;

export class AIIntentService {
  /**
   * Classifica a intenção da mensagem utilizando IAs (Groq -> Gemini -> NVIDIA) com fallback heurístico instantâneo.
   */
  public async classify(text: string, options?: ClassifyOptions): Promise<AIIntentResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        intent: 'UNRELATED',
        confidence: 1.0,
        reasoning: 'Mensagem vazia',
        extractedCode: null,
        source: 'heuristic'
      };
    }

    // 1. Tenta Groq (ultra-rápido, ~200-400ms)
    const groqResult = await this.tryGroq(trimmed, options);
    if (groqResult) return groqResult;

    // 2. Tenta Gemini (Google Flash)
    const geminiResult = await this.tryGemini(trimmed, options);
    if (geminiResult) return geminiResult;

    // 3. Tenta NVIDIA NIM (se configurado)
    const nvidiaResult = await this.tryNvidia(trimmed, options);
    if (nvidiaResult) return nvidiaResult;

    // 4. Fallback Heurístico local (0ms, offline)
    return this.classifyHeuristic(trimmed, options?.quotedText);
  }

  // ── 1. Groq (qwen/qwen3.8-27b ou groq/compound-mini) ─────────────────────
  private async tryGroq(text: string, options?: ClassifyOptions): Promise<AIIntentResult | null> {
    const groqKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY;
    if (!groqKey) return null;

    try {
      const userPrompt = this.buildPrompt(text, options);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 220
        }),
        signal: AbortSignal.timeout(3500)
      });

      if (!res.ok) {
        console.warn(`[AIIntent] Groq HTTP ${res.status}`);
        return null;
      }

      const data = (await res.json()) as any;
      const rawContent = data.choices?.[0]?.message?.content || '';
      const parsed = this.parseAIJson(rawContent);
      if (parsed) {
        console.log(`[AIIntent] ✅ Groq classificou como ${parsed.intent} (${parsed.reasoning})`);
        return { ...parsed, source: 'groq' };
      }
    } catch (err: any) {
      console.warn(`[AIIntent] Groq falhou: ${err.message?.slice(0, 60)}`);
    }
    return null;
  }

  // ── 2. Gemini (Google Generative AI - gemini-3.6-flash) ───────────────────
  private async tryGemini(text: string, options?: ClassifyOptions): Promise<AIIntentResult | null> {
    const geminiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey) return null;

    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-3.6-flash',
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 250,
          responseMimeType: 'application/json'
        }
      });

      const userPrompt = `${SYSTEM_PROMPT}\n\n${this.buildPrompt(text, options)}`;
      const result = await model.generateContent(userPrompt);
      const rawText = result.response.text();
      const parsed = this.parseAIJson(rawText);
      if (parsed) {
        console.log(`[AIIntent] ✅ Gemini classificou como ${parsed.intent} (${parsed.reasoning})`);
        return { ...parsed, source: 'gemini' };
      }
    } catch (err: any) {
      console.warn(`[AIIntent] Gemini falhou: ${err.message?.slice(0, 60)}`);
    }
    return null;
  }

  // ── 3. NVIDIA NIM ─────────────────────────────────────────────────────────
  private async tryNvidia(text: string, options?: ClassifyOptions): Promise<AIIntentResult | null> {
    const nvidiaKey = env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY;
    if (!nvidiaKey) return null;

    try {
      const userPrompt = this.buildPrompt(text, options);
      const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${nvidiaKey}`
        },
        body: JSON.stringify({
          model: 'meta/llama-3.1-70b-instruct',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0,
          max_tokens: 220
        }),
        signal: AbortSignal.timeout(4000)
      });

      if (!res.ok) return null;
      const data = (await res.json()) as any;
      const rawContent = data.choices?.[0]?.message?.content || '';
      const parsed = this.parseAIJson(rawContent);
      if (parsed) {
        console.log(`[AIIntent] ✅ NVIDIA classificou como ${parsed.intent}`);
        return { ...parsed, source: 'nvidia' };
      }
    } catch (err: any) {
      console.warn(`[AIIntent] NVIDIA falhou: ${err.message?.slice(0, 60)}`);
    }
    return null;
  }

  // ── 4. Fallback Heurístico Local (0ms, 100% offline) ─────────────────────
  public classifyHeuristic(text: string, quotedText?: string): AIIntentResult {
    const trimmed = text.trim();
    const normalized = trimmed
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    // 1. Contestação
    const contestationRegex = /\b(nao (e|eh) minh[ao]|nao pedi|encomenda errada|nao recebi|veio errad[ao]|nao sou eu|destinatario errado|pacote errado|nao reconheco|nao tenho ciencia|nao comprei)\b/i;
    if (contestationRegex.test(normalized)) {
      return {
        intent: 'CONTEST_PACKAGE',
        confidence: 0.95,
        reasoning: 'Regra heurística detectou negação/contestação de encomenda',
        extractedCode: null,
        conciergeAlert: `Morador informou que não reconhece a encomenda: "${trimmed}"`,
        source: 'heuristic'
      };
    }

    // 2. Extração de Código
    let extractedCode: string | null = null;
    const hashMatch = text.match(/#([a-zA-Z0-9]{4,8})\b/);
    const codePrefixMatch = text.match(/\b(?:cod(?:igo)?|retirada)[:\s]+([a-zA-Z0-9]{4,8})\b/i);

    if (hashMatch) {
      extractedCode = hashMatch[1].toUpperCase();
    } else if (codePrefixMatch) {
      extractedCode = codePrefixMatch[1].toUpperCase();
    } else if (/^[a-zA-Z0-9]{5,7}$/.test(trimmed)) {
      const commonWords = new Set([
        'BOM', 'BOA', 'DIA', 'TARDE', 'NOITE', 'OLA', 'OLAA', 'OI', 'OII', 'OIII',
        'TUDO', 'BEM', 'COMO', 'VAI', 'VALEU', 'VLW', 'OBRIGADO', 'OBRIGADA', 'OBG',
        'SHOW', 'TOP', 'JOIA', 'BELEZA', 'BLZ', 'SIM', 'NAO', 'OK', 'OKK', 'OKEY',
        'CIENTE', 'CONFIRMO', 'RECEBI', 'VOU', 'TESTE', 'FAVOR', 'AJUDA', 'AQUI',
        'ONDE', 'QUEM', 'QUAL', 'PORTA', 'VAGA', 'CARRO', 'CASA', 'APTO', 'BLOCO'
      ]);
      const upperCandidate = trimmed.toUpperCase();
      if (!commonWords.has(upperCandidate)) {
        extractedCode = upperCandidate;
      }
    }

    // 3. Pedido de Código / QR Code
    const codeRequestRegex = /\b(qual (o |meu )?cod(?:igo)?|manda (o |o link do )?(qr\s?code|cod(?:igo)?)|perdi (o |meu )?(qr\s?code|cod(?:igo)?)|link (da encomenda|do qr\s?code|de retirada)|cade o qr\s?code)\b/i;
    if (codeRequestRegex.test(normalized)) {
      return {
        intent: 'REQUEST_CODE',
        confidence: 0.95,
        reasoning: 'Regra heurística detectou solicitação do código/QR Code de retirada',
        extractedCode,
        source: 'heuristic'
      };
    }

    // 4. Assuntos diversos do condomínio
    const unrelatedCondoRegex = /\b(vaga|garagem|estacionamento|boleto|cota condominial|taxa|segunda via|sindico|sindica|administradora|administracao|interfone|portao|fechadura|chaveiro|chave|barulho|vizinho|som alto|lixo|reciclagem|elevador|vazamento|infiltracao|cano|agua|luz|visita|visitante|prestador|uber|ifood|pizza|entregador|mudanca|salao|churrasqueira|piscina|academia)\b/i;
    if (!hashMatch && !codePrefixMatch && unrelatedCondoRegex.test(normalized)) {
      return {
        intent: 'UNRELATED',
        confidence: 0.95,
        reasoning: 'Regra heurística detectou assunto condominial sem relação com encomenda',
        extractedCode: null,
        source: 'heuristic'
      };
    }

    // 5. Perguntas gerais com ponto de interrogação
    if (text.includes('?') && !hashMatch && !codePrefixMatch && !codeRequestRegex.test(normalized)) {
      return {
        intent: 'UNRELATED',
        confidence: 0.9,
        reasoning: 'Pergunta geral para a portaria',
        extractedCode: null,
        source: 'heuristic'
      };
    }

    // 6. Resposta direta a notificação citada (quotedMessage)
    if (quotedText) {
      const normQuoted = quotedText.toLowerCase();
      const isQuotingPackage =
        normQuoted.includes('encomenda') ||
        normQuoted.includes('retirada') ||
        normQuoted.includes('codigo') ||
        normQuoted.includes('condobox') ||
        normQuoted.includes('portaria');
      if (isQuotingPackage && trimmed.length <= 40) {
        return {
          intent: 'CONFIRM_SCIENCE',
          confidence: 0.95,
          reasoning: 'Resposta direta afirmativa citando a notificação da encomenda',
          extractedCode,
          source: 'heuristic'
        };
      }
    }

    // 7. Emojis afirmativos
    const ackEmojis = ['👍', '👌', '📦', '✅', '🆗', '🤝', '🙏'];
    const hasAckEmoji = ackEmojis.some(emoji => text.includes(emoji));

    // 8. Expressões afirmativas
    const ackKeywordsRegex = /\b(ciente|estou ciente|to ciente|tô ciente|ta ciente|tá ciente|ok|okk|okey|okay|confirmado|confirmo|confirmar|confirmada|recebido|recebi|entendido|entendi|obrigad[ao]|valeu|vlw|obg|agradecid[ao]|gratidao|show|show de bola|perfeito|maravilha|joia|beleza|blz|tranquilo|vou retirar|vou buscar|ja vou buscar|ja vou descer|estou descendo|to descendo|tô descendo|indo buscar|passo ai|passo aí|vou pegar|ja pego|pego mais tarde|logo busco)\b/i;

    const isShortMessage = trimmed.length <= 60;
    const isAckKeyword = isShortMessage && ackKeywordsRegex.test(normalized);
    const isSimpleYes = isShortMessage && /^(sim|sim obrigado|sim valeu|sim ciente)$/i.test(normalized);

    if (hasAckEmoji || isAckKeyword || isSimpleYes || extractedCode) {
      return {
        intent: 'CONFIRM_SCIENCE',
        confidence: 0.9,
        reasoning: extractedCode ? 'Código de retirada informado' : 'Palavra-chave/emoji afirmativo de ciência',
        extractedCode,
        source: 'heuristic'
      };
    }

    // 9. Padrão: Não relacionado / Saudação isolada
    return {
      intent: 'UNRELATED',
      confidence: 0.9,
      reasoning: 'Mensagem casual ou assunto não relacionado a confirmação de encomenda',
      extractedCode: null,
      source: 'heuristic'
    };
  }

  private buildPrompt(text: string, options?: ClassifyOptions): string {
    let prompt = `Mensagem do morador: "${text}"`;
    if (options?.quotedText) {
      prompt += `\nNotificação citada pelo morador: "${options.quotedText}"`;
    }
    if (options?.residentName) {
      prompt += `\nNome do morador no cadastro: "${options.residentName}"`;
    }
    if (options?.packagesInfo) {
      prompt += `\nEncomendas pendentes do morador: ${options.packagesInfo}`;
    }
    return prompt;
  }

  private parseAIJson(content: string): Omit<AIIntentResult, 'source'> | null {
    try {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]);

      let intent: AIIntentCategory = 'UNRELATED';
      const rawIntent = String(parsed.intent || '').toUpperCase();
      if (rawIntent.includes('CONFIRM') || rawIntent.includes('CIENCIA') || rawIntent.includes('SCIENCE')) {
        intent = 'CONFIRM_SCIENCE';
      } else if (rawIntent.includes('CONTEST') || rawIntent.includes('NAO') || rawIntent.includes('REJEIT')) {
        intent = 'CONTEST_PACKAGE';
      } else if (rawIntent.includes('CODE') || rawIntent.includes('CODIGO') || rawIntent.includes('QR')) {
        intent = 'REQUEST_CODE';
      } else {
        intent = 'UNRELATED';
      }

      return {
        intent,
        confidence: Number(parsed.confidence) || 0.9,
        reasoning: String(parsed.reasoning || parsed.explanation || ''),
        extractedCode: parsed.extractedCode || parsed.extracted_code || null,
        conciergeAlert: parsed.conciergeAlert || parsed.concierge_alert || null
      };
    } catch {
      return null;
    }
  }
}

export const aiIntentService = new AIIntentService();
