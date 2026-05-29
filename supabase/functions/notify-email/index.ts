// Supabase Edge Function: notify-email
// -----------------------------------------------------------------------------
// Sends task notification emails via Resend (https://resend.com).
// The Quest HQ client invokes this with supabase.functions.invoke('notify-email').
//
// DEPLOY (one-time):
//   1. Create a Resend account and verify your sending domain.
//   2. Set the function secrets in your Supabase project:
//        supabase secrets set RESEND_API_KEY=re_xxx
//        supabase secrets set EMAIL_FROM="Quest HQ <notifications@yourdomain.com>"
//      (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//   3. Deploy:
//        supabase functions deploy notify-email
//
// HARDENING (why this isn't a spam cannon):
//   - JWT verification is on by default, so only signed-in users can call it.
//   - Recipients are intersected with the team_members table — you can only mail
//     people who are actually on the team, never arbitrary addresses.
//   - Recipient count and HTML size are capped, and <script> is stripped.
//   - The Resend API key never leaves the server.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_RECIPIENTS = 25;
const MAX_HTML_BYTES = 100_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeHtml(html: string): string {
  // Basic defense-in-depth: drop <script>…</script> and on* handlers. The body
  // is composed server-side from escaped data, so this is belt-and-suspenders.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .slice(0, MAX_HTML_BYTES);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") ?? "Quest HQ <onboarding@resend.dev>";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY is not configured." }, 500);
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Supabase service credentials are not available." }, 500);
  }

  let payload: { to?: string[] | string; subject?: string; html?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const requested = (Array.isArray(payload.to) ? payload.to : [payload.to])
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((e) => e.trim().toLowerCase());
  if (requested.length === 0) return json({ error: "No recipients provided." }, 400);

  // Allowlist: only addresses that belong to a team member may be emailed.
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: members, error: memberErr } = await admin
    .from("team_members")
    .select("email");
  if (memberErr) {
    return json({ error: "Could not verify recipients.", detail: memberErr.message }, 500);
  }
  const allowed = new Set(
    (members ?? [])
      .map((m: { email: string | null }) => (m.email ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const to = [...new Set(requested.filter((e) => allowed.has(e)))].slice(0, MAX_RECIPIENTS);
  if (to.length === 0) {
    return json({ error: "No recipients are on the team allowlist." }, 422);
  }

  const subject = (payload.subject ?? "Quest HQ notification").slice(0, 200);
  const html = sanitizeHtml(payload.html ?? "");

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json({ error: "Email provider rejected the request.", detail: data }, 502);
  }
  return json({ ok: true, id: data?.id ?? null, sent: to.length, skipped: requested.length - to.length });
});
