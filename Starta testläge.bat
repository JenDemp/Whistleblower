@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Startar TESTLÄGE med påhittad data...
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8001"
python verktyg\testlage.py
pause
