'use strict';

// ── SUPABASE ──────────────────────────────────────────────────
const SUPABASE_URL = 'https://zovlagbblznesvjzhplh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvdmxhZ2JibHpuZXN2anpocGxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMzE1NTEsImV4cCI6MjEwMzkwNzU1MX0.bSjcl6qyZGazd5VHMZKsbKfffRUUpPbMASFm9jL7U48';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── SESSION STATE ─────────────────────────────────────────────
let me            = null;   // { id, email, anonymousToken?, name?, title?, role?, photo? }
let meType        = null;   // 'employee' | 'admin'
let activeCaseId  = null;
let selectedRecip = null;
let activeDashTab = 'all';

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
  if (me && meType === 'admin') {
    logoutBtn.style.display = 'inline-flex';
    if (me.photo) {
      profileEl.innerHTML = `
        <div class="admin-profile">
          <img src="${me.photo}" alt="${me.name}">
          <div><div class="a-name">${me.name}</div><div class="a-role">${me.title}</div></div>
        </div>`;
    } else {
      profileEl.innerHTML = `
        <div class="admin-profile">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;color:var(--gold);font-weight:700;font-size:16px;border:2px solid var(--gold);">
            ${me.name.charAt(0)}
          </div>
          <div><div class="a-name">${me.name}</div><div class="a-role">${me.title}</div></div>
        </div>`;
    }
    profileEl.style.display = 'block';
  } else if (me && meType === 'employee') {
    logoutBtn.style.display = 'inline-flex';
    profileEl.style.display = 'none';
  } else {
    logoutBtn.style.display = 'none';
    profileEl.style.display = 'none';
  }
  document.getElementById('tab-nav').style.display = 'flex';
}

// ── LANDING ───────────────────────────────────────────────────
function showLanding(activePanel) {
  const panel = activePanel || 'anmal';
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + panel).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === panel);
  });
  show('view-landing');
}

function handleTab(tab) {
  if (tab === 'anmal') {
    if (me && meType === 'employee') { showNewCase(); return; }
    if (me && meType === 'admin')    { showAdminDash(); return; }
  }
  if (tab === 'mina' && me && meType === 'employee') { showEmpDash(); return; }
  if (tab === 'admin' && me && meType === 'admin')   { showAdminDash(); return; }
  showLanding(tab);
}

// ── LOADING STATE ─────────────────────────────────────────────
function setBusy(btnId, busy) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = busy;
  btn.style.opacity = busy ? '0.6' : '1';
}

// ── AUTH: load context after sign-in ─────────────────────────
async function loadUserContext(session) {
  try {
    const { data: profile, error } = await sb
      .from('profiles')
      .select('anonymous_token, is_admin, admins(id, name, title, role, photo)')
      .eq('id', session.user.id)
      .single();
    if (error) throw error;

    if (profile.is_admin && profile.admins) {
      me = { id: session.user.id, email: session.user.email, ...profile.admins };
      meType = 'admin';
      await showAdminDash();
    } else {
      me = { id: session.user.id, email: session.user.email, anonymousToken: profile.anonymous_token };
      meType = 'employee';
      await showEmpDash();
    }
  } catch(e) {
    console.error('Kunde inte ladda användarkontexten:', e);
    await sb.auth.signOut();
    showLanding('anmal');
  }
}

// ── EMPLOYEE REGISTER ─────────────────────────────────────────
function showEmpRegister() {
  resetRegForm();
  show('view-emp-register');
}

async function handleSendCode() {
  const email = val('reg-email').toLowerCase();
  const pw    = val('reg-pw');
  const pw2   = val('reg-pw2');

  if (!email || !pw)  return err('reg-err', 'Fyll i alla fält.');
  if (!email.endsWith('@jenseneducation.se'))
    return err('reg-err', 'Endast e-postadresser från @jenseneducation.se är tillåtna.');
  if (pw !== pw2)     return err('reg-err', 'Lösenorden matchar inte.');
  if (pw.length < 8)  return err('reg-err', 'Lösenordet måste vara minst 8 tecken.');

  setBusy('btn-send-code', true);
  const { data, error } = await sb.auth.signUp({
    email,
    password: pw,
    options: { emailRedirectTo: window.location.href }
  });
  setBusy('btn-send-code', false);

  if (error) {
    return err('reg-err',
      error.message === 'User already registered'
        ? 'Det finns redan ett konto med denna e-postadress.'
        : error.message);
  }

  if (data.session) {
    // Email confirmation is disabled — user is now logged in, onAuthStateChange handles redirect
    return;
  }

  // Email confirmation is enabled — show "check your inbox"
  document.getElementById('reg-step1').style.display = 'none';
  document.getElementById('reg-step2').style.display = 'block';
  document.getElementById('reg-sent-to').textContent = email;
  clearErrors();
}

