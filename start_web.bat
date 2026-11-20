@echo off
title Bank Consolidated Report - Web Server
cd /d "%~dp0src\BankConsolidatedReport.Web"
echo ============================================================
echo   HE THONG BAO CAO TAI CHINH HOP NHAT NGAN HANG
echo   Dang khoi dong web server tren http://localhost:5000 ...
echo ============================================================
dotnet run --urls "http://localhost:5000"
pause

