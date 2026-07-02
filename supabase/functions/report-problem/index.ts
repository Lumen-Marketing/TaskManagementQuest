// Supabase Edge Function: report-problem
// -----------------------------------------------------------------------------
// "Report a problem" from the account menu. Any APPROVED user of ANY role
// (workers/sales included — unlike notify-email) can submit a bug/problem/
// suggestion. The function is the ONLY write path to public.bug_reports
// (the table has no INSERT policy); it validates + caps input, rate-limits
// per user, inserts with the service key, then best-effort emails every
// approved developer-role profile via Resend. Email failure never fails the
// request — the table is the source of truth.
//
// DEPLOY: like notify-email — gateway verify-JWT OFF (asymmetric signing
// keys), caller JWT validated manually below. Reuses the project-wide
// secrets RESEND_API_KEY / EMAIL_FROM / ALLOWED_ORIGINS.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const MAX_DESCRIPTION = 2000;
const MAX_CONTEXT_VALUE = 300;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_REPORTS_PER_HOUR = 5;
const TYPES = new Set(["bug", "problem", "suggestion"]);
const CONTEXT_KEYS = ["view", "company", "userAgent", "viewport", "path"];

// CORS: strict allowlist, fails closed — same contract as notify-email.
function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const allowList = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowList.length === 0) {
    console.error("[report-problem] ALLOWED_ORIGINS is not set — refusing cross-origin responses.");
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json(req, { error: "Service credentials are not available." }, 503);
    }
    // Email is best-effort: a missing Resend key must not block report storage.
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const from = Deno.env.get("EMAIL_FROM") ?? "Quest HQ <onboarding@resend.dev>";

    // -------- caller authorization ---------------------------------------
    // Any APPROVED profile may report, regardless of role. This is a
    // feedback channel, not a mail cannon: recipients are derived
    // server-side (developer profiles only), so the caller can never choose
    // who gets emailed.
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!callerJwt) return json(req, { error: "Not signed in." }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerUser, error: callerErr } = await admin.auth.getUser(callerJwt);
    if (callerErr || !callerUser?.user) {
      return json(req, { error: "Not signed in." }, 401);
    }
    const uid = callerUser.user.id;
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("approved, role, full_name, email")
      .eq("id", uid)
      .single();
    if (profileErr || !profile || !profile.approved) {
      return json(req, { error: "Not authorized." }, 403);
    }

    // -------- input validation --------------------------------------------
    const lenHeader = req.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_PAYLOAD_BYTES) {
      return json(req, { error: "Payload too large." }, 413);
    }
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return json(req, { error: "Payload too large." }, 413);
    }
    let payload: { type?: unknown; description?: unknown; context?: unknown };
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(req, { error: "Invalid JSON body." }, 400);
    }
    if (!payload || typeof payload !== "object") {
      return json(req, { error: "Invalid request body." }, 400);
    }

    const type = typeof payload.type === "string" && TYPES.has(payload.type)
      ? payload.type : "bug";
    const description = typeof payload.description === "string"
      ? payload.description.trim().slice(0, MAX_DESCRIPTION) : "";
    if (!description) {
      return json(req, { error: "Please describe the problem." }, 400);
    }
    // Context: only the expected keys, each value stringified + capped.
    const rawCtx = (payload.context && typeof payload.context === "object")
      ? payload.context as Record<string, unknown> : {};
    const context: Record<string, string> = {};
    for (const key of CONTEXT_KEYS) {
      const v = rawCtx[key];
      if (typeof v === "string" && v) context[key] = v.slice(0, MAX_CONTEXT_VALUE);
    }

    // -------- rate limit ---------------------------------------------------
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await admin
      .from("bug_reports")
      .select("id", { count: "exact", head: true })
      .eq("reporter_id", uid)
      .gte("created_at", hourAgo);
    if (countErr) {
      console.error("[report-problem] rate-limit count failed", countErr);
      return json(req, { error: "Could not submit the report." }, 500);
    }
    if ((count ?? 0) >= MAX_REPORTS_PER_HOUR) {
      return json(req, { error: "You've sent several reports recently — please wait a bit." }, 429);
    }

    // -------- store (source of truth) --------------------------------------
    const reporterName = (profile.full_name ?? "").trim() || "Unknown";
    const reporterEmail = (profile.email ?? callerUser.user.email ?? "").trim();
    const { data: inserted, error: insertErr } = await admin
      .from("bug_reports")
      .insert({
        reporter_id: uid,
        reporter_name: reporterName,
        reporter_email: reporterEmail,
        type,
        description,
        context,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("[report-problem] insert failed", insertErr);
      return json(req, { error: "Could not submit the report." }, 500);
    }

    // -------- best-effort email to developers ------------------------------
    let emailed = false;
    try {
      const { data: devs, error: devErr } = await admin
        .from("profiles")
        .select("email")
        .eq("role", "developer")
        .eq("approved", true);
      const to = [...new Set((devs ?? [])
        .map((d: { email: string | null }) => (d.email ?? "").trim().toLowerCase())
        .filter(Boolean))];
      if (devErr) console.error("[report-problem] developer lookup failed", devErr);
      if (resendKey && to.length > 0) {
        const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
        const ctxRows = Object.entries(context).map(([k, v]) =>
          `<tr><td style="padding:2px 12px 2px 0;color:#666;">${escapeHtml(k)}</td>` +
          `<td style="padding:2px 0;">${escapeHtml(v)}</td></tr>`).join("");
        const html =
          `<h2 style="margin:0 0 4px;">${escapeHtml(typeLabel)} report</h2>` +
          `<p style="margin:0 0 12px;color:#666;">From ${escapeHtml(reporterName)}` +
          (reporterEmail ? ` &lt;${escapeHtml(reporterEmail)}&gt;` : "") + `</p>` +
          `<p style="white-space:pre-wrap;">${escapeHtml(description)}</p>` +
          (ctxRows ? `<table style="margin-top:12px;font-size:13px;">${ctxRows}</table>` : "");
        const res = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to,
            subject: `[Quest HQ] ${typeLabel} report from ${reporterName}`,
            html,
          }),
        });
        if (res.ok) {
          emailed = true;
        } else {
          console.error("[report-problem] provider rejected", { status: res.status });
        }
      }
    } catch (mailErr) {
      console.error("[report-problem] email send failed", mailErr);
    }

    return json(req, { ok: true, id: inserted.id, emailed });
  } catch (err) {
    console.error("[report-problem] uncaught", err);
    return json(req, { error: "Internal error." }, 500);
  }
});
