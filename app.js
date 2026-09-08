'use strict';

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
function show(id) {
  document.querySelectorAll('.view').forEach(v => { v.style.display = 'none'; });
  document.getElementById(id).style.display = 'block';
  clearErrors();
  updateHeader();
}

function updateHeader() {
  const logoutBtn = document.getElementById('btn-logout');
  const profileEl = document.getElementById('header-profile');
  const adminLink = document.getElementById('admin-link');
  if (me && meType === 'admin') {
    logoutBtn.style.display = 'inline-flex';
    adminLink.style.display = 'none';
    const roleLine = (me.isSuperAdmin ? 'SUPER-ADMIN · ' : '') + (me.title || '');
    profileEl.innerHTML = me.photo
      ? `<div class="admin-profile"><img src="${me.photo}" alt="${me.name}"><div><div class="a-name">${me.name}</div><div class="a-role">${roleLine}</div></div></div>`
      : `<div class="admin-profile"><div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;color:var(--gold);font-weight:700;font-size:16px;border:2px solid var(--gold);">${(me.name||'?').charAt(0)}</div><div><div class="a-name">${me.name}</div><div class="a-role">${roleLine}</div></div></div>`;
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
sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    show('view-reset-password');
  } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
    await loadUserContext(session);
  } else if (event === 'SIGNED_OUT') {
    me = null; meType = null; activeCaseId = null; reportType = null;
    showLanding();
  } else if (event === 'INITIAL_SESSION' && !session) {
    showLanding();
  }
});

async function loadUserContext(session) {
  try {
    const { data: profile, error } = await sb
      .from('profiles')
      .select('reporter_type, is_admin, name, phone, admins(id, name, title, role, photo, is_super_admin)')
      .eq('id', session.user.id)
      .single();
    if (error) throw error;

    me = { id: session.user.id, email: session.user.email, reporterType: profile.reporter_type, name: profile.name, phone: profile.phone };

    if (profile.is_admin && profile.admins) {
      meType = 'admin';
      me.name  = profile.admins.name;
      me.title = profile.admins.title;
      me.photo = profile.admins.photo;
      me.isSuperAdmin = !!profile.admins.is_super_admin;
      await showAdminDash();
    } else {
      meType = 'employee';
      // If we arrived here via the reporter-type → register flow, continue straight to the form
      if (reportType) await showNewCase();
      else await showEmpDash();
    }
  } catch (e) {
    console.error('Kunde inte ladda användarkontexten:', e);
    await sb.auth.signOut();
    showLanding();
  }
}

// ── LANDING ───────────────────────────────────────────────────
function showLanding(section) {
  show('view-landing');
  document.querySelector('.landing-grid').style.display = section ? 'none' : 'grid';
  document.querySelectorAll('.tab-panel').forEach(p => { p.style.display = 'none'; });
  if (section) {
    const panel = document.getElementById('panel-' + section);
    if (panel) panel.style.display = 'block';
  }
  window.scrollTo(0, 0);
}

function onLangChange() {
  if (meType === 'admin' && document.getElementById('view-admin-dash').style.display === 'block') showAdminDash();
  if (meType === 'employee' && document.getElementById('view-emp-dash').style.display === 'block') showEmpDash();
}

// ── REPORT TYPE SELECTION ───────────────────────────────────────
function startNewReport() {
  reportType = null;
  pendingFiles = [];
  show('view-report-type');
}

// Inloggad medarbetare (typ 2/3) som klickar "+ Ny anmälan" ska INTE
// behöva välja typ igen eller registrera sig på nytt — deras konto har
// redan en fast reporter_type (satt vid registreringen).
function newCaseForExistingUser() {
  reportType = me.reporterType;
  showNewCase();
}

function selectReportType(type) {
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
    return err('reg-err', error.message === 'User already registered' ? t('err.alreadyRegistered') : error.message);
  }
  if (data.session) return; // auto-confirmed — onAuthStateChange handles redirect

  document.getElementById('reg-step1').style.display = 'none';
  document.getElementById('reg-step2').style.display = 'block';
  document.getElementById('reg-sent-to').textContent = email;
  clearErrors();
}

