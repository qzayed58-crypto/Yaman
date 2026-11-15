# English Teacher — مصدر الحقيقة: GitHub `main`

يحتوي هذا المستودع على لقطة الموقع المعتمدة حاليًا لدى Vercel. ملفات الموقع الثابتة في `public/`، وقواعد المسارات في `vercel.json`. يستخدم Vercel إعداد البناء الحالي `node src/build.js` ومجلد النشر `public/` دون تغيير.

تشمل اللقطة تحديثات A1 وA2 وB1 وB2 حتى الحوار 19، وقسم Read والإعدادات المنشورة. ملف `public/index.html` مطابق بايتًا للّقطة المعتمدة (SHA-256: `f81fdd0755653dd6a4be3a64d26e18779ecfce266f8e6006426ee28fcf9d7080`). حوار B2 رقم 20 غير موجود في هذه اللقطة المنشورة.

## النشر على Cloudflare

يخدم عامل Cloudflare الملفات نفسها الموجودة في `public/`. أثناء بناء Cloudflare، يولّد `cloudflare/generate-config.mjs` جدول إعادة الكتابة وإعداد Wrangler من قواعد `vercel.json`، ثم تُختبر مطابقة المسارات قبل النشر. بذلك لا تُنسخ قواعد Vercel يدويًا إلى مكان منفصل، ويُصلح مسار `/read` في Cloudflare عبر قاعدة المصدر ذاتها.

بعد تفعيل إعداد Workers Builds على `main`، تؤدي التغييرات المرفوعة إلى GitHub إلى نشر Vercel وCloudflare من المستودع نفسه. يبقى عامل Cloudflare باسم `english-teacher` ورابط `workers.dev` الحالي؛ أما وظائف العامل القديم الخاصة بـCloudflare فليست ضمن نسخة الموقع المعتمدة في Vercel.

## الفحص المحلي

```sh
node src/build.js
node cloudflare/generate-config.mjs
node --test cloudflare/tests/worker.test.mjs
```
