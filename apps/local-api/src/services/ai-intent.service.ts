import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { databaseService } from './database.service.js';

export type AIIntentCategory = 'CONFIRM_SCIENCE' | 'CONTEST_PACKAGE' | 'REQUEST_CODE' | 'UNRELATED';

export interface AIIntentResult {
  intent: AIIntentCategory;
  confidence: number;
  reasoning: string;
  extractedCode: string | null;
  conciergeAlert?: string | null;
  source: 'groq' | 'gemini' | 'nvidia' | 'heuristic' | 'learned_cache';
}

interface ClassifyOptions {
  quotedText?: string;
  residentName?: string;
  packagesInfo?: string;
}

type AIProvider = 'groq' | 'gemini' | 'nvidia';

interface LearnedPatternItem {
  intent: AIIntentCategory;
  confidence: number;
  reasoning: string;
  hits: number;
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
  private memoryCache = new Map<string, LearnedPatternItem>();
  private providerRoundRobinIndex = 0;
  private providerCooldowns = new Map<AIProvider, number>();
  private initialized = false;

  constructor() {
    this.initLearnedCache();
  }

  /**
   * Normaliza o texto removendo acentuações, pontuações e espaços extras.
   */
  public static normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Inicializa o cache com os padrões já salvos no SQLite e semeia padrões base se vazio.
   */
  private initLearnedCache(): void {
    if (this.initialized) return;

    try {
      const saved = databaseService.getAllLearnedPatterns();
      for (const item of saved) {
        this.memoryCache.set(item.pattern_key, {
          intent: item.intent as AIIntentCategory,
          confidence: item.confidence,
          reasoning: item.reasoning,
          hits: item.hits
        });
      }

      // Se o banco de aprendizado estiver vazio ou quase vazio, pré-popula com frases comuns brasileiras
      if (this.memoryCache.size < 10) {
        this.seedInitialPatterns();
      }

      this.initialized = true;
      console.log(`🧠 [AIIntent] Cache de aprendizado carregado com ${this.memoryCache.size} padrões conhecidos.`);
    } catch (err: any) {
      console.warn(`[AIIntent] Falha ao carregar padrões aprendidos: ${err.message}`);
    }
  }