function resetRegForm() {
  document.getElementById('reg-step1').style.display = 'block';
  document.getElementById('reg-step2').style.display = 'none';
  clearErrors();
}

// ── FORGOT / RESET PASSWORD ───────────────────────────────────
async function handleForgotPassword() {
  const email = val('emp-email');
  if (!email) return err('emp-err', 'Ange din e-postadress ovan och klicka sedan på "Glömt lösenord?".');
  if (!email.toLowerCase().endsWith('@jenseneducation.se'))
    return err('emp-err', 'Ange din @jenseneducation.se-adress.');

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href
  });
  if (error) return err('emp-err', error.message);

  // Reuse error element as success feedback (temporary)
  const el = document.getElementById('emp-err');
  el.textContent = '✓ Återställningslänk skickad! Kontrollera din JENSEN-inkorg.';
  el.style.display = 'block';
  el.style.color = 'var(--green, #2e7d32)';
  el.style.background = '#f0fdf4';
  el.style.borderColor = '#86efac';
}

async function handleSetNewPassword() {
  const pw  = val('new-pw');
  const pw2 = val('new-pw2');
  if (!pw)           return err('reset-err', 'Ange ett lösenord.');
  if (pw !== pw2)    return err('reset-err', 'Lösenorden matchar inte.');
  if (pw.length < 8) return err('reset-err', 'Lösenordet måste vara minst 8 tecken.');

  setBusy('btn-set-pw', true);
  const { error } = await sb.auth.updateUser({ password: pw });
  setBusy('btn-set-pw', false);
  if (error) return err('reset-err', error.message);
  // onAuthStateChange → SIGNED_IN fires after updateUser and routes to dashboard
}

// ── EMPLOYEE LOGIN ────────────────────────────────────────────
function showEmpLogin() { show('view-emp-login'); }

