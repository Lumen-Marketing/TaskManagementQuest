// Supabase Edge Function: delete-user
// -----------------------------------------------------------------------------
// Fully deletes a user: their profile row, their team_member row (best-effort),
// AND their Auth login (auth.users) — which is what frees the email so it can
// be reused for a new sign-up. The browser can't delete an Auth user (that needs
// the service-role key), so this runs server-side. The Quest HQ client invokes
// it with supabase.functions.invoke('delete-user').
//
// DEPLOY (one-time):
//   1. Set the allowed origins secret (comma-separated):
//        supabase secrets set ALLOWED_ORIGINS="https://your-app.vercel.app,http://localhost:5173"
//      (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//   2. Deploy:
//        supabase functions deploy delete-user
//
// HARDENING:
//   - JWT verification is on by default, so only signed-in users can call it.
//   - The caller must be approved AND hold a role-managing role
//     (admin / construction_supervisor / developer) — same gate as the in-app
//     Delete button and the can_manage_roles() RLS helper.
//   - You cannot delete your own account.
//   - The service-role key never leaves the server.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_PAYLOAD_BYTES = 16 * 1024;
const MANAGER_ROLES = new Set(["admin", "construction_supervisor", "developer"]);

function corsHeadersFor(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  const allowList = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (allowList.length === 0) {
    console.error("[delete-user] ALLOWED_ORIGINS is not set — refusing cross-origin responses.");
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

interface DeletePayload {
  profileId?: unknown;
  memberId?: unknown;
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

    // -------- caller authorization ---------------------------------------
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!callerJwt) return json(req, { error: "Missing authorization." }, 401);

    // Validate the caller's JWT with the SERVICE-ROLE client by passing the token
    // to getUser(jwt). This verifies the token server-side regardless of the
    // project's JWT signing scheme. Keying createClient by the user JWT instead
    // (apikey position) fails on projects using the new asymmetric signing keys,
    // because the gateway rejects a request whose apikey is a user JWT rather than
    // the anon/service key — surfacing as a spurious 401 for valid callers.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: callerUser, error: callerErr } = await admin.auth.getUser(callerJwt);
    if (callerErr || !callerUser?.user) {
      return json(req, { error: "Not signed in." }, 401);
    }

    const { data: callerProfile, error: profileErr } = await admin
      .from("profiles")
      .select("approved, role")
      .eq("id", callerUser.user.id)
      .single();
    if (profileErr || !callerProfile) {
      return json(req, { error: "Not authorized." }, 403);
    }
    if (!callerProfile.approved || !MANAGER_ROLES.has(callerProfile.role)) {
      return json(req, { error: "Not authorized to delete users." }, 403);
    }

    // -------- input ------------------------------------------------------
    const lenHeader = req.headers.get("content-length");
    if (lenHeader && Number(lenHeader) > MAX_PAYLOAD_BYTES) {
      return json(req, { error: "Payload too large." }, 413);
    }
    const raw = await req.text();
    if (raw.length > MAX_PAYLOAD_BYTES) return json(req, { error: "Payload too large." }, 413);

    let payload: DeletePayload;
    try { payload = JSON.parse(raw); } catch { return json(req, { error: "Invalid JSON body." }, 400); }

    const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
    const memberId = typeof payload.memberId === "string" ? payload.memberId.trim() : "";
    // profileId is the auth user id (profiles.id === auth.users.id).
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(profileId)) return json(req, { error: "A valid profileId is required." }, 400);
    if (profileId === callerUser.user.id) {
      return json(req, { error: "You can't delete your own account." }, 400);
    }

    // -------- delete (service role) --------------------------------------
    // 1. Profile row — revokes app access. (May already cascade from the auth
    //    delete below, but do it explicitly so the result is deterministic.)
    const profDel = await admin.from("profiles").delete().eq("id", profileId);
    if (profDel.error) {
      console.error("[delete-user] profile delete failed", profDel.error);
      return json(req, { error: "Could not remove the profile." }, 500);
    }

    // 2. team_member row — best-effort. ON DELETE RESTRICT keeps it when a task
    //    still references the member (so history doesn't break); that's fine.
    if (memberId) {
      const memDel = await admin.from("team_members").delete().eq("id", memberId);
      if (memDel.error) {
        console.warn("[delete-user] team_member kept (still referenced or blocked):", memDel.error.message);
      }
    }

    // 3. Auth login — this is what frees the email for re-registration.
    const { error: authDelErr } = await admin.auth.admin.deleteUser(profileId);
    if (authDelErr) {
      // Profile is already gone (access revoked), but the email is still
      // reserved. Report partial success so the UI can say so.
      console.error("[delete-user] auth user delete failed", authDelErr);
      return json(req, { ok: true, emailFreed: false, warning: "Access revoked, but the login could not be removed." });
    }

    return json(req, { ok: true, emailFreed: true });
  } catch (err) {
    console.error("[delete-user] uncaught", err);
    return json(req, { error: "Internal error." }, 500);
  }
});
