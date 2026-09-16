'use strict';

// Fångar fel som annars försvinner tyst i konsolen. Utan detta ser en
// trasig knapp ut som att "ingenting händer" — svårt att felsöka.
window.addEventListener('unhandledrejection', e => {
  console.error('Ohanterat fel:', e.reason);
});

// ── SUPABASE ──────────────────────────────────────────────────
const SUPABASE_URL = 'https://zovlagbblznesvjzhplh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvdmxhZ2JibHpuZXN2anpocGxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMzE1NTEsImV4cCI6MjEwMzkwNzU1MX0.bSjcl6qyZGazd5VHMZKsbKfffRUUpPbMASFm9jL7U48';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── SESSION STATE ─────────────────────────────────────────────
let me            = null;   // { id, email, reporterType, name?, phone?, title?, photo? }
let meType        = null;   // 'employee' | 'admin'
let activeCaseId  = null;
let activeCaseExtra = null; // kategori/verksamhet/valfria fält för öppet ärende — se renderMsgs
let activeDashTab = 'all';

let reportType    = null;   // 'anonymous_code' | 'anonymous_email' | 'open' — for the report currently being created
let pendingFiles  = [];     // File[] queued for upload with the new report
let lastAccessCode = null;  // shown once on the code-confirm screen
let anonCaseCode  = null;   // access code for the anonymous case currently open (tier 1 follow-up)
let anonCaseData  = null;   // cached result of get_case_by_code RPC

// ── VIEW ROUTER ───────────────────────────────────────────────
// Räknare som ogiltigförklarar svar från en vy man redan navigerat bort
// från. Utan den kan ett långsamt svar skriva in sig i fel vy.
let navToken = 0;

// Sätts medan vi återställer en vy från webbläsarhistoriken, så att
// återställningen inte i sin tur skriver nya historikposter.
let suppressHistory = false;

function show(id) {
  const view = document.getElementById(id);
  if (!view) { console.error('Okänd vy:', id); return; }
  navToken++;
  document.querySelectorAll('.view').forEach(v => { v.style.display = 'none'; });
  view.style.display = 'block';
  clearErrors();
  updateHeader();
  recordHistory({
    view: id,
    caseId: (id === 'view-case-emp' || id === 'view-case-admin') ? activeCaseId : null
  });
  return navToken;
}

// ── WEBBLÄSARHISTORIK ─────────────────────────────────────────
// Utan detta lämnar bakåtknappen (och svepgesten på mobil) hela sajten
// istället för att gå ett steg tillbaka — mitt i en påbörjad anmälan är
// det illa.
function recordHistory(state) {
  if (suppressHistory) return;
  const cur = history.state;
  // Första vyn efter sidladdning ersätter webbläsarens tomma post.
  // Annars hade man behövt trycka bakåt två gånger för att lämna sajten.
  if (!cur) { history.replaceState(state, ''); return; }
  const same = cur.view === state.view
    && (cur.caseId  || null) === (state.caseId  || null)
    && (cur.section || null) === (state.section || null);
  if (same) history.replaceState(state, '');
  else      history.pushState(state, '');
}

window.addEventListener('popstate', async e => {
  suppressHistory = true;
  try {
    await restoreView(e.state);
  } catch (err) {
    console.error('Kunde inte återställa vyn:', err);
  } finally {
    suppressHistory = false;
  }
});

async function restoreView(state) {
  if (!state || !state.view) { showLanding(); return; }

  // Utloggad användare ska inte kunna backa in i inloggade vyer.
  const needsLogin = ['view-emp-dash', 'view-admin-dash', 'view-case-emp', 'view-case-admin'];
  if (needsLogin.includes(state.view) && !me) { showLanding(); return; }

  switch (state.view) {
    case 'view-landing':    showLanding(state.section || undefined); break;
    case 'view-emp-dash':   await showEmpDash(); break;
    case 'view-admin-dash': await showAdminDash(); break;
    case 'view-case-emp':   state.caseId ? await openCaseEmp(state.caseId)   : await showEmpDash();   break;
    case 'view-case-admin': state.caseId ? await openCaseAdmin(state.caseId) : await showAdminDash(); break;
    // Formuläret återställs som ren vy, så att det som skrivits finns kvar.
    // Men bara medan rapporten pågår: efter att den skickats, eller efter
    // utloggning, ska bakåtknappen inte visa texten igen.
    case 'view-new-case':
      if (!reportType || (reportType !== 'anonymous_code' && !me)) { showLanding(); break; }
      show(state.view); break;
    // Åtkomstkoden visas en gång. När personen gått vidare ska den inte
    // gå att backa fram, t.ex. av nästa person vid en delad dator.
    case 'view-code-confirm':
      if (!lastAccessCode) { showLanding(); break; }
      show(state.view); break;
    case 'view-anon-case':
      if (!anonCaseData) { show('view-anon-code-entry'); break; }
      show(state.view); break;
    case 'view-reset-password':
      if (!passwordRecovery) { showLanding(); break; }
      show(state.view); break;
    default: show(state.view);
  }
}

// Varnar bara när man faktiskt lämnar sajten med en påbörjad anmälan.
window.addEventListener('beforeunload', e => {
  const view = document.getElementById('view-new-case');
  const msg  = document.getElementById('case-msg');
  if (view && view.style.display === 'block' && msg && msg.value.trim()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function updateHeader() {
  const logoutBtn = document.getElementById('btn-logout');
  const profileEl = document.getElementById('header-profile');
  const adminLink = document.getElementById('admin-link');
  if (me && meType === 'admin') {
    logoutBtn.style.display = 'inline-flex';
    adminLink.style.display = 'none';
    const roleLine = esc((me.isSuperAdmin ? 'SUPER-ADMIN · ' : '') + (me.title || ''));
    const name = esc(me.name || '');
    profileEl.innerHTML = me.photo
      ? `<div class="admin-profile"><img src="${esc(me.photo)}" alt="${name}"><div><div class="a-name">${name}</div><div class="a-role">${roleLine}</div></div></div>`
      : `<div class="admin-profile"><div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;color:var(--gold);font-weight:700;font-size:16px;border:2px solid var(--gold);">${esc((me.name||'?').charAt(0))}</div><div><div class="a-name">${name}</div><div class="a-role">${roleLine}</div></div></div>`;
    profileEl.style.display = 'block';
  } else if (me && meType === 'employee') {
    logoutBtn.style.display = 'inline-flex';
    adminLink.style.display = 'none';
    profileEl.style.display = 'none';
  } else {
    logoutBtn.style.display = 'none';
    adminLink.style.display = 'inline-flex';
    profileEl.style.display = 'none';
  }
}

async function handleLogout() {
  await sb.auth.signOut();
}

// ── AUTH: react to session changes ──────────────────────────────
// Satt från att en återställningslänk öppnats tills ett nytt lösenord
// sparats. Se loadUserContext.
let passwordRecovery = false;

sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    passwordRecovery = true;
    show('view-reset-password');
    return;
  }

  if (event === 'SIGNED_OUT') {
    me = null; meType = null; activeCaseId = null; reportType = null;
    adminsMapCache = null; passwordRecovery = false;
    showLanding();
    return;
  }

  if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
    // Supabase skickar SIGNED_IN igen vid tokenförnyelse och när fliken
    // återfår fokus. Utan den här spärren renderas dashboarden om och
    // användaren kastas ut ur ärendet de läser — det är den "krasch
    // tillbaka till startsidan" som upplevts.
    if (me && me.id === session.user.id) return;
    await loadUserContext(session);
    return;
  }

  if (event === 'INITIAL_SESSION' && !session) showLanding();
});