async function handleEmpLogin() {
  const email = val('emp-email');
  const pw    = val('emp-pw');
  if (!email || !pw) return err('emp-err', 'Fyll i alla fält.');
  if (!email.toLowerCase().endsWith('@jenseneducation.se'))
    return err('emp-err', 'Endast e-postadresser från @jenseneducation.se är tillåtna.');

  setBusy('btn-emp-login', true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  setBusy('btn-emp-login', false);

  if (error) return err('emp-err',
    error.message.includes('not confirmed')
      ? 'Verifiera din e-post först. Klicka på länken vi skickade dig.'
      : 'Felaktig e-postadress eller lösenord.');
  // onAuthStateChange handles redirect to dashboard
}

// ── ADMIN LOGIN ───────────────────────────────────────────────
function showAdminLogin() { show('view-admin-login'); }

async function handleAdminLogin() {
  const email = val('admin-email');
  const pw    = val('admin-pw');
  if (!email || !pw) return err('admin-err', 'Fyll i alla fält.');

  setBusy('btn-admin-login', true);
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  setBusy('btn-admin-login', false);

  if (error) return err('admin-err', 'Felaktig e-postadress eller lösenord.');
  // loadUserContext checks is_admin flag; non-admins see employee dash
}

// ── EMPLOYEE DASHBOARD ────────────────────────────────────────
async function showEmpDash(filter) {
  activeDashTab = filter || activeDashTab || 'all';
  document.querySelectorAll('.sub-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.stab === activeDashTab);
  });
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === 'mina');
  });
  document.getElementById('emp-token').textContent = me.anonymousToken;
  show('view-emp-dash');

  const list = document.getElementById('emp-cases-list');
  list.innerHTML = '<div class="empty-state">Laddar ärenden…</div>';

  let q = sb.from('cases')
    .select('*, messages(*)')
    .eq('employee_id', me.id)
    .order('created_at', { ascending: false });
  if (activeDashTab === 'open')     q = q.neq('status', 'resolved');
  if (activeDashTab === 'resolved') q = q.eq('status', 'resolved');

  const { data: cases, error } = await q;
  if (error) { list.innerHTML = `<div class="empty-state">Fel: ${error.message}</div>`; return; }

  const { data: admins } = await sb.from('admins').select('id, name');
  const adminMap = Object.fromEntries((admins || []).map(a => [a.id, a]));

  list.innerHTML = '';
  if (!cases || !cases.length) {
    list.innerHTML = `<div class="empty-state">${activeDashTab === 'all'
      ? 'Du har inga ärenden ännu. Klicka <strong>+ Ny anmälan</strong> för att komma igång.'
      : 'Inga ärenden i denna kategori.'}</div>`;
    return;
  }

  cases.forEach(c => {
    const admin   = adminMap[c.recipient_admin_id];
    const msgs    = (c.messages || []).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    const lastMsg = msgs.at(-1);
    const unread  = lastMsg && lastMsg.from_role === 'admin';
    const firstMsg = msgs[0];

    const div = el('div', `case-card${unread ? ' unread' : ''}`);
    div.innerHTML = `
      <div class="case-header">
        <span class="token">${c.anonymous_token}</span>
        <span class="status-pill s-${c.status}">${statusSv(c.status)}</span>
      </div>
      <div class="case-meta">
        <span>Till: <strong>${admin ? admin.name : 'Okänd'}</strong></span>
        <span>${catSv(c.category)}</span>
        <span>${fmt(c.created_at)}</span>
      </div>
      <div class="case-preview">${firstMsg ? esc(firstMsg.text.slice(0,130)) : ''}${firstMsg && firstMsg.text.length > 130 ? '…' : ''}</div>
      ${unread ? '<div class="new-badge">Nytt svar</div>' : ''}`;
    div.addEventListener('click', () => openCaseEmp(c.id));
    list.appendChild(div);
  });
}

// ── NEW CASE ──────────────────────────────────────────────────
async function showNewCase() {
  selectedRecip = null;
  document.getElementById('new-case-form').reset();
  const grid = document.getElementById('recipient-grid');
  grid.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px;">Laddar mottagare…</div>';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'anmal'));
  show('view-new-case');

  const { data: admins } = await sb.from('admins').select('*');
  grid.innerHTML = '';
  (admins || []).forEach(a => {
    const div = el('div', 'r-card');
    div.dataset.id = a.id;
    const avatarHtml = a.photo
      ? `<img src="${a.photo}" alt="${a.name}" onerror="this.parentElement.innerHTML='<div class=\\'r-avatar-placeholder\\'>👤</div>'">`
      : `<div class="r-avatar-placeholder">👤</div>`;
    div.innerHTML = `
      ${avatarHtml}
      <div class="r-name">${a.name}</div>
      <div class="r-title">${a.title}</div>
      <span class="r-badge ${a.role === 'HR' ? 'badge-hr' : a.role === 'Admin' ? 'badge-admin' : 'badge-mgmt'}">${a.role}</span>`;
    div.addEventListener('click', () => {
      selectedRecip = a.id;
      document.querySelectorAll('.r-card').forEach(c => c.classList.remove('selected'));
      div.classList.add('selected');
    });
    grid.appendChild(div);
  });
}

async function handleCreateCase() {
  if (!selectedRecip)        return err('nc-err', 'Välj en mottagare.');
  const category = val('cat-sel');
  const message  = val('case-msg');
  if (!category)             return err('nc-err', 'Välj en kategori.');
  if (!message || message.length < 10)
    return err('nc-err', 'Skriv ett mer utförligt meddelande (minst 10 tecken).');

  setBusy('btn-create-case', true);
  const { data: caseRow, error: caseErr } = await sb.from('cases').insert({
    anonymous_token:    me.anonymousToken,
    employee_id:        me.id,
    recipient_admin_id: selectedRecip,
    category,
    status: 'open'
  }).select().single();

  if (caseErr) { setBusy('btn-create-case', false); return err('nc-err', caseErr.message); }

  const { error: msgErr } = await sb.from('messages').insert({
    case_id: caseRow.id, from_role: 'employee', text: message
  });
  setBusy('btn-create-case', false);
  if (msgErr) return err('nc-err', msgErr.message);

  await showEmpDash();
}

