# Commute Craze 🚌

Renkli araçları otoparktan çıkar, yolcuları doğru renkteki araca bindir! (Bus Jam / Parking Jam türünde bir bulmaca oyunu.)

## Yapı
- `src/core/logic.js` – oyun kuralları + çözülebilirliği garantili bölüm üretici (sonsuz bölüm)
- `src/render.js` – Three.js 3D görünüm ve animasyonlar
- `src/main.js` – arayüz, boosterlar, ekonomi, kayıt
- `src/config.js` – **AdMob reklam ID'leri ve ekonomi ayarları**
- `android/` – Capacitor Android projesi (targetSdk 36)

## Derleme
GitHub'a her push'ta Actions otomatik olarak:
- telefonda test için **APK** (debug imzalı)
- Play Store için **AAB** (imzasız; yükleme anahtarı ile imzalanır)

üretir ve **Releases** sayfasına koyar.

Yerelde: `npm ci && npm run dev` (tarayıcıda oynanır), `npm test` (500 bölümün çözülebilirlik testi).

## Yayın öncesi yapılacaklar
1. AdMob'da uygulama + Interstitial + Rewarded reklam birimi oluştur, ID'leri `src/config.js` ve `android/app/src/main/res/values/strings.xml` içine yaz, `testing: false` yap.
2. Gizlilik politikası: https://mehmetyusuf112200-cmd.github.io/commute-craze-privacy.html