async function loadUserContext(session) {
  let profile;
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('reporter_type, is_admin, name, phone, admins(id, name, title, role, photo, is_super_admin)')
      .eq('id', session.user.id)
      .single();
    if (error) throw error;
    profile = data;
  } catch (e) {
    // Profilen går inte att läsa — sessionen är obrukbar, logga ut.
    console.error('Kunde inte läsa profilen:', e);
    await sb.auth.signOut();
    showLanding();
    return;
  }

  me = { id: session.user.id, email: session.user.email, reporterType: profile.reporter_type, name: profile.name, phone: profile.phone };

  if (profile.is_admin && profile.admins) {
    meType = 'admin';
    me.name  = profile.admins.name;
    me.title = profile.admins.title;
    me.photo = profile.admins.photo;
    me.isSuperAdmin = !!profile.admins.is_super_admin;
  } else {
    meType = 'employee';
  }

  // En återställningslänk ger både en återställnings- och en vanlig
  // inloggningshändelse, i valfri ordning. Utan den här spärren laddades
  // dashboarden klart sist och tog över formuläret för nytt lösenord.
  if (passwordRecovery) { show('view-reset-password'); return; }

  try {
    if (meType === 'admin') {
      reportType = null;
      await showAdminDash();
    } else if (reportType && reportType !== 'anonymous_code') {
      // Personen valde typ 2 eller 3 och loggade in för att skicka en
      // rapport. Kontot bestämmer typen, inte valet på typsidan: annars
      // nekade databasen rapporten när valet och kontot inte stämde.
      reportType = me.reporterType;
      await showNewCase();
    } else {
      reportType = null;
      await showEmpDash();
    }
  } catch (e) {
    // Renderingen sprack — nästan alltid övergående (nätverk, långsam query).
    // Logga INTE ut användaren för det; visa felet istället.
    console.error('Kunde inte rendera vyn:', e);
    showLoadError();
  }
}

function showLoadError() {
  const list = document.getElementById(meType === 'admin' ? 'admin-cases-list' : 'emp-cases-list');
  if (list) list.innerHTML = `<div class="empty-state">${t('err.loadFailed')}</div>`;
}

// ── LANDING ───────────────────────────────────────────────────
function showLanding(section) {
  // Ett öppet anonymt ärende ska inte gå att nå med bakåtknappen när man
  // lämnat det. På en delad dator kan nästa person annars läsa tråden.
  forgetAnonCase();
  resumeReport = false;

  // show() skriver en historikpost utan section — låt den vara tyst och
  // skriv en enda korrekt post här nedan istället.
  const wasSuppressed = suppressHistory;
  suppressHistory = true;
  show('view-landing');
  suppressHistory = wasSuppressed;

  document.querySelector('.landing-grid').style.display = section ? 'none' : 'grid';
  document.querySelectorAll('.tab-panel').forEach(p => { p.style.display = 'none'; });
  if (section) {
    const panel = document.getElementById('panel-' + section);
    if (panel) panel.style.display = 'block';
  }
  window.scrollTo(0, 0);
  recordHistory({ view: 'view-landing', section: section || null });
}

function onLangChange() {
  if (meType === 'admin' && document.getElementById('view-admin-dash').style.display === 'block') showAdminDash();
  if (meType === 'employee' && document.getElementById('view-emp-dash').style.display === 'block') showEmpDash();
  // Anteckningarna ritas av JS ("Du", tomtillstånd, datumformat) och blir
  // därför kvar på gamla språket om vi inte ritar om dem.
  if (document.getElementById('view-case-admin').style.display === 'block') renderNotes();
  if (pendingFiles.length) renderFilesList();
}

// ── REPORT TYPE SELECTION ───────────────────────────────────────
function startNewReport() {
  // Inloggad anmälare har redan en fast typ. Utan detta hamnade de på
  // typvalet och vidare till "Skapa konto", fast de redan var inloggade.
  if (me && meType === 'employee') { newCaseForExistingUser(); return; }
  reportType = null;
  clearPendingFiles();
  show('view-report-type');
}

// Inloggad medarbetare (typ 2/3) som klickar "+ Ny anmälan" ska INTE
// behöva välja typ igen eller registrera sig på nytt — deras konto har
// redan en fast reporter_type (satt vid registreringen).
function newCaseForExistingUser() {
  if (!me) { showLanding(); return; }
  reportType = me.reporterType;
  showNewCase();
}

function selectReportType(type) {
  // Den som redan är inloggad ska inte skickas till "Skapa konto".
  if (me && type !== 'anonymous_code') {
    if (meType === 'employee') newCaseForExistingUser();
    else showAdminDash();
    return;
  }
  reportType = type;

  if (type === 'anonymous_code') {
    showNewCase();
    return;
  }

  resetRegForm();
  const nameGroup  = document.getElementById('reg-name-group');
  const phoneGroup = document.getElementById('reg-phone-group');
  const subtitle   = document.getElementById('reg-subtitle');
  if (type === 'open') {
    nameGroup.style.display  = 'block';
    phoneGroup.style.display = 'block';
    subtitle.textContent = t('register.subtitleOpen');
  } else {
    nameGroup.style.display  = 'none';
    phoneGroup.style.display = 'none';
    subtitle.textContent = t('register.subtitleAnon');
  }
  show('view-emp-register');
}

// ── REGISTER (typ 2 & 3 – konto krävs) ──────────────────────────
function resetRegForm() {
  document.getElementById('reg-step1').style.display = 'block';
  document.getElementById('reg-step2').style.display = 'none';
  ['reg-email','reg-pw','reg-pw2','reg-name','reg-phone'].forEach(id => { document.getElementById(id).value = ''; });
  clearErrors();
}

async function handleSendCode() {
  const email = val('reg-email').toLowerCase();
  const pw    = val('reg-pw');
  const pw2   = val('reg-pw2');
  const name  = val('reg-name');
  const phone = val('reg-phone');

  if (!email || !pw) return err('reg-err', t('err.fillAll'));
  if (reportType === 'open' && !name) return err('reg-err', t('err.nameRequired'));
  if (pw !== pw2) return err('reg-err', t('err.pwMismatch'));
  if (pw.length < 8) return err('reg-err', t('err.pwShort'));

  setBusy('btn-send-code', true);
  const { data, error } = await sb.auth.signUp({
    email,
    password: pw,
    options: {
      emailRedirectTo: window.location.href,
      data: {
        reporter_type: reportType,
        name:  reportType === 'open' ? name : null,
        phone: reportType === 'open' ? (phone || null) : null
      }
    }
  });
  setBusy('btn-send-code', false);

  if (error) {
    if (error.message === 'User already registered') return err('reg-err', t('err.alreadyRegistered'));
    return err('reg-err', isNetworkError(error) ? t('err.network') : error.message);
  }
  if (data.session) return; // auto-confirmed — onAuthStateChange handles redirect

  document.getElementById('reg-step1').style.display = 'none';
  document.getElementById('reg-step2').style.display = 'block';
  document.getElementById('reg-sent-to').textContent = email;
  clearErrors();
}

// ── FOLLOW UP ─────────────────────────────────────────────────
function showFollowUp() {
  reportType = null;
  if (me && meType === 'employee') { showEmpDash(); return; }
  if (me && meType === 'admin')    { showAdminDash(); return; }
  show('view-followup-choice');
}

async function handleCodeEntry() {
  const code = val('access-code-input');
  if (!code) return err('code-entry-err', t('err.enterCode'));
  setBusy('btn-code-entry', true);
  const { data, error } = await sb.rpc('get_case_by_code', { p_code: code });
  setBusy('btn-code-entry', false);
  // Ett nätverksfel är inte en felaktig kod. Tidigare fick båda texten
  // "Ogiltig kod", och då började folk tvivla på koden de sparat.
  if (error) return err('code-entry-err', friendlyError(error));
  if (!data || !data.length) return err('code-entry-err', t('err.invalidCode'));
  anonCaseCode = code;
  anonCaseData = data[0];
  // Koden ska inte ligga kvar i fältet, där bakåtknappen kan visa den.
  document.getElementById('access-code-input').value = '';
  // Svarsrutan töms här och efter ett skickat svar, inte i renderAnonCase:
  // den körs igen efter varje svar och tömde då nästa påbörjade meddelande.
  document.getElementById('anon-reply-input').value = '';
  await renderAnonCase();
  show('view-anon-case');
  // Tråden ritades medan vyn var dold, och då har rullningen ingen
  // effekt. Utan detta öppnades långa ärenden längst upp i stället för
  // vid senaste meddelandet, som i de andra vyerna.
  const thread = document.getElementById('anon-thread');
  thread.scrollTop = thread.scrollHeight;
}

async function renderAnonCase() {
  const c = anonCaseData;
  document.getElementById('anon-token').textContent = c.wb_token;
  document.getElementById('anon-cat').textContent = tLabel('cat.', c.category);
  const sp = document.getElementById('anon-status');
  sp.textContent = tLabel('status.', c.status);
  sp.className = `status-pill s-${statusClass(c.status)}`;

  const cached = cachedAnonGallery(c.case_id);
  // Tills bilderna är hämtade visas filnamnen.
  renderCaseFiles('anon-files', cached || (c.attachments || []).map(a => ({ file_name: a.file_name, url: null })));

  await renderMsgs('anon-msgs', c.messages || [], 'employee', {
    subject: c.subject, category: c.category, department: c.department, departmentDetail: c.department_detail,
    whoInvolved: c.who_involved, whereHappened: c.where_happened,
    whenHappened: c.when_happened, otherActions: c.other_actions
  });

  if (!cached) refreshAnonGallery(c);
}