// ── EMPLOYEE CASE DETAIL ──────────────────────────────────────
async function openCaseEmp(caseId) {
  activeCaseId = caseId;
  show('view-case-emp');

  const [{ data: c }, { data: msgs }] = await Promise.all([
    sb.from('cases').select('*, admins(name)').eq('id', caseId).single(),
    sb.from('messages').select('*').eq('case_id', caseId).order('created_at', { ascending: true })
  ]);

  document.getElementById('c-token').textContent = c.anonymous_token;
  document.getElementById('c-to').textContent    = c.admins ? c.admins.name : 'Okänd';
  document.getElementById('c-cat').textContent   = catSv(c.category);
  const sp = document.getElementById('c-status');
  sp.textContent = statusSv(c.status);
  sp.className   = `status-pill s-${c.status}`;
  renderMsgs('emp-msgs', msgs || [], 'employee');
  document.getElementById('emp-reply-input').value = '';
}

async function handleEmpReply() {
  const text = val('emp-reply-input');
  if (!text) return err('emp-reply-err', 'Skriv ett meddelande.');
  setBusy('btn-emp-reply', true);
  const { error } = await sb.from('messages').insert({
    case_id: activeCaseId, from_role: 'employee', text
  });
  setBusy('btn-emp-reply', false);
  if (error) return err('emp-reply-err', error.message);
  document.getElementById('emp-reply-input').value = '';
  clearErrors();
  const { data: msgs } = await sb.from('messages').select('*')
    .eq('case_id', activeCaseId).order('created_at', { ascending: true });
  renderMsgs('emp-msgs', msgs || [], 'employee');
}

// ── ADMIN DASHBOARD ───────────────────────────────────────────
async function showAdminDash() {
  document.getElementById('admin-name').textContent  = me.name  || me.email;
  document.getElementById('admin-title').textContent = me.title || '';
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === 'admin');
  });
  show('view-admin-dash');

  const list = document.getElementById('admin-cases-list');
  list.innerHTML = '<div class="empty-state">Laddar ärenden…</div>';

  // employee_id is intentionally excluded from this query — anonymity enforced at query level
  const { data: cases, error } = await sb.from('cases')
    .select('id, anonymous_token, category, status, created_at, messages(*)')
    .eq('recipient_admin_id', me.id)
    .order('created_at', { ascending: false });

  if (error) { list.innerHTML = `<div class="empty-state">Fel: ${error.message}</div>`; return; }

  list.innerHTML = '';
  if (!cases || !cases.length) {
    list.innerHTML = '<div class="empty-state">Inga inkomna ärenden ännu.</div>';
    return;
  }

  cases.forEach(c => {
    const msgs   = (c.messages || []).sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    const last   = msgs.at(-1);
    const unread = last && last.from_role === 'employee';
    const first  = msgs[0];

    const div = el('div', `case-card${unread ? ' unread' : ''}`);
    div.innerHTML = `
      <div class="case-header">
        <span class="token">${c.anonymous_token}</span>
        <span class="status-pill s-${c.status}">${statusSv(c.status)}</span>
      </div>
      <div class="case-meta">
        <span>${catSv(c.category)}</span>
        <span>${fmt(c.created_at)}</span>
        <span>${msgs.length} meddelanden</span>
      </div>
      <div class="case-preview">${first ? esc(first.text.slice(0,130)) : ''}${first && first.text.length > 130 ? '…' : ''}</div>
      ${unread ? '<div class="new-badge">Nytt meddelande</div>' : ''}`;
    div.addEventListener('click', () => openCaseAdmin(c.id));
    list.appendChild(div);
  });
}

// ── ADMIN CASE DETAIL ─────────────────────────────────────────
async function openCaseAdmin(caseId) {
  activeCaseId = caseId;
  show('view-case-admin');

  const [{ data: c }, { data: msgs }] = await Promise.all([
    // employee_id is never selected — anonymity enforced at query level
    sb.from('cases').select('id, anonymous_token, category, status').eq('id', caseId).single(),
    sb.from('messages').select('*').eq('case_id', caseId).order('created_at', { ascending: true })
  ]);

  document.getElementById('ac-token').textContent = c.anonymous_token;
  document.getElementById('ac-cat').textContent   = catSv(c.category);
  document.getElementById('ac-status-sel').value  = c.status;
  renderMsgs('admin-msgs', msgs || [], 'admin');
  document.getElementById('admin-reply-input').value = '';
}

