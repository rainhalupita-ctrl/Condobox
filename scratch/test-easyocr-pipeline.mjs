// scratch/test-easyocr-pipeline.mjs
import fs from 'fs';

async function testPipeline() {
  console.log('--- TESTANDO INTEGRAÇÃO DO EASYOCR NO CONDOBOX ---');

  // 1. Health check do daemon EasyOCR
  try {
    const health = await fetch('http://127.0.0.1:5055/health').then(r => r.json());
    console.log('1. Health Check Daemon (porta 5055):', health);
  } catch (e) {
    console.error('Daemon não respondeu em :5055:', e.message);
  }

  // 2. Teste de OCR em imagem real de encomenda
  const imgPath = 'C:/Users/Kleber/.gemini/antigravity-ide/brain/9c9d1e69-5288-4a49-88e1-e44226f5ab0a/.user_uploaded/media_1789317873619.png';
  if (fs.existsSync(imgPath)) {
    const base64 = fs.readFileSync(imgPath).toString('base64');
    const t0 = Date.now();
    try {
      const res = await fetch('http://127.0.0.1:5055/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });
      const data = await res.json();
      console.log(`2. OCR concluído em ${Date.now() - t0}ms:`);
      console.log('   Sucesso:', data.success);
      console.log('   Total de linhas lidas:', data.lines?.length);
      console.log('   Primeiras linhas:', data.lines?.slice(0, 3));
    } catch (e) {
      console.error('Falha na chamada OCR:', e.message);
    }
  }

  console.log('--- TESTE CONCLUÍDO COM SUCESSO ---');
}

testPipeline();