// ── BILDER FÖR HELT ANONYM ANMÄLARE (typ 1) ────────────────────
// Typ 1 har ingen session och därmed ingen läsrätt i Storage. RPC:n
// open_case_files kontrollerar åtkomstkoden och öppnar ett läsfönster
// på två minuter för just det ärendet, och länkarna signeras direkt
// efteråt. Länkarna gäller sedan i en timme.
//
// Bilagor läggs bara till när rapporten skickas, så listan ändras
// aldrig. Den cachas per ärende tills länkarna närmar sig sin
// utgångstid, så ett nytt svar i chatten hämtar dem inte igen.
const ANON_GALLERY_TTL_MS = 50 * 60 * 1000;
let anonGalleryCache = { caseId: null, items: null, at: 0 };

function cachedAnonGallery(caseId) {
  const fresh = anonGalleryCache.caseId === caseId && Date.now() - anonGalleryCache.at < ANON_GALLERY_TTL_MS;
  return fresh ? anonGalleryCache.items : null;
}

async function refreshAnonGallery(c) {
  const { data: files, error } = await sb.rpc('open_case_files', { p_code: anonCaseCode });
  if (error) { console.error('Kunde inte öppna bilagorna:', error); return; }

  const items = await signAttachments(files || []);
  if (!anonCaseData || anonCaseData.case_id !== c.case_id) return;   // annan kod angiven
  anonGalleryCache = { caseId: c.case_id, items, at: Date.now() };
  renderCaseFiles('anon-files', items);
}

// Lämnar ärendet och glömmer det. Tråden och koden töms, så att de inte
// går att nå igen med bakåtknappen.
function leaveAnonCase() {
  forgetAnonCase();
  show('view-anon-code-entry');
}

function forgetAnonCase() {
  anonCaseCode = null;
  anonCaseData = null;
  anonGalleryCache = { caseId: null, items: null, at: 0 };
  document.getElementById('anon-msgs').innerHTML = '';
  document.getElementById('anon-reply-input').value = '';
  renderCaseFiles('anon-files', []);
}

async function handleAnonReply() {
  const text = val('anon-reply-input');
  if (!text) return err('anon-reply-err', t('err.writeMessage'));
  setBusy('btn-anon-reply', true);
  const { data: ok, error } = await sb.rpc('add_anonymous_message', { p_code: anonCaseCode, p_text: text });
  setBusy('btn-anon-reply', false);
  if (error) return err('anon-reply-err', friendlyError(error));
  if (!ok) return err('anon-reply-err', t('err.replyFailed'));

  sb.functions.invoke('notify', { body: { type: 'employee_reply', case_id: anonCaseData.case_id } });

  document.getElementById('anon-reply-input').value = '';
  clearErrors();
  const { data } = await sb.rpc('get_case_by_code', { p_code: anonCaseCode });
  if (data && data[0]) { anonCaseData = data[0]; await renderAnonCase(); }
}

// ── LOGIN (typ 2 & 3) ────────────────────────────────────────────
function showEmpLogin() {
  if (me) { meType === 'admin' ? showAdminDash() : showEmpDash(); return; }
  show('view-emp-login');
}

async function handleEmpLogin() {
  const email = val('emp-email');
  const pw    = val('emp-pw');
  if (!email || !pw) return err('emp-err', t('err.fillAll'));

  setBusy('btn-emp-login', true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  setBusy('btn-emp-login', false);

  if (error) {
    if (isNetworkError(error)) return err('emp-err', t('err.network'));
    return err('emp-err', (error.message || '').includes('not confirmed') ? t('err.notConfirmed') : t('err.badCredentials'));
  }
}

async function handleForgotPassword() {
  const email = val('emp-email');
  if (!email) return err('emp-err', t('err.enterEmailFirst'));
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) return err('emp-err', friendlyError(error));
  const elx = document.getElementById('emp-err');
  elx.textContent = t('common.resetLinkSent');
  elx.style.display = 'block';
  elx.style.color = '#2e7d32';
  elx.style.background = '#f0fdf4';
  elx.style.borderColor = '#86efac';
}

async function handleSetNewPassword() {
  const pw  = val('new-pw');
  const pw2 = val('new-pw2');
  if (!pw) return err('reset-err', t('err.enterPw'));
  if (pw !== pw2) return err('reset-err', t('err.pwMismatch'));
  if (pw.length < 8) return err('reset-err', t('err.pwShort'));

  setBusy('btn-set-pw', true);
  const { error } = await sb.auth.updateUser({ password: pw });
  setBusy('btn-set-pw', false);
  if (error) return err('reset-err', isNetworkError(error) ? t('err.network') : error.message);

  // Tidigare hände ingenting alls efter att lösenordet sparats: personen
  // blev stående på formuläret utan att veta om det gått igenom.
  passwordRecovery = false;
  document.getElementById('new-pw').value = '';
  document.getElementById('new-pw2').value = '';
  if (me) {
    meType === 'admin' ? await showAdminDash() : await showEmpDash();
  } else {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await loadUserContext(data.session);
    else showEmpLogin();
  }
  toast(t('reset.success'));
}

// ── ADMIN LOGIN ───────────────────────────────────────────────
function showAdminLogin() {
  if (me) { meType === 'admin' ? showAdminDash() : showEmpDash(); return; }
  show('view-admin-login');
}

async function handleAdminLogin() {
  const email = val('admin-email');
  const pw    = val('admin-pw');
  if (!email || !pw) return err('admin-err', t('err.fillAll'));

  setBusy('btn-admin-login', true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  setBusy('btn-admin-login', false);
  if (error) return err('admin-err', isNetworkError(error) ? t('err.network') : t('err.badCredentials'));
}

// ── NEW CASE / REPORT FORM (delas av alla tre typer) ────────────
// Sätts när sessionen tagit slut mitt i en rapport, så att det som hunnit
// skrivas finns kvar när personen loggat in igen.
let resumeReport = false;

async function showNewCase() {
  if (resumeReport) resumeReport = false;
  else resetReportFields();

  document.getElementById('reportform-subtitle').textContent =
    reportType === 'open' ? t('reportForm.subtitleOpen') : t('reportForm.subtitleAnon');

  show('view-new-case');
}

function handleReportFormBack() {
  if (reportType === 'anonymous_code') { reportType = null; showLanding(); return; }
  if (me && meType === 'employee') { showEmpDash(); return; }
  show('view-report-type');
}

function resetReportForm() {
  reportType = null;
  resetReportFields();
}

// Tömmer formuläret. Anropas när en rapport skickats, så att bakåtknappen
// inte visar rapportens text igen. På en delad dator är det illa.
function resetReportFields() {
  document.getElementById('new-case-form').reset();
  document.getElementById('dept-detail-group').style.display = 'none';
  clearPendingFiles();
}

function handleDeptChange() {
  const dept = val('dept-sel');
  const group    = document.getElementById('dept-detail-group');
  const staberSel = document.getElementById('dept-detail-sel');
  const annatText = document.getElementById('dept-detail-text');
  const label = document.getElementById('dept-detail-label');
  if (dept === 'staber') {
    group.style.display = 'block';
    staberSel.style.display = 'block';
    annatText.style.display = 'none';
    label.textContent = t('reportForm.staberChoose');
  } else if (dept === 'annat') {
    group.style.display = 'block';
    staberSel.style.display = 'none';
    annatText.style.display = 'block';
    label.textContent = t('reportForm.specify');
  } else {
    group.style.display = 'none';
  }
}

// ── BILDER SOM BILAGOR ───────────────────────────────────────────
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

// Bara vanliga bildformat. Samma lista sätts på Storage-bucketen
// (migrations/2026-09_bara-bilder.sql), så servern säger nej även om
// någon tar sig förbi kontrollen här.
// HEIC står medvetet inte med: bara Safari kan visa det, och en iPhone
// konverterar själv till JPEG när formatet inte efterfrågas.
const ALLOWED_IMAGE_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp'
};

// File → objekt-URL för förhandsvisningen. Varje URL håller bilden kvar
// i minnet tills den frigörs, så de släpps när bilden tas bort.
const previewUrls = new Map();

