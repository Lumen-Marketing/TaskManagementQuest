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
const MAX_SUBJECT_LEN = 200;
const MAX_PAYLOAD_BYTES = 256 * 1024; // hard cap so an attacker can't OOM the function
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// CORS: strict allowlist, fails closed. ALLOWED_ORIGINS must be set in
// function secrets as a comma-separated list of permitted origins, e.g.
//   supabase secrets set ALLOWED_ORIGINS="https://your-app.vercel.app,http://localhost:5173"
// If the env var is empty, or the request origin is not on the list, we
// omit the Access-Control-Allow-Origin header entirely — the browser will
// then reject the response. We never echo "*" or a guessed origin.
function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const allowList = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowList.length === 0) {
    console.error("[notify-email] ALLOWED_ORIGINS is not set — refusing cross-origin responses.");
    return headers;
  }
  const origin = req.headers.get("Origin") ?? "";
  if (allowList.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

function sanitizeHtml(html: string): string {
  // Defense-in-depth: drop <script>…</script>, javascript: URIs, and on* event
  // handlers. The body is composed server-side from escaped data, but a buggy
  // caller shouldn't be able to inject anything dangerous either.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "blocked:")
    .slice(0, MAX_HTML_BYTES);
}

interface EmailPayload {
  to?: unknown;
  subject?: unknown;
  html?: unknown;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("EMAIL_FROM") ?? "Quest HQ <onboarding@resend.dev>";
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!apiKey) return json(req, { error: "Email service is not configured." }, 503);
    if (!supabaseUrl || !serviceKey) {
      return json(req, { error: "Service credentials are not available." }, 503);
    }

    // -------- caller authorization ---------------------------------------
    // The Edge Function is JWT-verified by default (verify_jwt=true), so we
    // know there's SOME signed-in user. But a pending-approval account or a
    // role with no app permissions should not be able to send mail. Look up
    // their profile with the service key and confirm both approved=true and
    // a non-member role before doing anything expensive.
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!callerJwt) return json(req, { error: "Missing authorization." }, 401);

    const callerClient = createClient(supabaseUrl, callerJwt, {
      global: { headers: { Authorization: `Bearer ${callerJwt}` } },
    });
    const { data: callerUser, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerUser?.user) {
      return json(req, { error: "Not signed in." }, 401);
    }
    const adminProbe = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile, error: profileErr } = await adminProbe
      .from("profiles")
      .select("approved, role")
      .eq("id", callerUser.user.id)
      .single();
    if (profileErr || !callerProfile) {
      return json(req, { error: "Not authorized." }, 403);
    }
    // Authorize the caller to send notification emails: approved === true AND a
    // MANAGEMENT role. This is a fail-CLOSED allowlist on purpose. The send is a
    // privileged capability — it emits arbitrary (sanitized) HTML from the
    // official Quest HQ address to any teammate on the roster — so the lowest-
    // privilege role (worker) must not have it, or a single approved/compromised
    // worker account becomes an internal phishing/spam vector. A "any approved
    // role" gate fails OPEN (every future role can send by default); an explicit
    // allowlist fails SAFE (a new role is denied until added here), which is the
    // correct direction for a security gate. Enforced by
    // tests/role-gate.spec.js ("worker invoking notify-email gets a 403").
    // Retired role construction_supervisor is kept inert for parity with the SQL
    // RLS role lists. Approval is still required; RLS enforces row-level access.
    // NOTE: 'sales' is intentionally NOT here. It is a worker by another name
    // (migration 048 resolves sales -> worker), and workers must not send mail —
    // so sales is denied exactly like a worker.
    const SEND_ROLES = new Set([
      "admin", "construction_supervisor", "supervisor", "developer",
    ]);
    const callerRole = typeof callerProfile.role === "string" ? callerProfile.role.trim() : "";
    if (!callerProfile.approved || !SEND_ROLES.has(callerRole)) {
      return json(req, { error: "Not authorized." }, 403);
    }

    // Cap raw body size before parsing.
    const lenHeader = req.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_PAYLOAD_BYTES) {
      return json(req, { error: "Payload too large." }, 413);
    }
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return json(req, { error: "Payload too large." }, 413);
    }

    let payload: EmailPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(req, { error: "Invalid JSON body." }, 400);
    }
    if (!payload || typeof payload !== "object") {
      return json(req, { error: "Invalid request body." }, 400);
    }

    // ---- input validation -----------------------------------------------
    const toInput = Array.isArray(payload.to) ? payload.to : [payload.to];
    const requested = toInput
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length <= 254 && EMAIL_RE.test(e));
    if (requested.length === 0) {
      return json(req, { error: "No valid recipients provided." }, 400);
    }
    if (requested.length > MAX_RECIPIENTS * 4) {
      // Hard cap on input — allowlist intersection will further trim.
      return json(req, { error: "Too many recipients." }, 400);
    }

    if (typeof payload.subject !== "undefined" && typeof payload.subject !== "string") {
      return json(req, { error: "subject must be a string." }, 400);
    }
    if (typeof payload.html !== "undefined" && typeof payload.html !== "string") {
      return json(req, { error: "html must be a string." }, 400);
    }
    const subject = ((payload.subject as string | undefined) ?? "Quest HQ notification")
      .slice(0, MAX_SUBJECT_LEN);
    const html = sanitizeHtml((payload.html as string | undefined) ?? "");
    if (!html.trim()) {
      return json(req, { error: "html body is required." }, 400);
    }

    // ---- allowlist intersection -----------------------------------------
    // Reuse the admin client created for the caller-role check above.
    const { data: members, error: memberErr } = await adminProbe
      .from("team_members")
      .select("email");
    if (memberErr) {
      // Don't leak the underlying Postgres error to the public — log instead.
      console.error("[notify-email] team_members lookup failed", memberErr);
      return json(req, { error: "Could not verify recipients." }, 500);
    }
    const allowed = new Set(
      (members ?? [])
        .map((m: { email: string | null }) => (m.email ?? "").trim().toLowerCase())
        .filter(Boolean),
    );
    const to = [...new Set(requested.filter((e) => allowed.has(e)))].slice(0, MAX_RECIPIENTS);
    if (to.length === 0) {
      return json(req, { error: "No recipients are on the team allowlist." }, 422);
    }

    // ---- send -----------------------------------------------------------
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
      console.error("[notify-email] provider rejected", { status: res.status, data });
      return json(req, { error: "Email provider rejected the request." }, 502);
    }
    return json(req, {
      ok: true,
      id: data?.id ?? null,
      sent: to.length,
      skipped: requested.length - to.length,
    });
  } catch (err) {
    // Last-resort catch — any uncaught throw becomes a clean 500 JSON, never
    // a stack trace in the response body.
    console.error("[notify-email] uncaught", err);
    return json(req, { error: "Internal error." }, 500);
  }
});
