(() => {
  'use strict';
  const SUPABASE_URL = 'https://zbxugmujxwtbcuhlgvyv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_IfoGIJLbHTlAIN2tEFkPhA_dvdZfC8Y';
  const PROGRESS_TABLE = 'learning_progress_devices';
  const DEVICE_KEY = 'cue_progress_device_id_v1';
  const COURSE_KEY = 'fc_progress_v2';
  const PROGRESS_KEYS = new Set([COURSE_KEY, 'sdone', 'squiz']);
  const PROFILE_CACHE_PREFIX = 'cue_profile_cache_v1:';
  const AUTH_STORAGE_KEY = 'sb-zbxugmujxwtbcuhlgvyv-auth-token';
  // Providers are opt-in only: the page owner must explicitly configure a true value.
  // This prevents rendering buttons for providers that are not enabled in Supabase.
  const configuredProviders = () => {
    const value = window.CUE_AUTH_PROVIDERS;
    return { google: value?.google === true, apple: value?.apple === true };
  };
  const COUNTRY_OPTIONS = [
    ['DZ','الجزائر'],['BH','البحرين'],['KM','جزر القمر'],['DJ','جيبوتي'],['EG','مصر'],['IQ','العراق'],
    ['JO','الأردن'],['KW','الكويت'],['LB','لبنان'],['LY','ليبيا'],['MR','موريتانيا'],['MA','المغرب'],
    ['OM','عُمان'],['PS','فلسطين'],['QA','قطر'],['SA','السعودية'],['SO','الصومال'],['SD','السودان'],
    ['SY','سوريا'],['TN','تونس'],['AE','الإمارات العربية المتحدة'],['YE','اليمن']
  ];
  const COUNTRY_LABEL = Object.fromEntries(COUNTRY_OPTIONS);
  const NAME_RE = /^[A-Za-zءآأؤإئابتثجحخدذرزسشصضطظعغفقكلمنهويىةٱ]+(?: [A-Za-zءآأؤإئابتثجحخدذرزسشصضطظعغفقكلمنهويىةٱ]+)*$/u;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const gate = document.getElementById('cue-auth-gate');
  const pane = document.getElementById('pane-settings');
  if (!gate) return;

  let client = null;
  let currentSession = null;
  let currentProfile = null;
  let profileReady = false;
  let suppressProgressEvents = 0;
  let pendingSession = null;
  let syncPromise = null;
  let syncTimer = null;
  let offlineMode = false;
  let sessionCheckTimer = null;
  let sessionCheckInFlight = null;
  let localProgressOwner = null;
  let explicitSignInInFlight = false;
  let reconnectRequired = false;
  let lastAuthEventIdentity = '';
  let progressOwnerChanged = false;
  let authProviders = configuredProviders();
  let publicGuestMode = false;
  let progressHooksInstalled = false;

  const style = document.createElement('style');
  style.textContent = `
    #cue-auth-gate{position:fixed;inset:0;z-index:2147483647;overflow:auto;box-sizing:border-box;background:#eef0ea;color:#1d2b2a;display:grid;place-items:center;padding:18px;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    #cue-auth-gate[hidden]{display:none!important}
    .cue-auth-card{width:min(100%,480px);box-sizing:border-box;background:#fbfbf7;border:1px solid #cbd3cc;border-radius:18px;padding:22px;box-shadow:0 16px 45px #0002}
    .cue-auth-card h1,.cue-auth-card h2{margin:0 0 7px;font-size:1.45rem}.cue-auth-card p{color:#5e6d69;margin:7px 0 16px;line-height:1.65}
    .cue-auth-form,.cue-profile-form{display:grid;gap:12px}.cue-auth-form label,.cue-field{display:grid;gap:5px;font-weight:650}
    .cue-auth-form input,.cue-auth-form select,.cue-field input,.cue-field select{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #cbd3cc;border-radius:10px;background:#fff;color:#1d2b2a;font:inherit;font-size:16px;line-height:1.35}
    .cue-btn{border:1px solid #2f5d62;border-radius:11px;background:#2f5d62;color:#fff;padding:11px 14px;font:inherit;font-weight:750;cursor:pointer;min-height:44px}
    .cue-btn.secondary{background:transparent;color:#2f5d62}.cue-btn:disabled{opacity:.55;cursor:not-allowed}
    .cue-auth-actions{display:grid;gap:9px}.cue-auth-links{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:15px}
    .cue-auth-links button{border:0;background:none;color:#2f5d62;font:inherit;text-decoration:underline;cursor:pointer;padding:4px}
    .cue-auth-message{min-height:1.4em;margin:8px 0;color:#8a2632;line-height:1.6;overflow-wrap:anywhere}.cue-auth-message.ok{color:#206448}
    .cue-country-note{display:block;margin-top:3px;color:var(--muted,#5e6d69);font-size:.84rem;font-weight:500;line-height:1.55}.cue-profile-form select:disabled{opacity:1;background:#f1f3ef;color:#52615d;cursor:not-allowed}
    .cue-settings{max-width:42rem;margin:0 auto;padding:1rem 1rem 2rem;color:var(--body,#1d2b2a)}
    .cue-settings h1{margin:0 0 .25rem;color:var(--ink,#1d2b2a)}.cue-settings>p{margin:.25rem 0 1rem;color:var(--muted,#5e6d69)}
    .cue-settings-card{background:var(--surface,#fbfbf7);border:2px solid var(--edge,#cbd3cc);border-radius:18px;padding:1rem;margin:0 0 1rem;box-shadow:var(--shadow,0 4px 12px #0001)}
    .cue-settings-card h2{margin:0 0 .35rem;font-size:1.15rem}.cue-settings-card p{color:var(--muted,#5e6d69);line-height:1.6}
    @media(max-width:420px){.cue-auth-card{padding:18px}.cue-settings{padding-inline:.7rem}.cue-settings-card{padding:.8rem}}
  `;
  document.head.appendChild(style);

  function setGate(html) {
    try { sessionStorage.removeItem('cue_auth_entry_verified_v1'); } catch (_) {}
    gate.innerHTML = html;
    gate.classList.toggle('cue-ob-mode', !!gate.querySelector('.cue-onboarding'));
    if (gate.querySelector('.cue-onboarding') && !gate.querySelector('#cueContinueAsGuest')) {
      const guestButton = document.createElement('button');
      guestButton.id = 'cueContinueAsGuest';
      guestButton.type = 'button';
      guestButton.className = 'cue-btn secondary';
      guestButton.textContent = 'المتابعة كزائر / Continue as guest';
      guestButton.style.cssText = 'display:block;margin:12px auto 18px;position:relative;z-index:5;';
      guestButton.addEventListener('click', () => { void useSession(null); });
      (gate.querySelector('.cue-ob-shell') || gate.querySelector('.cue-onboarding')).appendChild(guestButton);
    }
    gate.hidden = false;
    document.documentElement.classList.add('cue-auth-checking');
  }
  function hideGate() {
    gate.hidden = true;
    gate.replaceChildren();
    document.documentElement.classList.remove('cue-auth-checking');
    try { sessionStorage.setItem('cue_auth_entry_verified_v1','1'); } catch (_) {}
  }
  function setMessage(node, text, good = false) {
    if (!node) return;
    node.textContent = text || '';
    node.classList.toggle('ok', !!good);
  }
  function countrySelect(selected = '') {
    return '<option value="">اختر الدولة</option>' + COUNTRY_OPTIONS.map(([code,label]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }
  function ageSelect(selected = '') {
    return '<option value="">اختر العمر</option>' + Array.from({length:70}, (_,i) => i + 1).map(age => `<option value="${age}"${Number(selected) === age ? ' selected' : ''}>${age}</option>`).join('');
  }
  function cleanName(value) { return String(value || '').trim().replace(/\s+/g, ' '); }
  function validName(value) { const name = cleanName(value); return name.length <= 100 && name.replace(/ /g, '').length >= 2 && NAME_RE.test(name); }
  function validProfile(value) {
    return !!value && validName(value.name) && !!COUNTRY_LABEL[value.country] && Number.isInteger(Number(value.age)) && Number(value.age) >= 1 && Number(value.age) <= 70;
  }
  function profileValues(form) {
    return { name: cleanName(form.elements.name.value), country: form.elements.country.value, age: Number(form.elements.age.value) };
  }
  function clearAuthUrl() {
    try { if (location.search || location.hash) history.replaceState({}, document.title, location.pathname); } catch (_) {}
  }
  function authErrorMessage(error, mode = 'login') {
    const code = String(error?.code || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();
    if (code === 'user_already_exists' || /user already registered|already exists/.test(message))
      return 'هذا البريد مرتبط بحساب موجود. اختر «لدي حساب بالفعل» وسجّل الدخول. / This email already has an account. Choose “I already have an account” to sign in.';
    if (code === 'email_not_confirmed' || /email not confirmed/.test(message))
      return 'أكد بريدك الإلكتروني قبل تسجيل الدخول. / Confirm your email before signing in.';
    if (code === 'invalid_credentials' || /invalid login credentials/.test(message))
      return mode === 'signup' ? 'تعذر تسجيل الدخول بهذه البيانات. تحقق من كلمة المرور، أو اختر «لدي حساب بالفعل». / Could not sign in with these credentials. Check your password or choose “I already have an account”.' : 'البريد أو كلمة المرور غير صحيحة. / Email or password is incorrect.';
    if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || /rate limit|too many requests/.test(message))
      return 'محاولات كثيرة؛ انتظر قليلاً ثم أعد المحاولة. / Too many attempts; wait a little and try again.';
    return 'تعذر إكمال الطلب. تحقق من اتصالك وحاول مجدداً. / Could not complete the request. Check your connection and try again.';
  }
  function providerButtons() {
    return Object.entries(authProviders).filter(([, enabled]) => enabled).map(([provider]) => {
      const label = provider === 'google' ? 'المتابعة باستخدام Google' : 'المتابعة باستخدام Apple';
      return `<button class="cue-btn secondary" type="button" data-auth-provider="${provider}">${label}</button>`;
    }).join('');
  }
  /* CUE_ILLUSTRATED_ONBOARDING_V1: UI-only draft; never reads/writes profile, auth or progress storage. */
  let cueOnboardingDismissed = false;
  let cueOnboardingDraft = { name: '', country: '', age: '', level: '' };
  const cueOnboardingLevels = ['A1','A2','B1','B2','C1','unknown'];
  const cueOnboardingLevelLabels = ['مبتدئ / Beginner (A1)','أساسي / Elementary (A2)','متوسط / Intermediate (B1)','متقدم / Upper-Intermediate (B2)','متقدم عالٍ / Advanced (C1)','لا أعرف / I don’t know'];
  const cueOnboardingCountryEnglish = {DZ:'Algeria',BH:'Bahrain',KM:'Comoros',DJ:'Djibouti',EG:'Egypt',IQ:'Iraq',JO:'Jordan',KW:'Kuwait',LB:'Lebanon',LY:'Libya',MR:'Mauritania',MA:'Morocco',OM:'Oman',PS:'Palestine',QA:'Qatar',SA:'Saudi Arabia',SO:'Somalia',SD:'Sudan',SY:'Syria',TN:'Tunisia',AE:'United Arab Emirates',YE:'Yemen'};
  style.textContent += `
    #cue-auth-gate.cue-ob-mode{display:block;background:#d9eeff;padding:0;overflow-x:hidden;overflow-y:auto;align-content:normal}
    .cue-onboarding{position:relative;isolation:isolate;display:block;width:100%;min-height:100vh;min-height:100svh;overflow:hidden;background:linear-gradient(155deg,#bde5ff 0%,#e7f5ff 48%,#c9e2ff 100%);color:#0a2d72;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;direction:rtl}
    .cue-ob-scene{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:radial-gradient(ellipse at 50% 100%,#f8fcff 0 17%,transparent 17.3%),linear-gradient(180deg,transparent 58%,#e4f3ff 100%)}
    .cue-ob-sun{position:absolute;right:9%;top:8%;width:clamp(64px,10vw,116px);aspect-ratio:1;border-radius:50%;background:radial-gradient(circle at 38% 34%,#fffde2 0 8%,#ffe889 48%,#ffd260 75%,#ffcf5a 100%);box-shadow:0 0 0 12px #fff5a533,0 0 65px #fff2ad99}
    .cue-ob-cloud{position:absolute;width:clamp(78px,13vw,160px);height:clamp(24px,4vw,45px);border-radius:99px;background:linear-gradient(180deg,#fff 0%,#f8fcff 100%);opacity:.86;filter:drop-shadow(0 5px 4px #5594c520)}
    .cue-ob-cloud:before,.cue-ob-cloud:after{content:"";position:absolute;bottom:6px;border-radius:50%;background:inherit}
    .cue-ob-cloud:before{left:17%;width:42%;aspect-ratio:1}.cue-ob-cloud:after{left:44%;width:54%;aspect-ratio:1}
    .cue-ob-cloud--one{left:5%;top:16%;transform:scale(.9)}.cue-ob-cloud--two{right:24%;top:31%;transform:scale(.7)}.cue-ob-cloud--three{left:31%;top:9%;transform:scale(.55);opacity:.65}
    .cue-ob-star{position:absolute;width:18px;aspect-ratio:1;background:#fff5a8;clip-path:polygon(50% 0,61% 37%,100% 50%,61% 62%,50% 100%,39% 62%,0 50%,39% 37%);filter:drop-shadow(0 2px 3px #2583d655)}
    .cue-ob-star--one{left:11%;top:38%;transform:scale(1.3)}.cue-ob-star--two{right:18%;top:45%;transform:scale(.8)}.cue-ob-star--three{left:39%;top:22%;transform:scale(.65);background:#fff}
    .cue-ob-city{position:absolute;left:0;right:0;bottom:0;height:clamp(94px,17vh,178px);display:flex;align-items:flex-end;justify-content:space-evenly;gap:clamp(2px,.45vw,8px);opacity:.54}
    .cue-ob-city i{position:relative;display:block;flex:0 1 clamp(18px,4vw,56px);height:var(--h,42%);border-radius:5px 5px 0 0;background:linear-gradient(180deg,#b1d7f5,#85b9e6);box-shadow:inset 0 7px #ffffff3b}
    .cue-ob-city i:nth-child(3n){--h:58%}.cue-ob-city i:nth-child(4n){--h:70%}.cue-ob-city i:nth-child(5n){--h:48%}.cue-ob-city i:nth-child(7n){--h:82%}
    .cue-ob-city .cue-ob-clocktower{flex-basis:clamp(22px,4.2vw,60px);height:88%;background:linear-gradient(90deg,#85b7e5,#b0d5f3)}
    .cue-ob-clocktower:before{content:"";position:absolute;left:50%;top:-17px;transform:translateX(-50%);width:0;height:0;border-left:13px solid transparent;border-right:13px solid transparent;border-bottom:20px solid #76a9dc}
    .cue-ob-clocktower:after{content:"";position:absolute;left:50%;top:12px;transform:translateX(-50%);width:16px;aspect-ratio:1;border:3px solid #f6fbff;border-radius:50%;background:linear-gradient(90deg,transparent 46%,#769dca 47% 54%,transparent 55%),linear-gradient(0deg,transparent 46%,#769dca 47% 54%,transparent 55%)}
    .cue-ob-shell{position:relative;z-index:1;box-sizing:border-box;width:min(100%,1240px);min-height:100vh;min-height:100svh;margin:0 auto;padding:clamp(14px,2.5vw,30px) clamp(16px,4vw,56px) max(15px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:clamp(8px,2vh,20px)}
    .cue-ob-header{display:flex;align-items:center;justify-content:space-between;gap:14px}
    .cue-ob-brand{display:flex;align-items:center;gap:10px;color:#0c438b;font-size:clamp(15px,2vw,21px);font-weight:850;letter-spacing:.01em}
    .cue-ob-brand-mark{display:grid;place-items:center;width:38px;height:38px;border:2px solid #fff;border-radius:14px;background:linear-gradient(145deg,#30c7ff,#1267df);color:#fff;box-shadow:0 5px 12px #2079c533;font-size:20px}
    .cue-ob-progress{display:grid;grid-template-columns:auto minmax(78px,150px);align-items:center;gap:9px;direction:ltr;color:#22568c;font-size:12px;font-weight:750;white-space:nowrap}
    .cue-ob-progress progress{width:100%;height:9px;border:0;border-radius:99px;overflow:hidden;appearance:none;background:#ffffffb8}
    .cue-ob-progress progress::-webkit-progress-bar{background:#ffffffb8;border-radius:99px}.cue-ob-progress progress::-webkit-progress-value{background:linear-gradient(90deg,#30c6ff,#1470e8);border-radius:99px}.cue-ob-progress progress::-moz-progress-bar{background:linear-gradient(90deg,#30c6ff,#1470e8);border-radius:99px}
    .cue-ob-form{display:flex;flex:1;min-height:0;margin:0}
    .cue-ob-content{width:100%;margin:auto;display:grid;grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr);align-items:center;gap:clamp(20px,5vw,70px);direction:ltr}
    .cue-ob-illustration{position:relative;display:grid;place-items:center;min-width:0;min-height:clamp(270px,48vh,460px);isolation:isolate}
    .cue-ob-illustration:before{content:"";position:absolute;inset:14% 9% 4%;z-index:-1;border-radius:48% 52% 39% 42%;background:radial-gradient(ellipse at 50% 60%,#fff9 0 39%,#ffffff48 40% 60%,transparent 61%);}
    .cue-ob-boy{position:relative;width:clamp(190px,25vw,282px);height:clamp(235px,38vh,350px);filter:drop-shadow(0 17px 10px #27629b30);transform:translateY(8px)}
    .cue-ob-boy__hoodie{position:absolute;z-index:1;left:12%;bottom:0;width:76%;height:47%;border-radius:48% 48% 17% 17%;background:linear-gradient(115deg,#0873da 0%,#1360c4 56%,#073d98 100%);box-shadow:inset 11px 4px 0 #5bb5ff55,inset -9px -3px 0 #092f7b45}
    .cue-ob-boy__hoodie:before{content:"";position:absolute;left:19%;top:-14%;width:62%;height:46%;border:12px solid #124f9e;border-bottom:0;border-radius:50% 50% 0 0;background:#2d7fe0}
    .cue-ob-boy__zip{position:absolute;left:50%;top:27%;height:68%;border-left:3px solid #bdeaff;opacity:.9}
    .cue-ob-boy__string{position:absolute;top:25%;left:34%;width:3px;height:31%;border-radius:5px;background:#e9f9ff;transform:rotate(5deg)}.cue-ob-boy__string:after{content:"";position:absolute;bottom:-3px;left:-2px;width:7px;height:7px;border-radius:50%;background:#fff}
    .cue-ob-boy__arm{position:absolute;z-index:3;width:30%;height:16%;border-radius:99px;background:linear-gradient(90deg,#1461bd,#2687ea);top:45%}
    .cue-ob-boy__arm--left{left:0;transform:rotate(34deg)}.cue-ob-boy__arm--right{right:1%;top:48%;transform:rotate(-30deg)}
    .cue-ob-boy__hand{position:absolute;z-index:4;left:-2%;top:34%;width:18%;height:14%;border-radius:48% 50% 45% 45%;background:linear-gradient(145deg,#ffd6af,#f2a36f);box-shadow:inset 0 -3px #df895e55;transform:rotate(-12deg)}
    .cue-ob-boy__hand:before,.cue-ob-boy__hand:after{content:"";position:absolute;left:23%;top:-38%;width:24%;height:69%;border-radius:99px;background:#f9b783;transform:rotate(-17deg)}.cue-ob-boy__hand:after{left:50%;top:-26%;height:58%;transform:rotate(10deg)}
    .cue-ob-boy__head{position:absolute;z-index:5;left:23%;top:6%;width:54%;height:50%;border-radius:46% 48% 48% 48%;background:linear-gradient(145deg,#ffd4ab 0%,#ffc18b 72%,#f4a66f 100%);box-shadow:inset 7px 0 0 #fff4d766,inset -5px -4px 0 #d9825e2b}
    .cue-ob-boy__hair{position:absolute;z-index:7;left:20%;top:2%;width:60%;height:30%;border-radius:58% 47% 34% 27%;background:linear-gradient(145deg,#713c2e 0%,#48251f 55%,#291915 100%);transform:rotate(-6deg);box-shadow:inset 9px 5px 0 #9b594055}
    .cue-ob-boy__hair:before{content:"";position:absolute;left:5%;top:30%;width:37%;height:53%;border-radius:50%;background:#5a3028;box-shadow:17px -11px 0 -2px #64372a,39px -5px 0 -5px #8a4b34}
    .cue-ob-boy__hair:after{content:"";position:absolute;right:-2%;top:34%;width:21%;height:67%;border-radius:40% 60% 75% 44%;background:#4a251f;transform:rotate(12deg)}
    .cue-ob-boy__ear{position:absolute;z-index:4;top:42%;width:16%;height:20%;border-radius:50%;background:#f3a978}.cue-ob-boy__ear--left{left:-9%}.cue-ob-boy__ear--right{right:-9%}
    .cue-ob-boy__eye{position:absolute;top:48%;width:15%;height:19%;border-radius:50%;background:#fff;box-shadow:0 1px 1px #6d3d3655}.cue-ob-boy__eye:after{content:"";position:absolute;left:27%;top:12%;width:61%;height:80%;border-radius:50%;background:radial-gradient(circle at 64% 32%,#fff 0 16%,transparent 18%),#39231d}
    .cue-ob-boy__eye--left{left:22%}.cue-ob-boy__eye--right{right:22%}
    .cue-ob-boy__brow{position:absolute;z-index:2;top:40%;width:19%;height:4%;border-radius:50%;background:#4c2924}.cue-ob-boy__brow--left{left:19%;transform:rotate(-8deg)}.cue-ob-boy__brow--right{right:19%;transform:rotate(8deg)}
    .cue-ob-boy__cheek{position:absolute;top:68%;width:16%;height:8%;border-radius:50%;background:#fa938477;filter:blur(3px)}.cue-ob-boy__cheek--left{left:11%}.cue-ob-boy__cheek--right{right:11%}
    .cue-ob-boy__smile{position:absolute;left:37%;top:70%;width:27%;height:14%;border-bottom:4px solid #8f3b36;border-radius:0 0 50% 50%;background:linear-gradient(180deg,transparent 55%,#fff 57% 80%,transparent 82%);transform:rotate(-2deg)}
    .cue-ob-props{position:absolute;z-index:2;left:4%;right:4%;bottom:4%;display:flex;align-items:flex-end;justify-content:space-between;pointer-events:none}
    .cue-ob-books{display:flex;flex-direction:column;gap:3px;transform:rotate(-7deg)}.cue-ob-books i{display:block;width:76px;height:17px;border:2px solid #fff9;border-radius:5px;background:#1688dc;box-shadow:0 3px 4px #27619b33}.cue-ob-books i:nth-child(2){width:90px;background:#ffbd43}.cue-ob-books i:nth-child(3){width:68px;background:#ef6f66}
    .cue-ob-globe{position:relative;width:82px;aspect-ratio:1;border:5px solid #eaf7ff;border-radius:50%;background:radial-gradient(ellipse at 34% 29%,#76ddff 0 4%,transparent 5%),linear-gradient(140deg,#28a5ef,#1764c7 72%);box-shadow:0 8px 16px #1b579655}
    .cue-ob-globe:before{content:"";position:absolute;left:22%;top:15%;width:38%;height:39%;border-radius:62% 40% 48% 45%;background:#77d39b;transform:rotate(18deg);box-shadow:22px 28px 0 -6px #77d39b,-8px 33px 0 -9px #77d39b}
    .cue-ob-globe:after{content:"";position:absolute;inset:10% 25%;border-left:2px solid #ffffff62;border-right:2px solid #ffffff62;border-radius:50%}
    .cue-ob-question{display:grid;place-items:center;width:65px;height:65px;border:4px solid #fff;border-radius:50% 50% 50% 10%;background:#ffd354;color:#fff;font-size:43px;font-weight:900;box-shadow:0 7px 16px #a9782d35;transform:rotate(-10deg)}
    .cue-ob-cake{position:relative;width:106px;height:78px;margin-bottom:2px;border-radius:16px 16px 10px 10px;background:linear-gradient(180deg,#fff5d9 0 27%,#ec83aa 28% 56%,#fff1da 57% 74%,#e55f88 75%);box-shadow:0 9px 16px #8f436333}
    .cue-ob-cake:before{content:"";position:absolute;left:-8px;right:-8px;top:-8px;height:17px;border-radius:50%;background:#fff0d0;box-shadow:0 4px #ed7fa2}
    .cue-ob-candles{position:absolute;left:27%;top:-36px;display:flex;gap:11px}.cue-ob-candles i{position:relative;width:7px;height:30px;border-radius:4px;background:repeating-linear-gradient(135deg,#fff 0 5px,#48a5e8 5px 9px)}.cue-ob-candles i:before{content:"";position:absolute;left:0;top:-11px;width:7px;height:11px;border-radius:50% 50% 50% 0;background:#ffb83c;transform:rotate(-45deg)}
    .cue-ob-learning-book{padding:9px 11px 10px;border:3px solid #fff;border-radius:8px 13px 13px 8px;background:linear-gradient(145deg,#277ce0,#0c4cae);box-shadow:0 7px 14px #144c8b55;color:#fff;font-size:13px;font-weight:850;transform:rotate(-8deg)}
    .cue-ob-cap{position:relative;width:66px;height:22px;margin-inline-start:8px;margin-bottom:42px;background:#172e79;clip-path:polygon(50% 0,100% 43%,50% 85%,0 43%);filter:drop-shadow(0 4px 3px #0003)}.cue-ob-cap:after{content:"";position:absolute;right:0;top:12px;width:3px;height:19px;background:#e8b42e}
    .cue-ob-card{box-sizing:border-box;width:min(100%,590px);margin-inline-start:auto;padding:clamp(20px,3vw,36px);border:1px solid #fff;border-radius:30px;background:linear-gradient(145deg,#ffffffed,#f8fcfff2);box-shadow:0 18px 46px #275b8d22,inset 0 1px #fff;backdrop-filter:blur(12px);direction:rtl;animation:cueObFadeIn .35s ease-out both}
    .cue-ob-kicker{display:inline-flex;align-items:center;gap:8px;margin-bottom:12px;padding:6px 12px;border:1px solid #c8e6ff;border-radius:99px;background:#edf8ff;color:#2472bc;font-size:12px;font-weight:800}
    .cue-ob-kicker:before{content:"";width:8px;height:8px;border-radius:50%;background:#35b9ee;box-shadow:0 0 0 4px #35b9ee22}
    .cue-ob-title{display:grid;gap:3px;margin:0;color:#092e78;font-size:clamp(25px,3.6vw,39px);line-height:1.28;font-weight:900;letter-spacing:-.025em;text-align:center}
    .cue-ob-title [lang="en"]{font-size:.75em;line-height:1.3;font-weight:800;letter-spacing:-.015em;color:#16539b}
    .cue-ob-subtitle{display:grid;gap:2px;margin:11px 0 21px;color:#42658c;font-size:clamp(14px,1.5vw,17px);line-height:1.65;text-align:center}
    .cue-ob-subtitle [lang="en"]{font-size:.96em;color:#547396}
    .cue-ob-controls{display:grid;gap:13px}
    .cue-ob-actions{display:grid;grid-template-columns:1fr 1fr;gap:11px}
    .cue-ob-btn{display:flex;justify-content:center;align-items:center;gap:8px;min-height:52px;box-sizing:border-box;padding:10px 15px;border:2px solid transparent;border-radius:17px;background:#fff;color:#174777;font:inherit;font-size:16px;font-weight:850;line-height:1.25;cursor:pointer;touch-action:manipulation;transition:transform .16s ease,box-shadow .16s ease,background .16s ease}
    .cue-ob-btn:hover{transform:translateY(-2px);box-shadow:0 7px 15px #215c9b22}.cue-ob-btn:active{transform:translateY(0)}
    .cue-ob-btn:focus-visible,.cue-ob-back:focus-visible,.cue-ob-level:focus-visible,.cue-ob-input:focus-visible,.cue-ob-select:focus-visible{outline:4px solid #176ce8;outline-offset:3px}
    .cue-ob-btn--primary{border-color:#0e5bc9;background:linear-gradient(180deg,#30baff,#0876e8 62%,#0756c7);color:#fff;box-shadow:0 7px 16px #0767c532,inset 0 1px #ffffff95}
    .cue-ob-btn--yes{border-color:#38a65a;background:linear-gradient(180deg,#73df7c,#31af59);color:#fff;box-shadow:0 7px 16px #219b4d32,inset 0 1px #ffffff99}
    .cue-ob-btn--quiet{border-color:#c7dff4;background:#fff;color:#27547e}
    .cue-ob-btn span{display:block}.cue-ob-btn [lang="en"]{font-size:.83em;font-weight:700;opacity:.94}
    .cue-ob-field{display:grid;gap:7px;color:#1b4678;font-weight:800;font-size:14px}
    .cue-ob-input,.cue-ob-select{width:100%;min-height:54px;box-sizing:border-box;padding:12px 14px;border:2px solid #bed9f1;border-radius:15px;background:#fff;color:#132f62;font:inherit;font-size:16px;line-height:1.3;box-shadow:0 3px 8px #2c67a00d}
    .cue-ob-input::placeholder{color:#8a9db1;font-weight:550}.cue-ob-select{cursor:pointer}
    .cue-ob-actions--single{grid-template-columns:1fr}
    .cue-ob-level-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;direction:ltr}
    .cue-ob-level{display:grid;direction:rtl;align-content:center;justify-items:center;gap:3px;min-height:80px;padding:9px 5px;border:2px solid #c9def2;border-radius:16px;background:linear-gradient(150deg,#fff,#eff8ff);color:#12457f;font:inherit;text-align:center;cursor:pointer;box-shadow:0 4px 9px #2469a011;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
    .cue-ob-level:hover{transform:translateY(-2px);border-color:#54a4e4;box-shadow:0 8px 14px #2469a022}.cue-ob-level:active{transform:translateY(0)}
    .cue-ob-level-ar{font-size:13px;font-weight:850;line-height:1.25}.cue-ob-level-en{font-size:12px;line-height:1.2}.cue-ob-level-code{font-size:12px;font-weight:900;color:#0c66bb}
    .cue-ob-level[data-cue-ob-level="unknown"]{background:#f7f0ff;border-color:#dfc8fb;color:#68419a}
    .cue-ob-navigation{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:2px}
    .cue-ob-back{min-height:42px;padding:7px 11px;border:0;border-radius:12px;background:transparent;color:#32638e;font:inherit;font-size:14px;font-weight:750;cursor:pointer}
    .cue-ob-back:hover{background:#eaf5ff}
    .cue-ob-status{min-height:0;margin:2px 0 0;padding:0;color:#a42938;font-size:13px;line-height:1.5;font-weight:700;overflow-wrap:anywhere}.cue-ob-status:empty{display:none}
    .cue-ob-footer{display:flex;justify-content:center;align-items:center;min-height:16px;color:#49719b;font-size:11px;text-align:center}
    .cue-ob-sr{position:absolute!important;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
    .cue-ob-summary{border:1px solid #b9d7f5;border-radius:12px;background:#eef7ff;padding:12px;margin-bottom:12px;color:#173c6b;font-size:14px;line-height:1.7;overflow-wrap:anywhere}
    .cue-ob-summary button{border:0;background:none;color:#184b8e;font:inherit;text-decoration:underline;cursor:pointer;padding:4px}
    @keyframes cueObFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @media(max-width:760px){
      .cue-ob-shell{gap:5px;padding:11px 14px max(12px,env(safe-area-inset-bottom))}.cue-ob-header{min-height:42px}.cue-ob-brand{font-size:15px}.cue-ob-brand-mark{width:32px;height:32px;border-radius:11px}
      .cue-ob-content{grid-template-columns:minmax(0,1fr);gap:0;direction:rtl}.cue-ob-illustration{grid-row:1;min-height:clamp(150px,24svh,220px);max-height:220px}.cue-ob-illustration:before{inset:7% 16% 0}.cue-ob-boy{width:clamp(150px,44vw,220px);height:clamp(183px,30svh,246px);transform:translateY(14px)}
      .cue-ob-props{left:8%;right:8%;bottom:2%}.cue-ob-globe{width:62px}.cue-ob-cake{transform:scale(.82);transform-origin:bottom left}.cue-ob-card{width:min(100%,620px);margin:0 auto;padding:clamp(18px,5vw,25px);border-radius:25px}.cue-ob-title{font-size:clamp(24px,7vw,34px)}.cue-ob-subtitle{margin:8px 0 15px}.cue-ob-level-grid{gap:7px}.cue-ob-level{min-height:72px}
      .cue-ob-city{height:10vh;opacity:.42}.cue-ob-sun{right:5%;top:7%;width:64px}.cue-ob-cloud--two{right:13%;top:27%}.cue-ob-footer{display:none}
    }
    @media(max-width:390px){.cue-ob-progress{grid-template-columns:auto 78px;gap:6px;font-size:11px}.cue-ob-brand{gap:7px;font-size:14px}.cue-ob-actions{gap:8px}.cue-ob-btn{padding:9px 8px;font-size:14px}.cue-ob-level{min-height:68px}.cue-ob-level-ar{font-size:12px}.cue-ob-level-en{font-size:11px}}
    @media(max-height:690px) and (min-width:761px){.cue-ob-shell{padding-top:10px;padding-bottom:10px;gap:6px}.cue-ob-illustration{min-height:240px}.cue-ob-boy{height:245px}.cue-ob-card{padding:20px}.cue-ob-subtitle{margin:7px 0 12px}.cue-ob-level{min-height:66px}}
    @media(prefers-reduced-motion:reduce){.cue-ob-card,.cue-ob-btn,.cue-ob-level{animation:none;transition:none}}
  `;
  function cueValidOnboardingDraft(draft) {
    return !!draft && validProfile(draft) && cueOnboardingLevels.includes(draft.level);
  }
  function cueOnboardingMetadata(draft) {
    if (!cueValidOnboardingDraft(draft)) return null;
    return { profile_name: cleanName(draft.name), profile_country: draft.country, profile_age: Number(draft.age), cue_onboarding_v1: { version: 1, english_level: draft.level } };
  }
  function renderAuth(status = '', good = false) {
    if (!status && !currentSession && !cueOnboardingDismissed) return cueRenderOnboarding(0);
    return renderAuthForm(status, good);
  }
  function cueOnboardingSceneMarkup(step) {
    let props = '';
    if (step === 1) props = '<div class="cue-ob-books"><i></i><i></i><i></i></div><div class="cue-ob-globe"></div>';
    if (step === 2) props = '<div class="cue-ob-question">?</div>';
    if (step === 3) props = '<div class="cue-ob-globe"></div>';
    if (step === 4) props = '<div class="cue-ob-cake"><span class="cue-ob-candles"><i></i><i></i><i></i></span></div>';
    if (step === 5) props = '<div class="cue-ob-learning-book">English</div><div class="cue-ob-cap"></div>';
    return `<div class="cue-ob-boy"><i class="cue-ob-boy__hoodie"><i class="cue-ob-boy__zip"></i><i class="cue-ob-boy__string"></i></i><i class="cue-ob-boy__arm cue-ob-boy__arm--left"></i><i class="cue-ob-boy__arm cue-ob-boy__arm--right"></i><i class="cue-ob-boy__hand"></i><i class="cue-ob-boy__ear cue-ob-boy__ear--left"></i><i class="cue-ob-boy__ear cue-ob-boy__ear--right"></i><i class="cue-ob-boy__head"><i class="cue-ob-boy__brow cue-ob-boy__brow--left"></i><i class="cue-ob-boy__brow cue-ob-boy__brow--right"></i><i class="cue-ob-boy__eye cue-ob-boy__eye--left"></i><i class="cue-ob-boy__eye cue-ob-boy__eye--right"></i><i class="cue-ob-boy__cheek cue-ob-boy__cheek--left"></i><i class="cue-ob-boy__cheek cue-ob-boy__cheek--right"></i><i class="cue-ob-boy__smile"></i></i><i class="cue-ob-boy__hair"></i></div><div class="cue-ob-props">${props}</div>`;
  }
  function cueRenderOnboarding(step = 0) {
    if (currentSession || explicitSignInInFlight) return;
    step = Math.max(0, Math.min(5, Number(step) || 0));
    const headings = [
      ['مرحباً بك!','Welcome!'],
      ['هنا ستتعلم اللغة الإنجليزية!','Here you will learn English!'],
      ['ما اسمك؟','What is your name?'],
      ['من أي بلد أنت؟','Which country do you live in?'],
      ['كم عمرك؟','How old are you?'],
      ['ما مستواك في اللغة الإنجليزية؟','What is your level in English?']
    ];
    const subtitles = [
      ['هل ترغب في بدء التعلّم؟','Would you like to start learning?'],
      ['التعلّم معنا سهل وممتع، خطوة صغيرة كل يوم.','Learning with us is easy and fun, one small step at a time.'],
      ['لنبدأ بالتعرّف إليك.','Let’s start by getting to know you.'],
      ['اختر البلد الذي تعيش فيه.','Choose the country where you live.'],
      ['اختر عمرك لمساعدتنا على تخصيص تجربتك.','Choose your age so we can tailor your experience.'],
      ['اختر الأقرب إلى مستواك الحالي.','Choose the option closest to your current level.']
    ];
    const stageNames = ['مرحباً / Welcome','رحلة التعلّم / Learning journey','التعريف بك / About you','بلدك / Your country','عمرك / Your age','مستواك / Your level'];
    let controls = '';
    if (step === 0) controls = `<div class="cue-ob-actions"><button type="button" class="cue-ob-btn cue-ob-btn--yes" id="cueObYes"><span lang="ar" dir="rtl">نعم</span><span lang="en" dir="ltr">Yes</span></button><button type="button" class="cue-ob-btn cue-ob-btn--quiet" id="cueObNotNow"><span lang="ar" dir="rtl">ليس الآن</span><span lang="en" dir="ltr">Not now</span></button></div>`;
    if (step === 1) controls = `<div class="cue-ob-actions cue-ob-actions--single"><button type="submit" class="cue-ob-btn cue-ob-btn--primary"><span lang="ar" dir="rtl">التالي</span><span lang="en" dir="ltr">Next</span></button></div>`;
    if (step === 2) controls = `<label class="cue-ob-field" for="cueObName"><span lang="ar" dir="rtl">الاسم / <span lang="en" dir="ltr">Your name</span></span><input id="cueObName" class="cue-ob-input" name="name" type="text" autocomplete="name" maxlength="100" minlength="2" placeholder="اكتب اسمك / Enter your name" value="${esc(cueOnboardingDraft.name)}" dir="auto" aria-describedby="cueObStatus"></label><button type="submit" class="cue-ob-btn cue-ob-btn--primary"><span lang="ar" dir="rtl">التالي</span><span lang="en" dir="ltr">Next</span></button>`;
    if (step === 3) controls = `<label class="cue-ob-field" for="cueObCountry"><span lang="ar" dir="rtl">اختر بلدك / <span lang="en" dir="ltr">Your country</span></span><select id="cueObCountry" class="cue-ob-select${cueOnboardingDraft.country ? '' : ' cue-ob-empty'}" name="country" aria-describedby="cueObStatus"><option value="">اختر بلدك / Select your country</option>${COUNTRY_OPTIONS.map(([code,label])=>`<option value="${code}"${cueOnboardingDraft.country===code?' selected':''}>${esc(label)} / ${esc(cueOnboardingCountryEnglish[code])}</option>`).join('')}</select></label><button type="submit" class="cue-ob-btn cue-ob-btn--primary"><span lang="ar" dir="rtl">التالي</span><span lang="en" dir="ltr">Next</span></button>`;
    if (step === 4) controls = `<label class="cue-ob-field" for="cueObAge"><span lang="ar" dir="rtl">اختر عمرك / <span lang="en" dir="ltr">Your age</span></span><select id="cueObAge" class="cue-ob-select${cueOnboardingDraft.age ? '' : ' cue-ob-empty'}" name="age" aria-describedby="cueObStatus"><option value="">اختر عمرك / Select your age</option>${Array.from({length:70},(_,i)=>i+1).map(age=>`<option value="${age}"${Number(cueOnboardingDraft.age)===age?' selected':''}>${age} سنة / ${age} years</option>`).join('')}</select></label><button type="submit" class="cue-ob-btn cue-ob-btn--primary"><span lang="ar" dir="rtl">التالي</span><span lang="en" dir="ltr">Next</span></button>`;
    if (step === 5) controls = `<div class="cue-ob-level-grid" role="group" aria-label="مستوى اللغة الإنجليزية / English level">${cueOnboardingLevels.map((level,i)=>{const labels=cueOnboardingLevelLabels[i].split(' / ');return `<button type="button" class="cue-ob-level" data-cue-ob-level="${level}" aria-label="${esc(cueOnboardingLevelLabels[i])}"><span class="cue-ob-level-ar" lang="ar" dir="rtl">${esc(labels[0])}</span><span class="cue-ob-level-en" lang="en" dir="ltr">${esc(labels[1].replace(/ \([A-Z0-9]+\)$/,''))}</span><span class="cue-ob-level-code">${level==='unknown'?'?':`(${level})`}</span></button>`;}).join('')}</div>`;
    const progressValue = step + 1;
    setGate(`<section class="cue-onboarding" aria-labelledby="cueObHeading" data-step="${progressValue}"><div class="cue-ob-scene" aria-hidden="true"><span class="cue-ob-sun"></span><span class="cue-ob-cloud cue-ob-cloud--one"></span><span class="cue-ob-cloud cue-ob-cloud--two"></span><span class="cue-ob-cloud cue-ob-cloud--three"></span><span class="cue-ob-star cue-ob-star--one"></span><span class="cue-ob-star cue-ob-star--two"></span><span class="cue-ob-star cue-ob-star--three"></span><div class="cue-ob-city"><i></i><i></i><i></i><i></i><i></i><i class="cue-ob-clocktower"></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="cue-ob-shell"><header class="cue-ob-header"><div class="cue-ob-brand"><span class="cue-ob-brand-mark" aria-hidden="true">A</span><span>English Teacher</span></div><div class="cue-ob-progress" dir="ltr"><span>Step ${progressValue} / 6</span><progress value="${progressValue}" max="6" aria-label="الخطوة ${progressValue} من 6 / Step ${progressValue} of 6"></progress></div></header><form id="cueObForm" class="cue-ob-form" novalidate><div class="cue-ob-content"><div class="cue-ob-illustration" aria-hidden="true">${cueOnboardingSceneMarkup(step)}</div><section class="cue-ob-card"><div class="cue-ob-kicker">${stageNames[step]}</div><h1 id="cueObHeading" class="cue-ob-title"><span lang="ar" dir="rtl">${headings[step][0]}</span><span lang="en" dir="ltr">${headings[step][1]}</span></h1><p class="cue-ob-subtitle"><span lang="ar" dir="rtl">${subtitles[step][0]}</span><span lang="en" dir="ltr">${subtitles[step][1]}</span></p><div class="cue-ob-controls">${controls}</div><p class="cue-ob-status" id="cueObStatus" role="status" aria-live="polite"></p><div class="cue-ob-navigation">${step>0?'<button type="button" class="cue-ob-back" id="cueObBack"><span lang="ar" dir="rtl">السابق</span> / <span lang="en" dir="ltr">Back</span></button>':''}${step===0?'<span></span>':''}</div></section></div></form><footer class="cue-ob-footer"><span lang="ar" dir="rtl">تعلّم الإنجليزية يبدأ بخطوة بسيطة</span>&nbsp;·&nbsp;<span lang="en" dir="ltr">Your English journey starts with one small step</span></footer></div></section>`);
    const form = document.getElementById('cueObForm');
    const status = document.getElementById('cueObStatus');
    const capture = () => {
      if (step === 2) cueOnboardingDraft.name = cleanName(form.elements.name.value);
      if (step === 3) cueOnboardingDraft.country = form.elements.country.value;
      if (step === 4) cueOnboardingDraft.age = form.elements.age.value;
    };
    document.getElementById('cueObNotNow')?.addEventListener('click', () => { status.textContent='ابدأ عندما تكون مستعداً بالضغط على نعم. / When you are ready, tap Yes to begin.'; });
    document.getElementById('cueObYes')?.addEventListener('click', () => cueRenderOnboarding(1));
    document.getElementById('cueObBack')?.addEventListener('click', () => { capture(); cueRenderOnboarding(step-1); });
    form.querySelectorAll('select').forEach(select=>select.addEventListener('change',()=>select.classList.toggle('cue-ob-empty',!select.value)));
    form.addEventListener('submit',event=>{
      event.preventDefault(); capture();
      if (step===2 && !validName(cueOnboardingDraft.name)) {status.textContent='اكتب اسماً من حرفين عربيين أو إنجليزيين على الأقل، دون أرقام أو رموز. / Enter at least two Arabic or English letters, without numbers or symbols.';form.elements.name.focus();return;}
      if (step===3 && !COUNTRY_LABEL[cueOnboardingDraft.country]) {status.textContent='اختر بلدك للمتابعة. / Select your country to continue.';form.elements.country.focus();return;}
      if (step===4 && (!Number.isInteger(Number(cueOnboardingDraft.age)) || Number(cueOnboardingDraft.age)<1 || Number(cueOnboardingDraft.age)>70)) {status.textContent='اختر عمرك من 1 إلى 70. / Select your age from 1 to 70.';form.elements.age.focus();return;}
      if (step>=1 && step<5) cueRenderOnboarding(step+1);
    });
    form.querySelectorAll('[data-cue-ob-level]').forEach(button=>button.addEventListener('click',()=>{
      cueOnboardingDraft.level=button.dataset.cueObLevel;
      if (!cueValidOnboardingDraft(cueOnboardingDraft)) {cueRenderOnboarding(2);return;}
      cueOnboardingDismissed=true;
      renderAuthForm('',false,'signup',Object.freeze({...cueOnboardingDraft,age:Number(cueOnboardingDraft.age)}));
    }));
    const heading=document.getElementById('cueObHeading');heading.tabIndex=-1;heading.focus({preventScroll:true});
  }

  /* CUE_AUTH_FINAL_HANDMADE_V1: presentation only; authentication stays unchanged. */
  style.textContent += `
    .cue-auth-final .cue-auth-final-layout{flex:1}
    .cue-auth-final .cue-auth-card{width:min(100%,590px);padding:clamp(22px,3vw,32px);border:1px solid #fff;border-radius:30px;background:linear-gradient(145deg,#ffffffed,#f8fcfff2);box-shadow:0 18px 46px #275b8d22,inset 0 1px #fff;color:#0a2d72}
    .cue-auth-final .cue-auth-card h1{display:grid;gap:3px;margin:0;color:#092e78;font-size:clamp(25px,3.2vw,35px);line-height:1.28;font-weight:900;letter-spacing:-.025em;text-align:center}
    .cue-auth-final .cue-auth-card h1 [lang="en"]{font-size:.75em;line-height:1.3;font-weight:800;color:#16539b}
    .cue-auth-final #cueAuthIntro{margin:12px 0 18px;color:#42658c;font-size:14px;line-height:1.75;text-align:start;font-weight:500}
    .cue-auth-final .cue-auth-form{gap:14px}
    .cue-auth-final .cue-auth-form label{gap:7px;color:#1b4678;font-size:14px;font-weight:800}
    .cue-auth-final .cue-auth-form input{min-height:54px;padding:12px 14px;border:2px solid #bed9f1;border-radius:15px;background:#fff;color:#132f62;font:inherit;font-size:16px;line-height:1.3;box-shadow:0 3px 8px #2c67a00d;transition:border-color .16s,box-shadow .16s}
    .cue-auth-final .cue-auth-form input:hover{border-color:#90bfe7}
    .cue-auth-final .cue-auth-form input:focus-visible{outline:3px solid #176ce8;outline-offset:3px;border-color:#176ce8}
    .cue-auth-final .cue-btn{min-height:52px;padding:11px 15px;border:2px solid #0e5bc9;border-radius:17px;background:linear-gradient(180deg,#30baff,#0876e8 62%,#0756c7);box-shadow:0 7px 16px #0767c532,inset 0 1px #ffffff95;color:#fff;font-size:16px;font-weight:850;line-height:1.4;touch-action:manipulation;transition:transform .16s,box-shadow .16s}
    .cue-auth-final .cue-btn:not(:disabled):hover{transform:translateY(-2px);box-shadow:0 10px 20px #0767c540,inset 0 1px #ffffff95}
    .cue-auth-final .cue-btn:not(:disabled):active{transform:translateY(0)}
    .cue-auth-final .cue-btn:focus-visible,.cue-auth-final .cue-auth-links button:focus-visible,.cue-auth-final .cue-ob-summary button:focus-visible{outline:3px solid #176ce8;outline-offset:3px}
    .cue-auth-final .cue-btn.secondary{border-color:#c7dff4;background:#fff;color:#27547e;box-shadow:0 4px 10px #2469a011}
    .cue-auth-final .cue-auth-message{min-height:0;margin:0 0 14px;padding:10px 12px;border:1px solid #efb6bd;border-radius:13px;background:#fff0f2;color:#9c243b;font-size:13px;font-weight:650;line-height:1.6}
    .cue-auth-final .cue-auth-message:empty{display:none}
    .cue-auth-final .cue-auth-message.ok{border-color:#acd8bf;background:#eefaf2;color:#206448}
    .cue-auth-final #cueOAuthActions:empty{display:none}
    .cue-auth-final #cueOAuthActions:not(:empty){margin-top:12px}
    .cue-auth-final .cue-ob-summary{margin:18px 0 0;padding:12px 14px;border:1px solid #c8e2f7;border-radius:16px;background:linear-gradient(145deg,#eef8ff,#f5faff);color:#315d88;font-size:12px;line-height:1.65}
    .cue-auth-final .cue-ob-summary strong{color:#174777;font-size:13px}
    .cue-auth-final .cue-ob-summary button{min-height:36px;color:#1763aa;text-underline-offset:4px}
    .cue-auth-final .cue-auth-links{justify-content:center;gap:5px 12px;margin-top:13px}
    .cue-auth-final .cue-auth-links button{min-height:42px;padding:7px 10px;border-radius:11px;color:#245d97;font-size:13px;font-weight:750;text-underline-offset:4px}
    .cue-auth-final .cue-auth-links button:hover{background:#eaf5ff}
    .cue-auth-final .cue-auth-stage-label{color:#22568c;font-size:12px;font-weight:750;line-height:1.5;text-align:end}
    @media(max-width:760px){
      .cue-auth-final .cue-ob-shell{gap:8px}
      .cue-auth-final .cue-auth-final-layout{gap:4px}
      .cue-auth-final .cue-ob-illustration{min-height:148px;height:148px;max-height:148px}
      .cue-auth-final .cue-ob-boy{width:120px;height:146px;transform:translateY(5px)}
      .cue-auth-final .cue-ob-illustration:before{inset:7% 18% 0}
      .cue-auth-final .cue-ob-props{left:15%;right:15%;bottom:5%}
      .cue-auth-final .cue-ob-globe{width:47px;border-width:3px}
      .cue-auth-final .cue-ob-books{transform:scale(.65) rotate(-7deg);transform-origin:bottom left}
      .cue-auth-final .cue-auth-card{padding:22px 20px;border-radius:25px}
      .cue-auth-final .cue-auth-card h1{font-size:28px}
      .cue-auth-final #cueAuthIntro{margin:10px 0 17px;font-size:13px;line-height:1.7}
      .cue-auth-final .cue-auth-stage-label{max-width:140px;font-size:11px}
      .cue-auth-final .cue-ob-sun{width:54px;top:65px}
      .cue-auth-final .cue-ob-footer{padding:8px 0 2px;line-height:1.7;flex-wrap:wrap}
    }
    @media(max-width:360px){.cue-auth-final .cue-auth-card{padding:20px 16px}.cue-auth-final .cue-auth-stage-label{max-width:110px}.cue-auth-final .cue-ob-brand{font-size:13px}.cue-auth-final .cue-ob-brand-mark{width:29px;height:29px}}
    @media(prefers-reduced-motion:reduce){.cue-auth-final .cue-btn,.cue-auth-final .cue-auth-form input{transition:none}}
  `;
  function renderAuthForm(status = '', good = false, initialMode = 'login', signupDraft = null) {
    const guidedDraft = cueValidOnboardingDraft(signupDraft) ? signupDraft : null;
    let activeSignupDraft = guidedDraft;
    const guidedMode = !!guidedDraft;
    setGate(`<section class="cue-onboarding cue-auth-final" dir="rtl" aria-labelledby="cueAuthTitle"><div class="cue-ob-scene" aria-hidden="true"><span class="cue-ob-sun"></span><span class="cue-ob-cloud cue-ob-cloud--one"></span><span class="cue-ob-cloud cue-ob-cloud--two"></span><span class="cue-ob-cloud cue-ob-cloud--three"></span><span class="cue-ob-star cue-ob-star--one"></span><span class="cue-ob-star cue-ob-star--two"></span><span class="cue-ob-star cue-ob-star--three"></span><div class="cue-ob-city"><i></i><i></i><i></i><i></i><i></i><i class="cue-ob-clocktower"></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div></div><div class="cue-ob-shell"><header class="cue-ob-header"><div class="cue-ob-brand"><span class="cue-ob-brand-mark" aria-hidden="true">A</span><span>English Teacher</span></div><div class="cue-auth-stage-label"><span lang="ar" dir="rtl">البريد وكلمة المرور</span><br><span lang="en" dir="ltr">Email &amp; password</span></div></header><div class="cue-ob-content cue-auth-final-layout"><div class="cue-ob-illustration" aria-hidden="true">${cueOnboardingSceneMarkup(1)}</div><section class="cue-auth-card cue-ob-card"><div class="cue-ob-kicker"><span lang="ar" dir="rtl">حسابك</span> / <span lang="en" dir="ltr">Your account</span></div>
      <h1 id="cueAuthTitle"><span lang="ar" dir="rtl">لنبدأ التعلّم!</span><span lang="en" dir="ltr">Let’s start learning!</span></h1>
      <p id="cueAuthIntro">${guidedMode ? 'أدخل بريدك وكلمة المرور للمتابعة. إن كان لديك حساب سندخلك إليه، وإلا سننشئ حساباً جديداً. / Enter your email and password. We will sign you into your existing account, or create a new one.' : 'استخدم بريدك وكلمة المرور للوصول إلى الدروس ومزامنة تقدمك بين أجهزتك. / Use your email and password to access lessons and sync your progress across devices.'}</p>
      <div id="cueAuthMessage" class="cue-auth-message" role="status" aria-live="polite"></div>
      <form id="cueAuthForm" class="cue-auth-form" novalidate>
        <label>البريد الإلكتروني / Email<input name="email" type="email" autocomplete="email" maxlength="254" required dir="ltr"></label>
        <label>كلمة المرور / Password<input name="password" type="password" autocomplete="current-password" required></label>
        <div class="cue-auth-actions"><button class="cue-btn" type="submit" id="cueAuthSubmit">${guidedMode ? 'متابعة / Continue' : 'تسجيل الدخول / Sign in'}</button></div>
      </form><div id="cueOAuthActions" class="cue-auth-actions">${providerButtons()}</div>
      ${guidedDraft ? `<div class="cue-ob-summary" id="cueObSummary"><strong>اختياراتك / Your choices</strong><br>${esc(guidedDraft.name)} • ${esc(COUNTRY_LABEL[guidedDraft.country])} / ${esc(cueOnboardingCountryEnglish[guidedDraft.country])} • ${Number(guidedDraft.age)}<br>${esc(cueOnboardingLevelLabels[cueOnboardingLevels.indexOf(guidedDraft.level)])}<br><button id="cueObEdit" type="button">تعديل الاختيارات / Edit choices</button></div>` : ''}
      <div class="cue-auth-links"><button id="cueAuthToggle" type="button">${guidedMode ? 'لدي حساب بالفعل / I already have an account' : 'إنشاء حساب جديد / Create an account'}</button>${!guidedMode ? '<button id="cueOnboardingStart" type="button">التسجيل خطوة بخطوة / Guided sign-up</button>' : ''}</div>
    </section></div><footer class="cue-ob-footer"><span lang="ar" dir="rtl">تعلّم الإنجليزية يبدأ بخطوة بسيطة</span>&nbsp;·&nbsp;<span lang="en" dir="ltr">Your English journey starts with one small step</span></footer></div></section>`);
    const form=document.getElementById('cueAuthForm'), msg=document.getElementById('cueAuthMessage'), toggle=document.getElementById('cueAuthToggle'), intro=document.getElementById('cueAuthIntro'), submit=document.getElementById('cueAuthSubmit');
    let mode = guidedMode ? 'guided' : (initialMode === 'signup' ? 'signup' : 'login');
    setMessage(msg,status,good);
    const setMode = next => {
      if (explicitSignInInFlight) return;
      mode = next;
      const signup = mode === 'signup';
      intro.textContent = signup ? 'أنشئ حساباً جديداً ببريدك وكلمة مرور من 6 أحرف على الأقل. / Create a new account with your email and a password of at least 6 characters.' : 'استخدم بريدك وكلمة المرور للوصول إلى الدروس ومزامنة تقدمك. / Sign in with your email and password to access lessons and sync progress.';
      form.elements.password.autocomplete = signup ? 'new-password' : 'current-password';
      if (signup) form.elements.password.minLength = 6;
      else form.elements.password.removeAttribute('minlength');
      submit.textContent = signup ? 'إنشاء الحساب / Create account' : 'تسجيل الدخول / Sign in';
      toggle.textContent = signup ? 'لدي حساب بالفعل / I already have an account' : 'إنشاء حساب جديد / Create an account';
      setMessage(msg, '');
    };
    if (!guidedMode && mode === 'signup') { setMode('signup'); setMessage(msg,status,good); }
    toggle.addEventListener('click', () => {
      if (mode === 'guided') setMode('login');
      else setMode(mode === 'login' ? 'signup' : 'login');
    });
    document.getElementById('cueOnboardingStart')?.addEventListener('click', () => {
      if (explicitSignInInFlight) return;
      cueOnboardingDraft = { name: '', country: '', age: '', level: '' };
      cueOnboardingDismissed = false;
      cueRenderOnboarding(0);
    });
    document.getElementById('cueObEdit')?.addEventListener('click', () => { if (!explicitSignInInFlight) cueRenderOnboarding(2); });
    document.querySelectorAll('[data-auth-provider]').forEach(button => button.addEventListener('click', async () => {
      if (!client) { setMessage(msg, 'تعذر الاتصال بخدمة تسجيل الدخول. / Could not connect to the sign-in service.'); return; }
      button.disabled = true;
      try { const { error } = await client.auth.signInWithOAuth({ provider: button.dataset.authProvider, options: { redirectTo: location.origin + location.pathname } }); if (error) throw error; }
      catch (error) { setMessage(msg, authErrorMessage(error, 'login')); button.disabled = false; }
    }));
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (explicitSignInInFlight) return;
      const submittedMode = mode;
      const email=form.elements.email.value.trim().toLowerCase(), password=form.elements.password.value;
      const emailValid=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const passwordValid = submittedMode === 'signup' ? password.length >= 6 : password.length > 0;
      if (!emailValid || !passwordValid) {
        setMessage(msg, !emailValid ? 'أدخل بريداً إلكترونياً صحيحاً. / Enter a valid email address.' : (submittedMode === 'signup' ? 'كلمة المرور يجب أن تتكون من 6 أحرف على الأقل. / Password must be at least 6 characters.' : 'أدخل كلمة المرور. / Enter your password.'));
        return;
      }
      submit.disabled=true; toggle.disabled=true; explicitSignInInFlight=true;
      try {
        if (!client) throw new Error('تعذر الاتصال بخدمة تسجيل الدخول. / Could not connect to the sign-in service.');
        if (submittedMode === 'guided') {
          // Existing account sign-in is always attempted first, with no onboarding metadata.
          const login = await client.auth.signInWithPassword({ email, password });
          if (!login.error) {
            if (!login.data?.session) throw new Error('تعذر فتح جلسة دخول. / Could not open a sign-in session.');
            await useSession(login.data.session, true);
            return;
          }
          const loginCode = String(login.error.code || '').toLowerCase();
          const loginText = String(login.error.message || '').toLowerCase();
          const invalidCredentials = loginCode === 'invalid_credentials' || /invalid login credentials/.test(loginText);
          if (!invalidCredentials) throw login.error;
          // Do not create an account unless the login failure is specifically bad credentials.
          if (password.length < 6) {
            setMessage(msg, 'كلمة المرور غير صحيحة لهذا الحساب، أو يجب أن تكون 6 أحرف على الأقل لإنشاء حساب جديد. / Incorrect password for this account, or use at least 6 characters to create a new account.');
            return;
          }
          const metadata = cueOnboardingMetadata(activeSignupDraft);
          const signupRequest = { email, password };
          if (metadata) signupRequest.options = { data: metadata };
          const signup = await client.auth.signUp(signupRequest);
          if (signup.error) throw signup.error;
          const user = signup.data?.user;
          if (Array.isArray(user?.identities) && user.identities.length === 0) {
            throw Object.assign(new Error('This email already has an account.'), { code: 'user_already_exists' });
          }
          if (signup.data?.session) await useSession(signup.data.session, true);
          else setMessage(msg, 'تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول. / Check your email to confirm your new account, then sign in.', true);
          activeSignupDraft = null;
          cueOnboardingDraft = { name: '', country: '', age: '', level: '' };
          return;
        }
        if (submittedMode === 'signup') {
          const { data, error } = await client.auth.signUp({ email, password });
          if (error) throw error;
          if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0)
            throw Object.assign(new Error('This email already has an account.'), { code: 'user_already_exists' });
          if (data?.session) await useSession(data.session, true);
          else setMessage(msg, 'تحقق من بريدك الإلكتروني لتأكيد الحساب ثم سجّل الدخول. / Check your email to confirm your account, then sign in.', true);
        } else {
          const {data,error}=await client.auth.signInWithPassword({email,password}); if(error) throw error;
          if (!data?.session) throw new Error('تعذر فتح جلسة دخول. / Could not open a sign-in session.');
          await useSession(data.session, true);
        }
      } catch(error) { setMessage(msg, authErrorMessage(error, submittedMode)); }
      finally { explicitSignInInFlight=false; if(submit.isConnected) submit.disabled=false; if(toggle.isConnected) toggle.disabled=false; }
    });
  }

  function renderProfileGate(profile = {}, status = '') {
    const source = currentSession?.user?.user_metadata || {};
    const name = profile.name || source.profile_name || '';
    const country = profile.country || source.profile_country || '';
    const age = profile.age || source.profile_age || '';
    // Metadata is only a draft fallback; lock only after the database confirms a choice.
    const countryLocked = !!String(profile.country || '').trim();
    setGate(`<section class="cue-auth-card" dir="rtl" aria-labelledby="cueProfileTitle">
      <h1 id="cueProfileTitle">أكمل ملفك الشخصي</h1><p>اختر الدولة بعناية؛ لا يمكن تغييرها بعد حفظ اختيارك الأول. يبقى العمر قابلاً للتعديل لاحقاً.</p>
      <div id="cueProfileGateMessage" class="cue-auth-message" role="status" aria-live="polite"></div>
      <form id="cueProfileGateForm" class="cue-auth-form" novalidate>
        <label>الاسم<input name="name" type="text" minlength="2" maxlength="100" autocomplete="name" required value="${esc(name)}"></label>
        <label>الدولة<select name="country" required${countryLocked ? ' disabled aria-disabled="true"' : ''}>${countrySelect(country)}</select><small class="cue-country-note">${countryLocked ? 'اختيار الدولة السابق مثبت ولا يمكن تغييره.' : 'بعد حفظ أول اختيار ستُثبّت الدولة؛ ويمكنك تعديل العمر لاحقاً.'}</small></label>
        <label>العمر<select name="age" required>${ageSelect(age)}</select></label>
        <button class="cue-btn" type="submit">حفظ ومتابعة</button>
      </form><div class="cue-auth-links"><button id="cueSignOutGate" type="button">تسجيل الخروج</button></div>
    </section>`);
    setMessage(document.getElementById('cueProfileGateMessage'), status);
    document.getElementById('cueSignOutGate').addEventListener('click', () => void signOut());
    document.getElementById('cueProfileGateForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, values = profileValues(form), message = document.getElementById('cueProfileGateMessage');
      if (!validName(values.name)) { setMessage(message, 'اكتب اسماً من حرفين عربيين أو إنجليزيين على الأقل، من دون أرقام أو رموز.'); return; }
      if (!COUNTRY_LABEL[values.country] || !Number.isInteger(values.age) || values.age < 1 || values.age > 70) { setMessage(message, 'اختر دولة عربية وعمراً من 1 إلى 70.'); return; }
      const button = form.querySelector('button[type=submit]'); button.disabled = true;
      try { await saveProfile(values, true); }
      catch (error) { setMessage(document.getElementById('cueProfileGateMessage'), "حدث خطأ. يرجى تحديث الصفحة."); }
      finally { if (button.isConnected) button.disabled = false; }
    });
  }

  async function saveProfile(values, fromGate = false) {
    if (!client || !currentSession) throw new Error('سجّل الدخول أولاً.');
    const session = currentSession, generation = authGeneration, identity = sessionIdentity(session), uid = session.user.id;
    const chosenCountry = String(currentProfile?.country || '').trim();
    if (chosenCountry && values.country !== chosenCountry) throw new Error('لا يمكن تغيير الدولة بعد اختيارها لأول مرة.');
    const updates = { name: values.name, age: values.age };
    if (!chosenCountry) updates.country = values.country;
    const { data, error } = await client.from('profiles').update(updates).eq('user_id', uid).select('user_id,email,name,country,age').single();
    if (error) throw error;
    if (generation !== authGeneration || sessionIdentity(currentSession) !== identity || currentSession?.user?.id !== uid) return;
    if (!data || data.user_id !== uid || !validProfile(data)) throw new Error('لم يتم تأكيد حفظ الملف الشخصي. أعد المحاولة.');
    currentProfile = data;
    cacheProfile(uid, data);
    if (fromGate) {
      activateProgressOwner(uid);
      await finishAuthenticatedSession(session, generation, identity);
    } else renderSettings();
  }

  function parseObject(raw) {
    try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch (_) { return {}; }
  }
  function progressOwnerKey(uid) { return 'cue_progress_owner_v1:' + uid; }
  function progressSnapshotKey(uid) { return 'cue_progress_snapshot_v1:' + uid; }
  function readProgressKeys() {
    let course={},sdone={},squiz={};
    try { course=parseObject(localStorage.getItem(COURSE_KEY)); } catch (_) {}
    try { sdone=parseObject(localStorage.getItem('sdone')); } catch (_) {}
    try { squiz=parseObject(localStorage.getItem('squiz')); } catch (_) {}
    return {version:1,course,phonics:{sdone,squiz}};
  }
  function writeProgressSnapshot(uid, progress) { try { localStorage.setItem(progressSnapshotKey(uid), JSON.stringify(progress)); } catch (_) {} }
  function readOwnedSnapshot(uid) { try { return parseObject(localStorage.getItem(progressSnapshotKey(uid))); } catch (_) { return {}; } }
  function activateProgressOwner(uid) {
    if (!uid) return;
    let owner=''; try { owner=localStorage.getItem('cue_progress_owner_active_v1') || ''; } catch (_) {}
    const live=readProgressKeys();
    if (!owner) {
      localProgressOwner = uid;
      try { localStorage.setItem('cue_progress_owner_active_v1', uid); } catch (_) {}
      writeProgressSnapshot(uid, live);
      return;
    }
    if (owner !== uid) {
      progressOwnerChanged = true;
      writeProgressSnapshot(owner, live);
      const saved=readOwnedSnapshot(uid);
      localProgressOwner = uid;
      try { localStorage.setItem('cue_progress_owner_active_v1', uid); } catch (_) {}
      writeLocalProgress(saved.version ? saved : emptyProgress());
      return;
    }
    localProgressOwner=uid;
  }
  function guestProgressOwnerId() {
    let id = '';
    try { id = localStorage.getItem('cue_progress_guest_id_v1') || ''; } catch (_) {}
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      try { if (typeof crypto !== 'undefined' && crypto.randomUUID) id = crypto.randomUUID(); } catch (_) {}
      if (!id) id = 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
      try { localStorage.setItem('cue_progress_guest_id_v1', id); } catch (_) {}
    }
    return 'guest:' + id;
  }
  function writeVerifiedProgressSnapshot(uid, progress) {
    writeProgressSnapshot(uid, progress);
    return stable(readOwnedSnapshot(uid)) === stable(progress);
  }
  function activateGuestProgress() {
    const guestUid = guestProgressOwnerId();
    let owner = '';
    try { owner = localStorage.getItem('cue_progress_owner_active_v1') || ''; } catch (_) {}
    if (owner === guestUid) { localProgressOwner = guestUid; return; }
    const live = readProgressKeys();
    const previousOwner = owner || ('legacy-unassigned:' + guestUid);
    if (!writeVerifiedProgressSnapshot(previousOwner, live)) throw new Error('guest-progress-snapshot-failed');
    let saved = readOwnedSnapshot(guestUid);
    const target = saved.version === 1 ? saved : emptyProgress();
    if (saved.version !== 1 && !writeVerifiedProgressSnapshot(guestUid, target)) throw new Error('guest-progress-initialize-failed');
    try {
      localProgressOwner = guestUid;
      writeLocalProgress(target);
      if (stable(readProgressKeys()) !== stable(target)) throw new Error('guest-progress-restore-failed');
      localStorage.setItem('cue_progress_owner_active_v1', guestUid);
      if (localStorage.getItem('cue_progress_owner_active_v1') !== guestUid) throw new Error('guest-progress-owner-failed');
    } catch (error) {
      try {
        localProgressOwner = owner || null;
        writeLocalProgress(live);
        if (owner) localStorage.setItem('cue_progress_owner_active_v1', owner);
        else localStorage.removeItem('cue_progress_owner_active_v1');
      } catch (_) {}
      throw error;
    }
    localProgressOwner = guestUid;
  }
  function enterGuestMode() {
    ++authGeneration;
    clearTimeout(syncTimer);
    stopSessionChecks();
    publicGuestMode = true;
    currentSession = null;
    currentProfile = null;
    profileReady = true;
    offlineMode = false;
    reconnectRequired = false;
    lastAuthEventIdentity = '';
    activateGuestProgress();
    hookProgressWrites();
    hideGate();
    renderSettings();
    window.__CUE_AUTH_READY = true;
  }
  function readLocalProgress() { return readProgressKeys(); }
  function emptyProgress() { return { version: 1, course: {}, phonics: { sdone: {}, squiz: {} } }; }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function examScore(value) {
    if (!value || typeof value !== 'object') return -1;
    const right = Number(value.right), total = Number(value.total);
    return Number.isFinite(right) ? right * 100000 + (Number.isFinite(total) ? total : 0) : -1;
  }
  function mergeValue(a, b, path = '') {
    if (a === undefined || a === null) return clone(b);
    if (b === undefined || b === null) return clone(a);
    if (path.endsWith('.examResult') && typeof a === 'object' && typeof b === 'object') return clone(examScore(b) > examScore(a) ? b : a);
    if (Array.isArray(a) && Array.isArray(b)) {
      const out = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i], y = b[i];
        if (x === undefined) out[i] = clone(y);
        else if (y === undefined) out[i] = clone(x);
        else if (typeof x === 'number' && typeof y === 'number' && path.includes('.lres')) out[i] = Math.min(x, y);
        else out[i] = mergeValue(x, y, path + '[' + i + ']');
      }
      return out;
    }
    if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out = {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) out[key] = mergeValue(a[key], b[key], path ? path + '.' + key : key);
      return out;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') return a || b;
    if (typeof a === 'number' && typeof b === 'number') return path.includes('.lres') ? Math.min(a, b) : Math.max(a, b);
    if (typeof a === 'string' && typeof b === 'string') return a || b;
    return clone(a);
  }
  function mergeProgress(a, b) {
    const merged = mergeValue(a || emptyProgress(), b || emptyProgress(), '');
    if (!merged.phonics || typeof merged.phonics !== 'object') merged.phonics = { sdone: {}, squiz: {} };
    if (!merged.phonics.sdone) merged.phonics.sdone = {};
    if (!merged.phonics.squiz) merged.phonics.squiz = {};
    if (!merged.course || typeof merged.course !== 'object') merged.course = {};
    merged.version = 1;
    return merged;
  }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
  function writeLocalProgress(progress) {
    suppressProgressEvents++;
    try {
      localStorage.setItem(COURSE_KEY, JSON.stringify(progress.course || {}));
      localStorage.setItem('sdone', JSON.stringify(progress.phonics?.sdone || {}));
      localStorage.setItem('squiz', JSON.stringify(progress.phonics?.squiz || {}));
      if (localProgressOwner) writeProgressSnapshot(localProgressOwner, progress);
    } finally { suppressProgressEvents--; }
  }
  function deviceId() {
    try {
      let value = localStorage.getItem(DEVICE_KEY);
      if (value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value;
      if (crypto?.randomUUID) value = crypto.randomUUID();
      else if (crypto?.getRandomValues) {
        const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
        const hex = [...bytes].map(x => x.toString(16).padStart(2,'0')).join(''); value = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      } else value = '00000000-0000-4000-8000-' + (Date.now().toString(16).padStart(12,'0').slice(-12));
      localStorage.setItem(DEVICE_KEY, value);
      return value;
    } catch (_) { return '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12,'0').slice(-12); }
  }
  async function fetchAllProgressRows(uid) {
    const rows = [], batch = 500;
    for (let offset = 0; ; offset += batch) {
      const { data, error } = await client.from(PROGRESS_TABLE).select('device_id,progress,updated_at').eq('user_id', uid).order('updated_at', { ascending: false }).range(offset, offset + batch - 1);
      if (error) throw error;
      const page = data || [];
      rows.push(...page);
      if (page.length < batch) break;
    }
    return rows;
  }
  /* CUE_PROGRESS_PRESERVE_V1: do not revoke completion while merging saved progress. */
  async function syncProgress(uid, mergeAtLogin = false) {
    const session = currentSession, generation = authGeneration, identity = sessionIdentity(session);
    const current = () => generation === authGeneration && currentSession?.user?.id === uid && sessionIdentity(currentSession) === identity;
    if (!client || !session || session.user.id !== uid || !navigator.onLine || offlineMode) return { ok: false, offline: true };
    const sessionCheck = await isCurrentAccountSession(generation, identity);
    if (!current()) return { ok: false, stale: true };
    if (!sessionCheck.ok) return { ok: false, replaced: !!sessionCheck.replaced, offline: !!sessionCheck.network };
    const existing = syncPromise;
    if (existing && existing.identity === identity && existing.generation === generation) return existing.promise;
    const promise = (async () => {
      const before = readLocalProgress();
      const rows = await fetchAllProgressRows(uid);
      if (!current()) return { ok: false, stale: true };
      let merged = emptyProgress();
      for (const row of rows) merged = mergeProgress(merged, row.progress);
      merged = mergeProgress(merged, before);
      const changed = stable(merged) !== stable(before);
      if (changed) { if (!current()) return { ok: false, stale: true }; writeLocalProgress(merged); }
      if (!current()) return { ok: false, stale: true };
      const { error } = await client.from(PROGRESS_TABLE).upsert({ user_id: uid, device_id: deviceId(), progress: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id,device_id' });
      if (error) throw error;
      if (!current()) return { ok: false, stale: true };
      if (mergeAtLogin && (changed || progressOwnerChanged)) {
        const signature = hash(stable(merged));
        const key = 'cue_progress_reload_v1:' + uid;
        let previous = '';
        try { previous = sessionStorage.getItem(key) || ''; } catch (_) {}
        if (progressOwnerChanged || previous !== signature) {
          if (!current()) return { ok: false, stale: true };
          try { sessionStorage.setItem(key, signature); } catch (_) {}
          setGate('<section class="cue-auth-card" dir="rtl"><h1>تمت مزامنة تقدمك</h1><p>جارٍ فتح التطبيق بآخر تقدم محفوظ على أجهزتك…</p></section>');
          setTimeout(() => { if (current()) location.reload(); }, 80);
          progressOwnerChanged = false;
          return { ok: true, reloading: true };
        }
      }
      return { ok: true, changed };
    })();
    syncPromise = { identity, generation, promise };
    try { return await promise; } finally { if (syncPromise?.promise === promise) syncPromise = null; }
  }
  function queueSync() {
    if (suppressProgressEvents || !profileReady || !currentSession || offlineMode) return;
    const session = currentSession, uid = session.user.id, identity = sessionIdentity(session), generation = authGeneration;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      if (generation !== authGeneration || currentSession?.user?.id !== uid || sessionIdentity(currentSession) !== identity) return;
      void syncProgress(uid, false).catch(() => {});
    }, 900);
  }
  function hookProgressWrites() {
    if (progressHooksInstalled) return;
    progressHooksInstalled = true;
    try {
      const original = Storage.prototype.setItem;
      if (original.__cueProgressHook) return;
      const wrapped = function(key, value) {
        const result = original.call(this, key, value);
        if (this === window.localStorage && PROGRESS_KEYS.has(String(key))) queueSync();
        return result;
      };
      wrapped.__cueProgressHook = true;
      Storage.prototype.setItem = wrapped;
    } catch (_) {}
    window.addEventListener('storage', event => { if (PROGRESS_KEYS.has(event.key)) queueSync(); });
    window.addEventListener('offline', () => { offlineMode=true; reconnectRequired=true; if(currentSession) renderReconnectGate('انقطع الاتصال. أعد الاتصال للتحقق من جلسة الحساب.'); });
    window.addEventListener('online', () => { if (currentSession) void revalidateAndResume(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') queueSync(); });
  }
  function cacheProfile(uid, profile) {
    try { localStorage.setItem(PROFILE_CACHE_PREFIX + uid, JSON.stringify(profile)); } catch (_) {}
  }
  function cachedProfile(uid) {
    try { const value = JSON.parse(localStorage.getItem(PROFILE_CACHE_PREFIX + uid) || 'null'); return validProfile(value) ? value : null; } catch (_) { return null; }
  }
  function cachedSession() {
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      const parsed = JSON.parse(raw || 'null');
      const value = parsed?.currentSession || parsed;
      return value?.user?.id ? value : null;
    } catch (_) { return null; }
  }
  function renderSettings() {
    if (!pane) return;
    if (!currentSession || !currentProfile) {
      pane.dataset.cueProfileSignature = '';
      pane.innerHTML = '<div class="cue-settings" dir="rtl"><h1>الإعدادات</h1><p>يمكنك استخدام الدروس والتمارين دون تسجيل دخول. تقدم الزائر محفوظ محليًا على هذا المتصفح ولا يُرسل إلى حساب أو يُشارك مع زوار آخرين.</p><section class="cue-settings-card"><h2>حسابك (اختياري)</h2><p>سجّل الدخول لمزامنة تقدم حسابك بين أجهزتك.</p><button id="cuePublicSignIn" class="cue-btn" type="button">تسجيل الدخول إلى حسابي</button></section></div>';
      document.getElementById('cuePublicSignIn')?.addEventListener('click', () => {
        publicGuestMode = false;
        cueOnboardingDismissed = true;
        renderAuthForm('', false, 'login');
      });
      return;
    }
    const p = currentProfile;
    /* CUE_SETTINGS_DRAFT_PRESERVE_V1 */
    const profileSignature=JSON.stringify([currentSession.user.id,p.name,p.country,p.age]);
    if(pane.dataset.cueProfileSignature===profileSignature&&pane.querySelector('#cueProfileSettingsForm'))return;
    pane.dataset.cueProfileSignature=profileSignature;
    const countryLocked = !!String(p.country || '').trim();
    pane.innerHTML = `<div class="cue-settings" dir="rtl">
      <h1>الإعدادات</h1><p>بيانات الملف الشخصي والتقدم محفوظة لمزامنتها بين أجهزتك.</p>
      <section class="cue-settings-card"><h2>الملف الشخصي</h2>
        <form id="cueProfileSettingsForm" class="cue-profile-form">
          <label class="cue-field">الاسم<input name="name" type="text" minlength="2" maxlength="100" autocomplete="name" required value="${esc(p.name)}"></label>
          <label class="cue-field">الدولة<select name="country" required${countryLocked ? ' disabled aria-disabled="true"' : ''}>${countrySelect(p.country)}</select><small class="cue-country-note">${countryLocked ? 'اختيار الدولة السابق مثبت ولا يمكن تغييره.' : 'اختر الدولة بعناية؛ بعد حفظ أول اختيار لا يمكن تغييره. العمر يبقى قابلاً للتعديل.'}</small></label>
          <label class="cue-field">العمر<select name="age" required>${ageSelect(p.age)}</select></label>
          <div><div id="cueProfileSettingsMessage" class="cue-auth-message" role="status"></div><button class="cue-btn" type="submit">حفظ التغييرات</button> <button id="cueSignOut" class="cue-btn secondary" type="button">تسجيل الخروج</button></div>
        </form>
      </section>
    </div>`;
    document.getElementById('cueProfileSettingsForm').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, values = profileValues(form), msg = document.getElementById('cueProfileSettingsMessage');
      if (!validName(values.name)) { setMessage(msg, 'اكتب اسماً من حرفين عربيين أو إنجليزيين على الأقل، من دون أرقام أو رموز.'); return; }
      if (!COUNTRY_LABEL[values.country] || !Number.isInteger(values.age) || values.age < 1 || values.age > 70) { setMessage(msg, 'اختر دولة عربية وعمراً من 1 إلى 70.'); return; }
      const button = form.querySelector('button[type=submit]'); button.disabled = true;
      try { await saveProfile(values, false); setMessage(document.getElementById('cueProfileSettingsMessage'), 'تم حفظ التغييرات.', true); }
      catch (error) { setMessage(document.getElementById('cueProfileSettingsMessage'), "حدث خطأ. يرجى تحديث الصفحة."); }
      finally { if (button.isConnected) button.disabled = false; }
    });
    document.getElementById('cueSignOut').addEventListener('click', () => void signOut());
  }
  window.renderSettings = renderSettings;

  async function fetchProfile(session) {
    const uid = session.user.id;
    const { data, error } = await client.from('profiles').select('user_id,email,name,country,age').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (data && validProfile(data)) return data;
    const metadata = session.user.user_metadata || {};
    const draft = { name: metadata.profile_name || '', country: metadata.profile_country || '', age: metadata.profile_age || '' };
    if (data && validProfile(draft)) {
      const { data: updated, error: updateError } = await client.from('profiles').update({ name: cleanName(draft.name), country: draft.country, age: Number(draft.age) }).eq('user_id', uid).select('user_id,email,name,country,age').single();
      if (!updateError && updated && validProfile(updated)) return updated;
    }
    if (data) return data;
    throw new Error('لم يتم إنشاء سجل الملف الشخصي للحساب. أعد تسجيل الدخول أو تواصل مع مالك التطبيق.');
  }
  function jwtSessionId(session) {
    try { const part=String(session?.access_token||'').split('.')[1]; const payload=JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-part.length%4)%4))); return payload?.session_id||''; } catch (_) { return ''; }
  }
  function sessionIdentity(session) { return `${session?.user?.id||''}:${session?.session_id||jwtSessionId(session)||'no-session-id'}`; }
  async function claimActiveSession(session) {
    if(!session?.user?.id||!client||!navigator.onLine) throw new Error('يلزم الاتصال بالإنترنت للتحقق من جلسة الحساب.');
    const {data,error}=await client.rpc('claim_active_account_session',{p_device_id:deviceId()});
    if (error) throw new Error(error.message || 'تعذّر التحقق من جلسة الحساب.');
    if (data !== true) { await gateReplacedSession(); return false; }
    return true;
  }
  async function isCurrentAccountSession(generation = authGeneration, identity = sessionIdentity(currentSession)) {
    const current = () => generation === authGeneration && currentSession && sessionIdentity(currentSession) === identity;
    if(!current()||!client||!navigator.onLine)return {ok:false,network:true};
    if(sessionCheckInFlight && sessionCheckInFlight.identity === identity && sessionCheckInFlight.generation === generation)return sessionCheckInFlight.promise;
    const promise=(async()=>{try{const {data,error}=await client.rpc('is_current_account_session');if(!current())return {ok:false,stale:true};if(error){renderReconnectGate('تعذّر التحقق من جلسة الحساب. أعد المحاولة عند استقرار الاتصال.');return {ok:false,network:true};}if(data!==true){await gateReplacedSession(generation,identity);return {ok:false,replaced:true}}return {ok:true}}catch(_){if(current())renderReconnectGate('تعذّر التحقق من جلسة الحساب. أعد المحاولة عند استقرار الاتصال.');return {ok:false,network:true}}})();
    sessionCheckInFlight={identity,generation,promise};
    try{return await promise}finally{if(sessionCheckInFlight?.promise===promise)sessionCheckInFlight=null}
  }
  async function gateReplacedSession(generation = authGeneration, identity = sessionIdentity(currentSession)) { if (generation !== authGeneration || sessionIdentity(currentSession) !== identity) return; ++authGeneration; clearTimeout(syncTimer); offlineMode=true; reconnectRequired=false; profileReady=false; currentProfile=null; stopSessionChecks(); try{await client.auth.signOut({scope:'local'});}catch(_){} currentSession=null; renderAuth('انتهت جلسة هذا الجهاز لأن الحساب سُجّل دخوله من جهاز آخر. سجّل الدخول مجدداً.',false); renderSettings(); }
  function renderReconnectGate(status='يلزم الاتصال بالإنترنت للتحقق من جلسة الحساب.') { reconnectRequired=true; offlineMode=true; setGate(`<section class="cue-auth-card" dir="rtl"><h1>يلزم التحقق من الجلسة</h1><p>${esc(status)}</p><button id="cueReconnect" class="cue-btn" type="button">إعادة المحاولة</button></section>`); document.getElementById('cueReconnect')?.addEventListener('click',()=>void revalidateAndResume()); }
  async function revalidateAndResume() { if(!currentSession||!navigator.onLine)return; const session=currentSession,generation=authGeneration,identity=sessionIdentity(session); renderReconnectGate('جارٍ التحقق من جلسة الحساب…'); const check=await isCurrentAccountSession(generation,identity); if(generation!==authGeneration||sessionIdentity(currentSession)!==identity)return;if(!check.ok){if(check.replaced)return;renderReconnectGate('تعذّر التحقق الآن. أعد المحاولة عند استقرار الاتصال.');return} reconnectRequired=false; offlineMode=false; if(!profileReady||!validProfile(currentProfile)){return cueAuthDeadline(useSession(session,false),30000).catch(()=>cueShowAuthStartupRecovery())} try{const result=await syncProgress(session.user.id,false);if(generation!==authGeneration||sessionIdentity(currentSession)!==identity)return;if(!result?.ok||result?.replaced||!profileReady||!validProfile(currentProfile)){if(!result?.ok&&!result?.stale)renderReconnectGate('تعذّرت مزامنة التقدم. أعد المحاولة قبل فتح التطبيق.');if(!profileReady||!validProfile(currentProfile))renderProfileGate(currentProfile||{});return}hideGate();renderSettings()}catch(_){if(generation===authGeneration&&sessionIdentity(currentSession)===identity)renderReconnectGate('تعذّرت مزامنة التقدم. أعد المحاولة قبل فتح التطبيق.')} }
  function stopSessionChecks(){if(sessionCheckTimer){clearInterval(sessionCheckTimer);sessionCheckTimer=null}}
  function startSessionChecks(){stopSessionChecks();/* CUE_SESSION_ENTRY_ONLY_V1 */}
  async function saveAndActivateProgress(uid){activateProgressOwner(uid);}
  async function finishAuthenticatedSession(session, generation, identity) {
    if(generation!==authGeneration||identity!==sessionIdentity(session))return;
    profileReady=true;offlineMode=false;reconnectRequired=false;clearAuthUrl();cacheProfile(session.user.id,currentProfile);hookProgressWrites();startSessionChecks();renderSettings();
    try{const result=await syncProgress(session.user.id,true);if(generation!==authGeneration||identity!==sessionIdentity(currentSession))return;if(!result?.ok){if(!result?.stale&&!result?.replaced)renderReconnectGate('تعذّرت مزامنة التقدم. أعد المحاولة عند استقرار الاتصال.');return}if(result?.reloading)return}catch(_){if(generation===authGeneration&&identity===sessionIdentity(currentSession))renderReconnectGate('تعذّرت مزامنة التقدم. أعد المحاولة قبل فتح التطبيق.');return}
    if(!navigator.onLine||!profileReady||!validProfile(currentProfile)||generation!==authGeneration||identity!==sessionIdentity(currentSession)){if(generation===authGeneration&&identity===sessionIdentity(currentSession)&&(!profileReady||!validProfile(currentProfile)))renderProfileGate(currentProfile||{});else if(generation===authGeneration&&identity===sessionIdentity(currentSession))renderReconnectGate();return} hideGate();renderSettings();
  }
  let authGeneration=0;
  async function useSession(session, explicit=false) {
    if(!session?.user?.id){try{sessionStorage.removeItem('cue_auth_entry_verified_v1')}catch(_){};enterGuestMode();return}
    publicGuestMode = false;
    const identity=sessionIdentity(session); if(pendingSession?.identity===identity)return pendingSession.promise;
    const generation=++authGeneration; currentSession=session;
    const promise=(async()=>{try{
      const claimed=await claimActiveSession(session); if(!claimed||generation!==authGeneration||sessionIdentity(currentSession)!==identity)return;
      currentProfile=await fetchProfile(session);
      if(generation!==authGeneration||sessionIdentity(currentSession)!==identity)return;
      if(!validProfile(currentProfile)){profileReady=false;renderProfileGate(currentProfile||{});renderSettings();return}
      await saveAndActivateProgress(session.user.id);
      await finishAuthenticatedSession(session,generation,identity);
    }catch(error){if(generation!==authGeneration||sessionIdentity(currentSession)!==identity)return;try{enterGuestMode()}catch(guestError){currentSession=null;currentProfile=null;profileReady=false;offlineMode=true;renderReconnectGate('تعذّر عزل تقدم الزائر بأمان على هذا المتصفح.');renderSettings()}}})();
    pendingSession={identity,promise};try{return await promise}finally{if(pendingSession?.promise===promise)pendingSession=null}
  }
  async function signOut(){try{sessionStorage.removeItem('cue_auth_entry_verified_v1')}catch(_){};++authGeneration;clearTimeout(syncTimer);stopSessionChecks();try{if(client)await client.auth.signOut({scope:'local'});else localStorage.removeItem(AUTH_STORAGE_KEY);await useSession(null)}catch(error){const node=document.getElementById('cueProfileSettingsMessage');if(node)setMessage(node,"حدث خطأ. يرجى تحديث الصفحة.")}}
  function hookSessionRechecks(){/* CUE_SESSION_ENTRY_ONLY_V1: verify at app entry; auth-state events remain active. */}

