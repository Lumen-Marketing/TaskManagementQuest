// ai-assistant — single-file build for pasting into the Supabase dashboard.
// (The repo keeps this split across index.ts + lib/*.mjs; this bundles them
// into one file so you can paste it in the browser without the CLI.)
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Provider seam — swap these two lines to move off Groq.
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const MAX_PAYLOAD_BYTES = 32 * 1024;
const MAX_CONTEXT_ITEMS = 25;
const DAILY_CAP = 10;

const usage = new Map<string, { day: string; n: number }>();

// ---- context builder (from lib/context.mjs) ---------------------------------
const DONE = new Set(["done", "complete", "completed"]);
const trunc = (s: unknown, n: number) => { const t = String(s || ""); return t.length > n ? t.slice(0, n) : t; };

function buildBriefingContext(tasks: any[], opts: any) {
  const { me, today, maxItems = 25 } = opts || {};
  const mine = (tasks || []).filter((t) => t && t.assignee === me);
  const isDone = (t: any) => DONE.has(String(t.status || "").toLowerCase());
  const open = mine.filter((t) => !isDone(t));
  const overdue = open.filter((t) => t.due && t.due < today);
  const dueToday = open.filter((t) => t.due === today);
  const onHold = open.filter((t) => t.status === "hold");
  const completedSince = mine.filter((t) => {
    if (!isDone(t) || !t.completedAt) return false;
    return String(t.completedAt).slice(0, 10) >= today;
  });
  const counts = {
    overdue: overdue.length, dueToday: dueToday.length, onHold: onHold.length,
    completedSince: completedSince.length, total: open.length,
  };
  const bySeq = (a: any, b: any) => {
    const fa = a.focusSeq == null ? Infinity : a.focusSeq;
    const fb = b.focusSeq == null ? Infinity : b.focusSeq;
    if (fa !== fb) return fa - fb;
    return String(a.due || "9999").localeCompare(String(b.due || "9999"));
  };
  const seen = new Set();
  const push = (arr: any[], out: any[]) => { for (const t of arr) { if (!seen.has(t.id)) { seen.add(t.id); out.push(t); } } };
  const ordered: any[] = [];
  push(overdue.slice().sort(bySeq), ordered);
  push(dueToday.slice().sort(bySeq), ordered);
  push(onHold.slice().sort(bySeq), ordered);
  push(open.slice().sort(bySeq), ordered);
  const tag = (t: any) => t.due && t.due < today ? "OVERDUE"
    : t.due === today ? "DUE TODAY" : t.status === "hold" ? "ON HOLD" : "OPEN";
  const lines = ordered.slice(0, maxItems).map((t) =>
    `${tag(t)} · ${trunc(t.title, 80)} · ${t.company || "—"} · ${t.due ? "due " + t.due : "no due date"}`);
  return { today, counts, lines };
}

// ---- response shaper (from lib/shape.mjs) -----------------------------------
function pluralize(n: number, word: string) { return `${n} ${word}${n === 1 ? "" : "s"}`; }

function fallbackBriefing(ctx: any) {
  const c = (ctx && ctx.counts) || { overdue: 0, dueToday: 0, onHold: 0, completedSince: 0 };
  const parts: string[] = [];
  if (c.overdue) parts.push(`${pluralize(c.overdue, "task")} overdue`);
  if (c.dueToday) parts.push(`${c.dueToday} due today`);
  if (c.onHold) parts.push(`${c.onHold} on hold`);
  const head = parts.length ? parts.join(", ") + "." : "Nothing overdue or due today.";
  const tail = c.completedSince ? ` ${pluralize(c.completedSince, "task")} completed since yesterday.` : "";
  const bullets = ((ctx && ctx.lines) || []).slice(0, 3).map((l: string) => ({ taskId: null, label: l }));
  return { text: (head + tail).trim(), bullets, source: "fallback" };
}

