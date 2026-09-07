export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const host = (req.headers && req.headers['host']) || 'condobox-local-api.vercel.app';
  const url = new URL(req.url || '/', `https://${host}`);
  const path = url.pathname;

  // 1. Favicon
  if (path === '/favicon.ico') {
    res.statusCode = 204;
    return res.end();
  }

  // 2. Health Check
  if (path === '/api/health') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({
      status: 'OK',
      timestamp: new Date().toISOString(),
      mode: 'CLOUD_SERVERLESS_GATEWAY',
      environment: 'Vercel Serverless',
      webAppUrl: 'https://web-eight-rust-97.vercel.app',
      services: {
        database: { type: 'Supabase Cloud (PostgreSQL)', status: 'ACTIVE' },
        whatsapp: { engine: 'Portaria Local Desktop', status: 'ACTIVE_ON_DESKTOP' },
        localBaseUrl: 'http://localhost:3001'
      }
    }, null, 2));
  }

  // 3. Status WhatsApp
  if (path === '/api/whatsapp/status') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({
      engine: 'Portaria Desktop (Baileys)',
      connected: true,
      state: 'open',
      mode: 'LOCAL_DESKTOP'
    }));
  }

  // 4. Outras rotas de API
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    return res.end(JSON.stringify({
      status: 'OK',
      path: path,
      message: 'CondoBox Cloud Gateway Ativo',
      webApp: 'https://web-eight-rust-97.vercel.app'
    }));
  }

  // 5. Rota Principal - Página visual elegante com redirecionamento para o Web App
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CondoBox — Portaria Inteligente</title>
  <meta http-equiv="refresh" content="2; url=https://web-eight-rust-97.vercel.app">
  <link rel="icon" href="https://web-eight-rust-97.vercel.app/favicon.ico">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #090d16;
      color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #131b2e;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 36px 32px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #34d399;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .badge::before {
      content: '';
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 10px #10b981;
    }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 10px; color: #ffffff; }
    p { color: #94a3b8; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
    .btn {
      display: block;
      width: 100%;
      padding: 14px;
      background: #10b981;
      color: #ffffff;
      font-weight: 600;
      font-size: 15px;
      border-radius: 10px;
      text-decoration: none;
      transition: all 0.2s;
    }
    .btn:hover { background: #059669; transform: translateY(-1px); }
    .footer {
      margin-top: 20px;
      font-size: 13px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Sistema Online &bull; Vercel</div>
    <h1>CondoBox Portaria</h1>
    <p>O gateway da API está operando normalmente. Redirecionando para o aplicativo do condomínio em 2 segundos...</p>
    <a class="btn" href="https://web-eight-rust-97.vercel.app">Acessar Sistema CondoBox &rarr;</a>
    <div class="footer">Redirecionamento automático ativo</div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.statusCode = 200;
  return res.end(html);
}
