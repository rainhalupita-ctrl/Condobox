# Especificação Técnica: Empacotamento, Distribuição e Instalador 1-Click

## 1. Visão Geral
Construir um pipeline de build automatizado com `electron-builder` que gera um instalador executável Windows (`Setup-CondoBox.exe` ou versão portátil `CondoBox.exe`) contendo tudo em um único arquivo, pronto para distribuição comercial.

---

## 2. Conteúdo do Pacote Instalador

O pacote final engloba:
1. **Runtime Electron (Chromium + Node.js)**.
2. **Local API compilada em JavaScript otimizado (`/dist`)**.
3. **Frontend compilado e estático (`/public`)**.
4. **Modelos treinados do OCR Tesseract** (`por.traineddata` e `eng.traineddata`).
5. **Drivers e bibliotecas nativas** necessárias para SQLite e WebSocket.
6. **Scripts de inicialização e auto-recuperação**:
   * Se o processo da API local cair por qualquer motivo, o Electron reinicia o processo automaticamente em segundo plano.

---

## 3. Estrutura do `electron-builder.json` / `package.json`

```json
{
  "name": "condobox-desktop",
  "productName": "CondoBox Portaria",
  "appId": "com.condobox.desktop",
  "win": {
    "target": [
      {
        "target": "nsis",
        "arch": ["x64"]
      },
      {
        "target": "portable",
        "arch": ["x64"]
      }
    ],
    "icon": "assets/icon.ico"
  },
  "nsis": {
    "oneClick": true,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "shortcutName": "CondoBox Portaria"
  }
}
```

---

## 4. Experiência do Usuário (Instalação em 30 Segundos)
1. O cliente faz o download de `CondoBox-Setup.exe`.
2. Executa com 1 duplo clique.
3. O instalador cria o atalho na Área de Trabalho e abre o CondoBox diretamente na tela de Pareamento do WhatsApp / Portaria.
4. Nenhuma linha de comando, nenhum Docker, nenhum arquivo de configuração manual é exigido do porteiro.
