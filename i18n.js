// VYRX Studio UI translations. English is the base; any missing key falls back to English.
const LANGS = [
  ['en', 'English'], ['bn', 'বাংলা'], ['hi', 'हिन्दी'], ['ur', 'اردو'], ['ar', 'العربية'],
  ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['tr', 'Türkçe'],
  ['id', 'Bahasa Indonesia'], ['ru', 'Русский'],
];
const RTL_LANGS = ['ar', 'ur'];

const EN = {
  tagline: 'Cinematic AI video from a prompt', home: 'Home', createVideo: 'Create video', myVideos: 'My videos',
  credits: 'Credits', support: 'Help & Support', admin: 'Admin', login: 'Log in', signup: 'Sign up', logout: 'Log out',
  heroTitle: 'Turn words into cinematic video', heroSub: 'Write a prompt, set a duration from 1 second to 20 minutes, and VYRX Studio builds your video. No subscription — free credits every day.',
  getStarted: 'Get started', howItWorks: 'How it works', faq: 'FAQ',
  how1: 'Create an account and wait for the admin to approve it.', how2: 'You receive +500 free credits every day.',
  how3: 'Write a prompt, optionally upload a character reference image or video, set the duration and voice language.',
  how4: 'Generation costs 50 credits per minute. Your video is built in parts and stitched into one full video.',
  faqQ1: 'Is it free?', faqA1: 'Yes. There is no subscription. You get +500 credits daily and each minute of video costs 50 credits.',
  faqQ2: 'Why do I need approval?', faqA2: 'Every account is approved by the admin first, so the service stays safe and credits are spent fairly.',
  faqQ3: 'How long can a video be?', faqA3: 'From 1 second up to 20 minutes. Longer videos are generated in parts and joined automatically.',
  faqQ4: 'Do I need a reference image?', faqA4: 'No. A reference is optional — it only helps keep one character looking the same across the whole video.',
  email: 'Email', password: 'Password', name: 'Name', noAccount: 'No account yet?', haveAccount: 'Already have an account?',
  pendingMsg: 'Your account is waiting for admin approval. You will get an email when it is approved.',
  bannedMsg: 'This account has been suspended by the admin.', rejectedMsg: 'Your application was not approved.',
  forgot: 'Forgot your password?', resetTitle: 'Reset password', resetSend: 'Send reset code', resetCode: '6-digit code', newPassword: 'New password', resetApply: 'Set new password',
  balance: 'Balance', dailyNote: '+500 credits are added every day.',
  promptLabel: 'Prompt', promptPh: 'Describe your video in detail…', duration: 'Duration', minutes: 'Minutes', seconds: 'Seconds',
  estCost: 'Estimated cost', refImage: 'Reference image (optional)', refVideo: 'Reference video (optional)',
  voiceLang: 'Voice language', bengali: 'Bengali', english: 'English', model: 'Model', generate: 'Generate video',
  insufficient: 'Not enough credits for this duration.', noVideos: 'You have not created any videos yet.',
  status_waiting_engine: 'Waiting for engine connection', status_queued: 'In queue', status_processing: 'Generating',
  status_done: 'Done', status_failed: 'Failed', stage_waking: 'Waking up the free engine…', stage_generating: 'Generating', stage_stitching: 'Joining the parts…',
  whyFailed: 'Why it failed', refundNote: 'Generation failed, so the credits for this job were refunded automatically.',
  download: 'Download', part: 'part', of: 'of',
  ledger: 'Credit history', subject: 'Subject', message: 'Message', send: 'Send', yourTickets: 'Your messages',
  noTickets: 'No messages yet. Write to us about any problem or idea.', reply: 'Reply', sendReply: 'Send reply',
  unreadNotice: 'You have an unread reply from support.',
  adminTitle: 'Admin panel', stats: 'Overview', totalUsers: 'Users', pendingApprovals: 'Pending approvals', totalVideos: 'Videos', creditsSpent: 'Credits spent',
  pendingList: 'Pending applications', usersList: 'All users', approve: 'Approve', reject: 'Reject', ban: 'Ban', unban: 'Unban', active: 'Active', pending: 'Pending', banned: 'Banned', rejected: 'Rejected',
  adjustCredits: 'Adjust credits', amount: 'Amount (+ to add, − to take)', confirmAdjust: 'Confirm adjustment', newBalanceWillBe: 'New balance will be',
  emailsLog: 'Emails log', engineSettings: 'Video engine', supportInbox: 'Support inbox',
  activeEngine: 'Active engine', freeEngine: 'Free engine — Hugging Face', falEngine: 'fal.ai (optional)',
  hfToken: 'Hugging Face read token', hfSpace: 'Hugging Face Space (owner/name)', falKey: 'fal.ai API key',
  save: 'Save', testConnection: 'Test connection', disconnect: 'Disconnect', connected: 'Connected', notConnected: 'Not connected',
  engineNote: 'Keys and tokens are stored encrypted on the server, are never shown again after saving, and are never sent to visitors.',
  adminSetupTitle: 'Set up the admin account', adminSetupNote: 'This is the first visit. Choose the admin password now — it is stored hashed and never shown anywhere.',
  setPassword: 'Set password and continue', adminLoginTitle: 'Admin login', status: 'Status', actions: 'Actions', videos: 'videos', to: 'To', kind: 'Kind', time: 'Time',
  jobCreated: 'Video job created', creditsDeducted: 'credits deducted. New balance', welcome: 'Welcome',
};

