"""
CondoBox EasyOCR Bridge & Microservice
Permite execução local offline de OCR com EasyOCR (PyTorch),
sem custo de tokens, com precisão neural superior ao Tesseract.

Pode ser executado de 2 formas:
1. CLI: python easyocr_bridge.py --image <caminho_ou_base64>
2. Servidor HTTP persistente (recomendado para manter o modelo em memória):
   python easyocr_bridge.py --serve --port 5055
"""

import sys
import os
import json
import base64
import io
import argparse
import warnings
from http.server import HTTPServer, BaseHTTPRequestHandler

# Silencia avisos de depreciação do PyTorch para manter saídas limpas
warnings.filterwarnings('ignore')
os.environ["PYTHONIOENCODING"] = "utf-8"

# Força stdout para UTF-8 no Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Import lazy de EasyOCR para permitir verificações rápidas
_reader = None

def get_reader():
    global _reader
    if _reader is None:
        import easyocr
        # gpu=False garante compatibilidade universal em CPU sem CUDA
        # pt + en cobre 100% das etiquetas brasileiras e internacionais
        _reader = easyocr.Reader(['pt', 'en'], gpu=False, verbose=False)
    return _reader

def run_ocr_on_bytes(image_bytes: bytes):
    try:
        from PIL import Image
        import numpy as np

        image = Image.open(io.BytesIO(image_bytes))
        # Converte para RGB caso esteja em RGBA ou escala de cinza
        if image.mode != 'RGB':
            image = image.convert('RGB')
        
        img_np = np.array(image)
        reader = get_reader()
        
        # Leitura com EasyOCR: retorna lista de (bbox, text, confidence)
        results = reader.readtext(img_np)
        
        lines = []
        confidences = []
        for bbox, text, conf in results:
            clean_text = str(text).strip()
            if clean_text:
                lines.append(clean_text)
                confidences.append(float(conf))
        
        full_text = "\n".join(lines)
        avg_confidence = (sum(confidences) / len(confidences)) if confidences else 0.0

        return {
            "success": True,
            "text": full_text,
            "lines": lines,
            "confidence": round(avg_confidence, 3),
            "details": [
                {"text": t, "confidence": round(c, 3)}
                for t, c in zip(lines, confidences)
            ]
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "text": "",
            "lines": [],
            "confidence": 0.0
        }

class OCRHTTPHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silencia logs excessivos para não poluir o terminal
        pass

    def _send_json(self, status_code: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self._send_json(200, {"status": "ok", "service": "condobox-easyocr", "engine": "easyocr"})
        else:
            self._send_json(404, {"error": "Not Found"})

    def do_POST(self):
        if self.path in ('/ocr', '/api/ocr'):
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                raw_body = self.rfile.read(content_length)
                
                # Suporta tanto JSON {"image": "base64..."} quanto envio direto binário
                content_type = self.headers.get('Content-Type', '')
                image_bytes = None
                
                if 'application/json' in content_type:
                    payload = json.loads(raw_body.decode('utf-8'))
                    img_data = payload.get('image') or payload.get('file') or ''
                    if ',' in img_data:
                        img_data = img_data.split(',', 1)[1]
                    image_bytes = base64.b64decode(img_data)
                elif 'image/' in content_type:
                    image_bytes = raw_body
                else:
                    # Tenta ler como JSON ou base64 raw
                    try:
                        payload = json.loads(raw_body.decode('utf-8'))
                        img_data = payload.get('image', '')
                        if ',' in img_data:
                            img_data = img_data.split(',', 1)[1]
                        image_bytes = base64.b64decode(img_data)
                    except Exception:
                        image_bytes = raw_body

                if not image_bytes:
                    self._send_json(400, {"success": False, "error": "No image data provided"})
                    return

                res = run_ocr_on_bytes(image_bytes)
                self._send_json(200 if res["success"] else 500, res)
            except Exception as e:
                self._send_json(500, {"success": False, "error": str(e)})
        else:
            self._send_json(404, {"error": "Not Found"})

def start_server(port: int = 5055):
    print(f"[CondoBox EasyOCR] Aquecendo modelo neural EasyOCR (pt, en)...")
    get_reader()
    print(f"[CondoBox EasyOCR] ✅ Modelo carregado em RAM com sucesso!")
    server = HTTPServer(('127.0.0.1', port), OCRHTTPHandler)
    print(f"[CondoBox EasyOCR] 🚀 Servidor HTTP ativo em http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[CondoBox EasyOCR] Servidor encerrado.")

def main():
    parser = argparse.ArgumentParser(description="CondoBox EasyOCR Bridge")
    parser.add_argument('--serve', action='store_true', help="Inicia microserviço HTTP persistente")
    parser.add_argument('--port', type=int, default=5055, help="Porta HTTP (default: 5055)")
    parser.add_argument('--image', type=str, help="Caminho do arquivo de imagem ou base64")
    parser.add_argument('--stdin', action='store_true', help="Lê imagem base64 do stdin")
    
    args = parser.parse_args()

    if args.serve:
        start_server(args.port)
        return

    image_bytes = None
    if args.image:
        if os.path.isfile(args.image):
            with open(args.image, 'rb') as f:
                image_bytes = f.read()
        else:
            # Assume base64 string
            raw_b64 = args.image
            if ',' in raw_b64:
                raw_b64 = raw_b64.split(',', 1)[1]
            image_bytes = base64.b64decode(raw_b64)
    elif args.stdin:
        raw_input = sys.stdin.read().strip()
        if ',' in raw_input:
            raw_input = raw_input.split(',', 1)[1]
        image_bytes = base64.b64decode(raw_input)

    if not image_bytes:
        print(json.dumps({"success": False, "error": "No image provided. Use --image or --serve"}))
        sys.exit(1)

    result = run_ocr_on_bytes(image_bytes)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
