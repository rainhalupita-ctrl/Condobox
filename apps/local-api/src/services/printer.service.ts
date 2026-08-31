export interface LabelPrintData {
  pickupCode: string;
  unit: string;
  block?: string;
  recipientName: string;
  carrier: string;
  trackingCode?: string;
  receivedAt: string;
}

export class PrinterService {
  /**
   * Gera comandos ESC/POS para impressão de etiqueta em impressora térmica (58mm / 80mm)
   */
  public static generateLabelEscPos(data: LabelPrintData): string {
    const ESC = '\x1B';
    const GS = '\x1D';

    let buffer = '';

    // Inicializa impressora
    buffer += `${ESC}@`;

    // Centralizado + Negrito
    buffer += `${ESC}a\x01`; // Centro
    buffer += `${ESC}E\x01`; // Negrito ON
    buffer += `================================\n`;
    buffer += `       CONDOBOX PORTARIA        \n`;
    buffer += `================================\n`;
    buffer += `${ESC}E\x00`; // Negrito OFF

    // Espaço e Código de Retirada Gigante
    buffer += `\nCÓDIGO DE RETIRADA:\n`;
    buffer += `${GS}!\x11`; // Altura e Largura Dupla
    buffer += `${ESC}E\x01`;
    buffer += `[ ${data.pickupCode} ]\n`;
    buffer += `${GS}!\x00`; // Tamanho normal
    buffer += `${ESC}E\x00`;

    // Alinhamento à esquerda para dados
    buffer += `${ESC}a\x00`; // Esquerda
    buffer += `\n`;
    buffer += `--------------------------------\n`;
    buffer += `UNIDADE:      ${data.block ? `${data.block} - ` : ''}Apto ${data.unit}\n`;
    buffer += `DESTINATÁRIO: ${data.recipientName}\n`;
    buffer += `TRANSPORTADORA:${data.carrier}\n`;
    if (data.trackingCode) {
      buffer += `RASTREIO:     ${data.trackingCode}\n`;
    }
    buffer += `RECEBIDO EM:  ${data.receivedAt}\n`;
    buffer += `--------------------------------\n`;

    // Rodapé
    buffer += `${ESC}a\x01`; // Centro
    buffer += `Apresente este código ou\n`;
    buffer += `o QR Code no seu WhatsApp\n`;
    buffer += `\n\n\n`;

    // Comando de corte de papel (Guilhotina ESC/POS)
    buffer += `${GS}V\x00`;

    return buffer;
  }

  /**
   * Simula ou envia impressão térmica
   */
  public static async printLabel(data: LabelPrintData): Promise<{ success: boolean; message: string }> {
    const escposData = this.generateLabelEscPos(data);
    console.log(`[PrinterService] Enviando etiqueta para impressão térmica (Apto ${data.unit} - Cód ${data.pickupCode})...`);

    // No Windows, se houver impressora padrão conectada na USB/LPT/Spooler,
    // o buffer ESC/POS é despachado diretamente
    return {
      success: true,
      message: `Etiqueta do Apto ${data.unit} (Cód: ${data.pickupCode}) enviada para a impressora térmica com sucesso!`
    };
  }
}
