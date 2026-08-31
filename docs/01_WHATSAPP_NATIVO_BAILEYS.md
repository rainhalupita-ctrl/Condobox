# Especificação Técnica: Motor de WhatsApp Nativo (Baileys Embutido)

## 1. Visão Geral
Eliminar a dependência de containers Docker (`Evolution API`, `PostgreSQL`, `Redis`) rodando um motor nativo de WhatsApp direto no processo Node.js / Fastify da API Local do CondoBox através da biblioteca `@whiskeysockets/baileys`.

---

## 2. Vantagens do Motor Nativo
* **Zero Configuração & Zero Dependências**: O porteiro/síndico não precisa instalar Docker Desktop, WSL2 ou configurar portas adicionais.
* **Economia de Recursos**: Consumo de RAM cai de ~4.5 GB (Docker + 3 containers) para apenas ~60 MB no processo Node.js existente.
* **Pareamento Direto**: O QR Code é gerado e atualizado em tempo real na interface web/desktop do CondoBox.
* **Persistência de Sessão Segura**: As credenciais de autenticação ficam armazenadas localmente em `./data/whatsapp_session` (pasta ignorada pelo Git e protegida por permissões de arquivo).

---

## 3. Arquitetura do Serviço

```mermaid
sequenceDiagram
    participant UI as CondoBox Desktop UI
    participant API as Condo Local API (Fastify)
    participant Baileys as WhatsApp Engine (Baileys)
    participant WA as Servidores WhatsApp

    UI->>API: GET /api/whatsapp/status
    API-->>UI: { status: "DISCONNECTED", qrcode: "data:image/png;base64,..." }
    Note over UI: Porteiro escaneia o QR Code no celular
    Baileys->>WA: Autenticação via WebSocket
    WA-->>Baileys: Sessão Estabelecida (open)
    Baileys->>API: Evento 'connection.update': { connection: 'open' }
    UI->>API: POST /api/whatsapp/send-package-notification
    API->>Baileys: sendImage({ phone, imageBuffer, caption })
    Baileys->>WA: Envio Direto Criptografado
    WA-->>Baileys: Mensagem Entregue (ACK)
```

---

## 4. Endpoints da API Local

1. `GET /api/whatsapp/status`:
   * Retorna `{ status: "CONNECTED" | "CONNECTING" | "DISCONNECTED", phone: string, qrcode: string | null }`
2. `POST /api/whatsapp/connect`:
   * Inicia o socket do Baileys e gera o QR Code inicial caso não esteja conectado.
3. `POST /api/whatsapp/disconnect` ou `POST /api/whatsapp/logout`:
   * Desconecta o WhatsApp e limpa a pasta de sessão para permitir novo pareamento.
4. `POST /api/whatsapp/send`:
   * Envio de mensagem de texto direta.
5. `POST /api/whatsapp/send-package-arrival`:
   * Envio de notificação formatada com foto da etiqueta, código numérico de retirada de 4 dígitos e botão interativo wa.me para confirmação de ciência com 1 clique.

---

## 5. Estratégia de Fallback e Webhook Interno
* As mensagens recebidas dos moradores (respostas como "Ciente", "OK", "Recebido") são tratadas diretamente pelo listener de eventos do Baileys (`messages.upsert`), disparando a baixa ou confirmação de ciência no banco de dados local instantaneamente, sem precisar de tunneling externo (ngrok/Cloudflare) para receber webhooks.
