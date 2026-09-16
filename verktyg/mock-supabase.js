/* TESTLÄGE: ersätter Supabase med påhittad data i webbläsarens minne.
   Ingen nätverkstrafik och inga riktiga konton, så inget här kan röra
   riktiga visselblåsarärenden. Allt nollställs när sidan laddas om.

   Startas med "Starta testläge.bat" i projektets rotmapp. Panelen nere
   till höger loggar in som olika roller utan lösenord.

   Koden speglar de behörighetsregler (RLS) som påverkar gränssnittet:
   anmälare ser bara sina egna ärenden, bara handläggare ser anteckningar,
   och helt anonyma når bilder först efter att koden angetts. */
(function () {
  'use strict';

  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));
  const nowIso = (offsetMin = 0) => new Date(Date.now() + offsetMin * 60000).toISOString();
  const wbToken = () => 'WB-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const byCreated = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

  function picture(color, label) {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 640;
    const x = c.getContext('2d');
    x.fillStyle = color; x.fillRect(0, 0, 480, 640);
    x.fillStyle = '#fff'; x.font = 'bold 72px sans-serif'; x.fillText(label, 40, 340);
    return c.toDataURL('image/png');
  }

  const users = {
    a1: { id: 'a1', email: 'ulrika@test.local' },
    a2: { id: 'a2', email: 'leif@test.local' },
    e1: { id: 'e1', email: 'anon.epost@test.local' },
    e2: { id: 'e2', email: 'oppen@test.local' },
  };

  const OPEN_NAME = 'Anna Andersson';

  const db = {
    profiles: [
      { id: 'a1', reporter_type: 'anonymous_email', is_admin: true, name: null, phone: null },
      { id: 'a2', reporter_type: 'anonymous_email', is_admin: true, name: null, phone: null },
      { id: 'e1', reporter_type: 'anonymous_email', is_admin: false, name: null, phone: null },
      { id: 'e2', reporter_type: 'open', is_admin: false, name: OPEN_NAME, phone: '070-123 45 67' },
    ],
    admins: [
      { id: 'a1', name: 'Ulrika Westerström', title: 'HR-chef', role: 'HR', photo: null, is_super_admin: false },
      { id: 'a2', name: 'Leif Glavå', title: 'Kvalitetschef', role: 'Kvalitet', photo: null, is_super_admin: false },
    ],
    cases: [], messages: [], attachments: [], case_notes: [],
  };
  const storageObjs = {};
  const codes = {};
  const grants = {};
  let session = null;
  const listeners = [];

  const mock = window.__mock = {
    db, users, codes, storageObjs, log: [], delayMs: 60, fail: {}, openCaseFilesMissing: false,
  };

  const delay = () => new Promise(r => setTimeout(r, mock.delayMs));
  const rls = table => ({ message: 'new row violates row-level security policy for table "' + table + '"', code: '42501' });

  function takeFailure(key) {
    for (const k of Object.keys(mock.fail)) {
      if ((k === '*' || k === key) && mock.fail[k] > 0) {
        mock.fail[k]--;
        if (!mock.fail[k]) delete mock.fail[k];
        return { message: 'TypeError: Failed to fetch', status: 0, name: 'FetchError' };
      }
    }
    return null;
  }

  function addCase(fields, msgs, files) {
    const id = fields.id || uid();
    db.cases.push(Object.assign({
      id, anonymous_token: wbToken(), status: 'open', created_at: nowIso(-60 * 24), employee_id: null,
      department_detail: null, who_involved: null, where_happened: null, when_happened: null,
      other_actions: null, reporter_name: null, reporter_phone: null,
    }, fields, { id }));
    (msgs || []).forEach((m, i) => db.messages.push(Object.assign({
      id: uid(), case_id: id, sender_id: null, created_at: nowIso(-60 * 24 + i * 30),
    }, m)));
    (files || []).forEach((f, i) => {
      const path = id + '/' + (1700000000000 + i) + '_' + i + '_' + f.name.replace(/[^A-Za-z0-9._-]/g, '_');
      storageObjs[path] = f.url;
      db.attachments.push({ id: uid(), case_id: id, file_path: path, file_name: f.name, file_size: f.size || 250000, created_at: nowIso(-60 * 24) });
    });
    return id;
  }
  mock.addCase = addCase;

  // ── Seed ───────────────────────────────────────────────────────
  const longThread = [{ from_role: 'employee', text: 'Jag har sett att inköpen går till en leverantör som ägs av en chefs släkting.' }];
  for (let i = 0; i < 7; i++) {
    longThread.push(i % 2 === 0
      ? { from_role: 'admin', sender_id: i % 4 === 0 ? 'a1' : 'a2', text: 'Svar från handläggare nummer ' + (i + 1) + '. Kan du beskriva mer?' }
      : { from_role: 'employee', text: 'Uppföljning ' + (i + 1) + ' från visselblåsaren med fler detaljer om händelsen.' });
  }
  addCase({ id: 'c1', reporter_type: 'anonymous_email', employee_id: 'e1', subject: 'Oegentligheter i upphandling',
    category: 'ekonomi', department: 'staber', department_detail: 'ekonomi', who_involved: 'Inköpsavdelningen',
    status: 'investigating' }, longThread,
    [{ name: 'Faktura mars.png', url: picture('#0f3859', 'Faktura') }, { name: 'Avtal sida 2.png', url: picture('#1a6b45', 'Avtal') }]);

  addCase({ id: 'c2', reporter_type: 'open', employee_id: 'e2', reporter_name: OPEN_NAME, reporter_phone: '070-123 45 67',
    subject: 'Hot mot personal', category: 'hot', department: 'gymnasiet', status: 'open' },
    [{ from_role: 'employee', text: 'En elev har hotat en lärare vid flera tillfällen.' },
     { from_role: 'employee', text: 'Det har hänt igen idag.' }]);

  addCase({ id: 'c3', reporter_type: 'anonymous_code', subject: 'Miljöfarligt avfall', category: 'miljo',
    department: 'annat', department_detail: 'Lagret i Solna', where_happened: 'Bakom lagret', status: 'investigating' },
    [{ from_role: 'employee', text: 'Kemikalier hälls ut bakom lagret varje fredag.' },
     { from_role: 'admin', sender_id: 'a2', text: 'Tack. Vi har kontaktat miljöansvarig.' }],
    [{ name: 'Bevis "lager" åäö.png', url: picture('#c9a35f', 'Lager') },
     { name: 'Tunnor.png', url: picture('#7a5200', 'Tunnor') },
     { name: 'Karta.png', url: picture('#0f3859', 'Karta') }]);
  codes['TESTKOD-ANON-123'] = 'c3';

  addCase({ id: 'c4', reporter_type: 'anonymous_email', employee_id: 'e1', subject: 'Gammal fråga om schema',
    category: 'annat', department: 'forskolan', status: 'resolved' },
    [{ from_role: 'employee', text: 'Detta är ett avslutat ärende.' }]);

  db.case_notes.push({ id: 'n1', case_id: 'c1', author_id: 'a2', text: 'Ringt inköp, väntar på underlag.', created_at: nowIso(-120) });
  db.case_notes.push({ id: 'n2', case_id: 'c1', author_id: 'a1', text: 'Möte bokat med ekonomichefen.', created_at: nowIso(-60) });

  // ── RLS-emulering ──────────────────────────────────────────────
  function role() {
    if (!session) return 'anon';
    return db.admins.some(a => a.id === session.user.id) ? 'admin' : 'employee';
  }
  function caseOf(id) { return db.cases.find(c => c.id === id); }
  function visible(table, row) {
    const r = role(), me = session && session.user.id;
    switch (table) {
      case 'cases': return r === 'admin' || (r === 'employee' && row.employee_id === me);
      case 'messages':
      case 'attachments': {
        const c = caseOf(row.case_id);
        return !!c && (r === 'admin' || (r === 'employee' && c.employee_id === me));
      }
      case 'case_notes': return r === 'admin';
      case 'profiles': return !!me && row.id === me;
      case 'admins': return true;
      default: return false;
    }
  }

  class Query {
    constructor(table) {
      this.table = table; this.op = 'select'; this.cols = '*';
      this.filters = []; this.orderBy = null; this.isSingle = false; this.payload = null; this.returning = false;
    }
    select(cols) {
      if (this.op === 'insert' || this.op === 'update') this.returning = true;
      this.cols = cols || '*';
      return this;
    }
    insert(p) { this.op = 'insert'; this.payload = Array.isArray(p) ? p : [p]; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push(r => r[c] === v); return this; }
    neq(c, v) { this.filters.push(r => r[c] !== v); return this; }
    order(c, o) { this.orderBy = [c, !(o && o.ascending === false)]; return this; }
    limit() { return this; }
    single() { this.isSingle = true; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }

    matches() {
      return db[this.table].filter(r => visible(this.table, r)).filter(r => this.filters.every(fn => fn(r)));
    }
    finish(rows) {
      if (this.isSingle) {
        if (rows.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } };
        return { data: clone(rows[0]), error: null };
      }
      return { data: clone(rows), error: null };
    }
    expand(r) {
      const row = Object.assign({}, r);
      if (this.table === 'cases' && /messages\(/.test(this.cols)) row.messages = db.messages.filter(m => m.case_id === r.id);
      if (this.table === 'profiles' && /admins\(/.test(this.cols)) row.admins = db.admins.find(a => a.id === r.id) || null;
      if (this.table === 'cases' && this.cols !== '*' && !/^\*/.test(this.cols) && !/employee_id/.test(this.cols)) delete row.employee_id;
      return row;
    }
    insertError(p) {
      const r = role(), me = session && session.user.id;
      if (this.table === 'messages') {
        const c = caseOf(p.case_id);
        if (!c || !(r === 'admin' || (r === 'employee' && c.employee_id === me))) return rls('messages');
      }
      if (this.table === 'attachments') {
        const c = caseOf(p.case_id);
        if (!c || !(r === 'admin' || (r === 'employee' && c.employee_id === me) || c.reporter_type === 'anonymous_code')) return rls('attachments');
      }
      if (this.table === 'case_notes' && (r !== 'admin' || p.author_id !== me)) return rls('case_notes');
      return null;
    }
    async run() {
      await delay();
      const key = this.table + '.' + this.op;
      mock.log.push(key);
      const failure = takeFailure(key);
      if (failure) return { data: null, error: failure };

      if (this.op === 'select') {
        let rows = this.matches();
        if (this.orderBy) {
          const [c, asc] = this.orderBy;
          rows = rows.slice().sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        }
        return this.finish(rows.map(r => this.expand(r)));
      }
      if (this.op === 'insert') {
        const created = [];
        for (const p of this.payload) {
          const e = this.insertError(p);
          if (e) return { data: null, error: e };
          const row = Object.assign({ id: uid(), created_at: nowIso() }, p);
          db[this.table].push(row);
          created.push(row);
        }
        return this.returning ? this.finish(created) : { data: null, error: null };
      }
      if (this.op === 'update') {
        if (this.table === 'cases' && role() !== 'admin') return { data: null, error: null };
        this.matches().forEach(r => Object.assign(r, this.payload));
        return { data: null, error: null };
      }
      if (this.op === 'delete') {
        const me = session && session.user.id;
        const hit = this.matches().filter(r => this.table !== 'case_notes' || r.author_id === me);
        db[this.table] = db[this.table].filter(r => !hit.includes(r));
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'okänd operation' } };
    }
  }

  async function rpc(name, a) {
    await delay();
    mock.log.push('rpc.' + name);
    const failure = takeFailure('rpc.' + name);
    if (failure) return { data: null, error: failure };
    const me = session && session.user.id;

    switch (name) {
      case 'create_anonymous_case': {
        const code = 'KOD' + Math.random().toString(36).slice(2, 14).toUpperCase();
        const id = addCase({
          reporter_type: 'anonymous_code', subject: a.p_subject, category: a.p_category, department: a.p_department,
          department_detail: a.p_department_detail, who_involved: a.p_who_involved, where_happened: a.p_where_happened,
          when_happened: a.p_when_happened, other_actions: a.p_other_actions, created_at: nowIso(),
        }, [{ from_role: 'employee', text: a.p_message, created_at: nowIso() }]);
        codes[code] = id;
        mock.lastCode = code;
        return { data: [{ case_id: id, access_code: code, wb_token: caseOf(id).anonymous_token }], error: null };
      }
      case 'create_case': {
        if (!me) return { data: null, error: { message: 'Inte inloggad', code: 'P0001' } };
        const prof = db.profiles.find(p => p.id === me);
        if (!prof || prof.reporter_type !== a.p_reporter_type) return { data: null, error: rls('cases') };
        const id = addCase({
          reporter_type: a.p_reporter_type, employee_id: me, subject: a.p_subject, category: a.p_category,
          department: a.p_department, department_detail: a.p_department_detail, who_involved: a.p_who_involved,
          where_happened: a.p_where_happened, when_happened: a.p_when_happened, other_actions: a.p_other_actions,
          reporter_name: a.p_reporter_type === 'open' ? a.p_reporter_name : null,
          reporter_phone: a.p_reporter_type === 'open' ? a.p_reporter_phone : null, created_at: nowIso(),
        }, [{ from_role: 'employee', text: a.p_message, created_at: nowIso() }]);
        return { data: [{ case_id: id, wb_token: caseOf(id).anonymous_token }], error: null };
      }
      case 'get_case_by_code': {
        const c = codes[a.p_code] && caseOf(codes[a.p_code]);
        if (!c) return { data: [], error: null };
        return { data: [{
          case_id: c.id, wb_token: c.anonymous_token, subject: c.subject, category: c.category, department: c.department,
          department_detail: c.department_detail, who_involved: c.who_involved, where_happened: c.where_happened,
          when_happened: c.when_happened, other_actions: c.other_actions, status: c.status, created_at: c.created_at,
          messages: clone(db.messages.filter(m => m.case_id === c.id).sort(byCreated)),
          attachments: db.attachments.filter(x => x.case_id === c.id).map(x => ({ file_name: x.file_name, file_size: x.file_size, created_at: x.created_at })),
        }], error: null };
      }
      case 'add_anonymous_message': {
        const id = codes[a.p_code];
        if (!id) return { data: false, error: null };
        db.messages.push({ id: uid(), case_id: id, from_role: 'employee', text: a.p_text, sender_id: null, created_at: nowIso() });
        return { data: true, error: null };
      }
      case 'open_case_files': {
        if (mock.openCaseFilesMissing) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.open_case_files(p_code) in the schema cache' } };
        }
        const id = codes[a.p_code];
        if (!id) return { data: [], error: null };
        grants[id] = Date.now() + 120000;
        return { data: db.attachments.filter(x => x.case_id === id).map(x => ({ file_path: x.file_path, file_name: x.file_name, file_size: x.file_size, created_at: x.created_at })), error: null };
      }
      default:
        return { data: null, error: { message: 'Okänd rpc: ' + name } };
    }
  }

  function canRead(path) {
    const c = caseOf(path.split('/')[0]);
    if (!c) return false;
    const r = role(), me = session && session.user.id;
    if (r === 'admin') return true;
    if (r === 'employee' && c.employee_id === me) return true;
    return (grants[c.id] || 0) > Date.now();
  }

  const storage = {
    from() {
      return {
        async upload(path, file) {
          await delay();
          mock.log.push('storage.upload');
          const failure = takeFailure('storage.upload');
          if (failure) return { data: null, error: failure };
          storageObjs[path] = URL.createObjectURL(file);
          return { data: { path }, error: null };
        },
        async createSignedUrls(paths) {
          await delay();
          mock.log.push('storage.sign');
          const failure = takeFailure('storage.sign');
          if (failure) return { data: null, error: failure };
          return { data: paths.map(p => (canRead(p) && storageObjs[p])
            ? { path: p, signedUrl: storageObjs[p], error: null }
            : { path: p, signedUrl: null, error: 'Either the object does not exist or you do not have access to it' }), error: null };
        },
      };
    },
  };

  function emit(event) {
    const s = session ? clone(session) : null;
    listeners.forEach(cb => Promise.resolve().then(() => cb(event, s)));
  }

  const auth = {
    onAuthStateChange(cb) {
      listeners.push(cb);
      if (location.hash.includes('mock-recovery')) {
        // Samma ordning som supabase-js vid en återställningslänk.
        session = { user: clone(users.e1), access_token: 'mock' };
        setTimeout(async () => { await cb('PASSWORD_RECOVERY', clone(session)); await cb('INITIAL_SESSION', clone(session)); }, 0);
      } else {
        setTimeout(() => cb('INITIAL_SESSION', session ? clone(session) : null), 0);
      }
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async getSession() { return { data: { session: clone(session) }, error: null }; },
    async signInWithPassword() { await delay(); return { data: {}, error: { message: 'Invalid login credentials', status: 400 } }; },
    async signUp() { await delay(); return { data: { user: null, session: null }, error: null }; },
    async signOut() { session = null; emit('SIGNED_OUT'); return { error: null }; },
    async resetPasswordForEmail() {
      await delay();
      const failure = takeFailure('auth.reset');
      return failure ? { data: null, error: failure } : { data: {}, error: null };
    },
    async updateUser() {
      await delay();
      const failure = takeFailure('auth.update');
      if (failure) return { data: null, error: failure };
      emit('USER_UPDATED');
      return { data: { user: session && session.user }, error: null };
    },
  };


  // ── Rollpanel ─────────────────────────────────────────────────
  // Byter inloggad roll utan lösenord. Finns bara i testläget.
  mock.logout = () => { session = null; emit('SIGNED_OUT'); };

  document.addEventListener('DOMContentLoaded', () => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:900;background:#fff8e6;border:2px solid #c9a35f;' +
      'border-radius:8px;padding:10px 12px;font:13px Inter,system-ui,sans-serif;color:#1c2b38;box-shadow:0 6px 20px rgba(0,0,0,.18);max-width:260px';
    const roles = [
      ['a1', 'HR: Ulrika Westerström'],
      ['a2', 'HR: Leif Glavå'],
      ['e1', 'Anmälare med e-post'],
      ['e2', 'Öppen anmälare'],
    ];
    box.innerHTML = '<div class="tl-head" style="font-weight:800;letter-spacing:.4px;cursor:pointer;display:flex;justify-content:space-between;gap:10px">' +
      '<span>TESTLÄGE</span><span class="tl-toggle">▾ dölj</span></div>' +
      '<div class="tl-body"><div style="margin:6px 0 8px;line-height:1.4">Påhittad data. Inget sparas i den riktiga databasen.</div></div>';
    const body = box.querySelector('.tl-body');
    box.querySelector('.tl-head').onclick = () => {
      const hidden = body.style.display === 'none';
      body.style.display = hidden ? 'block' : 'none';
      box.querySelector('.tl-toggle').textContent = hidden ? '▾ dölj' : '▴ visa';
    };
    roles.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.textContent = 'Logga in som ' + label;
      b.style.cssText = 'display:block;width:100%;margin:3px 0;padding:5px 8px;border:1px solid #c9a35f;border-radius:5px;background:#fff;cursor:pointer;font:inherit;text-align:left';
      b.onclick = () => { if (session) mock.logout(); setTimeout(() => mock.login(id), 50); };
      body.appendChild(b);
    });
    const out = document.createElement('button');
    out.textContent = 'Logga ut';
    out.style.cssText = 'display:block;width:100%;margin:6px 0 4px;padding:5px 8px;border:1px solid #999;border-radius:5px;background:#fff;cursor:pointer;font:inherit';
    out.onclick = () => mock.logout();
    body.appendChild(out);
    const code = document.createElement('div');
    code.style.cssText = 'margin-top:6px;line-height:1.4';
    code.innerHTML = 'Kod för helt anonymt ärende:<br><b>TESTKOD-ANON-123</b>';
    body.appendChild(code);
    document.body.appendChild(box);
  });

  mock.login = id => { session = { user: clone(users[id]), access_token: 'mock' }; emit('SIGNED_IN'); };
  mock.refreshToken = () => emit('SIGNED_IN');

  window.supabase = {
    createClient() {
      return { from: t => new Query(t), rpc, storage, auth, functions: { async invoke() { return { data: null, error: null }; } } };
    },
  };
})();