function shapeBriefing(modelText: unknown, ctx: any) {
  if (typeof modelText !== "string" || !modelText.trim()) return fallbackBriefing(ctx);
  const lines = modelText.split("\n").map((l) => l.trim()).filter(Boolean);
  const isBullet = (l: string) => /^([-*•]|\d+[.)])\s+/.test(l);
  const bulletLines = lines.filter(isBullet).map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, ""));
  const narrative = lines.filter((l) => !isBullet(l)).join(" ").trim();
  if (!narrative && !bulletLines.length) return fallbackBriefing(ctx);
  const bullets = bulletLines.slice(0, 3).map((label) => ({ taskId: null, label }));
  return { text: narrative || bulletLines[0], bullets, source: "model" };
}

// ---- task-draft validator (from lib/draft.mjs) ------------------------------
const MAX_DRAFT_TEXT = 500;
const DRAFT_DAILY_CAP = 60;
const draftUsage = new Map<string, { day: string; n: number }>();
const DRAFT_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const DRAFT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DRAFT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const MAX_ASSIGNEES = 10;
function validateDraft(raw: any, opts: any) {
  const out: any = { assignees: [], company: null, priority: null, due: null, dueTime: null };
  if (!raw || typeof raw !== "object") return out;
  const team = (opts && opts.team) || [];
  const companies = (opts && opts.companies) || [];
  const teamIds = new Set(team.map((t: any) => t && t.id).filter(Boolean));
  const compIds = new Set(companies.map((c: any) => c && c.id).filter(Boolean));
  const candidates = Array.isArray(raw.assignees) ? raw.assignees
    : (typeof raw.assignee === "string" ? [raw.assignee] : []);
  const seenIds = new Set();
  for (const id of candidates) {
    if (typeof id === "string" && teamIds.has(id) && !seenIds.has(id)) { seenIds.add(id); out.assignees.push(id); }
    if (out.assignees.length >= MAX_ASSIGNEES) break;
  }
  if (typeof raw.company === "string" && compIds.has(raw.company)) out.company = raw.company;
  if (typeof raw.priority === "string" && DRAFT_PRIORITIES.has(raw.priority)) out.priority = raw.priority;
  if (typeof raw.due === "string" && DRAFT_DATE_RE.test(raw.due) && !Number.isNaN(Date.parse(raw.due))) out.due = raw.due;
  if (typeof raw.dueTime === "string" && DRAFT_TIME_RE.test(raw.dueTime)) out.dueTime = raw.dueTime;
  return out;
}

