@echo off
set PORT=3001
set CONDOBOX_DATA_DIR=C:\Users\Kleber\AppData\Roaming\condobox-desktop\data
set NODE_PATH=C:\Users\Kleber\AppData\Local\Programs\CondoBox Portaria\resources\app.asar.unpacked\node_modules\condo-local-api\node_modules;C:\Users\Kleber\AppData\Local\Programs\CondoBox Portaria\resources\app.asar.unpacked\node_modules
cd /d "C:\Users\Kleber\AppData\Local\Programs\CondoBox Portaria\resources\app.asar.unpacked\node_modules\condo-local-api"
"C:\Users\Kleber\AppData\Local\Programs\CondoBox Portaria\resources\bin\node.exe" dist\server.js