// ── FOLLOW UP ─────────────────────────────────────────────────
function showFollowUp() { show('view-followup-choice'); }

async function handleCodeEntry() {
  const code = val('access-code-input');
  if (!code) return err('code-entry-err', t('err.enterCode'));
  setBusy('btn-code-entry', true);
  const { data, error } = await sb.rpc('get_case_by_code', { p_code: code });
  setBusy('btn-code-entry', false);
  if (error || !data || !data.length) return err('code-entry-err', t('err.invalidCode'));
  anonCaseCode = code;
  anonCaseData = data[0];
  renderAnonCase();
  show('view-anon-case');
}

function renderAnonCase() {
  const c = anonCaseData;
  document.getElementById('anon-token').textContent = c.wb_token;
  document.getElementById('anon-cat').textContent = t('cat.' + c.category);
  const sp = document.getElementById('anon-status');
  sp.textContent = t('status.' + c.status);
  sp.className = `status-pill s-${c.status}`;
  renderMsgs('anon-msgs', c.messages || [], 'employee', {
    subject: c.subject, category: c.category, department: c.department, departmentDetail: c.department_detail,
    whoInvolved: c.who_involved, whereHappened: c.where_happened,
    whenHappened: c.when_happened, otherActions: c.other_actions
  });
  document.getElementById('anon-reply-input').value = '';
}

async function handleAnonReply() {
  const text = val('anon-reply-input');
  if (!text) return err('anon-reply-err', t('err.writeMessage'));
  setBusy('btn-anon-reply', true);
  const { data: ok, error } = await sb.rpc('add_anonymous_message', { p_code: anonCaseCode, p_text: text });
  setBusy('btn-anon-reply', false);
  if (error || !ok) return err('anon-reply-err', t('err.replyFailed'));

  sb.functions.invoke('notify', { body: { type: 'employee_reply', case_id: anonCaseData.case_id } });

  document.getElementById('anon-reply-input').value = '';
  clearErrors();
  const { data } = await sb.rpc('get_case_by_code', { p_code: anonCaseCode });
  if (data && data[0]) { anonCaseData = data[0]; renderAnonCase(); }
}

// ── LOGIN (typ 2 & 3) ────────────────────────────────────────────
function showEmpLogin() { show('view-emp-login'); }

async function handleEmpLogin() {
  const email = val('emp-email');
  const pw    = val('emp-pw');
  if (!email || !pw) return err('emp-err', t('err.fillAll'));

  setBusy('btn-emp-login', true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  setBusy('btn-emp-login', false);

  if (error) return err('emp-err', error.message.includes('not confirmed') ? t('err.notConfirmed') : t('err.badCredentials'));
}

async function handleForgotPassword() {
  const email = val('emp-email');
  if (!email) return err('emp-err', t('err.enterEmailFirst'));
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) return err('emp-err', error.message);
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
  if (error) return err('reset-err', error.message);
}

// ── ADMIN LOGIN ───────────────────────────────────────────────
function showAdminLogin() { show('view-admin-login'); }

