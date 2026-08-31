# 06. Extensões de Automação, Utilidades e Recursos Locais (JS + Python)

Agora que o **CondoBox** é um sistema desktop completo e independente (rodando localmente com Node.js e Electron), temos acesso direto ao hardware do computador, portas USB, sistema de arquivos do Windows, áudio e execução de scripts utilitários em **JavaScript (Node.js)** e **Python**.

Abaixo estão os módulos de alto valor selecionados para transformar o CondoBox em uma central inteligente de portaria.

---

## 🛠️ Recursos de Alto Valor Planejados

### 1. 🖨️ Módulo de Impressão Térmica de Etiquetas e Comprovantes (ESC/POS)
* **Objetivo**: Imprimir etiquetas adesivas térmicas para colar no pacote ou emitir comprovante físico de retirada (impressoras térmicas de 58mm e 80mm comuns em portarias, como Bematech, Elgin, Epson).
* **Tecnologia**: Node.js (`escpos` / `printer`) e script Python fallback.
* **Benefício**: O porteiro cadastra a encomenda e a impressora térmica cospe a etiqueta com o QR Code, Bloco/Apto e Código de Retirada instantaneamente, sem abrir caixa de diálogo do Windows.

---

### 2. 🔊 Alertas de Voz (Text-to-Speech) & Efeitos Sonoros de Portaria
* **Objetivo**: O computador fala em voz alta a confirmação do registro e da entrega:
  * *"Encomenda cadastrada com sucesso: Bloco A, Apartamento 805."*
  * *"QR Code validado. Encomenda entregue para Jhen."*
  * *"Atenção: Encomenda pendente há mais de 3 dias no Bloco B."*
* **Tecnologia**: Web Speech API nativa + script Python TTS (`pyttsx3`) offline sem custos.
* **Benefício**: Evita que o porteiro guarde a caixa na gaveta ou prateleira errada e agiliza a rotina com confirmação auditiva.

---

### 3. 📊 Gerador de Relatórios Executivos em PDF & Excel com Envio Automático
* **Objetivo**: Gerar relatórios periódicos de fluxo da portaria:
  * Quantidade de pacotes recebidos por dia/semana.
  * Tempo médio que as encomendas ficam guardadas na portaria antes da retirada.
  * Transportadoras mais frequentes (Mercado Livre, Amazon, Shopee, Correios).
  * Lista de encomendas esquecidas (+5 dias).
* **Automação**: Disparo automático do relatório em PDF semanal diretamente no WhatsApp do Síndico toda segunda-feira às 08:00.
* **Tecnologia**: Python (`reportlab` / `pandas` / `openpyxl`) e Node.js.

---

### 4. 💾 Backup Automático Diário do SQLite & Imagens
* **Objetivo**: Criar cópias de segurança compactadas (`.zip`) de todo o banco de dados `condobox.db` e das fotos de etiquetas e assinaturas.
* **Recursos**:
  * Backup agendado a cada 24 horas.
  * Opção de salvar em pasta local, pendrive USB conectado ou sincronizar com o Supabase Storage.
  * Função de restauração em 1 clique no Painel Administrativo.
* **Tecnologia**: Node.js (`archiver` / `fs`) e Python (`shutil` / `sqlite3`).

---

### 5. 🔍 Otimizador de Imagem & Tratamento de Etiquetas (OpenCV / Python)
* **Objetivo**: Aumentar drasticamente a assertividade do OCR do Gemini em fotos tiradas com pouca luz, borradas ou com ângulo inclinado.
* **Tecnologia**: Script Python opcional com `Pillow` / `OpenCV` (equalização de histograma, aumento de contraste e corte automático de bordas).

---

### 6. 🔫 Suporte Nativo a Leitores de Código de Barras / QR Code USB (Pistola Laser)
* **Objetivo**: Quando o porteiro usa um leitor USB de mão (pistola), o sistema captura o buffer de entrada (HID) automaticamente de qualquer tela e abre a encomenda correspondente para baixa imediata.
* **Tecnologia**: JavaScript / Listener global no Electron.

---

## 🏗️ Estrutura de Diretórios Proposta

```
apps/local-api/
  ├── src/
  │   ├── services/
  │   │   ├── printer.service.ts       # Gerenciador de impressão térmica ESC/POS
  │   │   ├── backup.service.ts        # Gerenciador de backups zip e restauração
  │   │   ├── reports.service.ts       # Gerador de relatórios PDF/Excel
  │   │   └── voice.service.ts         # Sintetizador e alertas de áudio
  │   ├── routes/
  │   │   ├── printer.routes.ts        # Rotas /api/printer/print, /status
  │   │   ├── backup.routes.ts         # Rotas /api/backup/create, /list, /restore
  │   │   └── reports.routes.ts        # Rotas /api/reports/generate, /send-whatsapp
  └── scripts/
      ├── python/
      │   ├── generate_report.py       # Gerador Python de PDF com gráficos
      │   ├── enhance_image.py         # Tratamento de imagem para OCR
      │   └── backup_sqlite.py         # Script de compressão de banco
```