async function handleAdminReply() {
  const text = val('admin-reply-input');
  if (!text) return err('admin-reply-err', 'Skriv ett meddelande.');
  setBusy('btn-admin-reply', true);
  const { error } = await sb.from('messages').insert({
    case_id: activeCaseId, from_role: 'admin', text
  });
  setBusy('btn-admin-reply', false);
  if (error) return err('admin-reply-err', error.message);
  document.getElementById('admin-reply-input').value = '';
  clearErrors();
  const { data: msgs } = await sb.from('messages').select('*')
    .eq('case_id', activeCaseId).order('created_at', { ascending: true });
  renderMsgs('admin-msgs', msgs || [], 'admin');
}

async function handleStatusChange() {
  const status = document.getElementById('ac-status-sel').value;
  await sb.from('cases').update({ status }).eq('id', activeCaseId);
}

// ── RENDER MESSAGES ───────────────────────────────────────────
function renderMsgs(id, messages, perspective) {
  const c = document.getElementById(id);
  if (!messages.length) {
    c.innerHTML = '<div style="text-align:center;color:var(--muted);padding:32px;font-size:14px;">Inga meddelanden ännu.</div>';
    return;
  }
  c.innerHTML = '';
  messages.forEach(m => {
    const own  = m.from_role === perspective;
    const wrap = el('div', `msg ${own ? 'msg-own' : 'msg-other'}`);
    wrap.innerHTML = `
      <div class="bubble">
        <div class="bubble-sender">${m.from_role === 'employee' ? 'Anonym anmälare' : 'Handläggare'}</div>
        <div class="bubble-text">${esc(m.text)}</div>
        <div class="bubble-time">${fmt(m.created_at)}</div>
      </div>`;
    c.appendChild(wrap);
  });
  c.scrollTop = c.scrollHeight;
}

// ── HELPERS ───────────────────────────────────────────────────
function el(tag, cls)  { const e = document.createElement(tag); e.className = cls; return e; }
function val(id)       { return (document.getElementById(id)?.value || '').trim(); }
function esc(str)      { const d = document.createElement('div'); d.textContent = str; return d.innerHTML.replace(/\n/g,'<br>'); }
function clearErrors() { document.querySelectorAll('.error-msg').forEach(e => { e.style.display='none'; e.textContent=''; }); }
function err(id, msg)  { const e = document.getElementById(id); if(e){ e.textContent=msg; e.style.display='block'; } }
function fmt(ts)       { return new Date(ts).toLocaleString('sv-SE', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
function statusSv(s)   { return { open:'Öppen', investigating:'Under utredning', resolved:'Avslutad' }[s] || s; }
function catSv(c)      {
  return {
    harassment: 'Trakasserier / Mobbning', discrimination: 'Diskriminering',
    safety: 'Arbetsmiljö & säkerhet',      fraud: 'Ekonomiska oegentligheter',
    corruption: 'Korruption / Mutor',      compliance: 'Lagstiftning / Regelefterlevnad',
    other: 'Övrigt'
  }[c] || c;
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      // User clicked the reset link in their email — show "set new password" form
      show('view-reset-password');
    } else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
      await loadUserContext(session);
    } else if (event === 'SIGNED_OUT') {
      me = null; meType = null; activeCaseId = null; selectedRecip = null;
      showLanding('anmal');
    }
  });

  document.getElementById('btn-logout').addEventListener('click', () => sb.auth.signOut());

  document.getElementById('reg-pw2')?.addEventListener('keydown',  e => { if(e.key==='Enter') handleSendCode(); });
  document.getElementById('emp-pw')?.addEventListener('keydown',   e => { if(e.key==='Enter') handleEmpLogin(); });
  document.getElementById('admin-pw')?.addEventListener('keydown', e => { if(e.key==='Enter') handleAdminLogin(); });
  ['emp-reply-input', 'admin-reply-input'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        id === 'emp-reply-input' ? handleEmpReply() : handleAdminReply();
      }
    });
  });

  showLanding('anmal');
});
