@echo off
cd /d "%~dp0.."
"C:\Program Files\Meta Quest Developer Hub\resources\bin\adb.exe" reverse tcp:8872 tcp:8872
start "" http://localhost:8872
python -m research_sync.fixation_server
pause
