@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Kare Android APK hazirlaniyor. Ilk seferde 5-15 dakika surebilir...
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurup tekrar deneyin. & pause & exit /b 1)
if not defined JAVA_HOME if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
if not defined JAVA_HOME (echo Android Studio bulunamadi. https://developer.android.com/studio adresinden kurun ve bir kez acin. & pause & exit /b 1)
set "SDK=%LOCALAPPDATA%\Android\Sdk"
if not exist "%SDK%" (echo Android SDK bulunamadi. Android Studio yu bir kez acip kurulum sihirbazini tamamlayin. & pause & exit /b 1)
call npm install || goto hata
call npm run build || goto hata
call npx cap sync android || goto hata
> android\local.properties echo sdk.dir=%SDK:\=\\%
cd android
call gradlew.bat assembleDebug || goto hata
cd ..
copy /y android\app\build\outputs\apk\debug\app-debug.apk Kare.apk >nul
echo.
echo TAMAM! Kare.apk bu klasorde hazir. Telefonuna gonderip kurabilirsin.
pause
exit /b 0
:hata
echo.
echo Bir hata olustu. Bu pencerenin ekran goruntusunu Claude a gonder.
pause
exit /b 1
