"""
Gerador de Relatórios Executivos da Portaria - CondoBox
Consulta ./data/condobox.db e gera resumo em formato texto limpo e formatado para envio no WhatsApp do Síndico ou exportação em arquivo.
"""

import os
import sys
import sqlite3
import json
from datetime import datetime

# Garante UTF-8 no stdout no Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def generate_report():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    db_file = os.path.join(base_dir, "data", "condobox.db")
    
    if not os.path.exists(db_file):
        print(json.dumps({"error": "Banco de dados condobox.db não encontrado"}))
        return
        
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    
    # 1. Estatísticas de Encomendas
    cursor.execute("SELECT COUNT(*) FROM packages")
    total_packages = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM packages WHERE status = 'DELIVERED'")
    delivered_packages = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM packages WHERE status != 'DELIVERED'")
    pending_packages = cursor.fetchone()[0]
    
    # 2. Ranking de Transportadoras
    cursor.execute("""
        SELECT carrier, COUNT(*) as qty 
        FROM packages 
        GROUP BY carrier 
        ORDER BY qty DESC 
        LIMIT 5
    """)
    carriers = cursor.fetchall()
    
    # 3. Total de Apartamentos e Moradores
    cursor.execute("SELECT COUNT(*) FROM units")
    total_units = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM residents")
    total_residents = cursor.fetchone()[0]
    
    conn.close()
    
    now_str = datetime.now().strftime("%d/%m/%Y às %H:%M")
    
    # Monta texto formatado para WhatsApp
    report_text = f"📊 *RELATÓRIO DE FLUXO DA PORTARIA - CONDOBOX*\n"
    report_text += f"🗓️ Data do Relatório: {now_str}\n\n"
    report_text += f"📦 *ENCOMENDAS:*\n"
    report_text += f"• Total Registradas: {total_packages}\n"
    report_text += f"• Entregues aos Moradores: {delivered_packages}\n"
    report_text += f"• Aguardando Retirada: {pending_packages}\n\n"
    
    if carriers:
        report_text += f"🚚 *PRINCIPAIS TRANSPORTADORAS:*\n"
        for carrier, qty in carriers:
            report_text += f"• {carrier}: {qty} pacote(s)\n"
        report_text += "\n"
        
    report_text += f"🏢 *CADASTROS:*\n"
    report_text += f"• Apartamentos: {total_units}\n"
    report_text += f"• Moradores com WhatsApp: {total_residents}\n\n"
    report_text += f"_Sistema CondoBox Portaria Inteligente_"
    
    result = {
        "success": True,
        "generatedAt": now_str,
        "metrics": {
            "totalPackages": total_packages,
            "delivered": delivered_packages,
            "pending": pending_packages,
            "units": total_units,
            "residents": total_residents,
            "topCarriers": [{"carrier": c[0], "count": c[1]} for c in carriers]
        },
        "reportText": report_text
    }
    
    print(json.dumps(result, ensure_ascii=False))
    return result

if __name__ == "__main__":
    generate_report()