async function handleAdminLogin() {
  const email = val('admin-email');
  const pw    = val('admin-pw');
  if (!email || !pw) return err('admin-err', t('err.fillAll'));

  setBusy('btn-admin-login', true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  setBusy('btn-admin-login', false);
  if (error) return err('admin-err', t('err.badCredentials'));
}

// ── NEW CASE / REPORT FORM (delas av alla tre typer) ────────────
async function showNewCase() {
  pendingFiles = [];
  document.getElementById('new-case-form').reset();
  document.getElementById('nc-files-list').innerHTML = '';
  document.getElementById('dept-detail-group').style.display = 'none';

  document.getElementById('reportform-subtitle').textContent =
    reportType === 'open' ? t('reportForm.subtitleOpen') : t('reportForm.subtitleAnon');

  show('view-new-case');
}

function handleReportFormBack() {
  if (reportType === 'anonymous_code') { showLanding(); return; }
  if (me && meType === 'employee') { showEmpDash(); return; }
  show('view-report-type');
}

function resetReportForm() {
  reportType = null;
  pendingFiles = [];
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

// ── FILE ATTACHMENTS ─────────────────────────────────────────────
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function handleFilesSelected(inputEl) {
  pendingFiles = pendingFiles.concat(Array.from(inputEl.files));
  inputEl.value = '';
  renderFilesList();
}

function removeFile(idx) {
  pendingFiles.splice(idx, 1);
  renderFilesList();
}

function renderFilesList() {
  const list = document.getElementById('nc-files-list');
  list.innerHTML = '';
  let total = 0;
  pendingFiles.forEach((f, idx) => {
    total += f.size;
    const chip = el('div', 'file-chip');
    chip.innerHTML = `<span>${esc(f.name)} (${(f.size / 1024 / 1024).toFixed(2)} MB)</span><span class="file-remove" onclick="removeFile(${idx})">✕</span>`;
    list.appendChild(chip);
  });
  if (total > MAX_TOTAL_BYTES) err('nc-err', t('err.filesTooLarge'));
  else clearErrors();
}

async function uploadPendingFiles(caseId) {
  const failures = [];
  for (const file of pendingFiles) {
    const path = `${caseId}/${Date.now()}_${file.name}`;
    const { error: upErr } = await sb.storage.from('case-attachments').upload(path, file);
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
  pendingFiles = [];
  if (failures.length) {
    // Anmälan är redan skickad vid det här laget — felet gäller bara bilagorna,
    // så vi varnar utan att avbryta flödet.
    alert(t('err.attachmentsFailed') + '\n' + failures.join(', '));
  }
}

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'nc-files') handleFilesSelected(e.target);
});

// ── CREATE CASE (grenar per anmälartyp) ─────────────────────────
async function handleCreateCase() {
  const subject  = val('case-subject');
  const category = val('cat-sel');
  const dept     = val('dept-sel');
  const message  = val('case-msg');

  if (!subject)         return err('nc-err', t('err.subjectRequired'));
  if (!category)       return err('nc-err', t('err.chooseCategory'));
  if (!dept)            return err('nc-err', t('err.chooseDept'));
  if (!message || message.length < 10) return err('nc-err', t('err.messageShort'));

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
    setBusy('btn-create-case', false);
    if (error || !data || !data[0]) return err('nc-err', (error && error.message) || t('err.generic'));

    const row = data[0];
    if (pendingFiles.length) await uploadPendingFiles(row.case_id);
    sb.functions.invoke('notify', { body: { type: 'new_case', case_id: row.case_id } });
    showCodeConfirm(row.access_code, row.wb_token);
    return;
  }

  // typ 2 & 3 — kräver inloggning
  const insertPayload = {
    reporter_type: reportType,
    employee_id: me.id,
    subject, category, department: dept, department_detail: deptDetail,
    who_involved: who || null, where_happened: where || null,
    when_happened: when || null, other_actions: actions || null,
    status: 'open'
  };
  if (reportType === 'open') {
    insertPayload.reporter_name  = me.name;
    insertPayload.reporter_phone = me.phone || null;
  }

  const { data: caseRow, error: caseErr } = await sb.from('cases').insert(insertPayload).select().single();
  if (caseErr) { setBusy('btn-create-case', false); return err('nc-err', caseErr.message); }

  const { error: msgErr } = await sb.from('messages').insert({ case_id: caseRow.id, from_role: 'employee', text: message });
  setBusy('btn-create-case', false);
  if (msgErr) return err('nc-err', msgErr.message);

  if (pendingFiles.length) await uploadPendingFiles(caseRow.id);
  sb.functions.invoke('notify', { body: { type: 'new_case', case_id: caseRow.id } });

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

function copyAccessCode() {
  if (!lastAccessCode) return;
  navigator.clipboard.writeText(lastAccessCode).catch(() => {});
}

function handleCodeConfirmDone() {
  lastAccessCode = null;
  resetReportForm();
  showLanding();
}