function fileExtension(name) {
  const m = /\.([^.]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function isAllowedImage(file) {
  if (!ALLOWED_IMAGE_TYPES[fileExtension(file.name)]) return false;
  // Vissa system skickar ingen MIME-typ alls; då får filändelsen räcka.
  return !file.type || Object.values(ALLOWED_IMAGE_TYPES).includes(file.type);
}

function totalPendingBytes() {
  return pendingFiles.reduce((sum, f) => sum + f.size, 0);
}

// En skärmdump på 300 KB visades som "0,0 MB". Under en megabyte visas KB.
function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toLocaleString(currentLang === 'en' ? 'en-GB' : 'sv-SE',
    { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB';
}

function handleFilesSelected(inputEl) {
  const rejected = [];
  let total = totalPendingBytes();

  for (const file of Array.from(inputEl.files)) {
    const alreadyAdded = pendingFiles.some(f =>
      f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
    if (alreadyAdded) continue;

    if (!isAllowedImage(file)) { rejected.push(t('err.fileType', { name: file.name })); continue; }
    // Bilden som inte ryms avvisas, men de som redan valts ligger kvar.
    if (total + file.size > MAX_TOTAL_BYTES) { rejected.push(t('err.fileWouldExceed', { name: file.name })); continue; }

    total += file.size;
    pendingFiles.push(file);
    previewUrls.set(file, URL.createObjectURL(file));
  }

  inputEl.value = '';   // annars går samma fil inte att välja igen efter borttagning
  hideError('nc-files-err');
  renderFilesList();
  if (rejected.length) err('nc-files-err', rejected.join(' '));
}

function removeFile(idx) {
  const [file] = pendingFiles.splice(idx, 1);
  if (file && previewUrls.has(file)) {
    URL.revokeObjectURL(previewUrls.get(file));
    previewUrls.delete(file);
  }
  hideError('nc-files-err');
  renderFilesList();
}

function clearPendingFiles() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls.clear();
  pendingFiles = [];
  hideError('nc-files-err');
  renderFilesList();
}

// Miniatyrerna byggs med DOM-anrop, inte innerHTML: ett filnamn kan
// innehålla citattecken, och esc() skyddar bara text, inte attribut.
function renderFilesList() {
  const list  = document.getElementById('nc-files-list');
  const usage = document.getElementById('nc-files-usage');
  list.innerHTML = '';
  usage.innerHTML = '';

  pendingFiles.forEach((file, idx) => {
    const url  = previewUrls.get(file);
    const item = el('div', 'thumb-item');

    const thumb = el('button', 'thumb');
    thumb.type = 'button';
    thumb.setAttribute('aria-label', t('common.enlargeImage', { name: file.name }));
    const img = el('img');
    img.src = url;
    img.alt = '';
    thumb.appendChild(img);
    thumb.addEventListener('click', () => openLightbox(url, file.name));

    const remove = el('button', 'thumb-remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', t('reportForm.removeImage', { name: file.name }));
    remove.innerHTML = '<i class="ti ti-x" aria-hidden="true"></i>';
    remove.addEventListener('click', () => removeFile(idx));

    const caption = el('div', 'thumb-caption');
    caption.textContent = file.name;
    caption.title = file.name;

    const size = el('div', 'thumb-size');
    size.textContent = fmtSize(file.size);

    item.append(thumb, remove, caption, size);
    list.appendChild(item);
  });

  if (!pendingFiles.length) return;
  const used = totalPendingBytes();
  const bar  = el('div', 'files-usage-bar');
  const fill = el('span');
  fill.style.width = Math.min(100, used / MAX_TOTAL_BYTES * 100).toFixed(1) + '%';
  bar.appendChild(fill);
  const text = el('div', 'files-usage-text');
  text.textContent = t('reportForm.sizeUsed', { used: fmtSize(used) });
  usage.append(bar, text);
}

// Supabase Storage avvisar nycklar med icke-ASCII, # eller % med
// InvalidKey. Ett svenskt filnamn som "Bevis åäö.jpg" gick alltså aldrig
// upp. Det riktiga namnet sparas oförändrat i attachments.file_name,
// så handläggaren ser ändå vad filen heter.
function storageSafeName(name) {
  const withoutAccents = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const safe = withoutAccents.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_{2,}/g, '_');
  // Behåll slutet av namnet om det är långt — där sitter filändelsen.
  return (safe.length > 80 ? safe.slice(-80) : safe) || 'bilaga';
}

async function uploadPendingFiles(caseId) {
  const failures = [];
  const status = document.getElementById('nc-upload-status');
  const total  = pendingFiles.length;

  for (const [i, file] of pendingFiles.entries()) {
    status.textContent = t('reportForm.uploading', { n: i + 1, total });
    // Index i nyckeln: "bild å.jpg" och "bild ä.jpg" saneras båda till
    // bild_a.jpg, och utan det skulle den andra krocka med den första.
    const path = `${caseId}/${Date.now()}_${i}_${storageSafeName(file.name)}`;
    const contentType = file.type || ALLOWED_IMAGE_TYPES[fileExtension(file.name)];
    const { error: upErr } = await sb.storage.from('case-attachments').upload(path, file, { contentType });
    if (upErr) {
      console.error('Bilageuppladdning misslyckades:', file.name, upErr);
      failures.push(file.name);
      continue;
    }
    const { error: metaErr } = await sb.from('attachments').insert({ case_id: caseId, file_path: path, file_name: file.name, file_size: file.size });
    if (metaErr) {
      console.error('Kunde inte spara bilage-metadata:', file.name, metaErr);
      failures.push(file.name);
    }
  }

  status.textContent = '';
  clearPendingFiles();
  if (failures.length) {
    // Rapporten är redan skickad vid det här laget — felet gäller bara
    // bilderna, så vi varnar utan att avbryta flödet.
    alert(t('err.attachmentsFailed') + '\n' + failures.join(', '));
  }
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'nc-files') handleFilesSelected(e.target);
});

// ── CREATE CASE (grenar per anmälartyp) ─────────────────────────
async function handleCreateCase() {
  // Formuläret kan nås med bakåtknappen efter utloggning, eller när
  // anmälartypen redan nollställts. Utan spärrarna skickades en rapport
  // utan typ, och databasen svarade med ett tekniskt fel.
  if (!reportType) { startNewReport(); return; }
  if (reportType !== 'anonymous_code' && !me) {
    resumeReport = true;
    showEmpLogin();
    err('emp-err', t('err.sessionExpired'));
    return;
  }

  const subject  = val('case-subject');
  const category = val('cat-sel');
  const dept     = val('dept-sel');
  const message  = val('case-msg');

  if (!subject)         return err('nc-err', t('err.subjectRequired'));
  if (!category)       return err('nc-err', t('err.chooseCategory'));
  if (!dept)            return err('nc-err', t('err.chooseDept'));
  if (!message || message.length < 10) return err('nc-err', t('err.messageShort'));

  // Utan den här spärren skapades ärendet först och bilagorna föll bort
  // efteråt, med en alert som kom när rapporten redan var skickad.
  const totalBytes = pendingFiles.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) return err('nc-err', t('err.filesTooLarge'));

  let deptDetail = null;
  if (dept === 'staber') deptDetail = val('dept-detail-sel');
  if (dept === 'annat')  deptDetail = val('dept-detail-text');

  const who = val('q-who'), where = val('q-where'), when = val('q-when'),
        actions = val('q-actions');

  setBusy('btn-create-case', true);

  if (reportType === 'anonymous_code') {
    const { data, error } = await sb.rpc('create_anonymous_case', {
      p_subject: subject, p_category: category, p_department: dept, p_department_detail: deptDetail,
      p_who_involved: who || null, p_where_happened: where || null,
      p_when_happened: when || null, p_what_happened: null,
      p_other_actions: actions || null, p_message: message
    });
    if (error || !data || !data[0]) {
      setBusy('btn-create-case', false);
      return err('nc-err', error ? friendlyError(error) : t('err.generic'));
    }

    const row = data[0];
    // Knappen hålls låst tills bilderna är uppe. Annars kan ett andra klick
    // skapa ett nytt ärende medan det första fortfarande laddar upp.
    if (pendingFiles.length) await uploadPendingFiles(row.case_id);
    setBusy('btn-create-case', false);
    sb.functions.invoke('notify', { body: { type: 'new_case', case_id: row.case_id } });
    resetReportFields();
    showCodeConfirm(row.access_code, row.wb_token);
    return;
  }

  // typ 2 & 3 — kräver inloggning. Ärendet och första meddelandet skapas
  // i EN transaktion, annars kunde ett tappat andra anrop lämna ett tomt
  // ärende och anmälarens text vara borta.
  const { data, error } = await sb.rpc('create_case', {
    p_reporter_type: reportType,
    p_subject: subject, p_category: category,
    p_department: dept, p_department_detail: deptDetail,
    p_who_involved: who || null, p_where_happened: where || null,
    p_when_happened: when || null, p_other_actions: actions || null,
    p_message: message,
    p_reporter_name:  reportType === 'open' ? me.name : null,
    p_reporter_phone: reportType === 'open' ? (me.phone || null) : null
  });
  if (error || !data || !data[0]) {
    setBusy('btn-create-case', false);
    return err('nc-err', error ? friendlyError(error) : t('err.generic'));
  }

  const newCaseId = data[0].case_id;
  if (pendingFiles.length) await uploadPendingFiles(newCaseId);
  setBusy('btn-create-case', false);
  sb.functions.invoke('notify', { body: { type: 'new_case', case_id: newCaseId } });

  resetReportForm();
  await showEmpDash();
}

