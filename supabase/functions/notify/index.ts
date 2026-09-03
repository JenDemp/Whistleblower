import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_KEY  = Deno.env.get('RESEND_API_KEY')!
const SITE_URL    = 'https://jendemp.github.io/Whistleblower/'
const FROM_EMAIL  = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev'
const FROM_NAME   = 'JENSEN Whistleblower'

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({ from: `${FROM_NAME} <${FROM_EMAIL}>`, to: [to], subject, html }),
  })
  if (!res.ok) console.error('Resend error:', await res.text())
}

function emailWrapper(content: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;background:#fff;border:1px solid #dddad2;border-radius:8px;">
      <p style="margin:0 0 24px;"><img src="https://www.jenseneducation.se/themes/custom/jensen/css/graphics/logo-gold-jensen-education.svg" style="height:38px;" alt="JENSEN"></p>
      ${content}
      <hr style="border:none;border-top:1px solid #eee;margin:28px 0 16px;">
      <p style="color:#999;font-size:12px;margin:0;">JENSEN Whistleblower &mdash; Konfidentiellt. Svara inte på detta mejl.</p>
    </div>`
}

function loginButton(): string {
  return `<p style="margin-top:24px;"><a href="${SITE_URL}" style="display:inline-block;background:#c4a135;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">Öppna JENSEN Whistleblower</a></p>`
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Not allowed', { status: 405 })

  // Verify caller is authenticated
  const authHeader = req.headers.get('Authorization') ?? ''
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { type, case_id } = await req.json()

  const { data: c } = await sbAdmin
    .from('cases')
    .select('id, anonymous_token, category, recipient_admin_id, employee_id')
    .eq('id', case_id)
    .single()

  if (!c) return new Response('Case not found', { status: 404 })

  // ── Notify admin: new case or employee reply ───────────────────
  if (type === 'new_case' || type === 'employee_reply') {
    const { data: { user: admin } } = await sbAdmin.auth.admin.getUserById(c.recipient_admin_id)
    if (!admin?.email) return new Response('OK', { status: 200 })

    const isNew = type === 'new_case'
    const subject = isNew
      ? `Nytt ärende – ${c.anonymous_token}`
      : `Nytt svar – ärende ${c.anonymous_token}`

    const html = emailWrapper(`
      <h2 style="color:#1e3246;font-size:20px;margin:0 0 12px;">${isNew ? 'Nytt ärende inkommet' : 'Nytt svar på ärende'}</h2>
      <p style="color:#444;">Ärendenummer: <strong>${c.anonymous_token}</strong></p>
      ${isNew ? `<p style="color:#444;">Kategori: <strong>${c.category}</strong></p>` : ''}
      <p style="color:#666;font-size:13px;">Anmälarens identitet är skyddad och visas aldrig för dig.</p>
      ${loginButton()}
    `)

    await sendEmail(admin.email, subject, html)
  }

  // ── Notify employee: admin replied ─────────────────────────────
  if (type === 'admin_reply') {
    const { data: { user: emp } } = await sbAdmin.auth.admin.getUserById(c.employee_id)
    if (!emp?.email) return new Response('OK', { status: 200 })

    // TODO(human): implement the email body the employee receives when HR/admin replies.
    // The subject and html variables need to be set here.
    // Guidance: keep it brief, don't reveal who replied or any case details (privacy),
    // just tell them they have a reply and give them the login button. ~4-6 lines of HTML.
    const subject = ''
    const html = ''

    if (subject && html) await sendEmail(emp.email, subject, html)
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  })
})
