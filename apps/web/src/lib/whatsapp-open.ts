/**
 * Utilitário centralizado para abertura do WhatsApp em qualquer dispositivo (iOS, Android, Desktop).
 * 
 * Garante que:
 * 1. O app do WhatsApp seja aberto diretamente com a mensagem pré-pronta.
 * 2. Quando o usuário fechar o WhatsApp ou voltar ao navegador, o navegador retorne IMEDIATAMENTE
 *    para o site do CondoBox, SEM ficar preso na página intermediária 'api.whatsapp.com' do WhatsApp.
 * 3. Segue o padrão de funcionamento do botão de contestação ("Não fiz a retirada"), com suporte
 *    a deep linking nativo (Universal Link wa.me/{phone} ou esquema whatsapp://send).
 */

export interface OpenWhatsAppOptions {
  phone?: string | null;
  text: string;
}

export function getWhatsAppLink({ phone, text }: OpenWhatsAppOptions): string {
  const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
  const fullPhone = cleanPhone
    ? (cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`)
    : '';
  const encodedText = encodeURIComponent(text);

  if (fullPhone) {
    // Universal Link oficial com telefone (iOS e Android interceptam nativamente)
    return `https://wa.me/${fullPhone}?text=${encodedText}`;
  }

  // Sem telefone específico (ex: compartilhar com terceiro escolhendo o contato)
  if (typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
    // No mobile, o esquema nativo abre o app direto no seletor de contatos sem navegar a aba para api.whatsapp.com
    return `whatsapp://send?text=${encodedText}`;
  }

  return `https://wa.me/?text=${encodedText}`;
}

export function openWhatsApp({ phone, text }: OpenWhatsAppOptions): void {
  if (typeof window === 'undefined') return;

  const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
  const fullPhone = cleanPhone
    ? (cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`)
    : '';
  const encodedText = encodeURIComponent(text);

  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobile) {
    if (fullPhone) {
      // Abre direto via wa.me com número (Universal Link capturado pelo iOS/Android nativamente)
      // Usar window.location.href evita criar abas vazias órfãs no Safari/Chrome
      window.location.href = `https://wa.me/${fullPhone}?text=${encodedText}`;
    } else {
      // Protocolo nativo whatsapp://send: abre o app do WhatsApp direto no seletor de conversas
      // SEM redirecionar o navegador para a página web api.whatsapp.com!
      // Ao sair do WhatsApp, a aba do sistema CondoBox continua aberta exatamente onde estava.
      window.location.href = `whatsapp://send?text=${encodedText}`;
    }
  } else {
    // Desktop (PC/Mac): abre via wa.me
    const targetUrl = fullPhone
      ? `https://wa.me/${fullPhone}?text=${encodedText}`
      : `https://wa.me/?text=${encodedText}`;
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  }
}
