// due-reminders — scheduled (pg_cron) Edge Function that sends task due-date
// reminders server-side, so they fire whether or not anyone has the app open.
// Mirrors the client ReminderEngine schedule by priority:
//   critical → 4h before due, at-due, +24h overdue
//   urgent   → 4h before due, at-due
//   high     → 8am-HQ morning-of, at-due
//   medium   → 8am-HQ morning-of
//   low      → none
//
// Dedupe: claims a (task_id, kind) row in public.reminder_log before sending,
// so each reminder goes out exactly once. Only recent windows fire (CATCHUP_MS),
// so first deploy / a cron gap won't flood old backlog.
//
// Invoked by pg_cron via pg_net with an x-reminders-secret header (Verify JWT
// must be OFF for this function). Secrets needed:
//   REMINDERS_SECRET, RESEND_API_KEY, EMAIL_FROM
//   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const PRE_DUE_MS = 4 * 60 * 60 * 1000;
const OVERDUE_MS = 24 * 60 * 60 * 1000;
const CATCHUP_MS = 90 * 60 * 1000; // only fire windows that became due in the last 90 min
const MAX_TASKS = 2000;

// America/Phoenix has NO DST → fixed UTC-7. An HQ wall-clock time HH:MM is
// therefore UTC HH+7:MM. tasks.due is already the HQ calendar date.
function hqMs(y: number, m: number, d: number, hh: number, mm: number): number {
  return Date.UTC(y, m - 1, d, hh + 7, mm, 0);
}

function dueTimestamp(due: string, dueTime: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due || "");
  if (!m) return null;
  let hh = 23, mm = 59;
  if (dueTime) {
    const p = String(dueTime).split(":");
    const h = Number(p[0]); const n = Number(p[1] ?? 0);
    if (!Number.isNaN(h)) { hh = h; mm = Number.isNaN(n) ? 0 : n; }
  }
  return hqMs(+m[1], +m[2], +m[3], hh, mm);
}

// A `datetime-local` string ("YYYY-MM-DDTHH:MM") interpreted as HQ wall-clock.
function parseLocalHq(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s || ""));
  return m ? hqMs(+m[1], +m[2], +m[3], +m[4], +m[5]) : null;
}

function windowsFor(task: any): Array<{ kind: string; at: number }> {
  const out: Array<{ kind: string; at: number }> = [];

  // Automatic priority windows (need a due date).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(task.due || "");
  const dueTs = dueTimestamp(task.due, task.due_time);
  if (m && dueTs != null) {
    const morning = hqMs(+m[1], +m[2], +m[3], 8, 0);
    const prio = task.priority || "medium";
    if (prio === "critical") {
      out.push({ kind: "pre", at: dueTs - PRE_DUE_MS }, { kind: "at", at: dueTs }, { kind: "overdue", at: dueTs + OVERDUE_MS });
    } else if (prio === "urgent") {
      out.push({ kind: "pre", at: dueTs - PRE_DUE_MS }, { kind: "at", at: dueTs });
    } else if (prio === "high") {
      out.push({ kind: "morning", at: morning }, { kind: "at", at: dueTs });
    } else if (prio === "medium") {
      out.push({ kind: "morning", at: morning });
    }
  }

  // Custom one-off reminder (independent of due date). Keyed on the value so
  // changing the reminder time re-arms it.
  if (task.reminder_at) {
    const ts = parseLocalHq(task.reminder_at);
    if (ts != null) out.push({ kind: "custom:" + task.reminder_at, at: ts });
  }
  return out;
}

const LABEL: Record<string, string> = {
  pre: "Due in 4 hours",
  at: "Due now",
  overdue: "Overdue",
  morning: "Due today",
};

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

Deno.serve(async (req) => {
  // Shared-secret gate (no JWT; the cron job supplies the header).
  const secret = Deno.env.get("REMINDERS_SECRET");
  if (!secret || req.headers.get("x-reminders-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "server misconfigured" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const db = createClient(supabaseUrl, serviceKey);
  const now = Date.now();

  // Open, dated tasks only.
  const taskRes = await db
    .from("tasks")
    .select("id, title, due, due_time, reminder_at, priority, status, assignee_id, watchers")
    .neq("status", "done")
    .or("due.not.is.null,reminder_at.not.is.null")
    .limit(MAX_TASKS);
  if (taskRes.error) {
    console.error("[due-reminders] task load failed", taskRes.error);
    return new Response(JSON.stringify({ error: "task load failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  const tasks = taskRes.data ?? [];

  // Recipient emails: id -> email from team_members.
  const memberRes = await db.from("team_members").select("id, email");
  const emailById = new Map<string, string>();
  const knownMembers = new Set<string>();
  (memberRes.data ?? []).forEach((m: any) => {
    knownMembers.add(m.id);
    if (m.email) emailById.set(m.id, String(m.email).trim());
  });

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") ?? "Quest HQ <onboarding@resend.dev>";

  let sent = 0;
  const errors: string[] = [];

  for (const t of tasks) {
    const recipients = new Set<string>();
    if (t.assignee_id && knownMembers.has(t.assignee_id)) recipients.add(t.assignee_id);
    (Array.isArray(t.watchers) ? t.watchers : []).forEach((w: string) => {
      if (w && knownMembers.has(w)) recipients.add(w);
    });
    if (!recipients.size) continue;

    for (const w of windowsFor(t)) {
      // Only fire windows that became due within the catch-up window.
      if (now < w.at || now - w.at > CATCHUP_MS) continue;

      // Claim the (task_id, kind) row; empty result = already sent → skip.
      const claim = await db
        .from("reminder_log")
        .upsert({ task_id: t.id, kind: w.kind }, { onConflict: "task_id,kind", ignoreDuplicates: true })
        .select();
      if (claim.error) { errors.push(`log ${t.id}/${w.kind}: ${claim.error.message}`); continue; }
      if (!claim.data || claim.data.length === 0) continue; // already sent

      const label = LABEL[w.kind] || (w.kind.startsWith("custom:") ? "Reminder" : "Due soon");
      const titleEsc = esc(t.title || "Task");

      // In-app notification per recipient.
      const notifRows = [...recipients].map((memberId) => ({
        id: crypto.randomUUID(),
        member_id: memberId,
        task_id: t.id,
        meta: `Reminder · ${label}`,
        html: `<strong>${label}</strong>: <em>${titleEsc}</em>`,
        read: false,
      }));
      const notifRes = await db.from("notifications").insert(notifRows);
      if (notifRes.error) errors.push(`notif ${t.id}/${w.kind}: ${notifRes.error.message}`);

      // Email (best-effort).
      if (apiKey) {
        const to = [...recipients].map((id) => emailById.get(id)).filter(Boolean) as string[];
        if (to.length) {
          try {
            const r = await fetch(RESEND_ENDPOINT, {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from,
                to,
                subject: `${label}: ${t.title || "Task"}`,
                html: `<p><strong>${label}</strong></p><p>${titleEsc}</p><p style="color:#888;font-size:12px">Quest HQ reminder</p>`,
              }),
            });
            if (!r.ok) errors.push(`email ${t.id}/${w.kind}: ${r.status}`);
          } catch (e) {
            errors.push(`email ${t.id}/${w.kind}: ${String(e)}`);
          }
        }
      }
      sent++;
    }
  }

  return new Response(JSON.stringify({ ok: true, scanned: tasks.length, sent, errors: errors.slice(0, 20) }), {
    headers: { "Content-Type": "application/json" },
  });
});