// ── EMPLOYEE DASHBOARD (typ 2 & 3) ────────────────────────────
async function showEmpDash(filter) {
  activeDashTab = filter || activeDashTab || 'all';
  document.querySelectorAll('.sub-tab').forEach(b => b.classList.toggle('active', b.dataset.stab === activeDashTab));
  show('view-emp-dash');

  const list = document.getElementById('emp-cases-list');
  list.innerHTML = `<div class="empty-state">${t('common.loading')}</div>`;

  let q = sb.from('cases').select('*, messages(*)').eq('employee_id', me.id).order('created_at', { ascending: false });
  if (activeDashTab === 'open')     q = q.neq('status', 'resolved');
  if (activeDashTab === 'resolved') q = q.eq('status', 'resolved');

  const { data: cases, error } = await q;
  if (error) { list.innerHTML = `<div class="empty-state">Fel: ${error.message}</div>`; return; }

  list.innerHTML = '';
  if (!cases || !cases.length) {
    list.innerHTML = `<div class="empty-state">${activeDashTab === 'all' ? t('dash.emptyAll') : t('dash.emptyFiltered')}</div>`;
    return;
  }

  cases.forEach(c => {
    const msgs    = (c.messages || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const lastMsg = msgs.at(-1);
    const unread  = lastMsg && lastMsg.from_role === 'admin';

    const div = el('div', `case-card${unread ? ' unread' : ''}`);
    div.innerHTML = `
      <div class="case-header">
        <span class="token">${c.anonymous_token}</span>
        <span class="status-pill s-${c.status}">${t('status.' + c.status)}</span>
      </div>
      <div class="case-subject-line">${esc(c.subject || '—')}</div>
      <div class="case-meta">
        <span>${t('cat.' + c.category)}</span>
        <span>${fmt(c.created_at)}</span>
      </div>
      ${unread ? `<div class="new-badge">${t('common.newReply')}</div>` : ''}`;
    div.addEventListener('click', () => openCaseEmp(c.id));
    list.appendChild(div);
  });
}

// ── CASE DETAIL – Employee ─────────────────────────────────────
async function openCaseEmp(caseId) {
  activeCaseId = caseId;
  show('view-case-emp');

  const [{ data: c }, { data: msgs }] = await Promise.all([
    sb.from('cases').select('*').eq('id', caseId).single(),
    sb.from('messages').select('*').eq('case_id', caseId).order('created_at', { ascending: true })
  ]);

  document.getElementById('c-token').textContent = c.anonymous_token;
  document.getElementById('c-cat').textContent   = t('cat.' + c.category);
  const sp = document.getElementById('c-status');
  sp.textContent = t('status.' + c.status);
  sp.className   = `status-pill s-${c.status}`;
  activeCaseExtra = {
    subject: c.subject, category: c.category, department: c.department, departmentDetail: c.department_detail,
    whoInvolved: c.who_involved, whereHappened: c.where_happened,
    whenHappened: c.when_happened, otherActions: c.other_actions
  };
  renderMsgs('emp-msgs', msgs || [], 'employee', activeCaseExtra);
  document.getElementById('emp-reply-input').value = '';
}

async function handleEmpReply() {
  const text = val('emp-reply-input');
  if (!text) return err('emp-reply-err', t('err.writeMessage'));
  setBusy('btn-emp-reply', true);
  const { error } = await sb.from('messages').insert({ case_id: activeCaseId, from_role: 'employee', text });
  setBusy('btn-emp-reply', false);
  if (error) return err('emp-reply-err', error.message);

  sb.functions.invoke('notify', { body: { type: 'employee_reply', case_id: activeCaseId } });

  document.getElementById('emp-reply-input').value = '';
  clearErrors();
  const { data: msgs } = await sb.from('messages').select('*')
    .eq('case_id', activeCaseId).order('created_at', { ascending: true });
  renderMsgs('emp-msgs', msgs || [], 'employee', activeCaseExtra);
}

// ── ADMIN DASHBOARD ───────────────────────────────────────────
async function showAdminDash() {
  document.getElementById('admin-name').textContent  = me.name  || me.email || '';
  document.getElementById('admin-title').textContent = me.title || '';
  show('view-admin-dash');

  const list = document.getElementById('admin-cases-list');
  list.innerHTML = `<div class="empty-state">${t('common.loading')}</div>`;

  // employee_id är avsiktligt exkluderat — anonymitet upprätthålls på query-nivå.
  // Ingen mottagarfiltrering: delad inkorg, RLS avgör vilka rader admins ser.
  const { data: cases, error } = await sb.from('cases')
    .select('id, anonymous_token, reporter_type, reporter_name, subject, category, department, status, created_at, messages(*)')
    .order('created_at', { ascending: false });

  if (error) { list.innerHTML = `<div class="empty-state">Fel: ${error.message}</div>`; return; }

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

    const div = el('div', `case-card${unread ? ' unread' : ''}`);
    div.innerHTML = `
      <div class="case-header">
        <span class="token">${c.anonymous_token}</span>
        <span class="status-pill s-${c.status}">${t('status.' + c.status)}</span>
      </div>
      <div class="case-subject-line">${esc(c.subject || '—')}</div>
      <div class="case-meta">
        <span class="type-tag">${esc(typeLabel)}</span>
        <span>${t('cat.' + c.category)}</span>
        <span>${fmt(c.created_at)}</span>
        <span>${msgs.length} ${t('common.messages')}</span>
      </div>
      ${unread ? `<div class="new-badge">${t('common.newMessage')}</div>` : ''}`;
    div.addEventListener('click', () => openCaseAdmin(c.id));
    list.appendChild(div);
  });
}

