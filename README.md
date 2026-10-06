# FLEX PERSONEL — Cloud / PostgreSQL edition

Bu versiya 4 ta obyekt, taxminan 1,500–2,000 nafar xodim va bir vaqtda kamida 10 ta foydalanuvchi ishlashi uchun serverga tayyorlangan.

## Nima o'zgardi
- Production'da ma'lumotlar **PostgreSQL** bazasida saqlanadi. JSON fayl faqat lokal test uchun fallback.
- 5 ta hisob: 1 admin + 4 obyekt.
- Admin barcha obyektlarni ko'radi; obyekt foydalanuvchisi faqat o'z obyektini ko'radi.
- Har bir state yozuvi serverda obyekt huquqi bilan tekshiriladi.
- PostgreSQL connection pool ishlatiladi (`DB_POOL_MAX`, default 10).
- Login urinishlariga oddiy rate-limit qo'shilgan.
- Production'da session cookie `Secure` bo'ladi.
- Keyinchalik serverni kuchaytirish yoki boshqa PostgreSQL serveriga ko'chirish uchun `DATABASE_URL`ni almashtirish kifoya.

## Muhim: bepul davr
Hosting provayderining free plan'i qancha vaqt bepul bo'lishi uning amaldagi shartlariga bog'liq. Dastur 5–6 oy bepul ishlashni texnik jihatdan cheklamaydi; free hosting yoki free database limiti tugasa, pullik plan'ga o'tiladi.

## Boshlang'ich hisoblar
- Admin: `abduraupovsahobiddin@gmail.com` / `admin123`
- JOIS: `jois` / `jois123`
- NAGATINO: `nag1` / `nag1123`
- NAGATINO 2: `nag2` / `nag2123`
- PREOBREJENKA: `prb` / `prb123`

**Internetga chiqarishdan oldin parollarni va `SESSION_SECRET`, `FLEX_RECOVERY_CODE` ni almashtiring.**

## Ishga tushirish
```bash
npm install
npm start
```

PostgreSQL bilan:
```bash
DATABASE_URL="postgresql://..." npm start
```

Server birinchi ishga tushganda kerakli `accounts` va `app_state` jadvallarini o'zi yaratadi. JOIS uchun paket ichidagi boshlang'ich ma'lumot ham birinchi ishga tushishda seed qilinadi.

## Deploy
Node.js + PostgreSQL beradigan hosting tanlang. Build/install: `npm install`; Start: `npm start`.
Environment variables:
- `DATABASE_URL`
- `DATABASE_SSL=true`
- `DB_POOL_MAX=10`
- `NODE_ENV=production`
- `SESSION_SECRET`
- `FLEX_RECOVERY_CODE`

## Backup
Production'da PostgreSQL'ning avtomatik backup/snapshot imkoniyatini yoqing. Bepul planlarda backup bo'lmasligi mumkin.

## Keyingi pullik bosqich
Agar 5–10 foydalanuvchi va 1,500–2,000 xodim bilan tizim yaxshi ishlasa, darhol katta server shart emas. Yuklama oshsa CPU/RAM va PostgreSQL resurslari bosqichma-bosqich kuchaytiriladi.
