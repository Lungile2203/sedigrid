@echo off
cd /d "%~dp0"
echo Deploying the SediGrid dashboard and Realtime Database rules...
echo.
call firebase deploy --only hosting,database
echo.
echo When it says "Deploy complete", open https://sedigrid-dbef5.web.app/dashboard/
pause