// ---- HTTP handler (from index.ts) -------------------------------------------
function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const allowList = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowList.length === 0) {
    console.error("[ai-assistant] ALLOWED_ORIGINS is not set — refusing cross-origin responses.");
    return headers;
  }
  const origin = req.headers.get("Origin") ?? "";
  if (allowList.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(req) });
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const groqKey = Deno.env.get("GROQ_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!groqKey) return json(req, { error: "AI service is not configured." }, 503);
    if (!supabaseUrl || !anonKey) return json(req, { error: "Service credentials are not available." }, 503);

    const authHeader = req.headers.get("Authorization") ?? "";
    const callerJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!callerJwt) return json(req, { error: "Missing authorization." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${callerJwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json(req, { error: "Not signed in." }, 401);
    const uid = userData.user.id;

    const { data: profile, error: profErr } = await userClient
      .from("profiles").select("approved, member_id").eq("id", uid).single();
    if (profErr || !profile || !profile.approved) return json(req, { error: "Not authorized." }, 403);
    // Tasks are keyed by member id (e.g. "abraham"), not the auth UUID.
    const memberId = profile.member_id || uid;

    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) return json(req, { error: "Payload too large." }, 413);
    let payload: { action?: unknown };
    try { payload = JSON.parse(raw || "{}"); } catch { return json(req, { error: "Invalid JSON body." }, 400); }
    const action = payload.action;
    if (action !== "briefing" && action !== "draft_task") {
      return json(req, { error: "Unknown action." }, 400);
    }

    // -------- draft_task: natural-language → validated task fields ----------
    if (action === "draft_task") {
      const dday = new Date().toISOString().slice(0, 10);
      const du = draftUsage.get(uid);
      const dn = du && du.day === dday ? du.n : 0;
      if (dn >= DRAFT_DAILY_CAP) return json(req, { error: "Daily draft limit reached." }, 429);
      draftUsage.set(uid, { day: dday, n: dn + 1 });

      const p = payload as { text?: unknown; team?: unknown; companies?: unknown; today?: unknown };
      const text = (typeof p.text === "string" ? p.text : "").slice(0, MAX_DRAFT_TEXT).trim();
      const team = Array.isArray(p.team) ? p.team : [];
      const companies = Array.isArray(p.companies) ? p.companies : [];
      const today = typeof p.today === "string" ? p.today : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());
      const emptyDraft = { assignees: [], company: null, priority: null, due: null, dueTime: null };
      if (!text) return json(req, { ok: true, draft: emptyDraft });

      const names = team.map((t: any) => `${t.id} = ${t.name}`).join("; ");
      const comps = companies.map((c: any) => `${c.id} = ${c.label}`).join("; ");
      const sys = "You extract task fields from a short sentence. Respond ONLY with a JSON object with keys assignees, company, priority, due, dueTime. assignees is an ARRAY of ids from the PEOPLE list (include EVERY person named — one or more); company is an id from the COMPANIES list; priority one of low|medium|high|critical; due as YYYY-MM-DD; dueTime as 24h HH:mm. Use [] for assignees and null for other fields not clearly present. Never invent ids.";
      const usr = `Today is ${today}.\nPEOPLE: ${names || "(none)"}\nCOMPANIES: ${comps || "(none)"}\nSENTENCE: ${text}`;

      let draft = emptyDraft;
      try {
        const res = await fetch(GROQ_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: GROQ_MODEL, temperature: 0, max_tokens: 200,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
          }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const content = data?.choices?.[0]?.message?.content ?? "{}";
          let parsed: unknown = {};
          try { parsed = JSON.parse(content); } catch { parsed = {}; }
          draft = validateDraft(parsed, { team, companies });
        } else {
          console.error("[ai-assistant] draft provider rejected", { status: res.status });
        }
      } catch (e) {
        console.error("[ai-assistant] draft fetch threw", e);
      }
      return json(req, { ok: true, draft });
    }

    // -------- briefing (existing) -----------------------------------------
    const day = new Date().toISOString().slice(0, 10);
    const u = usage.get(uid);
    const n = u && u.day === day ? u.n : 0;
    if (n >= DAILY_CAP) return json(req, { error: "Daily briefing limit reached. Try again tomorrow." }, 429);
    usage.set(uid, { day, n: n + 1 });

    const { data: rows, error: taskErr } = await userClient
      .from("tasks")
      .select("id,title,company_id,due,status,priority,assignee_id,focus_seq,completed_at")
      .eq("assignee_id", memberId)
      .order("due", { ascending: true })
      .limit(120);
    if (taskErr) {
      console.error("[ai-assistant] task fetch failed", taskErr);
      return json(req, { error: "Could not load your tasks." }, 500);
    }
    const tasks = (rows ?? []).map((r: any) => ({
      id: r.id, title: r.title, company: r.company_id, due: r.due, status: r.status,
      priority: r.priority, assignee: r.assignee_id, focusSeq: r.focus_seq, completedAt: r.completed_at, activity: [],
    }));

    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date());
    const ctx = buildBriefingContext(tasks, { me: memberId, today, maxItems: MAX_CONTEXT_ITEMS });

    const system = "You are a concise task assistant. Write a 2 to 4 sentence briefing describing what happened and what needs attention today, then up to 3 short bullet lines each naming one specific task. Only reference tasks in the provided context. Plain text, no emojis, no markdown headings.";
    const userMsg = `Today is ${today}.\nCounts: ${JSON.stringify(ctx.counts)}\nTasks:\n${ctx.lines.join("\n") || "(none)"}`;

    let briefing;
    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: GROQ_MODEL, temperature: 0.4, max_tokens: 350,
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
        }),
      });
      if (!res.ok) {
        console.error("[ai-assistant] provider rejected", { status: res.status });
        briefing = fallbackBriefing(ctx);
      } else {
        const data = await res.json().catch(() => ({}));
        const text = data?.choices?.[0]?.message?.content ?? "";
        briefing = shapeBriefing(text, ctx);
      }
    } catch (e) {
      console.error("[ai-assistant] provider fetch threw", e);
      briefing = fallbackBriefing(ctx);
    }

    return json(req, { ok: true, briefing, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("[ai-assistant] uncaught", err);
    return json(req, { error: "Internal error." }, 500);
  }
});