const DICT = {
  en: EN,
  bn: { tagline: 'প্রম্পট থেকে সিনেমাটিক AI ভিডিও', home: 'হোম', createVideo: 'ভিডিও তৈরি', myVideos: 'আমার ভিডিও', credits: 'ক্রেডিট', support: 'সাহায্য ও সাপোর্ট', admin: 'অ্যাডমিন', login: 'লগইন', signup: 'সাইন আপ', logout: 'লগ আউট', heroTitle: 'কথাকে বানান সিনেমাটিক ভিডিও', heroSub: 'প্রম্পট লিখুন, ১ সেকেন্ড থেকে ২০ মিনিট পর্যন্ত সময় সেট করুন — VYRX Studio আপনার ভিডিও বানিয়ে দেবে। কোনো সাবস্ক্রিপশন নেই, প্রতিদিন ফ্রি ক্রেডিট।', getStarted: 'শুরু করুন', howItWorks: 'কীভাবে কাজ করে', how1: 'অ্যাকাউন্ট খুলুন এবং অ্যাডমিনের অনুমোদনের অপেক্ষা করুন।', how2: 'প্রতিদিন +৫০০ ফ্রি ক্রেডিট পাবেন।', how3: 'প্রম্পট লিখুন, চাইলে ক্যারেক্টার রেফারেন্স ছবি/ভিডিও দিন, সময় ও ভয়েসের ভাষা সেট করুন।', how4: 'প্রতি মিনিটে ৫০ ক্রেডিট খরচ। ভিডিও অংশে অংশে তৈরি হয়ে একটায় জোড়া লাগে।', balance: 'ব্যালেন্স', creditsDeducted: 'ক্রেডিট কেটেছে। নতুন ব্যালেন্স', jobCreated: 'ভিডিও জব তৈরি হয়েছে', generate: 'ভিডিও বানান', promptLabel: 'প্রম্পট', duration: 'সময়কাল', estCost: 'আনুমানিক খরচ', voiceLang: 'ভয়েসের ভাষা', status_failed: 'ব্যর্থ', status_done: 'হয়ে গেছে', whyFailed: 'কেন ব্যর্থ হলো' },
  hi: { tagline: 'प्रॉम्प्ट से सिनेमाई AI वीडियो', home: 'होम', createVideo: 'वीडियो बनाएं', myVideos: 'मेरे वीडियो', credits: 'क्रेडिट', support: 'मदद और समर्थन', admin: 'एडमिन', login: 'लॉग इन', signup: 'साइन अप', logout: 'लॉग आउट', heroTitle: 'शब्दों को सिनेमाई वीडियो में बदलें', getStarted: 'शुरू करें', howItWorks: 'यह कैसे काम करता है', balance: 'बैलेंस', generate: 'वीडियो बनाएं', promptLabel: 'प्रॉम्प्ट', duration: 'अवधि', voiceLang: 'आवाज़ की भाषा' },
  ur: { tagline: 'پرامپٹ سے سنیمائی AI ویڈیو', home: 'ہوم', createVideo: 'ویڈیو بنائیں', myVideos: 'میری ویڈیوز', credits: 'کریڈٹس', support: 'مدد اور سپورٹ', admin: 'ایڈمن', login: 'لاگ ان', signup: 'سائن اپ', logout: 'لاگ آؤٹ', heroTitle: 'الفاظ کو سنیمائی ویڈیو میں بدلیں', getStarted: 'شروع کریں', howItWorks: 'یہ کیسے کام کرتا ہے', balance: 'بیلنس', generate: 'ویڈیو بنائیں', promptLabel: 'پرامپٹ', duration: 'دورانیہ', voiceLang: 'آواز کی زبان' },
  ar: { tagline: 'فيديو سينمائي بالذكاء الاصطناعي من وصف نصي', home: 'الرئيسية', createVideo: 'إنشاء فيديو', myVideos: 'فيديوهاتي', credits: 'النقاط', support: 'المساعدة والدعم', admin: 'المسؤول', login: 'تسجيل الدخول', signup: 'إنشاء حساب', logout: 'تسجيل الخروج', heroTitle: 'حوّل الكلمات إلى فيديو سينمائي', getStarted: 'ابدأ الآن', howItWorks: 'كيف يعمل', balance: 'الرصيد', generate: 'إنشاء الفيديو', promptLabel: 'الوصف', duration: 'المدة', voiceLang: 'لغة الصوت' },
  es: { tagline: 'Video cinematográfico con IA desde un texto', home: 'Inicio', createVideo: 'Crear video', myVideos: 'Mis videos', credits: 'Créditos', support: 'Ayuda y soporte', admin: 'Admin', login: 'Iniciar sesión', signup: 'Registrarse', logout: 'Cerrar sesión', heroTitle: 'Convierte palabras en video cinematográfico', getStarted: 'Empezar', howItWorks: 'Cómo funciona', balance: 'Saldo', generate: 'Generar video', promptLabel: 'Descripción', duration: 'Duración', voiceLang: 'Idioma de la voz' },
  fr: { tagline: 'Vidéo cinématographique IA à partir d’un texte', home: 'Accueil', createVideo: 'Créer une vidéo', myVideos: 'Mes vidéos', credits: 'Crédits', support: 'Aide et support', admin: 'Admin', login: 'Se connecter', signup: 'S’inscrire', logout: 'Se déconnecter', heroTitle: 'Transformez des mots en vidéo cinématographique', getStarted: 'Commencer', howItWorks: 'Comment ça marche', balance: 'Solde', generate: 'Générer la vidéo', promptLabel: 'Description', duration: 'Durée', voiceLang: 'Langue de la voix' },
  de: { tagline: 'Kinoreifes KI-Video aus einem Prompt', home: 'Start', createVideo: 'Video erstellen', myVideos: 'Meine Videos', credits: 'Credits', support: 'Hilfe & Support', admin: 'Admin', login: 'Anmelden', signup: 'Registrieren', logout: 'Abmelden', heroTitle: 'Verwandle Worte in kinoreifes Video', getStarted: 'Loslegen', howItWorks: 'So funktioniert es', balance: 'Guthaben', generate: 'Video generieren', promptLabel: 'Prompt', duration: 'Dauer', voiceLang: 'Sprache der Stimme' },
  pt: { tagline: 'Vídeo cinematográfico com IA a partir de um texto', home: 'Início', createVideo: 'Criar vídeo', myVideos: 'Meus vídeos', credits: 'Créditos', support: 'Ajuda e suporte', admin: 'Admin', login: 'Entrar', signup: 'Cadastrar', logout: 'Sair', heroTitle: 'Transforme palavras em vídeo cinematográfico', getStarted: 'Começar', howItWorks: 'Como funciona', balance: 'Saldo', generate: 'Gerar vídeo', promptLabel: 'Descrição', duration: 'Duração', voiceLang: 'Idioma da voz' },
  tr: { tagline: 'Bir metinden sinematik yapay zekâ videosu', home: 'Ana sayfa', createVideo: 'Video oluştur', myVideos: 'Videolarım', credits: 'Krediler', support: 'Yardım ve Destek', admin: 'Yönetici', login: 'Giriş yap', signup: 'Kayıt ol', logout: 'Çıkış yap', heroTitle: 'Kelimeleri sinematik videoya dönüştürün', getStarted: 'Başlayın', howItWorks: 'Nasıl çalışır', balance: 'Bakiye', generate: 'Video oluştur', promptLabel: 'Açıklama', duration: 'Süre', voiceLang: 'Ses dili' },
  id: { tagline: 'Video sinematik AI dari sebuah prompt', home: 'Beranda', createVideo: 'Buat video', myVideos: 'Video saya', credits: 'Kredit', support: 'Bantuan & Dukungan', admin: 'Admin', login: 'Masuk', signup: 'Daftar', logout: 'Keluar', heroTitle: 'Ubah kata menjadi video sinematik', getStarted: 'Mulai', howItWorks: 'Cara kerja', balance: 'Saldo', generate: 'Buat video', promptLabel: 'Prompt', duration: 'Durasi', voiceLang: 'Bahasa suara' },
  ru: { tagline: 'Кинематографичное ИИ-видео по текстовому запросу', home: 'Главная', createVideo: 'Создать видео', myVideos: 'Мои видео', credits: 'Кредиты', support: 'Помощь и поддержка', admin: 'Админ', login: 'Войти', signup: 'Регистрация', logout: 'Выйти', heroTitle: 'Превращайте слова в кинематографичное видео', getStarted: 'Начать', howItWorks: 'Как это работает', balance: 'Баланс', generate: 'Создать видео', promptLabel: 'Запрос', duration: 'Длительность', voiceLang: 'Язык озвучки' },
};

function t(lang, key) {
  const d = DICT[lang] || EN;
  return d[key] !== undefined ? d[key] : EN[key] || key;
}
