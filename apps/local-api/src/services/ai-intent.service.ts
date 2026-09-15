import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';
import { databaseService } from './database.service.js';

export type AIIntentCategory = 'CONFIRM_SCIENCE' | 'AUTHORIZE_THIRD_PARTY' | 'CONTEST_PACKAGE' | 'REQUEST_CODE' | 'UNRELATED';

export interface AIIntentResult {
  intent: AIIntentCategory;
  confidence: number;
  reasoning: string;
  extractedCode: string | null;
  thirdPartyName?: string | null;
  thirdPartyRelation?: string | null;
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
Sua função é analisar as mensagens enviadas por moradores pelo WhatsApp após serem notificados sobre encomendas na portaria e perguntados sobre QUEM irá retirar o pacote.

Classifique a mensagem do morador ESTRITAMENTE em uma destas 5 categorias:

1. "CONFIRM_SCIENCE":
   O morador confirma ciência e informa que ELE MESMO vai retirar ("eu mesmo", "eu mesma", "vou buscar pessoalmente"), ou envia confirmação/agradecimento simples.
   Exemplos: "eu mesmo", "eu mesma", "vou eu", "eu que vou buscar", "ok", "obrigado", "obrigada", "ciente", "estou ciente", "valeu", "vlw", "já vou buscar", "tô descendo", "vou pegar mais tarde", "show", "beleza", "blz", "👍", "confirmado", "sim", "entendido".

2. "AUTHORIZE_THIRD_PARTY":
   O morador informa que OUTRA PESSOA (esposa, marido, filho, filha, mãe, pai, irmão, vizinho, amigo, diarista, funcionário ou terceiro) vai buscar/retirar a encomenda, ou autoriza a entrega para outra pessoa.
   Exemplos:
   - "Quem vai buscar é minha esposa Maria"
   - "Pode entregar para o Carlos"
   - "Meu filho João vai retirar"
   - "Minha diarista Solange vai pegar hoje à tarde"
   - "Vou pedir pro meu irmão Pedro buscar"
   - "Liberado para o Lucas"
   - "Autorizo a Mariana a retirar"
   - "Minha vizinha do 402 vai pegar pra mim"
   - "Pode entregar pro meu marido"
   Para AUTHORIZE_THIRD_PARTY, você DEVE extrair:
   - "thirdPartyName": Nome próprio da pessoa indicada (ex: "Maria", "Carlos", "João", "Solange", "Pedro"). Se o morador não informar o nome próprio, use a relação com a primeira letra maiúscula (ex: "Esposa", "Marido", "Filho").
   - "thirdPartyRelation": Grau de parentesco ou vínculo se mencionado (ex: "esposa", "marido", "filho", "filha", "mãe", "pai", "irmão", "amigo", "vizinho", "diarista"), ou null se não houver.

3. "CONTEST_PACKAGE":
   O morador afirma que NÃO tem ciência, NÃO pediu nada, NÃO reconhece o pacote, que não é dele, que veio errado, que houve engano, que não comprou nada, OU afirma que NÃO realizou a retirada ("não fiz a retirada", "não retirei", "não fui eu quem retirou", etc.).
   Exemplos: "não tenho ciência disso", "não é meu", "não é minha", "não pedi nada", "encomenda errada", "deve ser engano", "estou fora e não comprei nada", "veio errado", "não sou eu", "não reconheço esse pacote", "número errado", "não fiz a retirada", "não retirei", "consta como retirada mas não fui eu", "contestação de retirada".

4. "REQUEST_CODE":
   O morador pede o código de retirada, link do QR Code ou como retirar.
   Exemplos: "qual meu código?", "manda o qr code", "perdi o código", "onde vejo o código?", "como retiro?".

5. "UNRELATED":
   A mensagem NÃO é sobre ciência da encomenda nem contestação. Trata de outros assuntos condominiais (garagem, vaga, portão, interfone, síndico, boleto, visita ou saudação isolada como "bom dia", "olá").
   Exemplos: "Tem vaga de visitante?", "O portão abriu?", "Bom dia", "Qual o ramal do síndico?".

IMPORTANTE:
- Se for "AUTHORIZE_THIRD_PARTY", extraia rigorosamente "thirdPartyName" e "thirdPartyRelation".
- Se for "CONTEST_PACKAGE", formule um resumo claro no campo "conciergeAlert" para alertar o porteiro (ex: "Morador alega que não reconhece o pacote e não pediu nada").
- Retorne EXCLUSIVAMENTE um objeto JSON válido, sem formatação markdown em volta:
{
  "intent": "CONFIRM_SCIENCE" | "AUTHORIZE_THIRD_PARTY" | "CONTEST_PACKAGE" | "REQUEST_CODE" | "UNRELATED",
  "confidence": 0.0 a 1.0,
  "reasoning": "breve explicação",
  "extractedCode": "código alfanumérico se o morador digitou, ou null",
  "thirdPartyName": "Nome da pessoa se for AUTHORIZE_THIRD_PARTY, ou null",
  "thirdPartyRelation": "Grau de parentesco ou vínculo se houver, ou null",
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
      .replace(/👍/g, ' emoji_positivo ')
      .replace(/👌/g, ' emoji_positivo ')
      .replace(/✅/g, ' emoji_positivo ')
      .replace(/🆗/g, ' emoji_positivo ')
      .replace(/❤️/g, ' emoji_positivo ')
      .replace(/👏/g, ' emoji_positivo ')
      .replace(/🙌/g, ' emoji_positivo ')
      .replace(/📦/g, ' emoji_positivo ')
      .replace(/🙏/g, ' emoji_positivo ')
      .replace(/🫡/g, ' emoji_positivo ')
      .replace(/😊/g, ' emoji_positivo ')
      .replace(/😃/g, ' emoji_positivo ')
      .replace(/👎/g, ' emoji_negativo ')
      .replace(/❌/g, ' emoji_negativo ')
      .replace(/🚫/g, ' emoji_negativo ')
      .replace(/🛑/g, ' emoji_negativo ')
      .replace(/⛔/g, ' emoji_negativo ')
      .replace(/😡/g, ' emoji_negativo ')
      .replace(/😠/g, ' emoji_negativo ')
      .replace(/🤷/g, ' emoji_negativo ')
      .replace(/[^\w\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Inicializa o cache com os padrões já salvos no SQLite e semeia padrões base se vazio ou incompleto.
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

      // Garante que todos os padrões fundamentais estejam sempre presentes no cache e banco
      this.seedInitialPatterns();

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
      // 1. Confirmação de Ciência / Prontidão de Retirada ("sim", "ok", "show", "beleza", "já vou buscar")
      { key: 'sim', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação simples de ciência' },
      { key: 'sim obrigado', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com agradecimento' },
      { key: 'sim obrigada', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com agradecimento' },
      { key: 'sim valeu', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com agradecimento' },
      { key: 'sim ciente', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com ciência expressa' },
      { key: 'sim ja vi', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com visualização confirmada' },
      { key: 'sim to sabendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação de ciência' },
      { key: 'sim to ciente', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação de ciência' },
      { key: 'sim pode mandar', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação autorizando envio' },
      { key: 'sim vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com retirada declarada' },
      { key: 'sim ja vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com retirada declarada' },
      { key: 'sim to descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'com certeza', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação enfática' },
      { key: 'positivo', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação expressa' },
      { key: 'isso', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação simples' },
      { key: 'isso mesmo', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'exato', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'claro', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'pode ser', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'certo', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'certinho', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'ok', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa monossilábica' },
      { key: 'ok obrigado', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa com agradecimento' },
      { key: 'ok obrigada', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa com agradecimento' },
      { key: 'ok valeu', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação com agradecimento' },
      { key: 'ok ciente', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação com ciência expressa' },
      { key: 'ok pode deixar', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'ok combinado', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'ok show', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'ok beleza', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'obrigado', intent: 'CONFIRM_SCIENCE', reasoning: 'Agradecimento de notificação' },
      { key: 'obrigada', intent: 'CONFIRM_SCIENCE', reasoning: 'Agradecimento de notificação' },
      { key: 'obrigado ja vi', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação com ciência expressa' },
      { key: 'obrigada ja vi', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação com ciência expressa' },
      { key: 'valeu', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação coloquial' },
      { key: 'vlw', intent: 'CONFIRM_SCIENCE', reasoning: 'Abreviação de valeu' },
      { key: 'obg', intent: 'CONFIRM_SCIENCE', reasoning: 'Abreviação de obrigado' },
      { key: 'show', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação positiva' },
      { key: 'show de bola', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação positiva' },
      { key: 'show beleza', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação positiva combinada' },
      { key: 'show ja vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação com prontidão de retirada' },
      { key: 'show beleza ja vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação completa de ciência e prontidão para retirada' },
      { key: 'beleza ja vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação de ciência e prontidão para retirada' },
      { key: 'beleza vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação de ciência e prontidão para retirada' },
      { key: 'beleza to descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'show to descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'beleza', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'blz', intent: 'CONFIRM_SCIENCE', reasoning: 'Abreviação de beleza' },
      { key: 'top', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação positiva' },
      { key: 'perfeito', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação de recebimento da mensagem' },
      { key: 'maravilha', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'joia', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
      { key: 'tranquilo', intent: 'CONFIRM_SCIENCE', reasoning: 'Confirmação afirmativa' },
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
      { key: 'ja vou retirar', intent: 'CONFIRM_SCIENCE', reasoning: 'Intenção de retirada imediata' },
      { key: 'estou descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'to descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'tô descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'ja to descendo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador a caminho da portaria' },
      { key: 'ja pego', intent: 'CONFIRM_SCIENCE', reasoning: 'Intenção de retirada' },
      { key: 'pego mais tarde', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência com retirada posterior' },
      { key: 'passo ai mais tarde', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência com retirada posterior' },
      { key: 'passo ai', intent: 'CONFIRM_SCIENCE', reasoning: 'Ciência com retirada posterior' },
      { key: 'pode deixar', intent: 'CONFIRM_SCIENCE', reasoning: 'Afirmação de responsabilidade de retirada' },
      { key: 'eu mesmo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador confirma retirada pessoal' },
      { key: 'eu mesma', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador confirma retirada pessoal' },
      { key: 'eu mesmo vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador confirma retirada pessoal' },
      { key: 'eu que vou buscar', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador confirma retirada pessoal' },
      { key: 'vou eu mesmo', intent: 'CONFIRM_SCIENCE', reasoning: 'Morador confirma retirada pessoal' },
      { key: 'minha esposa vai retirar', intent: 'AUTHORIZE_THIRD_PARTY', reasoning: 'Terceiro autorizado para retirada' },
      { key: 'meu marido vai retirar', intent: 'AUTHORIZE_THIRD_PARTY', reasoning: 'Terceiro autorizado para retirada' },
      { key: 'meu filho vai buscar', intent: 'AUTHORIZE_THIRD_PARTY', reasoning: 'Terceiro autorizado para retirada' },
      { key: 'minha filha vai buscar', intent: 'AUTHORIZE_THIRD_PARTY', reasoning: 'Terceiro autorizado para retirada' },
      { key: 'pode entregar para terceiro', intent: 'AUTHORIZE_THIRD_PARTY', reasoning: 'Terceiro autorizado para retirada' },
      { key: 'emoji_positivo', intent: 'CONFIRM_SCIENCE', reasoning: 'Emoji positivo de confirmação de ciência' },

      // 2. Contestação de Encomenda / Não Ciência ("não", "não é meu", "não reconheço")
      { key: 'nao', intent: 'CONTEST_PACKAGE', reasoning: 'Negação direta simples' },
      { key: 'não', intent: 'CONTEST_PACKAGE', reasoning: 'Negação direta simples' },
      { key: 'negativo', intent: 'CONTEST_PACKAGE', reasoning: 'Negação expressa' },
      { key: 'nao e meu', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que pacote não pertence a ele' },
      { key: 'nao e minha', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que pacote não pertence a ele' },
      { key: 'nao eh meu', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que pacote não pertence a ele' },
      { key: 'nao eh minha', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que pacote não pertence a ele' },
      { key: 'nao e meu nao', intent: 'CONTEST_PACKAGE', reasoning: 'Negação enfática' },
      { key: 'nao tenho ciencia', intent: 'CONTEST_PACKAGE', reasoning: 'Morador declara não ter ciência da encomenda' },
      { key: 'nao tenho ciencia disso', intent: 'CONTEST_PACKAGE', reasoning: 'Morador declara não ter ciência da encomenda' },
      { key: 'nao to ciente', intent: 'CONTEST_PACKAGE', reasoning: 'Morador declara não ter ciência da encomenda' },
      { key: 'nao pedi nada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador alega que não realizou nenhum pedido' },
      { key: 'nao comprei nada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador alega que não comprou nada' },
      { key: 'nao comprei', intent: 'CONTEST_PACKAGE', reasoning: 'Morador alega que não comprou' },
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
      { key: 'apartamento errado', intent: 'CONTEST_PACKAGE', reasoning: 'Apartamento incorreto' },
      { key: 'nao fiz a retirada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que não fez a retirada da encomenda' },
      { key: 'nao fiz retirada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador contesta retirada da encomenda' },
      { key: 'nao retirei', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que não retirou o pacote' },
      { key: 'nao peguei', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que não pegou o pacote' },
      { key: 'nao fui eu que retirei', intent: 'CONTEST_PACKAGE', reasoning: 'Morador afirma que outra pessoa retirou indevidamente' },
      { key: 'nao fui eu quem retirou', intent: 'CONTEST_PACKAGE', reasoning: 'Morador contesta a retirada' },
      { key: 'contestacao de retirada', intent: 'CONTEST_PACKAGE', reasoning: 'Contestação formal de retirada pelo morador' },
      { key: 'nao retirei nada', intent: 'CONTEST_PACKAGE', reasoning: 'Morador contesta retirada' },
      { key: 'alguem pegou por engano', intent: 'CONTEST_PACKAGE', reasoning: 'Morador suspeita de entrega indevida a terceiro' },
      { key: 'emoji_negativo', intent: 'CONTEST_PACKAGE', reasoning: 'Emoji negativo contestando encomenda' },

      // 3. Pedidos de Código / QR Code ("me manda aí", "qual o código", "manda o link")
      { key: 'beleza me manda ai', intent: 'REQUEST_CODE', reasoning: 'Morador confirma e solicita envio do código' },
      { key: 'me manda ai', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do código' },
      { key: 'manda ai', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do código' },
      { key: 'manda ae', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do código' },
      { key: 'manda pra mim', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do código' },
      { key: 'manda o link', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do link' },
      { key: 'me manda o link', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do link' },
      { key: 'pode mandar', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do código' },
      { key: 'manda o qr', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do QR Code' },
      { key: 'passa o codigo', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do código' },
      { key: 'passa o link', intent: 'REQUEST_CODE', reasoning: 'Morador solicita envio do link' },
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
      const existing = this.memoryCache.get(normKey);
      if (!existing || existing.intent !== seed.intent) {
        this.memoryCache.set(normKey, {
          intent: seed.intent,
          confidence: 0.98,
          reasoning: seed.reasoning,
          hits: existing?.hits || 1
        });
        databaseService.saveLearnedPattern(normKey, seed.intent, 0.98, seed.reasoning, 'system_seed');
      }
    }
  }

  /**
   * Classifica a intenção de forma inteligente com otimizações:
   * 1. Cache de Aprendizado Contínuo (0ms, 0 chamadas de API).
   * 2. Rotação Round-Robin entre Groq, Gemini e NVIDIA para equilibrar cotas.
   * 3. Circuit Breaker contra limites de taxa (HTTP 429 / RESOURCE_EXHAUSTED).
   * 4. Multi-tier Fallback Resiliente caso todas as APIs excedam ou fiquem offline:
   *    - Tier 1: Segue com o que já foi aprendido com as IAs (matching flexível por trecho/tokens).
   *    - Tier 2: Modo Consciente Heurístico (compreende "sim", "não", "ok", "show", "beleza", "já vou buscar", etc.).
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

    // ── ETAPA 1: VERIFICAÇÃO NO CACHE DE APRENDIZADO (0ms, 0 chamadas de API) ──
    const cached = this.checkLearnedCache(normalized, trimmed);
    if (cached) {
      console.log(`⚡ [AIIntent: CACHE] Padrão "${normalized}" já aprendido! [${cached.intent}] (Hits: ${cached.hits})`);
      const extractedThirdParty = cached.intent === 'AUTHORIZE_THIRD_PARTY' ? this.extractThirdParty(trimmed, normalized) : null;
      return {
        intent: cached.intent,
        confidence: cached.confidence,
        reasoning: `Padrão aprendido previamente (${cached.reasoning})`,
        extractedCode: extractedCode || null,
        thirdPartyName: extractedThirdParty?.name || null,
        thirdPartyRelation: extractedThirdParty?.relation || null,
        conciergeAlert:
          cached.intent === 'CONTEST_PACKAGE'
            ? `Morador informou no WhatsApp: "${trimmed}"`
            : null,
        source: 'learned_cache'
      };
    }

    // ── ETAPA 2: ROTAÇÃO INTELIGENTE (GROQ / GEMINI / NVIDIA) ──────────────
    const rotatedProviders = this.getRotatedProviders();
    if (rotatedProviders.length > 0) {
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
          // Garante extração de nome do terceiro caso a LLM não tenha retornado o campo
          if (result.intent === 'AUTHORIZE_THIRD_PARTY' && !result.thirdPartyName) {
            const fallbackThird = this.extractThirdParty(trimmed, normalized);
            if (fallbackThird) {
              result.thirdPartyName = fallbackThird.name;
              result.thirdPartyRelation = fallbackThird.relation || result.thirdPartyRelation;
            }
          }

          // Se a IA classificou com alta confiança e a mensagem é concisa, aprende o padrão
          if (result.confidence >= 0.8 && normalized.length <= 120) {
            this.learnPattern(normalized, result.intent, result.confidence, result.reasoning);
          }
          return result;
        }
      }
    }

    // ── ETAPA 3: NENHUMA IA DISPONÍVEL OU TODAS FALHARAM ───────────────────────
    // Requisito do usuário:
    // "se nada das ias funcionar nas mensagens deve seguir o processo com oque ja aprendeu com as ias
    // e se nn tiver aprendido nada ainda siga do modo mais consiente entendendo o sim o não o ok ou o show beleza ja vou buscar"
    console.warn(`🛡️ [AIIntent] Nenhuma IA disponível ou todas falharam. Verificando o que já foi aprendido com as IAs...`);

    // 3.1: Verifica se casa com qualquer padrão previamente aprendido pelas IAs
    const learnedFallback = this.findLearnedPatternFlexible(normalized);
    if (learnedFallback) {
      console.log(`🧠 [AIIntent: APRENDIZADO IA OFFLINE] Intenção identificada via aprendizado prévio das IAs: "${learnedFallback.matchedKey}" -> ${learnedFallback.item.intent} (Hits: ${learnedFallback.item.hits})`);
      const extractedThirdParty = learnedFallback.item.intent === 'AUTHORIZE_THIRD_PARTY' ? this.extractThirdParty(trimmed, normalized) : null;
      return {
        intent: learnedFallback.item.intent,
        confidence: Math.max(learnedFallback.item.confidence, 0.94),
        reasoning: `[Aprendizado Prévio das IAs] Reconhecido padrão "${learnedFallback.matchedKey}" (${learnedFallback.item.reasoning})`,
        extractedCode: extractedCode || null,
        thirdPartyName: extractedThirdParty?.name || null,
        thirdPartyRelation: extractedThirdParty?.relation || null,
        conciergeAlert:
          learnedFallback.item.intent === 'CONTEST_PACKAGE'
            ? `Morador informou no WhatsApp: "${trimmed}"`
            : null,
        source: 'learned_cache'
      };
    }

    // 3.2: Se não aprendeu nada ainda para essa expressão, segue no MODO CONSCIENTE Heurístico
    console.log(`🧭 [AIIntent: MODO CONSCIENTE] Expressão inédita não aprendida ainda. Analisando pelo motor consciente local ("sim", "não", "ok", "show", "beleza", "já vou buscar")...`);
    const consciousResult = this.classifyConsciousHeuristic(trimmed, options?.quotedText);

    // Grava o padrão reconhecido conscientemente para expandir a base aprendida
    if (normalized.length <= 120 && consciousResult.confidence >= 0.88) {
      this.learnPattern(normalized, consciousResult.intent, consciousResult.confidence, consciousResult.reasoning);
    }

    return {
      ...consciousResult,
      reasoning: `[Modo Consciente Local] ${consciousResult.reasoning}`
    };
  }

  /**
   * Consulta o cache em memória procurando correspondência exata ou por trecho chave flexível.
   */
  private checkLearnedCache(normalized: string, rawText: string): LearnedPatternItem | null {
    // 1. Busca exata pela frase normalizada
    const exact = this.memoryCache.get(normalized);
    if (exact) {
      exact.hits += 1;
      databaseService.incrementPatternHits(normalized);
      return exact;
    }

    // 2. Busca flexível nos padrões já aprendidos (se o morador mandar frase contendo expressão aprendida)
    const flexible = this.findLearnedPatternFlexible(normalized);
    if (flexible) {
      return flexible.item;
    }

    return null;
  }

  /**
   * Busca inteligente e flexível nos padrões já aprendidos pelas IAs.
   * Se a mensagem contiver expressões aprendidas anteriormente, aplica a intenção correspondente.
   * Ordem de prioridade estrita de segurança:
   * 1. Contestação de Encomenda (CONTEST_PACKAGE) - Sempre tem prioridade máxima
   * 2. Pedido de Código / QR Code (REQUEST_CODE)
   * 3. Confirmação / Ciência / Prontidão (CONFIRM_SCIENCE) - Somente se não houver negações
   * 4. Assuntos diversos do condomínio (UNRELATED)
   */
  public findLearnedPatternFlexible(normalized: string): { matchedKey: string; item: LearnedPatternItem } | null {
    // 1. Correspondência exata direta
    const exact = this.memoryCache.get(normalized);
    if (exact) {
      exact.hits += 1;
      databaseService.incrementPatternHits(normalized);
      return { matchedKey: normalized, item: exact };
    }

    // 2. Agrupa os padrões aprendidos por intenção
    const contestationPatterns: Array<{ key: string; item: LearnedPatternItem }> = [];
    const requestCodePatterns: Array<{ key: string; item: LearnedPatternItem }> = [];
    const thirdPartyPatterns: Array<{ key: string; item: LearnedPatternItem }> = [];
    const confirmPatterns: Array<{ key: string; item: LearnedPatternItem }> = [];
    const unrelatedPatterns: Array<{ key: string; item: LearnedPatternItem }> = [];

    for (const [key, item] of this.memoryCache.entries()) {
      if (item.intent === 'CONTEST_PACKAGE') contestationPatterns.push({ key, item });
      else if (item.intent === 'REQUEST_CODE') requestCodePatterns.push({ key, item });
      else if (item.intent === 'AUTHORIZE_THIRD_PARTY') thirdPartyPatterns.push({ key, item });
      else if (item.intent === 'CONFIRM_SCIENCE') confirmPatterns.push({ key, item });
      else if (item.intent === 'UNRELATED') unrelatedPatterns.push({ key, item });
    }

    const matchesPattern = (patternKey: string) => {
      if (!patternKey || patternKey.length < 2) return false;
      if (patternKey.length >= 4) {
        return normalized.includes(patternKey);
      }
      // Para chaves curtas (ex: "ok", "sim", "nao", "blz"), exige limite de palavras para evitar falsos positivos
      const escaped = patternKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
      return regex.test(normalized);
    };

    // 2.1 PRIORIDADE 1: CONTESTAÇÃO (Ex: "nao e meu", "nao pedi nada", "veio errado")
    contestationPatterns.sort((a, b) => b.key.length - a.key.length);
    for (const p of contestationPatterns) {
      if (matchesPattern(p.key)) {
        p.item.hits += 1;
        databaseService.incrementPatternHits(p.key);
        return { matchedKey: p.key, item: p.item };
      }
    }

    // 2.2 PRIORIDADE 2: PEDIDOS DE CÓDIGO / QR CODE (Ex: "manda ai", "passa o codigo")
    requestCodePatterns.sort((a, b) => b.key.length - a.key.length);
    for (const p of requestCodePatterns) {
      if (matchesPattern(p.key)) {
        p.item.hits += 1;
        databaseService.incrementPatternHits(p.key);
        return { matchedKey: p.key, item: p.item };
      }
    }

    // 2.3 PRIORIDADE 3: AUTORIZAÇÃO DE TERCEIRO / CONFIRMAÇÃO DE CIÊNCIA
    // Se a mensagem contiver negações suspeitas (ex: "nao e meu ok"), NÃO casa como confirmação
    const hasSuspectNegation = /\b(nao|não|nem|nunca|errado|engano|rejeit|recus)\b/i.test(normalized);
    if (!hasSuspectNegation) {
      thirdPartyPatterns.sort((a, b) => b.key.length - a.key.length);
      for (const p of thirdPartyPatterns) {
        if (matchesPattern(p.key)) {
          p.item.hits += 1;
          databaseService.incrementPatternHits(p.key);
          return { matchedKey: p.key, item: p.item };
        }
      }

      confirmPatterns.sort((a, b) => b.key.length - a.key.length);
      for (const p of confirmPatterns) {
        if (matchesPattern(p.key)) {
          p.item.hits += 1;
          databaseService.incrementPatternHits(p.key);
          return { matchedKey: p.key, item: p.item };
        }
      }
    }

    // 2.4 PRIORIDADE 4: NÃO RELACIONADO
    unrelatedPatterns.sort((a, b) => b.key.length - a.key.length);
    for (const p of unrelatedPatterns) {
      if (p.key.length >= 4 && matchesPattern(p.key)) {
        p.item.hits += 1;
        databaseService.incrementPatternHits(p.key);
        return { matchedKey: p.key, item: p.item };
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

  /**
   * Extrai com alta precisão o nome e o grau de parentesco / relação
   * de frases em português que indicam a retirada por terceiro.
   */
  public extractThirdParty(rawText: string, normalizedText?: string): { name: string; relation: string | null } | null {
    const raw = rawText.trim();
    const norm = (normalizedText || AIIntentService.normalize(raw)).trim();

    // Se o morador disse expressamente que é ele mesmo, não é terceiro
    if (/\b(eu mesmo|eu mesma|eu proprio|eu propria|vou eu|eu que vou|eu quem vou|pessoalmente)\b/i.test(norm)) {
      return null;
    }

    const relationKeywords = [
      'esposa', 'esposo', 'marido', 'filho', 'filha', 'mae', 'mãe', 'pai',
      'irmao', 'irmão', 'irma', 'irmã', 'sobrinho', 'sobrinha', 'primo', 'prima',
      'tio', 'tia', 'namorado', 'namorada', 'noivo', 'noiva', 'sogro', 'sogra',
      'cunhado', 'cunhada', 'diarista', 'secretaria', 'secretária', 'vizinho',
      'vizinha', 'amigo', 'amiga', 'porteiro', 'zelador', 'faxineira', 'terceiro'
    ];

    const cleanName = (str: string): string => {
      let cleaned = str
        .replace(/^(?:o|a|os|as|meu|minha|o meu|a minha|um|uma|sr|sra|dona|seu)\s+/i, '')
        .replace(/\b(?:vai|que vai|pode|pra|para|buscar|retirar|pegar|hoje|depois|mais tarde|a tarde|amanha|amanhã|ok|obrigado|obrigada|valeu|por favor)\b.*/gi, '')
        .replace(/[^\w\sÀ-ÿ]/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return cleaned
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    };

    // Padrão 1: "Quem vai buscar é minha esposa Maria" / "Quem vai pegar é o Carlos"
    const quemVaiRegex = /\bquem vai (?:buscar|retirar|pegar|descer)\s+(?:e|eh|é)\s+(?:o|a|meu|minha|o meu|a minha)?\s*([a-zA-ZÀ-ÿ\s]+)/i;
    const matchQuem = raw.match(quemVaiRegex);
    if (matchQuem && matchQuem[1]) {
      let captured = matchQuem[1].trim();
      let foundRelation: string | null = null;
      let nameCandidate = captured;

      for (const rel of relationKeywords) {
        const relRegex = new RegExp(`^${rel}\\s+`, 'i');
        if (relRegex.test(nameCandidate)) {
          foundRelation = rel.toLowerCase();
          nameCandidate = nameCandidate.replace(relRegex, '');
          break;
        } else if (new RegExp(`^${rel}$`, 'i').test(nameCandidate)) {
          foundRelation = rel.toLowerCase();
          nameCandidate = rel.charAt(0).toUpperCase() + rel.slice(1).toLowerCase();
          break;
        }
      }

      const finalName = cleanName(nameCandidate);
      if (finalName && finalName.length >= 2) {
        return {
          name: finalName,
          relation: foundRelation
        };
      }
    }

    // Padrão 2: "Pode entregar para o Carlos" / "Pode liberar pro João da Silva" / "Autorizo a Maria"
    const entregaParaRegex = /\b(?:pode entregar|entrega|pode liberar|libera|liberado|autorizo|autorizado|autoriza)\s+(?:para|pro|pra|ao|a)?\s+(?:o|a|meu|minha)?\s*([a-zA-ZÀ-ÿ\s]+)/i;
    const matchEntrega = raw.match(entregaParaRegex);
    if (matchEntrega && matchEntrega[1]) {
      let captured = matchEntrega[1].trim();
      let foundRelation: string | null = null;

      for (const rel of relationKeywords) {
        const relRegex = new RegExp(`^${rel}\\s+`, 'i');
        if (relRegex.test(captured)) {
          foundRelation = rel.toLowerCase();
          captured = captured.replace(relRegex, '');
          break;
        } else if (new RegExp(`^${rel}$`, 'i').test(captured)) {
          foundRelation = rel.toLowerCase();
          captured = rel.charAt(0).toUpperCase() + rel.slice(1).toLowerCase();
          break;
        }
      }

      const finalName = cleanName(captured);
      if (finalName && finalName.length >= 2) {
        return {
          name: finalName,
          relation: foundRelation || 'autorizado'
        };
      }
    }

    // Padrão 3: "Minha esposa Maria vai buscar" / "Meu filho Pedro vai retirar" / "A diarista Solange vai pegar"
    const relacaoVaiRegex = new RegExp(
      `\\b(?:meu|minha|o|a)?\\s*(${relationKeywords.join('|')})\\s+([a-zA-ZÀ-ÿ\\s]+?)\\s+(?:vai|que vai|pode)\\s+(?:buscar|retirar|pegar)`,
      'i'
    );
    const matchRelacao = raw.match(relacaoVaiRegex);
    if (matchRelacao && matchRelacao[1] && matchRelacao[2]) {
      const rel = matchRelacao[1].toLowerCase();
      const finalName = cleanName(matchRelacao[2]);
      if (finalName && finalName.length >= 2) {
        return {
          name: finalName,
          relation: rel
        };
      }
    }

    // Padrão 4: "Minha esposa vai retirar" / "Meu filho vai buscar" (sem nome próprio explícito)
    const relacaoSozinhaRegex = new RegExp(
      `\\b(?:meu|minha|o|a)\\s+(${relationKeywords.join('|')})\\s+(?:vai|que vai|pode)\\s+(?:buscar|retirar|pegar)`,
      'i'
    );
    const matchRelacaoSozinha = raw.match(relacaoSozinhaRegex);
    if (matchRelacaoSozinha && matchRelacaoSozinha[1]) {
      const rel = matchRelacaoSozinha[1].toLowerCase();
      return {
        name: rel.charAt(0).toUpperCase() + rel.slice(1).toLowerCase(),
        relation: rel
      };
    }

    // Padrão 5: "Vou pedir pro meu irmão Pedro buscar" / "Vou pedir para o Carlos retirar"
    const pedirRegex = /\b(?:vou pedir|pedi|vou mandar|mandei)\s+(?:para|pro|pra|ao|a)\s+(?:o|a|meu|minha)?\s*([a-zA-ZÀ-ÿ\s]+?)\s+(?:buscar|retirar|pegar)/i;
    const matchPedir = raw.match(pedirRegex);
    if (matchPedir && matchPedir[1]) {
      let captured = matchPedir[1].trim();
      let foundRelation: string | null = null;
      for (const rel of relationKeywords) {
        const relRegex = new RegExp(`^${rel}\\s+`, 'i');
        if (relRegex.test(captured)) {
          foundRelation = rel.toLowerCase();
          captured = captured.replace(relRegex, '');
          break;
        }
      }
      const finalName = cleanName(captured);
      if (finalName && finalName.length >= 2) {
        return {
          name: finalName,
          relation: foundRelation
        };
      }
    }

    return null;
  }

  /**
   * Motor Heurístico Consciente Local (0ms, 100% offline, resiliente a qualquer falha de IA).
   * Processa a linguagem natural brasileira entendendo profundamente nuances de:
   * - Retirada Pessoal: "eu mesmo", "eu mesma", "vou eu"
   * - Terceiros: "quem vai buscar é minha esposa Maria", "pode entregar pro Carlos"
   * - O "SIM": confirmações, ciências e acordos ("sim", "sim por favor", "com certeza", "positivo", etc.)
   * - O "NÃO": contestações, recusas e não-reconhecimento ("não", "não é meu", "não pedi nada", "veio errado", etc.)
   * - O "OK": confirmações simples e educadas ("ok", "ok obrigado", "ok combinado", etc.)
   * - O "SHOW", "BELEZA", "JÁ VOU BUSCAR": confirmações coloquiais e prontidão para retirada
   * - Pedidos de Código / QR Code: "me manda aí", "manda aí", "qual o código", "manda o link", etc.
   */
  public classifyConsciousHeuristic(text: string, quotedText?: string): AIIntentResult {
    const trimmed = text.trim();
    const normalized = AIIntentService.normalize(trimmed);
    const extractedCode = this.extractCode(text);

    // ── 1. CONTESTAÇÃO / NÃO RECONHECIMENTO (PRIORIDADE MÁXIMA) ───────────────
    // Se o morador contestar, negações SEMPRE sobrepõem qualquer termo afirmativo (ex: "não é meu ok", "não comprei show").
    const contestationPhrasesRegex = /\b(nao (e|eh) (meu|minha|daqui|nosso|nossa)|nao pedi( nada)?|nao comprei( nada)?|nao fiz pedido|nao encomendei|nao tenho ciencia|nao to ciente|nao estou ciente|nao reconheco|nao conheco|nao sou eu|destinatario errado|encomenda errada|pacote errado|veio errad[ao]|deve ser engano|engano|numero errado|apto errado|apartamento errado|bloco errado|nao estou esperando( nada)?|nao to esperando|devolver|rejeitar|recusar|nao autorizo|nao quero|nao e pra mim|nao eh pra mim)\b/i;

    const isolatedNoRegex = /^(nao|não|n|negativo|nem|nunca|nem a pau|acho que nao|acho que não)$/i;

    const negativeEmojiRegex = /(👎|❌|🛑|⛔|🚫|😡|😠|🤷|emoji_negativo)/;

    if (
      contestationPhrasesRegex.test(normalized) ||
      isolatedNoRegex.test(normalized) ||
      negativeEmojiRegex.test(text) ||
      normalized.includes('emoji_negativo')
    ) {
      return {
        intent: 'CONTEST_PACKAGE',
        confidence: 0.98,
        reasoning: 'Motor consciente detectou contestação/não reconhecimento da encomenda ("não", "não é meu", etc.)',
        extractedCode: null,
        conciergeAlert: `Morador contestou a encomenda no WhatsApp: "${trimmed}"`,
        source: 'heuristic'
      };
    }

    // ── 2. RETIRADA PESSOAL DECLARADA ("EU MESMO", "EU MESMA", "VOU EU") ──
    const selfPickupRegex = /\b(eu mesmo|eu mesma|eu proprio|eu propria|vou eu|eu que vou|eu quem vou|retirada pessoal|pego pessoalmente|vou retirar pessoalmente)\b/i;
    if (selfPickupRegex.test(normalized)) {
      return {
        intent: 'CONFIRM_SCIENCE',
        confidence: 0.98,
        reasoning: 'Morador confirmou retirada pessoal ("eu mesmo")',
        extractedCode,
        source: 'heuristic'
      };
    }

    // ── 3. AUTORIZAÇÃO DE RETIRADA POR TERCEIRO ("QUEM VAI BUSCAR É MINHA ESPOSA MARIA", "PODE ENTREGAR PRO CARLOS") ──
    const thirdParty = this.extractThirdParty(trimmed, normalized);
    if (thirdParty && thirdParty.name) {
      return {
        intent: 'AUTHORIZE_THIRD_PARTY',
        confidence: 0.97,
        reasoning: `Morador autorizou retirada por terceiro: ${thirdParty.name}${thirdParty.relation ? ` (${thirdParty.relation})` : ''}`,
        extractedCode,
        thirdPartyName: thirdParty.name,
        thirdPartyRelation: thirdParty.relation || null,
        source: 'heuristic'
      };
    }

    // ── 4. PEDIDO DE CÓDIGO / QR CODE ───────────────────────────────────────
    const codeRequestRegex = /\b(qual (o |meu )?cod(?:igo)?|manda (o |o link do )?(qr\s?code|cod(?:igo)?)|(me )?manda (ai|ae|o link|o codigo|o qr|os dados|pra mim)|perdi (o |meu )?(qr\s?code|cod(?:igo)?)|link (da encomenda|do qr\s?code|de retirada)|cade o (qr\s?code|codigo)|como (retiro|pego|faco pra pegar)|passa o (codigo|link|qr)|pode mandar|me passa)\b/i;

    if (codeRequestRegex.test(normalized)) {
      return {
        intent: 'REQUEST_CODE',
        confidence: 0.96,
        reasoning: 'Motor consciente detectou solicitação do código/QR Code de retirada ("me manda aí", "qual o código")',
        extractedCode,
        source: 'heuristic'
      };
    }

    // ── 3. RESPOSTA DIRETA CITANDO NOTIFICAÇÃO (QUOTED TEXT) ────────────────
    if (quotedText) {
      const normQuoted = quotedText.toLowerCase();
      const isQuotingPackage =
        normQuoted.includes('encomenda') ||
        normQuoted.includes('retirada') ||
        normQuoted.includes('codigo') ||
        normQuoted.includes('condobox') ||
        normQuoted.includes('portaria');
      if (isQuotingPackage && trimmed.length <= 50) {
        return {
          intent: 'CONFIRM_SCIENCE',
          confidence: 0.95,
          reasoning: 'Resposta afirmativa citando a notificação da encomenda',
          extractedCode,
          source: 'heuristic'
        };
      }
    }

    // ── 4. AFIRMAÇÕES CONSCIENTES ("SIM", "OK", "SHOW", "BELEZA", "JÁ VOU BUSCAR") ──
    // 4.1 O "SIM" isolado ou com complementos afirmativos
    const isolatedYesRegex = /^(sim|s|simm+|sim sim|positivo|isso|isso mesmo|exato|exatamente|claro|claro que sim|com certeza|com toda certeza|perfeito|certinho|certo)$/i;
    const affirmativeYesRegex = /\b(sim por favor|sim obrigado|sim obrigada|sim valeu|sim ciente|sim ja vi|sim to sabendo|sim tô sabendo|sim pode mandar|sim vou buscar|sim estou descendo|sim to descendo|sim senhor|sim senhora|sim claro|sim com certeza|pode ser|pode mandar|pode sim)\b/i;

    // 4.2 O "OK" isolado ou com complementos
    const isolatedOkRegex = /^(ok|okk+|okey|okay|ok ok|ok!+|ok\s*👍)$/i;
    const affirmativeOkRegex = /\b(ok obrigado|ok obrigada|ok valeu|ok vlw|ok obg|ok ciente|ok to ciente|ok pode deixar|ok ja vi|ok combinado|ok show|ok beleza|tudo bem|combinado|fechado|otimo|ótimo)\b/i;

    // 4.3 O "SHOW", "BELEZA", "JÁ VOU BUSCAR" e prontidão para retirada
    const readinessAndAffirmationRegex = /\b(show|showw+|show de bola|showzaco|top|maravilha|joia|jóia|massa|beleza|blz|blzz+|belezura|tranquilo|tranks|ja vou buscar|já vou buscar|vou buscar|ja busco|já busco|busco ja|busco já|vou la buscar|vou lá buscar|vou retirar|ja vou retirar|já vou retirar|ja retiro|já retiro|vou la retirar|vou lá retirar|ja vou pegar|já vou pegar|vou pegar|ja pego|já pego|pego ja|pego já|pego mais tarde|logo busco|passo ai|passo aí|logo mais passo ai|logo mais passo aí|daqui a pouco busco|daqui a pouco eu pego|to descendo|tô descendo|estou descendo|ja estou descendo|já estou descendo|ja to descendo|já tô descendo|vou descer|ja vou descer|já vou descer|ja desco|já desço|descendo ja|descendo já|descendo|estou indo|to indo|tô indo|ja to indo|já tô indo|indo buscar|a caminho|indo ai|indo aí|pode deixar|pode deixar que pego|pode deixar que busco|deixa comigo|ciente|estou ciente|to ciente|tô ciente|ta ciente|tá ciente|confirmado|confirmo|confirmar|confirmada|recebido|recebi|entendido|entendi|obrigad[ao]|valeu|vlw|obg|agradecid[ao]|gratidao)\b/i;

    // 4.4 Emojis afirmativos
    const ackEmojiRegex = /(👍|👌|📦|✅|🆗|🤝|🙏|😊|😃|🙌|👏|🫡|emoji_positivo)/;

    const isAffirmative =
      isolatedYesRegex.test(normalized) ||
      affirmativeYesRegex.test(normalized) ||
      isolatedOkRegex.test(normalized) ||
      affirmativeOkRegex.test(normalized) ||
      readinessAndAffirmationRegex.test(normalized) ||
      ackEmojiRegex.test(text) ||
      normalized.includes('emoji_positivo');

    if (isAffirmative || extractedCode) {
      return {
        intent: 'CONFIRM_SCIENCE',
        confidence: 0.95,
        reasoning: extractedCode
          ? 'Código de retirada informado'
          : 'Motor consciente reconheceu confirmação de ciência / prontidão para retirada ("sim", "ok", "show", "beleza", "já vou buscar")',
        extractedCode,
        source: 'heuristic'
      };
    }

    // ── 5. ASSUNTOS CONDOMINIAIS DIVERSOS ────────────────────────────────────
    const unrelatedCondoRegex = /\b(vaga|garagem|estacionamento|boleto|cota condominial|taxa|segunda via|sindico|sindica|administradora|administracao|interfone|portao|fechadura|chaveiro|chave|barulho|vizinho|som alto|lixo|reciclagem|elevador|vazamento|infiltracao|cano|agua|luz|visita|visitante|prestador|uber|ifood|pizza|entregador|mudanca|salao|churrasqueira|piscina|academia)\b/i;

    if (unrelatedCondoRegex.test(normalized)) {
      return {
        intent: 'UNRELATED',
        confidence: 0.95,
        reasoning: 'Regra consciente detectou assunto condominial sem relação com encomenda',
        extractedCode: null,
        source: 'heuristic'
      };
    }

    // ── 6. PERGUNTAS GERAIS OU SAUDAÇÕES ─────────────────────────────────────
    if (text.includes('?')) {
      return {
        intent: 'UNRELATED',
        confidence: 0.9,
        reasoning: 'Pergunta geral para a portaria',
        extractedCode: null,
        source: 'heuristic'
      };
    }

    // ── 7. CASUAL / DESCONHECIDO ─────────────────────────────────────────────
    return {
      intent: 'UNRELATED',
      confidence: 0.9,
      reasoning: 'Mensagem casual ou assunto não relacionado a confirmação de encomenda',
      extractedCode: null,
      source: 'heuristic'
    };
  }

  /**
   * Alias para retrocompatibilidade com chamadas anteriores.
   */
  public classifyHeuristic(text: string, quotedText?: string): AIIntentResult {
    return this.classifyConsciousHeuristic(text, quotedText);
  }

  public extractCode(text: string): string | null {
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
        if (rawIntent.includes('THIRD') || rawIntent.includes('TERCEIRO') || rawIntent.includes('AUTHORIZE')) {
          intent = 'AUTHORIZE_THIRD_PARTY';
        } else if (rawIntent.includes('CONFIRM') || rawIntent.includes('CIENCIA') || rawIntent.includes('SCIENCE')) {
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
          thirdPartyName: parsed.thirdPartyName || parsed.third_party_name || null,
          thirdPartyRelation: parsed.thirdPartyRelation || parsed.third_party_relation || null,
          conciergeAlert: parsed.conciergeAlert || parsed.concierge_alert || null
        };
      }

      // Se a IA responder em texto puro (ex: "CONFIRM_SCIENCE: o morador disse...")
      const upper = content.toUpperCase();
      let intent: AIIntentCategory | null = null;
      if (upper.includes('THIRD') || upper.includes('TERCEIRO') || upper.includes('AUTHORIZE')) {
        intent = 'AUTHORIZE_THIRD_PARTY';
      } else if (upper.includes('CONFIRM_SCIENCE') || upper.includes('CONFIRM')) {
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
          thirdPartyName: null,
          thirdPartyRelation: null,
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
