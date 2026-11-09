# Kare

Fotoğraf paylaşımı, 71 kart oyunu ve Türk Şekerleri; tek hesap ve tek çip bakiyesi.
Web (React + Vite), Android ve iOS (Capacitor) için tek kod tabanı. Sunucu: Supabase "KARE-Frankfurt".

## Klasörler
- `src/engine/` – 71 kural motoru ve yapay zekâ (sunucu ve pratik modu aynı kodu kullanır)
- `src/game71/`, `src/pages/`, `src/candy/` – ekranlar
- `supabase/migrations/` – veritabanı şeması (uygulandı)
- `supabase/functions/game71/` – online 71 sunucusu (yayında). Motoru güncelledikten sonra `npm run engine:copy`
- `android/`, `ios/` – telefon projeleri

## Komutlar
- `npm install` – bağımlılıklar
- `npm test` – 49 otomatik test (kurallar, botlarla tam oyunlar, Türk Şekerleri)
- `npm run dev` – bilgisayarda deneme
- `npm run build` – web sürümü `dist/` klasörüne
- `npx cap sync` – web sürümünü Android/iOS projelerine kopyalar

## Yayına alma
1. **Web:** `dist/` klasörünü https://app.netlify.com/drop adresine sürükle.
2. **Supabase:** Authentication › URL Configuration › Site URL alanına web adresini yaz (e-posta doğrulama bağlantıları buraya döner).
3. **Android APK:** Projeyi GitHub'a yükle; `.github/workflows/android.yml` her gönderimde APK'yı derler (Actions › Android APK › kare-apk). Google Play için imzalı sürüm (AAB) gerekir.
4. **iOS:** `ios/App` Xcode ile bir Mac'te açılır ya da bulut derleme servisiyle derlenir; Apple Developer hesabı gerekir.
