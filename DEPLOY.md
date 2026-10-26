# VYRX Studio — Deploy Guide (Render Free Tier)

# VYRX Studio — ডিপ্লয় গাইড (Render ফ্রি টিয়ার)

এক টাকাও খরচ না করে VYRX Studio পাবলিক করার পুরো ধাপ নিচে দেওয়া হলো।
The full zero-cost public launch, step by step.

---

## ধাপ ১ — GitHub অ্যাকাউন্ট ও রিপোজিটরি (Step 1 — GitHub account & repo)

1. https://github.com — এ যান → **Sign up** → ইমেইল ও পাসওয়ার্ড দিয়ে ফ্রি অ্যাকাউন্ট খুলুন → ইমেইল ভেরিফাই করুন।
   Go to https://github.com → **Sign up** → create a free account → verify your email.
2. এই ফোল্ডারের (`vyrx-studio-deploy`) সব ফাইল একটা নতুন রিপোজিটরিতে আপলোড করুন:
   Upload every file from this folder (`vyrx-studio-deploy`) into a new repository:
   - GitHub-এ **New repository** → নাম দিন `vyrx-studio` → **Create repository** → **uploading an existing file** → সব ফাইল টেনে ছেড়ে দিন → **Commit changes**।
   - অথবা কম্পিউটারে git থাকলে / Or with git locally:
     ```
     git init && git add . && git commit -m "VYRX Studio" && git branch -M main
     git remote add origin https://github.com/<your-username>/vyrx-studio.git
     git push -u origin main
     ```

## ধাপ ২ — Render অ্যাকাউন্ট (Step 2 — Render account)

1. https://render.com — এ যান → **Get Started** → **GitHub দিয়ে Sign up** করুন (ফ্রি)।
   Go to https://render.com → **Get Started** → sign up with GitHub (free).

## ধাপ ৩ — New Web Service তৈরি (Step 3 — Create the Web Service)

1. Render Dashboard → **New +** → **Web Service** → আপনার `vyrx-studio` রিপোজিটরি সিলেক্ট করুন।
   Dashboard → **New +** → **Web Service** → select your `vyrx-studio` repo.
2. সেটিংস এভাবে রাখুন / Settings:
   - **Name:** `vyrx-studio`
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
3. **Advanced → Environment Variables**-এ এগুলো দিন / Add these env vars:
   - `DATABASE_PATH` = `/tmp/vyrx.db`
   - `UPLOAD_DIR` = `/tmp/uploads`
   - `SESSION_SECRET` = লম্বা এলোমেলো একটা লেখা (নিজে বানিয়ে লিখুন) / a long random string you invent
   - (ঐচ্ছিক / optional, আসল ইমেইল পাঠাতে) `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
4. **Create Web Service** চাপুন। ২–৫ মিনিটে ডিপ্লয় হবে।
   Click **Create Web Service**. Deploy takes ~2–5 minutes.

## ধাপ ৪ — আপনার পাবলিক ঠিকানা (Step 4 — Your public address)

- ডিপ্লয় শেষ হলে ঠিকানা হবে: **https://vyrx-studio.onrender.com** (নাম অন্য কেউ নিয়ে থাকলে Render নম্বর যোগ করবে)।
  Your address will be **https://vyrx-studio.onrender.com**.
- এই লিংকটাই পাবলিক — যে কেউ খুলতে পারবে, অ্যাকাউন্টের আবেদন করতে পারবে।
  Anyone can open this link and apply for an account.
- ⚠️ ফ্রি টিয়ারের সীমা / Free-tier limits: ~১৫ মিনিট কেউ না এলে সার্ভার ঘুমিয়ে যায় (পরের ভিজিটে জাগতে ~১ মিনিট লাগে), আর ফাইল/ডাটাবেস **স্থায়ী নয়** — রিস্টার্ট/নতুন ডিপ্লয়ে রিসেট হতে পারে। পরে পেইড প্ল্যান + Persistent Disk (`/var/data`) নিলে `DATABASE_PATH=/var/data/vyrx.db` ও `UPLOAD_DIR=/var/data/uploads` করে দিলেই ডাটা স্থায়ী হবে।
  The free service sleeps when idle and its filesystem is ephemeral; a paid plan + persistent disk makes the data permanent.

## ধাপ ৫ — অ্যাডমিন পাসওয়ার্ড সেট করা (Step 5 — Set the admin password)

1. সাইটে যান → ওপরের **Admin** বোতাম চাপুন।
   Open the site → click **Admin**.
2. প্রথমবার গেলেই **পাসওয়ার্ড বসানোর ফর্ম** আসবে — নিজের পছন্দের পাসওয়ার্ড বসান (কমপক্ষে ৬ অক্ষর)। এটাই আপনার অ্যাডমিন পাসওয়ার্ড; কোডে কোনো পাসওয়ার্ড লেখা নেই।
   On the first visit you get the password-setup form. Choose your admin password (min. 6 characters). No password exists anywhere in the code.
3. এরপর থেকে অ্যাডমিন ইমেইল (সার্ভারে সেট করা) + এই পাসওয়ার্ড দিয়ে লগইন হবে। পাসওয়ার্ড ভুলে গেলে লগইন পেজের **Forgot your password?** থেকে ইমেইলে ৬ সংখ্যার কোড যাবে (SMTP সেট থাকলে)।
   Later, log in with the admin email + this password. "Forgot your password?" emails a 6-digit reset code (needs SMTP configured).

## ধাপ ৬ — Hugging Face টোকেন বসানো (Step 6 — Paste the Hugging Face token)

1. অ্যাডমিন দিয়ে লগইন → **Admin → Video engine**।
   Log in as admin → **Admin → Video engine**.
2. আপনার ফ্রি Hugging Face **Read** টোকেনটা বসান → Space ঘরে ডিফল্টটাই রাখুন (`r3gm/wan2-2-fp8da-aoti-preview`) → **Save** → **Test connection** → **Connected ✓** দেখলেই ইঞ্জিন চালু।
   Paste your free Hugging Face **Read** token → keep the default Space → **Save** → **Test connection** → "Connected ✓" means the engine is live.
3. টোকেন ছাড়া জবগুলো "Waiting for engine connection" অবস্থায় থাকবে — ক্রেডিট কাটবে না হারাবে না; টোকেন বসলেই প্রসেস শুরু হবে।
   Without a token, jobs wait at "Waiting for engine connection" — no credits are lost; processing starts once a token is saved.

## ধাপ ৭ — পরে নিজের ডোমেইন (Step 7 — Custom domain, later)

1. ডোমেইন কিনুন (যেকোনো রেজিস্ট্রার) → Render → আপনার সার্ভিস → **Settings → Custom Domains → Add** → ডোমেইন লিখুন।
   Buy a domain → Render service → **Settings → Custom Domains → Add**.
2. Render যে DNS রেকর্ড (CNAME) দেখাবে, সেটা ডোমেইনের DNS-এ বসান → কিছুক্ষণে HTTPS সহ ডোমেইন চালু হবে।
   Add the CNAME Render shows in your domain's DNS; HTTPS activates automatically.

---

**লোকালে চালানো / Run locally:** `npm install && npm run build && npm start` → http://localhost:3000
