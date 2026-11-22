@echo off
if not exist "%~dp0bin" mkdir "%~dp0bin"
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /reference:System.Web.Extensions.dll /out:"%~dp0bin\ManufacturerCapture.exe" "%~dp0ManufacturerCapture.cs"
