@echo off
cd /d "%~dp0.."
if exist ".venv\Scripts\pythonw.exe" (
  ".venv\Scripts\pythonw.exe" -m research_sync.control_app
) else (
  pythonw -m research_sync.control_app
)
