@echo off
rem ─── La cruscotto di Tarantola, in locale ─────────────────────────────────
rem  Doppio clic: lancia il serverino sulla porta 8789 e apre il browser.
rem  La pagina si rigenera a ogni F5. Nessun ordine, nessun accesso al broker.
rem  Per fermarlo: chiudi la finestra nera (o Ctrl+C).

cd /d "%~dp0"

set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%BUN%" set "BUN=bun"

rem La porta da aprire nel browser: la legge dallo stesso posto del programma (config.ts).
set PORTA=8789

start "Tarantola · cruscotto" "%BUN%" run src/cli.ts cruscotto
timeout /t 2 >nul
start http://localhost:%PORTA%/