// ── KOD-BEKRÄFTELSE (typ 1, visas EN gång) ──────────────────────
function showCodeConfirm(code, token) {
  lastAccessCode = code;
  document.getElementById('code-display-value').textContent = code;
  document.getElementById('code-confirm-token').textContent = token;
  show('view-code-confirm');
}

async function copyAccessCode() {
  if (!lastAccessCode) return;
  const btn = document.getElementById('btn-copy-code');
  // Tidigare hände ingenting synligt, så det gick inte att veta om koden
  // faktiskt hamnat i urklipp.
  try {
    await navigator.clipboard.writeText(lastAccessCode);
    btn.textContent = t('codeConfirm.copied');
  } catch (e) {
    // Urklipp kan vara blockerat. Markera koden så att den går att kopiera för hand.
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('code-display-value'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    btn.textContent = t('codeConfirm.copyFailed');
  }
  clearTimeout(copyAccessCode.timer);
  copyAccessCode.timer = setTimeout(() => { btn.textContent = t('codeConfirm.copy'); }, 2500);
}

function handleCodeConfirmDone() {
  lastAccessCode = null;
  document.getElementById('code-display-value').textContent = '';
  document.getElementById('code-confirm-token').textContent = '';
  resetReportForm();
  showLanding();
}

// ── EMPLOYEE DASHBOARD (typ 2 & 3) ────────────────────────────
async function showEmpDash(filter) {
  if (!me) return;
  activeDashTab = filter || activeDashTab || 'all';
  document.querySelectorAll('#view-emp-dash .sub-tab').forEach(b => b.classList.toggle('active', b.dataset.stab === activeDashTab));
  const token = show('view-emp-dash');

  const list = document.getElementById('emp-cases-list');
  list.innerHTML = `<div class="empty-state">${t('common.loading')}</div>`;

  let q = sb.from('cases').select('*, messages(*)').eq('employee_id', me.id).order('created_at', { ascending: false });
  if (activeDashTab === 'open')     q = q.neq('status', 'resolved');
  if (activeDashTab === 'resolved') q = q.eq('status', 'resolved');

  const { data: cases, error } = await q;
  if (token !== navToken) return;
  if (error) { list.innerHTML = `<div class="empty-state">${t('err.loadFailed')}</div>`; return; }

  list.innerHTML = '';
  if (!cases || !cases.length) {
    list.innerHTML = `<div class="empty-state">${activeDashTab === 'all' ? t('dash.emptyAll') : t('dash.emptyFiltered')}</div>`;
    return;
  }

  cases.forEach(c => {
    const msgs    = (c.messages || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const lastMsg = msgs.at(-1);
    const unread  = lastMsg && lastMsg.from_role === 'admin';
    // Speglar admin-vyn: om senaste meddelandet är från mig själv väntar
    // jag på handläggaren, annars ligger nytt svar och väntar på mig.
    const waitingNote = (c.status === 'investigating' && !unread) ? t('common.waitingForHandler') : '';

    const div = el('div', `case-card${unread ? ' unread' : ''}`);
    div.innerHTML = `
      <div class="case-header">
        <span class="token">${esc(c.anonymous_token)}</span>
        <span class="status-pill s-${statusClass(c.status)}">${esc(tLabel('status.', c.status))}</span>
      </div>
      <div class="case-subject-line">${esc(c.subject || '—')}</div>
      <div class="case-meta">
        <span>${esc(tLabel('cat.', c.category))}</span>
        <span>${fmt(c.created_at)}</span>
      </div>
      ${waitingNote ? `<div class="waiting-note">${waitingNote}</div>` : ''}
      ${unread ? `<div class="new-badge">${t('common.newReply')}</div>` : ''}`;
    div.addEventListener('click', () => openCaseEmp(c.id));
    list.appendChild(div);
  });
}

// ── CASE DETAIL – Employee ─────────────────────────────────────
async function openCaseEmp(caseId) {
  activeCaseId = caseId;
  const token = show('view-case-emp');
  // Töms direkt när ärendet öppnas. Tidigare tömdes rutan först när
  // meddelandena laddats klart, och på en långsam uppkoppling försvann
  // då det personen hunnit börja skriva.
  document.getElementById('emp-reply-input').value = '';

  const [{ data: c }, { data: msgs }, { data: attachments }] = await Promise.all([
    sb.from('cases').select('*').eq('id', caseId).single(),
    sb.from('messages').select('*').eq('case_id', caseId).order('created_at', { ascending: true }),
    sb.from('attachments').select('file_path, file_name, file_size, created_at')
      .eq('case_id', caseId).order('created_at', { ascending: true })
  ]);

  if (token !== navToken) return;         // användaren har navigerat vidare
  if (!c) { err('emp-reply-err', t('err.caseLoadFailed')); return; }

  document.getElementById('c-token').textContent = c.anonymous_token;
  document.getElementById('c-cat').textContent   = tLabel('cat.', c.category);
  const sp = document.getElementById('c-status');
  sp.textContent = tLabel('status.', c.status);
  sp.className   = `status-pill s-${statusClass(c.status)}`;
  activeCaseExtra = {
    subject: c.subject, category: c.category, department: c.department, departmentDetail: c.department_detail,
    whoInvolved: c.who_involved, whereHappened: c.where_happened,
    whenHappened: c.when_happened, otherActions: c.other_actions,
    reporterType: c.reporter_type, reporterName: c.reporter_name
  };
  const files = await signAttachments(attachments || []);
  if (token !== navToken) return;
  renderCaseFiles('c-files', files);
  await renderMsgs('emp-msgs', msgs || [], 'employee', activeCaseExtra);
}

async function handleEmpReply() {
  const text = val('emp-reply-input');
  if (!text) return err('emp-reply-err', t('err.writeMessage'));
  setBusy('btn-emp-reply', true);
  const { error } = await sb.from('messages').insert({ case_id: activeCaseId, from_role: 'employee', text });
  setBusy('btn-emp-reply', false);
  if (error) return err('emp-reply-err', friendlyError(error));

  sb.functions.invoke('notify', { body: { type: 'employee_reply', case_id: activeCaseId } });

  document.getElementById('emp-reply-input').value = '';
  clearErrors();
  const { data: msgs } = await sb.from('messages').select('*')
    .eq('case_id', activeCaseId).order('created_at', { ascending: true });
  await renderMsgs('emp-msgs', msgs || [], 'employee', activeCaseExtra);
}

// ── ADMIN DASHBOARD ───────────────────────────────────────────
let activeAdminDashTab = 'all';

async function showAdminDash(filter) {
  if (!me) return;
  activeAdminDashTab = filter || activeAdminDashTab || 'all';
  document.querySelectorAll('#view-admin-dash .sub-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.stab === activeAdminDashTab);
  });
  document.getElementById('admin-name').textContent  = me.name  || me.email || '';
  document.getElementById('admin-title').textContent = me.title || '';
  const token = show('view-admin-dash');

  const list = document.getElementById('admin-cases-list');
  list.innerHTML = `<div class="empty-state">${t('common.loading')}</div>`;

  // employee_id är avsiktligt exkluderat — anonymitet upprätthålls på query-nivå.
  // Ingen mottagarfiltrering: delad inkorg, RLS avgör vilka rader admins ser.
  let q = sb.from('cases')
    .select('id, anonymous_token, reporter_type, reporter_name, subject, category, department, status, created_at, messages(*)')
    .order('created_at', { ascending: false });
  if (activeAdminDashTab !== 'all') q = q.eq('status', activeAdminDashTab);

  const { data: cases, error } = await q;

  if (token !== navToken) return;
  if (error) { list.innerHTML = `<div class="empty-state">${t('err.loadFailed')}</div>`; return; }

  list.innerHTML = '';
  if (!cases || !cases.length) {
    list.innerHTML = `<div class="empty-state">${t('adminDash.empty')}</div>`;
    return;
  }

  cases.forEach(c => {
    const msgs   = (c.messages || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const last   = msgs.at(-1);
    const unread = last && last.from_role === 'employee';
    const typeLabel = c.reporter_type === 'open'
      ? (c.reporter_name || t('reportType.t3title'))
      : c.reporter_type === 'anonymous_email' ? t('reportType.t2title') : t('reportType.t1title');
    // Pillen är alltid kort. Om ärendet är under utredning och admin redan
    // svarat (väntar på anmälaren) visas det som en separat liten textrad
    // istället för att proppa in en lång mening i den runda pillen.
    const waitingNote = (c.status === 'investigating' && !unread) ? t('common.waitingForReporter') : '';

    const div = el('div', `case-card${unread ? ' unread' : ''}`);
    div.innerHTML = `
      <div class="case-header">
        <span class="token">${esc(c.anonymous_token)}</span>
        <span class="status-pill s-${statusClass(c.status)}">${esc(tLabel('status.', c.status))}</span>
      </div>
      <div class="case-subject-line">${esc(c.subject || '—')}</div>
      <div class="case-meta">
        <span class="type-tag">${esc(typeLabel)}</span>
        <span>${esc(tLabel('cat.', c.category))}</span>
        <span>${fmt(c.created_at)}</span>
        <span>${msgs.length} ${t('common.messages')}</span>
      </div>
      ${waitingNote ? `<div class="waiting-note">${waitingNote}</div>` : ''}
      ${unread ? `<div class="new-badge">${t('common.newMessage')}</div>` : ''}`;
    div.addEventListener('click', () => openCaseAdmin(c.id));
    list.appendChild(div);
  });
}

// ── CASE DETAIL – Admin ─────────────────────────────────────────
async function openCaseAdmin(caseId) {
  activeCaseId = caseId;
  const token = show('view-case-admin');
  // Töms direkt när ärendet öppnas. Tidigare tömdes rutan först när
  // meddelandena laddats klart, och på en långsam uppkoppling försvann
  // då det personen hunnit börja skriva.
  document.getElementById('admin-reply-input').value = '';
  document.getElementById('ac-note-input').value = '';

  const [{ data: c }, { data: msgs }, { data: attachments }] = await Promise.all([
    // employee_id är aldrig med i select — anonymitet upprätthålls på query-nivå
    sb.from('cases').select('id, anonymous_token, reporter_type, reporter_name, reporter_phone, subject, category, department, department_detail, status, who_involved, where_happened, when_happened, other_actions').eq('id', caseId).single(),
    sb.from('messages').select('*').eq('case_id', caseId).order('created_at', { ascending: true }),
    sb.from('attachments').select('*').eq('case_id', caseId).order('created_at', { ascending: true })
  ]);

  if (token !== navToken) return;         // användaren har navigerat vidare
  if (!c) { err('admin-reply-err', t('err.caseLoadFailed')); return; }

  document.getElementById('ac-subject').textContent = c.subject || '';
  document.getElementById('ac-token').textContent = c.anonymous_token;
  document.getElementById('ac-cat').textContent   = tLabel('cat.', c.category);
  const deptDetailLabel = c.department_detail
    ? (translations[currentLang]['staber.' + c.department_detail] || c.department_detail)
    : '';
  document.getElementById('ac-dept').textContent = tLabel('dept.', c.department) + (deptDetailLabel ? ' – ' + deptDetailLabel : '');
  document.getElementById('ac-status-sel').value  = c.status;
  activeCaseStatus = c.status;

  const reporterInfoEl = document.getElementById('ac-reporter-info');
  if (c.reporter_type === 'open') {
    reporterInfoEl.innerHTML = `${t('reportType.t3title')}: <strong>${esc(c.reporter_name || '')}</strong>${c.reporter_phone ? ' · ' + esc(c.reporter_phone) : ''}`;
  } else {
    reporterInfoEl.textContent = c.reporter_type === 'anonymous_email' ? t('reportType.t2title') : t('reportType.t1title');
  }

  activeCaseExtra = {
    subject: c.subject, category: c.category, department: c.department, departmentDetail: c.department_detail,
    whoInvolved: c.who_involved, whereHappened: c.where_happened,
    whenHappened: c.when_happened, otherActions: c.other_actions,
    reporterType: c.reporter_type, reporterName: c.reporter_name
  };
  const files = await signAttachments(attachments || []);
  if (token !== navToken) return;
  renderCaseFiles('ac-files', files);
  await renderMsgs('admin-msgs', msgs || [], 'admin', activeCaseExtra);

  applyNotesPanel();
  await loadNotes(caseId);
}

async function handleAdminReply() {
  const text = val('admin-reply-input');
  if (!text) return err('admin-reply-err', t('err.writeMessage'));
  setBusy('btn-admin-reply', true);
  const { error } = await sb.from('messages').insert({ case_id: activeCaseId, from_role: 'admin', text, sender_id: me.id });
  setBusy('btn-admin-reply', false);
  if (error) return err('admin-reply-err', friendlyError(error));

  // typ 1 (helt anonym) har ingen e-post att notifiera
  const { data: c } = await sb.from('cases').select('reporter_type').eq('id', activeCaseId).single();
  if (c && c.reporter_type !== 'anonymous_code') {
    sb.functions.invoke('notify', { body: { type: 'admin_reply', case_id: activeCaseId } });
  }

  document.getElementById('admin-reply-input').value = '';
  clearErrors();
  const { data: msgs } = await sb.from('messages').select('*')
    .eq('case_id', activeCaseId).order('created_at', { ascending: true });
  await renderMsgs('admin-msgs', msgs || [], 'admin', activeCaseExtra);
}

// Senast sparade status. Om en ändring misslyckas visar listan det här
// igen, i stället för ett värde som aldrig sparades.
let activeCaseStatus = null;

async function handleStatusChange() {
  const sel = document.getElementById('ac-status-sel');
  const status = sel.value;
  sel.disabled = true;
  const { error } = await sb.from('cases').update({ status }).eq('id', activeCaseId);
  sel.disabled = false;
  if (error) {
    console.error('Kunde inte uppdatera status:', error);
    sel.value = activeCaseStatus;
    err('admin-reply-err', t('err.statusUpdateFailed'));
    return;
  }
  activeCaseStatus = status;
}

// ── INTERNA ANTECKNINGAR (endast admin) ───────────────────────
// Anteckningarna bor i en egen tabell, case_notes, som bara admins har
// någon policy alls på. Visselblåsaren kan därför inte nå dem — varken
// via tabellen eller via get_case_by_code() (typ 1).
let notesOpen       = false;   // panelen är kvar öppen när man byter ärende
let activeCaseNotes = [];

function toggleNotes(force) {
  notesOpen = (force === undefined) ? !notesOpen : !!force;
  applyNotesPanel();
  if (notesOpen) document.getElementById('ac-note-input').focus();
}

function applyNotesPanel() {
  document.getElementById('view-case-admin').classList.toggle('notes-open', notesOpen);

  const btn = document.getElementById('btn-notes-toggle');
  btn.setAttribute('aria-expanded', String(notesOpen));
  // Ikonen visar vad knappen gör härnäst: plus när panelen är stängd,
  // minus när den är öppen och nästa klick fäller ihop den.
  const icon = btn.querySelector('i');
  icon.classList.toggle('ti-plus',  !notesOpen);
  icon.classList.toggle('ti-minus',  notesOpen);
}

async function loadNotes(caseId) {
  const { data, error } = await sb.from('case_notes')
    .select('id, author_id, text, created_at')
    .eq('case_id', caseId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Kunde inte hämta anteckningar:', error);
    activeCaseNotes = [];
    document.getElementById('ac-notes-list').innerHTML =
      `<div class="notes-empty">${t('err.notesLoadFailed')}</div>`;
    updateNotesCount();
    return;
  }
  activeCaseNotes = data || [];
  await renderNotes();
}

function updateNotesCount() {
  const badge = document.getElementById('ac-notes-count');
  badge.textContent = activeCaseNotes.length;
  badge.classList.toggle('has-notes', activeCaseNotes.length > 0);
}

async function renderNotes() {
  const list = document.getElementById('ac-notes-list');
  updateNotesCount();

  if (!activeCaseNotes.length) {
    list.innerHTML = `<div class="notes-empty">${t('notes.empty')}</div>`;
    return;
  }

  // En nytillagd kollega finns inte i den cachade kartan. Slå om en gång
  // istället för att visa "Handläggare" i onödan.
  let adminsMap = await getAdminsMap();
  if (activeCaseNotes.some(n => !adminsMap[n.author_id])) {
    adminsMapCache = null;
    adminsMap = await getAdminsMap();
  }

  list.innerHTML = '';
  activeCaseNotes.forEach(n => {
    const isOwn = !!me && n.author_id === me.id;
    const author = isOwn ? t('notes.you') : (adminsMap[n.author_id] || t('common.caseHandler'));

    const card = el('div', 'note-card');
    card.innerHTML = `
      <div class="note-head">
        <span class="note-author">${esc(author)}</span>
        <span class="note-time">${fmt(n.created_at)}</span>
      </div>
      <div class="note-text">${esc(n.text)}</div>`;

    decorateOwnNote(card, n, isOwn);
    list.appendChild(card);
  });
  list.scrollTop = list.scrollHeight;
}

// Anropas för varje anteckning efter att kortet byggts. Egna anteckningar
// får gärna skilja sig från kollegornas, och bara egna går att ta bort —
// det är vad RLS-policyn "Notes: admin raderar egna" tillåter.
//
// card   – elementet <div class="note-card"> som redan innehåller
//          författare, tidsstämpel och text
// note   – { id, author_id, text, created_at }
// isOwn  – true om inloggad handläggare skrev anteckningen
function decorateOwnNote(card, note, isOwn) {
  if (!isOwn) return;

  card.classList.add('note-own');

  // Papperskorgen ligger i .note-head efter tidsstämpeln, inte ovanpå
  // texten — anteckningarna är korta och en knapp mitt i dem skulle
  // knuffa runt raderna. Den tonas fram vid hover över kortet så att
  // listan är lugn att läsa.
  const btn = el('button', 'note-delete');
  btn.type = 'button';
  btn.setAttribute('aria-label', t('notes.delete'));
  btn.innerHTML = '<i class="ti ti-trash" aria-hidden="true"></i>';
  btn.addEventListener('click', () => handleDeleteNote(note.id));
  card.querySelector('.note-head').appendChild(btn);
}

async function handleAddNote() {
  const text = val('ac-note-input');
  if (!text) return err('ac-note-err', t('err.noteEmpty'));

  setBusy('btn-add-note', true);
  const { data, error } = await sb.from('case_notes')
    .insert({ case_id: activeCaseId, author_id: me.id, text })
    .select('id, author_id, text, created_at')
    .single();
  setBusy('btn-add-note', false);

  if (error) {
    console.error('Kunde inte spara anteckning:', error);
    return err('ac-note-err', t('err.noteFailed'));
  }

  clearErrors();
  document.getElementById('ac-note-input').value = '';
  activeCaseNotes.push(data);
  await renderNotes();
}

async function handleDeleteNote(noteId) {
  if (!confirm(t('notes.confirmDelete'))) return;
  const { error } = await sb.from('case_notes').delete().eq('id', noteId);
  if (error) {
    console.error('Kunde inte ta bort anteckning:', error);
    return err('ac-note-err', t('err.noteFailed'));
  }
  activeCaseNotes = activeCaseNotes.filter(n => n.id !== noteId);
  await renderNotes();
}


// ── RENDER MESSAGES ───────────────────────────────────────────
// caseExtra (valfri): { category, department, departmentDetail,
// whoInvolved, whereHappened, whenHappened, otherActions } — allt som
// fylldes i utöver själva meddelandet, för att "Min anmälan"-modalen
// ska kunna visa hela anmälan i sin ursprungliga blockstruktur.
let adminsMapCache = null;
async function getAdminsMap() {
  if (adminsMapCache) return adminsMapCache;
  const { data } = await sb.from('admins').select('id, name');
  adminsMapCache = Object.fromEntries((data || []).map(a => [a.id, a.name]));
  return adminsMapCache;
}

async function renderMsgs(id, messages, perspective, caseExtra) {
  const c = document.getElementById(id);
  // Bilageraden ligger bredvid rapportbubblan, alltså inne i tråden som
  // töms nedan. Flytta ut den först, annars försvinner den med innehållet.
  const scroller = c.closest('.thread-scroll');
  const files = scroller && scroller.querySelector('.case-files');
  if (files && c.contains(files)) scroller.insertBefore(files, c);
  if (!messages.length) {
    c.innerHTML = `<div style="text-align:center;color:var(--muted);padding:32px;font-size:14px;">${t('common.noMessages')}</div>`;
    return;
  }
  const adminsMap = await getAdminsMap();
  c.innerHTML = '';
  messages.forEach((m, idx) => {
    const own = m.from_role === perspective;
    const isFirst = idx === 0; // det första meddelandet är alltid själva anmälan
    const wrap = el('div', `msg ${own ? 'msg-own' : 'msg-other'}`);
    const senderLabel = isFirst
      ? (perspective === 'employee' ? t('common.myReport') : t('common.theReport'))
      : (m.from_role === 'employee'
          ? ((caseExtra && caseExtra.reporterType === 'open' && caseExtra.reporterName) ? caseExtra.reporterName : t('common.reporter'))
          : (adminsMap[m.sender_id] || t('common.caseHandler')));

    wrap.innerHTML = `
      <div class="bubble${isFirst ? ' bubble-report' : ''}">
        <div class="bubble-sender">${esc(senderLabel)}</div>
        <div class="bubble-text${isFirst ? ' bubble-cta' : ''}">${isFirst ? `📄 ${t('common.clickToReadReport')}` : esc(m.text)}</div>
        <div class="bubble-time">${fmt(m.created_at)}</div>
      </div>`;

    if (isFirst) {
      const bubbleEl = wrap.querySelector('.bubble');
      bubbleEl.style.cursor = 'pointer';
      bubbleEl.addEventListener('click', () => showReportModal(senderLabel, m.text, m.created_at, caseExtra));
      // Bilagorna hör till rapporten och står därför på samma rad, på
      // den sida som vetter in mot mitten av tråden.
      if (files) {
        wrap.classList.add('msg-with-files');
        own ? wrap.prepend(files) : wrap.appendChild(files);
      }
    }
    c.appendChild(wrap);
  });
  // Tråden rullar i omslaget som även rymmer bilagorna överst.
  const scrollBox = scroller || c;
  scrollBox.scrollTop = scrollBox.scrollHeight;
}

// ── FÖRSTORAD VY AV ANMÄLAN ─────────────────────────────────────
function showReportModal(title, text, createdAt, caseExtra) {
  let modal = document.getElementById('report-modal');
  if (!modal) {
    modal = el('div', 'report-modal-overlay');
    modal.id = 'report-modal';
    modal.innerHTML = `
      <div class="report-modal">
        <button class="report-modal-close" aria-label="Stäng">✕</button>
        <div class="report-modal-title"></div>
        <div class="report-modal-time"></div>
        <div class="report-modal-blocks"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeReportModal(); });
    modal.querySelector('.report-modal-close').addEventListener('click', closeReportModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeReportModal(); });
  }

  const e = caseExtra || {};
  const deptDetailLabel = e.departmentDetail
    ? (translations[currentLang]['staber.' + e.departmentDetail] || e.departmentDetail)
    : '';

  const blocks = [];
  if (e.subject)    blocks.push([t('reportForm.subject'), e.subject]);
  if (e.category)   blocks.push([t('reportForm.category'), tLabel('cat.', e.category)]);
  if (e.department)  blocks.push([t('reportForm.department'), tLabel('dept.', e.department) + (deptDetailLabel ? ' – ' + deptDetailLabel : '')]);
  blocks.push([t('reportForm.message'), text]);
  if (e.whoInvolved)    blocks.push([t('reportForm.qWho'), e.whoInvolved]);
  if (e.whereHappened)  blocks.push([t('reportForm.qWhere'), e.whereHappened]);
  if (e.whenHappened)   blocks.push([t('reportForm.qWhen'), e.whenHappened]);
  if (e.otherActions)   blocks.push([t('reportForm.qActions'), e.otherActions]);

  modal.querySelector('.report-modal-title').textContent = title;
  modal.querySelector('.report-modal-time').textContent = fmt(createdAt);
  modal.querySelector('.report-modal-blocks').innerHTML = blocks.map(([label, val]) => `
    <div class="report-modal-block">
      <div class="report-modal-label">${esc(label)}</div>
      <div class="report-modal-text">${esc(val)}</div>
    </div>`).join('');
  modal.style.display = 'flex';
}

function closeReportModal() {
  const modal = document.getElementById('report-modal');
  if (modal) modal.style.display = 'none';
}

// ── BILDVISARE ─────────────────────────────────────────────────
let lightboxReturnFocus = null;

function openLightbox(src, caption) {
  let box = document.getElementById('lightbox');
  if (!box) {
    box = el('div', 'lightbox-overlay');
    box.id = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML = `
      <button type="button" class="lightbox-close"><i class="ti ti-x" aria-hidden="true"></i></button>
      <figure class="lightbox-figure">
        <img class="lightbox-img" alt="">
        <figcaption class="lightbox-caption"></figcaption>
      </figure>`;
    document.body.appendChild(box);
    // Klick på den mörka bakgrunden stänger, klick på själva bilden gör det inte.
    box.addEventListener('click', e => {
      if (e.target === box || e.target.closest('.lightbox-close')) closeLightbox();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
  }

  lightboxReturnFocus = document.activeElement;
  const closeBtn = box.querySelector('.lightbox-close');
  closeBtn.setAttribute('aria-label', t('common.close'));
  const img = box.querySelector('.lightbox-img');
  img.src = src;
  img.alt = caption || '';
  box.querySelector('.lightbox-caption').textContent = caption || '';
  box.style.display = 'flex';
  closeBtn.focus();
}

function closeLightbox() {
  const box = document.getElementById('lightbox');
  if (!box || box.style.display !== 'flex') return;
  box.style.display = 'none';
  box.querySelector('.lightbox-img').removeAttribute('src');
  if (lightboxReturnFocus && lightboxReturnFocus.focus) lightboxReturnFocus.focus();
  lightboxReturnFocus = null;
}

// ── BILAGOR I ETT ÄRENDE ───────────────────────────────────────
// Samma bildrad i alla tre ärendevyer, överst i den rullande tråden
// (.thread-scroll) ovanför rapporten. Man rullar förbi den som förbi
// vilket meddelande som helst, så den tar ingen fast plats från chatten.
//
// Tidigare låg raden fast under ärendets rubrik. Den syntes alltid, men
// åt av höjden som chatten och anteckningarna delar på.

// Signerade länkar för en lista bilagor, alla i ett anrop. Gäller en
// timme. url blir null om signeringen misslyckas; då visas bara namnet.
async function signAttachments(attachments) {
  if (!attachments || !attachments.length) return [];
  const { data, error } = await sb.storage.from('case-attachments')
    .createSignedUrls(attachments.map(a => a.file_path), 3600);
  if (error) console.error('Kunde inte skapa länkar till bilagor:', error);
  const urlByPath = {};
  (data || []).forEach(x => { if (x.path && x.signedUrl) urlByPath[x.path] = x.signedUrl; });
  return attachments.map(a => ({ file_name: a.file_name, url: urlByPath[a.file_path] || null }));
}

// items: [{ file_name, url }]
function renderCaseFiles(containerId, items) {
  const wrap = document.getElementById(containerId);
  // Byts bilderna ut medan personen läser längst ner, t.ex. när en anonym
  // anmälares bilder blir klara, ska läsläget stå kvar i stället för att
  // tråden hoppar när innehållet ovanför ändrar höjd.
  const scroller = wrap.closest('.thread-scroll');
  const atBottom = !!scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
  const keepBottom = () => { if (atBottom) scroller.scrollTop = scroller.scrollHeight; };

  wrap.innerHTML = '';
  if (!items || !items.length) { wrap.style.display = 'none'; keepBottom(); return; }

  const label = el('span', 'case-files-label');
  label.innerHTML = '<i class="ti ti-paperclip" aria-hidden="true"></i>';
  label.appendChild(document.createTextNode(t('anonCase.attachments')));

  const strip = el('div', 'case-files-strip');
  items.forEach(a => strip.appendChild(caseFileItem(a)));

  wrap.append(label, strip);
  wrap.style.display = 'flex';
  keepBottom();
}

// Bild med länk: liten ruta som förstoras vid klick. Annan fil med länk,
// t.ex. en PDF från innan formaten begränsades: ikon som öppnar filen.
// Utan länk, medan länkarna hämtas: filnamnet.
function caseFileItem(a) {
  const isImage = !!ALLOWED_IMAGE_TYPES[fileExtension(a.file_name)];

  if (a.url && isImage) {
    const btn = el('button', 'thumb');
    btn.type = 'button';
    btn.title = a.file_name;
    btn.setAttribute('aria-label', t('common.enlargeImage', { name: a.file_name }));
    const img = el('img');
    img.src = a.url;
    img.alt = '';
    btn.appendChild(img);
    btn.addEventListener('click', () => openLightbox(a.url, a.file_name));
    return btn;
  }

  if (a.url) {
    const link = el('a', 'thumb thumb-file');
    link.href = a.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = a.file_name;
    link.setAttribute('aria-label', a.file_name);
    link.innerHTML = '<i class="ti ti-file" aria-hidden="true"></i>';
    return link;
  }

  const chip = el('span', 'case-file-chip');
  chip.textContent = a.file_name;
  return chip;
}

// ── ENTER I FORMULÄR ──────────────────────────────────────────
// Enter i ett enradsfält skickar formuläret, som användare förväntar sig.
// Textrutor påverkas inte: där betyder Enter ny rad. Knappens låsning
// respekteras, så att Enter inte skickar två gånger under ett anrop.
const ENTER_SUBMITS = {
  'access-code-input': ['btn-code-entry', () => handleCodeEntry()],
  'emp-email':  ['btn-emp-login', () => handleEmpLogin()],
  'emp-pw':     ['btn-emp-login', () => handleEmpLogin()],
  'admin-email': ['btn-admin-login', () => handleAdminLogin()],
  'admin-pw':    ['btn-admin-login', () => handleAdminLogin()],
  'reg-name':  ['btn-send-code', () => handleSendCode()],
  'reg-email': ['btn-send-code', () => handleSendCode()],
  'reg-phone': ['btn-send-code', () => handleSendCode()],
  'reg-pw':    ['btn-send-code', () => handleSendCode()],
  'reg-pw2':   ['btn-send-code', () => handleSendCode()],
  'new-pw':  ['btn-set-pw', () => handleSetNewPassword()],
  'new-pw2': ['btn-set-pw', () => handleSetNewPassword()],
};

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const entry = e.target && ENTER_SUBMITS[e.target.id];
  if (!entry) return;
  e.preventDefault();
  const btn = document.getElementById(entry[0]);
  if (btn && btn.disabled) return;
  entry[1]();
});

// ── HELPERS ───────────────────────────────────────────────────
function el(tag, className) { const e = document.createElement(tag); if (className) e.className = className; return e; }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function fmt(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'sv-SE', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(currentLang === 'en' ? 'en-GB' : 'sv-SE', { hour: '2-digit', minute: '2-digit' });
}
function val(id) { return (document.getElementById(id).value || '').trim(); }
function err(id, msg) {
  const e = document.getElementById(id);
  if (!e) return;
  // Återställningslänkens bekräftelse färgar samma ruta grön. Utan den här
  // nollställningen blev nästa felmeddelande också grönt.
  e.style.color = ''; e.style.background = ''; e.style.borderColor = '';
  e.textContent = msg;
  e.style.display = 'block';
}

// Tekniska fel som "TypeError: Failed to fetch" eller texter från
// databasens behörighetsregler betyder ingenting för en användare.
// Nätverksfel får en egen text, allt annat en allmän. Detaljerna
// hamnar i konsolen för felsökning.
function isNetworkError(error) {
  const msg = String((error && error.message) || '');
  return !!error && (error.status === 0 || /failed to fetch|networkerror|network request failed|load failed/i.test(msg));
}

function friendlyError(error) {
  console.error('Fel från servern:', error);
  return isNetworkError(error) ? t('err.network') : t('err.generic');
}

// Status används som del av ett klassnamn och får bara vara kända värden.
function statusClass(status) {
  return ['open', 'investigating', 'resolved'].includes(status) ? status : 'open';
}

// Kort bekräftelse längst ner på skärmen, t.ex. efter byte av lösenord.
function toast(msg) {
  let box = document.getElementById('toast');
  if (!box) {
    box = el('div', 'toast');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('show'), 3500);
}
function hideError(id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; }
function clearErrors() { document.querySelectorAll('.error-msg').forEach(e => { e.style.display = 'none'; }); }
function setBusy(btnId, busy) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = busy;
  btn.style.opacity = busy ? '0.6' : '1';
}