/* CUE_AUTH_STARTUP_RECOVERY_V1: authentication remains mandatory; no storage is cleared. */
function cueAuthDeadline(promise,milliseconds){let timer;return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('cue-auth-timeout')),milliseconds)})]).finally(()=>clearTimeout(timer))}
async function cueTimedAuthFetch(input,init){init=init||{};const controller=new AbortController();const previous=init.signal||(typeof Request!=='undefined'&&input instanceof Request?input.signal:null);const abort=()=>controller.abort();if(previous){if(previous.aborted)abort();else previous.addEventListener('abort',abort,{once:true})}const timer=setTimeout(abort,12000);try{return await fetch(input,Object.assign({},init,{signal:controller.signal}))}finally{clearTimeout(timer);if(previous)previous.removeEventListener('abort',abort)}}
function cueShowAuthStartupRecovery(){setGate('<section class="cue-auth-card" dir="rtl"><h1>تعذّر إكمال الاتصال</h1><p>لم يكتمل التحقق من جلسة الحساب. تحقق من اتصال الإنترنت ثم أعد المحاولة؛ لن تُحذف بياناتك أو تقدمك.</p><button id="cueAuthStartupRetry" class="cue-btn" type="button">إعادة المحاولة</button></section>');document.getElementById('cueAuthStartupRetry')?.addEventListener('click',()=>location.reload())}
const cueAuthStartupTimer=setTimeout(()=>{if(gate&&!gate.hidden&&!gate.querySelector('input,button'))cueShowAuthStartupRecovery()},20000);

  (async () => {
    try {
      const {createClient}=await cueAuthDeadline(import('/cue-auth-vendor-2.118.0.js?v=2'),15000);
      client=createClient(SUPABASE_URL,SUPABASE_KEY,{global:{fetch:cueTimedAuthFetch},auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,flowType:'pkce',lockAcquireTimeout:12000}}); hookSessionRechecks();
      client.auth.onAuthStateChange((event,nextSession)=>{const identity=sessionIdentity(nextSession);if(event==='SIGNED_OUT'){lastAuthEventIdentity='';void useSession(null);return}if(publicGuestMode)return;if(nextSession&&!explicitSignInInFlight){if(identity===lastAuthEventIdentity){if(currentSession?.user?.id===nextSession.user.id)currentSession=nextSession;return}lastAuthEventIdentity=identity;setTimeout(()=>{void useSession(nextSession,false)},0);}});
      const {data,error}=await cueAuthDeadline(client.auth.getSession(),15000);if(error)throw error;const initial=data?.session||null;lastAuthEventIdentity=sessionIdentity(initial);await cueAuthDeadline(useSession(initial,false),30000);clearTimeout(cueAuthStartupTimer);window.__CUE_AUTH_READY=true;try{if(navigator.storage?.persist)void navigator.storage.persist().catch(()=>{})}catch(_){}
    } catch(error) { clearTimeout(cueAuthStartupTimer);try{enterGuestMode()}catch(guestError){++authGeneration;stopSessionChecks();currentSession=null;currentProfile=null;profileReady=false;offlineMode=true;cueShowAuthStartupRecovery();window.__CUE_AUTH_READY=false;} }
  })();
})();
