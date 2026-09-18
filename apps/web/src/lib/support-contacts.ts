/**
 * Contatos Oficiais de Suporte e Desbloqueio de Contas CondoBox
 * Telefones fornecidos para atendimento comercial, financeiro e suporte técnico.
 */

export interface SupportContact {
  id: string;
  label: string;
  display: string;
  raw: string;
  whatsappUrl: string;
  tel: string;
}

export const DEFAULT_EXPIRED_MESSAGE = 
  'Olá, o tempo de vigência da minha conta no CondoBox acabou. Preciso efetuar o pagamento e solicitar o desbloqueio do acesso.';

export function buildSupportWhatsAppUrl(phoneRaw: string, condoName?: string, condoId?: string): string {
  let message = DEFAULT_EXPIRED_MESSAGE;
  if (condoName) {
    message += `\n\nCondomínio: ${condoName}`;
  }
  if (condoId) {
    message += `\nID da Conta: ${condoId}`;
  }
  return `https://wa.me/${phoneRaw}?text=${encodeURIComponent(message)}`;
}

export function buildQuotaExceededWhatsAppUrl(
  phoneRaw: string,
  condoName?: string,
  currentUnits?: number,
  maxApartments?: number
): string {
  let message = `Olá! Nosso condomínio atingiu o limite máximo de ${maxApartments || 250} apartamentos permitidos no plano atual do CondoBox (${currentUnits || 0}/${maxApartments || 250} unidades cadastradas).`;
  if (condoName) {
    message += `\n\nCondomínio: ${condoName}`;
  }
  message += `\n\nGostaria de falar com o suporte comercial para solicitar o upgrade do plano e liberar a criação de novos apartamentos.`;
  return `https://wa.me/${phoneRaw}?text=${encodeURIComponent(message)}`;
}

export const SUPPORT_CONTACTS: SupportContact[] = [
  {
    id: 'support-73',
    label: 'Suporte & Atendimento (73)',
    display: '(73) 99841-9901',
    raw: '5573998419901',
    whatsappUrl: buildSupportWhatsAppUrl('5573998419901'),
    tel: 'tel:+5573998419901'
  },
  {
    id: 'support-21',
    label: 'Suporte & Atendimento (21)',
    display: '(21) 97196-6473',
    raw: '5521971966473',
    whatsappUrl: buildSupportWhatsAppUrl('5521971966473'),
    tel: 'tel:+5521971966473'
  }
];