  /**
   * Popula padrões fundamentais da língua portuguesa para evitar consumo desnecessário de APIs de IA.
   */
  private seedInitialPatterns(): void {
    const seeds: Array<{ key: string; intent: AIIntentCategory; reasoning: string }> = [
      // 1. Confirmação de Ciência
      { key: 'ok', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa monossilábica' },
      { key: 'ok obrigado', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa com agradecimento' },
      { key: 'ok obrigada', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa com agradecimento' },
      { key: 'obrigado', intent: 'CONFIRM_SCIENCE', reasoning: 'Agradecimento de notificação' },
      { key: 'obrigada', intent: 'CONFIRM_SCIENCE', reasoning: 'Agradecimento de notificação' },
      { key: 'obrigado ja vi', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação com ciência expressa' },
      { key: 'obrigada ja vi', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação com ciência expressa' },
      { key: 'valeu', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação coloquial' },
      { key: 'vlw', intent: 'CONFIRM_SCIENCE', reasoning: 'Abreviação de valeu' },
      { key: 'obg', intent: 'CONFIRM_SCIENCE', reasoning: 'Abreviação de obrigado' },
      { key: 'show', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação positiva' },
      { key: 'show de bola', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação positiva' },
      { key: 'beleza', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'blz', intent: 'CONFIRM_SCIENCE', reasoning: 'Abreviação de beleza' },
      { key: 'top', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação positiva' },
      { key: 'perfeito', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação de recebimento da mensagem' },
      { key: 'maravilha', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'ciente', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência expressa' },
      { key: 'estou ciente', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência expressa' },
      { key: 'to ciente', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência expressa' },
      { key: 'tô ciente', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência expressa' },
      { key: 'ta ciente', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência expressa' },
      { key: 'confirmado', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação expressa' },
      { key: 'recebido', intent: 'CONFIRM_SCIENCE', reasoning: 'Notificação recebida' },
      { key: 'vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Intenção de retirada declarada' },
      { key: 'ja vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Intenção de retirada imediata' },
      { key: 'vou retirar', intent: 'CONFIRM_SCIENCE', reasoning: 'Intenção de retirada declarada' },
      { key: 'estou descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'to descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'ja pego', intent: 'CONFIRM_SCIENCE', reasoning: 'Intenção de retirada' },
      { key: 'pego mais tarde', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência com retirada posterior' },
      { key: 'passo ai mais tarde', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência com retirada posterior' },
      { key: 'minha esposa vai retirar', intent: 'CONFIRM_SCIENCE', reasoning: 'Terceiro autorizado para retirada' },
      { key: 'meu marido vai retirar', intent: 'CONFIRM_SCIENCE', reasoning: 'Terceiro autorizado para retirada' },
      { key: 'meu filho vai buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Terceiro autorizado para retirada' },
      { key: 'sim', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação simples' },
      { key: 'sim obrigado', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com agradecimento' },

      // 2. Contestação de Encomenda / Não Ciência
      { key: 'nao e meu', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que pacote não pertence a ele' },
      { key: 'nao e minha', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que pacote não pertence a ele' },
      { key: 'nao eh meu', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que pacote não pertence a ele' },
      { key: 'nao eh minha', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que pacote não pertence a ele' },
      { key: 'nao tenho ciencia', intent: 'CONTEST_PACKAGE', reasoning: 'Morador declara não ter ciência da encomenda' },
      { key: 'nao tenho ciencia disso', intent: 'CONTEST_PACKAGE', reasoning: 'Morador declara não ter ciência da encomenda' },
      { key: 'nao pedi nada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador alega que não realizou nenhum pedido' },
      { key: 'nao comprei nada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador alega que não comprou nada' },
      { key: 'nao fiz pedido', intent: 'CONTEST_PACKAGE', reasoning: 'Morador alega que não fez compra' },
      { key: 'encomenda errada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador aponta erro de encomenda' },
      { key: 'deve ser engano', intent: 'CONTEST_PACKAGE', reasoning: 'Morador aponta provável engano' },
      { key: 'veio errado', intent: 'CONTEST_PACKAGE', reasoning: 'Morador aponta entrega errada' },
      { key: 'pacote errado', intent: 'CONTEST_PACKAGE', reasoning: 'Morador aponta entrega errada' },
      { key: 'destinatario errado', intent: 'CONTEST_PACKAGE', reasoning: 'Destinatário incorreto' },
      { key: 'nao sou eu', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma não ser o destinatário' },
      { key: 'nao reconheco', intent: 'CONTEST_PACKAGE', reasoning: 'Morador não reconhece a entrega' },
      { key: 'nao reconheco essa encomenda', intent: 'CONTEST_PACKAGE', reasoning: 'Morador não reconhece a entrega' },
      { key: 'nao estou esperando nada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador não aguarda encomendas' },
      { key: 'numero errado', intent: 'CONTEST_PACKAGE', reasoning: 'Contato telefônico incorreto para a unidade' },
      { key: 'apto errado', intent: 'CONTEST_PACKAGE', reasoning: 'Apartamento incorreto' },

      // 3. Solicitação de Código / QR Code
      { key: 'qual o codigo', intent: 'REQUEST_CODE', reasoning: 'Solicitação do código de retirada' },
      { key: 'qual meu codigo', intent: 'REQUEST_CODE', reasoning: 'Solicitação do código pessoal' },
      { key: 'qual o meu codigo', intent: 'REQUEST_CODE', reasoning: 'Solicitação do código pessoal' },
      { key: 'manda o codigo', intent: 'REQUEST_CODE', reasoning: 'Pedido de envio do código' },
      { key: 'manda o qr code', intent: 'REQUEST_CODE', reasoning: 'Pedido de envio do QR Code' },
      { key: 'perdi o codigo', intent: 'REQUEST_CODE', reasoning: 'Morador informa perda do código' },
      { key: 'onde vejo o codigo', intent: 'REQUEST_CODE', reasoning: 'Dúvida sobre localização do código' },
      { key: 'como retiro', intent: 'REQUEST_CODE', reasoning: 'Instruções de retirada' },
      { key: 'link de retirada', intent: 'REQUEST_CODE', reasoning: 'Pedido do link de acesso' },

      // 4. Assuntos Diversos / Saudações
      { key: 'bom dia', intent: 'UNRELATED', reasoning: 'Saudação comum sem relação com pacote' },
      { key: 'boa tarde', intent: 'UNRELATED', reasoning: 'Saudação comum sem relação com pacote' },
      { key: 'boa noite', intent: 'UNRELATED', reasoning: 'Saudação comum sem relação com pacote' },
      { key: 'ola', intent: 'UNRELATED', reasoning: 'Saudação' },
      { key: 'oi', intent: 'UNRELATED', reasoning: 'Saudação' },
      { key: 'tudo bem', intent: 'UNRELATED', reasoning: 'Saudação' },
      { key: 'tem vaga de visitante', intent: 'UNRELATED', reasoning: 'Dúvida sobre garagem/vaga' },
      { key: 'o portao esta quebrado', intent: 'UNRELATED', reasoning: 'Aviso sobre portão' },
      { key: 'boleto do condominio', intent: 'UNRELATED', reasoning: 'Assunto financeiro da administração' },
      { key: 'falar com o sindico', intent: 'UNRELATED', reasoning: 'Contato administrativo' }
    ];

    for (const seed of seeds) {
      const normKey = AIIntentService.normalize(seed.key);
      this.memoryCache.set(normKey, {
        intent: seed.intent,
        confidence: 0.98,
        reasoning: seed.reasoning,
        hits: 1
      });
      databaseService.saveLearnedPattern(normKey, seed.intent, 0.98, seed.reasoning, 'system_seed');
    }
  }

  /**
   * Classifica a intenção de forma inteligente com otimizações:
   * 1. Cache de Aprendizado Contínuo (0ms, 0 chamadas de API).
   * 2. Rotação Round-Robin entre Groq, Gemini e NVIDIA para equilibrar cotas.
   * 3. Circuit Breaker contra limites de taxa (HTTP 429 / RESOURCE_EXHAUSTED).
   * 4. Fallback Heurístico Resiliente caso todas as APIs excedam ou fiquem offline.
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

    const normalized = AIIntentService.normalize(trimmed);
    const extractedCode = this.extractCode(trimmed);

    // ── ETAPA 1: VERIFICAÇÃO NO CACHE DE APRENDIZADO ────────────────────────
    const cached = this.checkLearnedCache(normalized, trimmed);
    if (cached) {
      console.log(`⚡ [AIIntent: CACHE] Padrão "${normalized}" já aprendido! [${cached.intent}] (Hits: ${cached.hits})`);
      return {
        intent: cached.intent,
        confidence: cached.confidence,
        reasoning: `Padrão aprendido previamente (${cached.reasoning})`,
        extractedCode: extractedCode || null,
        conciergeAlert:
          cached.intent === 'CONTEST_PACKAGE'
            ? `Morador informou no WhatsApp: "${trimmed}"`
            : null,
        source: 'learned_cache'
      };
    }

    // ── ETAPA 2: ROTAÇÃO INTELIGENTE (GROQ / GEMINI / NVIDIA) ──────────────
    const rotatedProviders = this.getRotatedProviders();
    console.log(`🔄 [AIIntent] Ordem dos provedores para esta mensagem:`, rotatedProviders);

    for (const provider of rotatedProviders) {
      // Verifica se o provedor está em período de cooldown (limite excedido)
      const cooldownUntil = this.providerCooldowns.get(provider) || 0;
      if (cooldownUntil > Date.now()) {
        const remainingSecs = Math.ceil((cooldownUntil - Date.now()) / 1000);
        console.warn(`⏳ [AIIntent] Provedor ${provider.toUpperCase()} em cooldown por limite de cota (${remainingSecs}s restantes). Alternando...`);
        continue;
      }

      console.log(`🤖 [AIIntent] Consultando provedor: ${provider.toUpperCase()}...`);
      let result: AIIntentResult | null = null;
      if (provider === 'groq') {
        result = await this.tryGroq(trimmed, options);
      } else if (provider === 'gemini') {
        result = await this.tryGemini(trimmed, options);
      } else if (provider === 'nvidia') {
        result = await this.tryNvidia(trimmed, options);
      }

      if (result) {
        // Se a IA classificou com alta confiança e a mensagem é concisa, aprende o padrão
        if (result.confidence >= 0.8 && normalized.length <= 90) {
          this.learnPattern(normalized, result.intent, result.confidence, result.reasoning);
        }
        return result;
      }
    }

    // ── ETAPA 3: FALLBACK HEURÍSTICO RESILIENTE (SEMPRE FUNCIONA) ───────────
    console.warn(`🛡️ [AIIntent] Todas as IAs indisponíveis ou cotas esgotadas. Executando fallback heurístico local resiliente...`);
    const fallbackResult = this.classifyHeuristic(trimmed, options?.quotedText);
    return {
      ...fallbackResult,
      reasoning: `[Fallback Local Resiliente] ${fallbackResult.reasoning}`
    };
  }

  /**
   * Consulta o cache em memória procurando correspondência exata ou por trecho chave de contestação.
   */
  private checkLearnedCache(normalized: string, rawText: string): LearnedPatternItem | null {
    // 1. Busca exata pela frase normalizada
    const exact = this.memoryCache.get(normalized);
    if (exact) {
      exact.hits += 1;
      databaseService.incrementPatternHits(normalized);
      return exact;
    }

    // 2. Busca por sub-expressões de alta prioridade (especialmente contestação)
    for (const [key, item] of this.memoryCache.entries()) {
      if (key.length >= 8 && normalized.includes(key)) {
        // Se contiver a expressão de contestação gravada (ex: "nao tenho ciencia")
        if (item.intent === 'CONTEST_PACKAGE') {
          item.hits += 1;
          databaseService.incrementPatternHits(key);
          return item;
        }
      }
    }

    return null;
  }

  /**
   * Grava um novo padrão aprendido em memória e no banco SQLite.
   */
  private learnPattern(key: string, intent: AIIntentCategory, confidence: number, reasoning: string): void {
    if (!key || key.length < 2) return;

    this.memoryCache.set(key, {
      intent,
      confidence,
      reasoning,
      hits: 1
    });

    databaseService.saveLearnedPattern(key, intent, confidence, reasoning, 'ai_learned');
    console.log(`🧠 [AIIntent] Novo padrão aprendido e salvo no banco: "${key}" -> ${intent}`);
  }

  /**
   * Retorna os provedores configurados ordenados de forma intercalada (Round-Robin).
   */
  private getRotatedProviders(): AIProvider[] {
    const available: AIProvider[] = [];

    const groqKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY;
    const geminiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const nvidiaKey = env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY;

    if (groqKey) available.push('groq');
    if (geminiKey) available.push('gemini');
    if (nvidiaKey) available.push('nvidia');

    if (available.length <= 1) return available;

    // Rotação: desloca o índice para que a cada requisição um provedor diferente seja o primário
    const startIndex = this.providerRoundRobinIndex % available.length;
    this.providerRoundRobinIndex = (this.providerRoundRobinIndex + 1) % available.length;

    const rotated = [...available.slice(startIndex), ...available.slice(0, startIndex)];
    return rotated;
  }

  /**
   * Marca um provedor em cooldown temporário quando excede o limite de taxa / quota (HTTP 429).
   */
  private triggerProviderCooldown(provider: AIProvider, reason: string): void {
    const cooldownMs = 60_000; // 60 segundos de pausa para restabelecer token bucket
    this.providerCooldowns.set(provider, Date.now() + cooldownMs);
    console.warn(`🚨 [AIIntent] Limite de requisições atingido no provedor ${provider.toUpperCase()} (${reason}). Ativando cooldown de 60s.`);
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

      if (res.status === 429) {
        this.triggerProviderCooldown('groq', 'HTTP 429 Too Many Requests');
        return null;
      }

      if (!res.ok) {
        console.warn(`[AIIntent] Groq retornou HTTP ${res.status}`);
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
      if (err.message?.includes('429') || err.message?.includes('rate')) {
        this.triggerProviderCooldown('groq', err.message);
      } else {
        console.warn(`[AIIntent] Groq falhou: ${err.message?.slice(0, 60)}`);
      }
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
          maxOutputTokens: 400
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
      const msg = String(err.message || '');
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        this.triggerProviderCooldown('gemini', 'Quota/Rate Limit Exceeded');
      } else {
        console.warn(`[AIIntent] Gemini falhou detalhe: ${msg}`);
      }
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

      if (res.status === 429) {
        this.triggerProviderCooldown('nvidia', 'HTTP 429 Too Many Requests');
        return null;
      }

      if (!res.ok) return null;
      const data = (await res.json()) as any;
      const rawContent = data.choices?.[0]?.message?.content || '';
      const parsed = this.parseAIJson(rawContent);
      if (parsed) {
        console.log(`[AIIntent] ✅ NVIDIA classificou como ${parsed.intent}`);
        return { ...parsed, source: 'nvidia' };
      }
    } catch (err: any) {
      const msg = String(err.message || '');
      if (msg.includes('429') || msg.includes('rate') || msg.includes('limit')) {
        this.triggerProviderCooldown('nvidia', 'Rate Limit Exceeded');
      } else {
        console.warn(`[AIIntent] NVIDIA falhou: ${msg.slice(0, 60)}`);
      }
    }
    return null;
  }

  // ── 4. Fallback Heurístico Local (0ms, 100% offline) ─────────────────────
  public classifyHeuristic(text: string, quotedText?: string): AIIntentResult {
    const trimmed = text.trim();
    const normalized = AIIntentService.normalize(trimmed);

    // 1. Contestação
    const contestationRegex = /\b(nao (e|eh) minh[ao]|nao pedi|encomenda errada|nao recebi|veio errad[ao]|nao sou eu|destinatario errado|pacote errado|nao reconheco|nao tenho ciencia|nao comprei|nao fiz pedido|nao estou esperando)\b/i;
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
    const extractedCode = this.extractCode(text);

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
    const hasCodeFormat = Boolean(this.extractCode(text));

    if (!hasCodeFormat && unrelatedCondoRegex.test(normalized)) {
      return {
        intent: 'UNRELATED',
        confidence: 0.95,
        reasoning: 'Regra heurística detectou assunto condominial sem relação com encomenda',
        extractedCode: null,
        source: 'heuristic'
      };
    }

    // 5. Perguntas gerais com ponto de interrogação
    if (text.includes('?') && !hasCodeFormat && !codeRequestRegex.test(normalized)) {
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

  private extractCode(text: string): string | null {
    const trimmed = text.trim();
    const hashMatch = text.match(/#([a-zA-Z0-9]{4,8})\b/);
    if (hashMatch) return hashMatch[1].toUpperCase();

    const codePrefixMatch = text.match(/\b(?:cod(?:igo)?|retirada)[:\s]+([a-zA-Z0-9]{4,8})\b/i);
    if (codePrefixMatch) return codePrefixMatch[1].toUpperCase();

    if (/^[a-zA-Z0-9]{5,7}$/.test(trimmed)) {
      const commonWords = new Set([
        'BOM', 'BOA', 'DIA', 'TARDE', 'NOITE', 'OLA', 'OLAA', 'OI', 'OII', 'OIII',
        'TUDO', 'BEM', 'COMO', 'VAI', 'VALEU', 'VLW', 'OBRIGADO', 'OBRIGADA', 'OBG',
        'SHOW', 'TOP', 'JOIA', 'BELEZA', 'BLZ', 'SIM', 'NAO', 'OK', 'OKK', 'OKEY',
        'CIENTE', 'CONFIRMO', 'RECEBI', 'VOU', 'TESTE', 'FAVOR', 'AJUDA', 'AQUI',
        'ONDE', 'QUEM', 'QUAL', 'PORTA', 'VAGA', 'CARRO', 'CASA', 'APTO', 'BLOCO'
      ]);
      const upperCandidate = trimmed.toUpperCase();
      if (!commonWords.has(upperCandidate)) {
        return upperCandidate;
      }
    }
    return null;
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
      if (match) {
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
          confidence: Number(parsed.confidence) || 0.95,
          reasoning: String(parsed.reasoning || parsed.explanation || ''),
          extractedCode: parsed.extractedCode || parsed.extracted_code || null,
          conciergeAlert: parsed.conciergeAlert || parsed.concierge_alert || null
        };
      }

      // Se a IA responder em texto puro (ex: "CONFIRM_SCIENCE: o morador disse...")
      const upper = content.toUpperCase();
      let intent: AIIntentCategory | null = null;
      if (upper.includes('CONFIRM_SCIENCE') || upper.includes('CONFIRM')) {
        intent = 'CONFIRM_SCIENCE';
      } else if (upper.includes('CONTEST_PACKAGE') || upper.includes('CONTEST')) {
        intent = 'CONTEST_PACKAGE';
      } else if (upper.includes('REQUEST_CODE')) {
        intent = 'REQUEST_CODE';
      } else if (upper.includes('UNRELATED')) {
        intent = 'UNRELATED';
      }

      if (intent) {
        return {
          intent,
          confidence: 0.9,
          reasoning: content.trim().slice(0, 120),
          extractedCode: null,
          conciergeAlert: intent === 'CONTEST_PACKAGE' ? content.trim().slice(0, 120) : null
        };
      }
    } catch {
      return null;
    }
    return null;
  }
}

export const aiIntentService = new AIIntentService();
