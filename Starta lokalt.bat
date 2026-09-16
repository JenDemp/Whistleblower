@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Startar sajten lokalt på http://localhost:8000
echo.
echo OBS: den här versionen använder den RIKTIGA databasen.
echo Rapporter och svar du skickar hamnar bland riktiga ärenden.
echo Vill du testa utan risk, använd "Starta testläge.bat" i stället.
echo.
echo Stäng fönstret för att avsluta.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000"
python -m http.server 8000 --bind 127.0.0.1
pause
