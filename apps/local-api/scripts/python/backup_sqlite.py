"""
Script de Backup do Banco de Dados SQLite e Mídias do CondoBox
Compacta ./data/condobox.db e ./data/whatsapp_session em um arquivo ZIP com timestamp.
"""

import os
import sys
import time
import zipfile
import shutil
from datetime import datetime

# Garante UTF-8 no stdout no Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

def create_backup():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    data_dir = os.path.join(base_dir, "data")
    backups_dir = os.path.join(data_dir, "backups")
    
    os.makedirs(backups_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"condobox_backup_{timestamp}.zip"
    backup_filepath = os.path.join(backups_dir, backup_filename)
    
    print(f"📦 Iniciando backup do CondoBox em: {backup_filepath}")
    
    with zipfile.ZipFile(backup_filepath, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # 1. Banco SQLite
        db_file = os.path.join(data_dir, "condobox.db")
        if os.path.exists(db_file):
            zipf.write(db_file, arcname="condobox.db")
            print(f"  ✓ condobox.db incluído no backup")
            
        # 2. Sessão do WhatsApp (para não perder o pareamento)
        session_dir = os.path.join(data_dir, "whatsapp_session")
        if os.path.exists(session_dir):
            for root, _, files in os.walk(session_dir):
                for file in files:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, data_dir)
                    zipf.write(full_path, arcname=rel_path)
            print(f"  ✓ whatsapp_session incluída no backup")

    size_kb = round(os.path.getsize(backup_filepath) / 1024, 2)
    print(f"✅ Backup concluído com sucesso! Tamanho: {size_kb} KB")
    print(f"FILE:{backup_filepath}")
    return backup_filepath

if __name__ == "__main__":
    create_backup()
