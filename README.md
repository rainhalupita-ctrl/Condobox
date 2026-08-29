# 📦 CondoBox - Gestão de Encomendas para Condomínios ($0/mês)

Sistema completo e moderno para controle de encomendas em portarias de condomínio, operando com **custo zero de servidor** através de arquitetura híbrida (Local + Nuvem).

---

## 🏗️ Arquitetura do Sistema

```text
┌─────────────────────────────────────────────────────────────────┐
│                    PC DA PORTARIA (Linux/Windows)               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Evolution API│  │  Local API   │  │  Armazenamento Local │  │
│  │ (Docker)     │  │  (Fastify/TS)│  │  /data/packages/     │  │
│  │ Porta 8080   │  │  Porta 3001  │  │  labels/  signatures/│  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         ▼                 ▼                      ▼              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Cron local: limpa fotos > 90 dias, mantém assinaturas   │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ Apenas SAÍDA (HTTPS)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE (Free Tier)                     │
│  • PostgreSQL (DB, 500MB)    • Auth (moradores/porteiros)      │
│  • Realtime (dashboard vivo) • RLS (segurança de dados)        │
└────────────────────────────┬────────────────────────────────────┘
                             ▲
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VERCEL / CLOUDFLARE PAGES (Grátis)           │
│  • PWA Next.js (portaria + morador + síndico)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Como Executar o Projeto

### 1. Banco de Dados (Supabase)

1. Acesse seu painel no [Supabase](https://supabase.com) e crie um novo projeto gratuito.
2. No menu **SQL Editor**, execute o arquivo de migração:
   - [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
3. Em seguida, execute os dados iniciais de teste:
   - [`supabase/seed.sql`](supabase/seed.sql)
4. Guarde sua **URL do Projeto**, **Anon Key** e **Service Role Key** da aba *Project Settings > API*.

---

### 2. Subir a Evolution API (WhatsApp Local) no PC da Portaria

No PC da portaria, abra o terminal na pasta `docker/` e execute:

```bash
cd docker
docker compose up -d
```

Acesse `http://localhost:8080` e faça o pareamento do WhatsApp da portaria com o QR Code.

---

### 3. Iniciar a API Local (`apps/local-api`)

No PC da portaria:

```bash
cd apps/local-api
npm install
cp .env.example .env
```

Edite o arquivo `.env` com suas chaves:

- `GEMINI_API_KEY`: Sua chave do Google AI Studio (Gemini Flash).
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`: Dados do seu Supabase.
- `EVOLUTION_API_KEY`: Chave configurada no Docker Compose.

Inicie o servidor local na porta 3001:

```bash
npm run dev
```

---

### 4. Iniciar o Frontend PWA (`apps/web`)

Você pode rodar no mesmo PC da portaria ou publicar na Vercel/Cloudflare gratuitamente:

```bash
cd apps/web
npm install
cp .env.example .env.local
```

Preencha o `.env.local` com a URL e Anon Key do Supabase.

Inicie o Next.js:

```bash
npm run dev
```

---

## 📱 Acesso no Tablet da Portaria (Wi-Fi)

1. No Tablet conectado ao Wi-Fi da portaria, abra o navegador e acesse o endereço do PWA.
2. Clique no ícone de **Configurações (⚙️)** no topo da tela e defina o IP do PC da portaria (Ex: `http://192.168.1.100:3001`).
3. Pronto! O tablet se comunicará com o PC da portaria para envio das fotos e OCR, e com o Supabase para sincronização em tempo real.

---

## 🛡️ Funcionalidades Principais

- 📸 **OCR Gemini Flash**: Leitura instantânea de nome, apartamento/bloco e transportadora diretamente da foto da etiqueta.
- 💬 **Notificações no WhatsApp**: Alertas automáticos de chegada de encomenda com código de retirada e foto da etiqueta.
- ✍️ **Assinatura Digital Touch**: O morador assina no tablet da portaria e o comprovante fica arquivado com segurança.
- 🔍 **QR Code de Retirada**: O morador apresenta o QR Code gerado no seu celular para baixa com 1 toque.
- 🧹 **Cron de Retenção (90 dias)**: Rotina automática que limpa fotos de etiquetas antigas para nunca lotar o disco rígido, mantendo as assinaturas de retirada para auditoria.