// ── CASE DETAIL – Admin ─────────────────────────────────────────
async function openCaseAdmin(caseId) {
  activeCaseId = caseId;
  show('view-case-admin');

  const [{ data: c }, { data: msgs }, { data: attachments }] = await Promise.all([
    // employee_id är aldrig med i select — anonymitet upprätthålls på query-nivå
    sb.from('cases').select('id, anonymous_token, reporter_type, reporter_name, reporter_phone, subject, category, department, department_detail, status, who_involved, where_happened, when_happened, other_actions').eq('id', caseId).single(),
    sb.from('messages').select('*').eq('case_id', caseId).order('created_at', { ascending: true }),
    sb.from('attachments').select('*').eq('case_id', caseId)
  ]);

  document.getElementById('ac-subject').textContent = c.subject || '';
  document.getElementById('ac-token').textContent = c.anonymous_token;
  document.getElementById('ac-cat').textContent   = t('cat.' + c.category);
  const deptDetailLabel = c.department_detail
    ? (translations[currentLang]['staber.' + c.department_detail] || c.department_detail)
    : '';
  document.getElementById('ac-dept').textContent = t('dept.' + c.department) + (deptDetailLabel ? ' – ' + deptDetailLabel : '');
  document.getElementById('ac-status-sel').value  = c.status;

  const reporterInfoEl = document.getElementById('ac-reporter-info');
  const anonNoticeEl   = document.getElementById('ac-anon-notice');
  if (c.reporter_type === 'open') {
    reporterInfoEl.innerHTML = `${t('reportType.t3title')}: <strong>${esc(c.reporter_name || '')}</strong>${c.reporter_phone ? ' · ' + esc(c.reporter_phone) : ''}`;
    anonNoticeEl.style.display = 'none';
  } else {
    reporterInfoEl.textContent = c.reporter_type === 'anonymous_email' ? t('reportType.t2title') : t('reportType.t1title');
    anonNoticeEl.style.display = 'flex';
  }

  const attWrap = document.getElementById('ac-attachments');
  attWrap.innerHTML = '';
  for (const a of (attachments || [])) {
    const { data: signed } = await sb.storage.from('case-attachments').createSignedUrl(a.file_path, 3600);
    const chip = el('a', 'attachment-chip');
    chip.href = (signed && signed.signedUrl) || '#';
    chip.target = '_blank';
    chip.innerHTML = `📎 ${esc(a.file_name)}`;
    attWrap.appendChild(chip);
  }

  activeCaseExtra = {
    subject: c.subject, category: c.category, department: c.department, departmentDetail: c.department_detail,
    whoInvolved: c.who_involved, whereHappened: c.where_happened,
    whenHappened: c.when_happened, otherActions: c.other_actions
  };
  renderMsgs('admin-msgs', msgs || [], 'admin', activeCaseExtra);
  document.getElementById('admin-reply-input').value = '';
}

async function handleAdminReply() {
  const text = val('admin-reply-input');
  if (!text) return err('admin-reply-err', t('err.writeMessage'));
  setBusy('btn-admin-reply', true);
  const { error } = await sb.from('messages').insert({ case_id: activeCaseId, from_role: 'admin', text });
  setBusy('btn-admin-reply', false);
  if (error) return err('admin-reply-err', error.message);

  // typ 1 (helt anonym) har ingen e-post att notifiera
  const { data: c } = await sb.from('cases').select('reporter_type').eq('id', activeCaseId).single();
  if (c && c.reporter_type !== 'anonymous_code') {
    sb.functions.invoke('notify', { body: { type: 'admin_reply', case_id: activeCaseId } });
  }

  document.getElementById('admin-reply-input').value = '';
  clearErrors();
  const { data: msgs } = await sb.from('messages').select('*')
    .eq('case_id', activeCaseId).order('created_at', { ascending: true });
  renderMsgs('admin-msgs', msgs || [], 'admin', activeCaseExtra);
}

async function handleStatusChange() {
  const status = document.getElementById('ac-status-sel').value;
  await sb.from('cases').update({ status }).eq('id', activeCaseId);
}

// ── RENDER MESSAGES ───────────────────────────────────────────
// caseExtra (valfri): { category, department, departmentDetail,
// whoInvolved, whereHappened, whenHappened, otherActions } — allt som
// fylldes i utöver själva meddelandet, för att "Min anmälan"-modalen
// ska kunna visa hela anmälan i sin ursprungliga blockstruktur.
function renderMsgs(id, messages, perspective, caseExtra) {
  const c = document.getElementById(id);
  if (!messages.length) {
    c.innerHTML = `<div style="text-align:center;color:var(--muted);padding:32px;font-size:14px;">${t('common.noMessages')}</div>`;
    return;
  }
  c.innerHTML = '';
  messages.forEach((m, idx) => {
    const own = m.from_role === perspective;
    const isFirst = idx === 0; // det första meddelandet är alltid själva anmälan
    const wrap = el('div', `msg ${own ? 'msg-own' : 'msg-other'}`);
    const senderLabel = isFirst
      ? (perspective === 'employee' ? t('common.myReport') : t('common.theReport'))
      : (m.from_role === 'employee' ? t('common.reporter') : t('common.caseHandler'));

    wrap.innerHTML = `
      <div class="bubble${isFirst ? ' bubble-report' : ''}">
        <div class="bubble-sender">${senderLabel}</div>
        <div class="bubble-text${isFirst ? ' bubble-cta' : ''}">${isFirst ? `📄 ${t('common.clickToReadReport')}` : esc(m.text)}</div>
        <div class="bubble-time">${fmt(m.created_at)}</div>
      </div>`;

    if (isFirst) {
      const bubbleEl = wrap.querySelector('.bubble');
      bubbleEl.style.cursor = 'pointer';
      bubbleEl.addEventListener('click', () => showReportModal(senderLabel, m.text, m.created_at, caseExtra));
    }
    c.appendChild(wrap);
  });
  c.scrollTop = c.scrollHeight;
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
  if (e.category)   blocks.push([t('reportForm.category'), t('cat.' + e.category)]);
  if (e.department)  blocks.push([t('reportForm.department'), t('dept.' + e.department) + (deptDetailLabel ? ' – ' + deptDetailLabel : '')]);
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

// ── HELPERS ───────────────────────────────────────────────────
function el(tag, className) { const e = document.createElement(tag); if (className) e.className = className; return e; }
function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function fmt(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(currentLang === 'en' ? 'en-GB' : 'sv-SE', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(currentLang === 'en' ? 'en-GB' : 'sv-SE', { hour: '2-digit', minute: '2-digit' });
}
function val(id) { return (document.getElementById(id).value || '').trim(); }
function err(id, msg) { const e = document.getElementById(id); if (!e) return; e.textContent = msg; e.style.display = 'block'; }
function clearErrors() { document.querySelectorAll('.error-msg').forEach(e => { e.style.display = 'none'; }); }
function setBusy(btnId, busy) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = busy;
  btn.style.opacity = busy ? '0.6' : '1';
}
