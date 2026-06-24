window.App = window.App || {};

App.SupabaseDataStore = class SupabaseDataStore {
  constructor({ supabase, currentUser, role }) {
    if (!supabase) throw new Error('Supabase client is required.');
    this.supabase = supabase;
    this.currentUser = currentUser;
    this.role = role || 'member';
    this._profileColumns = 'id, email, full_name, approved, role, email_verified, member_id, supervisor_id, company_ids, avatar_url, created_at';
    // Last-seen updated_at per task id — used as an optimistic-concurrency guard
    // so a save can't silently clobber an edit made elsewhere.
    this._taskVersions = {};
    // PostgREST caps a single response at its max-rows setting (~1000 by
    // default) and SILENTLY truncates — no error. Any unbounded list read
    // (tasks, time_entries, team_members, notifications) must page through with
    // .range() or rows simply vanish once a table grows past the cap. See
    // _pageAll.
    this._PAGE_SIZE = 1000;
  }

  /* Page through a select in fixed chunks until a short page comes back, so a
     table larger than PostgREST's max-rows cap is fully read instead of silently
     truncated. `buildQuery()` MUST return a fresh PostgREST query each call
     (with a STABLE .order() so paging windows don't overlap or skip) — we add
     .range() on top. Returns the concatenated rows. */
  async _pageAll(buildQuery, label) {
    const size = this._PAGE_SIZE;
    const out = [];
    for (let from = 0; ; from += size) {
      const to = from + size - 1;
      const res = await buildQuery().range(from, to);
      this._throwIfError(res, label);
      const rows = res.data || [];
      out.push(...rows);
      // A page shorter than the window means we've reached the end. (An exactly-
      // full final page costs one extra empty request, which is harmless.)
      if (rows.length < size) break;
    }
    return out;
  }

  async loadProfiles() {
    const res = await this.supabase
      .from('profiles')
      .select(this._profileColumns)
      .order('created_at', { ascending: false });
    this._throwIfError(res, 'profiles');
    return res.data || [];
  }

  async loadNotifications() {
    // Paged so a busy inbox isn't truncated at the PostgREST max-rows cap.
    // Secondary .order('id') keeps the paging window stable.
    const rows = await this._pageAll(
      () => this.supabase
        .from('notifications')
        .select('*')
        .eq('member_id', this.currentUser)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }),
      'notifications',
    );
    return rows.map(row => this._mapNotificationRow(row));
  }

  // ----- Task comments (migration 053) -----
  async loadComments(taskId) {
    const res = await this.supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    this._throwIfError(res, 'task_comments');
    return (res.data || []).map(r => ({
      id: r.id,
      taskId: r.task_id,
      authorId: r.author_id,
      body: r.body || '',
      mentions: Array.isArray(r.mentions) ? r.mentions : [],
      createdAt: r.created_at,
    }));
  }

  async addComment(taskId, { body, mentions }) {
    const res = await this.supabase
      .from('task_comments')
      .insert({
        task_id: taskId,
        author_id: this.currentUser,
        body: String(body || ''),
        mentions: Array.isArray(mentions) ? mentions : [],
      })
      .select('*')
      .single();
    this._throwIfError(res, 'task_comments insert');
    const r = res.data;
    return {
      id: r.id,
      taskId: r.task_id,
      authorId: r.author_id,
      body: r.body || '',
      mentions: Array.isArray(r.mentions) ? r.mentions : [],
      createdAt: r.created_at,
    };
  }

  async load() {
    // The four unbounded lists (team_members, tasks, time_entries,
    // notifications) are paged so they aren't silently truncated at PostgREST's
    // max-rows cap. Each .order() is stable so paging windows are correct.
    // active_timers (≤1 row/user) and profiles stay single-shot.
    const [
      peopleRows,
      taskRows,
      entryRows,
      notificationRows,
      timersRes,
      profilesRes,
    ] = await Promise.all([
      this._pageAll(() => this.supabase.from('team_members').select('*').order('name', { ascending: true }).order('id', { ascending: true }), 'people'),
      this._pageAll(() => this.supabase.from('tasks').select('*').order('created_at', { ascending: true }).order('id', { ascending: true }), 'tasks'),
      this._pageAll(() => this.supabase.from('time_entries').select('*').order('start_at', { ascending: false }).order('id', { ascending: true }), 'time entries'),
      this._pageAll(() => this.supabase.from('notifications').select('*').eq('member_id', this.currentUser).order('created_at', { ascending: false }).order('id', { ascending: true }), 'notifications'),
      this.supabase.from('active_timers').select('*'),
      (App.can('roles.manage') || App.can('team.view'))
        ? this.supabase.from('profiles').select(this._profileColumns).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    this._throwIfError(timersRes, 'active timers');
    this._throwIfError(profilesRes, 'profiles');

    this._taskVersions = {};
    const tasks = taskRows.map(row => {
      this._taskVersions[row.id] = row.updated_at;
      return this._mapTaskRow(row);
    });

    return {
      people: this._mapPeople(peopleRows),
      profiles: profilesRes.data || [],
      tasks,
      timeEntries: entryRows.map(row => ({
        id: row.id,
        userId: row.user_id,
        taskId: row.task_id,
        start: Date.parse(row.start_at),
        end: Date.parse(row.end_at),
        durationMs: Number(row.duration_ms || 0),
        note: row.note || '',
      })),
      activeTimers: Object.fromEntries((timersRes.data || []).map(row => [
        row.user_id,
        {
          taskId: row.task_id,
          startedAt: Date.parse(row.started_at),
          taskTitle: row.task_title || null,
          taskCompany: row.task_company || null,
        },
      ])),
      notifications: notificationRows.map(row => this._mapNotificationRow(row)),
    };
  }

  /* Tasks-only refresh for the background sync poll. Mirrors the tasks query in
     load(). The optimistic-lock version map (_taskVersions) is advanced to the
     server's latest for every task EXCEPT those the caller flags as dirty: a
     dirty task has an unsaved local edit whose pending save must still lock
     against the version that edit was based on, so refreshing it here would mask
     a genuine concurrent-edit conflict. RLS scopes the rows as on initial load. */
  async loadTasks(skipVersionIds) {
    // Paged so the poll re-pull isn't truncated once the tasks table grows past
    // the PostgREST max-rows cap. Secondary .order('id') keeps paging stable.
    const rows = await this._pageAll(
      () => this.supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      'tasks',
    );
    return rows.map(row => {
      if (!skipVersionIds || !skipVersionIds.has(row.id)) {
        this._taskVersions[row.id] = row.updated_at;
      }
      return this._mapTaskRow(row);
    });
  }

  /* ---------- save (non-destructive: upserts + deltas) ----------
     `tasks` and `timeEntries` are the CHANGED subset (the models track what's
     dirty). Nothing is deleted-and-reinserted; the only deletes are clearing
     the current user's own single active-timer row on clock-out.
     Returns { conflicts } — tasks the server had a newer version of. */
  async save({ tasks, timeEntries, activeTimers, notifications }) {
    const conflicts = [];
    if (App.can('tasks.write') && tasks && tasks.length) {
      const c = await this._saveTasks(tasks);
      conflicts.push(...c);
    }
    await this._upsertTimeEntries(timeEntries || []);
    await this._syncActiveTimer(activeTimers || {});
    await this._upsertNotifications(notifications || []);
    return { conflicts };
  }

  async _saveTasks(tasks) {
    const conflicts = [];
    for (const task of tasks) {
      const row = this._taskRow(task);
      const known = this._taskVersions[task.id];
      if (known) {
        // Optimistic lock: only update if the row hasn't changed since we read it.
        const res = await this.supabase
          .from('tasks')
          .update(row)
          .eq('id', task.id)
          .eq('updated_at', known)
          .select('updated_at')
          .maybeSingle();
        this._throwIfError(res, 'saving task');
        if (!res.data) {
          // Optimistic-lock conflict: the server row changed under us. Do NOT
          // wholesale-replace the local task with the server copy — that discards
          // the local edit we were trying to save (e.g. a clearDoneTasks
          // `clearedAt` would be reverted to the server's null and lost).
          // Instead FIELD-MERGE: server row is the base, then re-apply the
          // locally-edited fields on top. We advance the known version to the
          // server's updated_at so the single-flight retry's next save passes the
          // lock (the merged task stays dirty upstream → it WILL be retried).
          // This converges: each retry carries the latest server updated_at, so
          // it can't loop on the same stale-version conflict.
          const fresh = await this._refetchTask(task.id);
          if (fresh) {
            this._taskVersions[fresh.row.id] = fresh.updatedAt;
            const mergedTask = this._mergeConflict(fresh.task, task);
            // Flag so app.js re-marks it dirty (instead of clearing it) and lets
            // the coalescing save retry write the merged result.
            mergedTask._conflictMerged = true;
            conflicts.push(mergedTask);
          }
        } else {
          this._taskVersions[task.id] = res.data.updated_at;
        }
      } else {
        const res = await this.supabase
          .from('tasks')
          .insert(row)
          .select('updated_at')
          .single();
        this._throwIfError(res, 'creating task');
        this._taskVersions[task.id] = res.data.updated_at;
      }
    }
    return conflicts;
  }

  async _refetchTask(id) {
    const res = await this.supabase.from('tasks').select('*').eq('id', id).maybeSingle();
    if (res.error || !res.data) return null;
    return { updatedAt: res.data.updated_at, row: res.data, task: this._mapTaskRow(res.data) };
  }

  /* Field-merge for an optimistic-lock conflict (fix #4).
     `serverTask` is the freshly-refetched authoritative row (mapped to camel);
     `localTask` is the in-memory copy whose save just lost the lock — i.e. the
     user's intended edits. We have only whole-task dirty tracking, so every
     editable field on localTask is treated as locally-dirty and re-applied on
     top of the server base. Server-owned metadata that the client never edits
     (id, createdAt) is taken from the server row. The result is the local edits
     preserved while inheriting any server-only fields the local copy lacks.
     Returns a NEW object so the caller can decide how to splice it in. */
  _mergeConflict(serverTask, localTask) {
    // List of fields the UI can edit and the save writes back (see _taskRow).
    // These are re-applied from the local copy so the conflicting save isn't
    // silently dropped. Everything else (id, createdAt, …) comes from the server.
    const EDITABLE = [
      'title', 'description', 'type', 'label', 'bidStatus', 'company', 'creator',
      'assignee', 'project', 'due', 'dueTime', 'reminderAt', 'priority', 'status',
      'watchers', 'subtasks', 'activity', 'clearedAt', 'completedAt', 'focusSeq',
    ];
    const merged = { ...serverTask };
    for (const f of EDITABLE) {
      if (Object.prototype.hasOwnProperty.call(localTask, f)) merged[f] = localTask[f];
    }
    return merged;
  }

  _taskRow(task) {
    return {
      id: task.id,
      title: task.title,
      description: task.description || '',
      type: task.type || 'admin',
      // The app uses the 'none' sentinel for "No label", but the DB
      // tasks_label_check constraint only allows NULL or a real label
      // ('roof'/'roof_framing'/'framing'). Map 'none' → NULL so picking
      // "No label" doesn't trip the constraint and silently fail the save.
      label: (task.label && task.label !== 'none') ? task.label : null,
      bid_status: task.type === 'bid' ? (task.bidStatus || 'queue') : null,
      company_id: task.company,
      creator_id: task.creator,
      assignee_id: task.assignee,
      project_id: task.project || null,
      due: task.due,
      due_time: task.dueTime || null,
      reminder_at: task.reminderAt || null,
      priority: task.priority || 'medium',
      urgency: task.priority || 'medium',
      status: task.status || 'todo',
      watchers: task.watchers || [],
      subtasks: task.subtasks || [],
      activity: task.activity || [],
      cleared_at: task.clearedAt || null,
      completed_at: task.completedAt || null,
      focus_seq: (task.focusSeq === null || task.focusSeq === undefined) ? null : task.focusSeq,
    };
  }

  /* Hard-delete a single task on demand. RLS gates this to the same
     roles allowed by migration 017's "role users can delete tasks"
     policy (admin / construction_supervisor / developer / supervisor /
     sales). All child rows hanging off task_id (time_entries,
     active_timers, notifications) cascade-delete via the schema FKs. */
  async deleteTask(id) {
    if (!id) return;
    const res = await this.supabase.from('tasks').delete().eq('id', id);
    this._throwIfError(res, 'deleting task');
    delete this._taskVersions[id];
  }

  /* Hard-delete tasks whose cleared_at is older than the grace window.
     Runs on app boot (best-effort); RLS gates this to the same roles
     allowed by migration 017's "role users can delete tasks" policy.
     Returns the number of rows removed, or 0 if RLS blocked or nothing
     was due. Never throws — a network blip on boot shouldn't break login. */
  async purgeExpiredClearedTasks({ graceDays = 30 } = {}) {
    try {
      const cutoff = new Date(Date.now() - graceDays * 24 * 60 * 60 * 1000).toISOString();
      const res = await this.supabase
        .from('tasks')
        .delete()
        .lt('cleared_at', cutoff)
        .select('id');
      if (res.error) {
        console.warn('[datastore] purge cleared tasks failed', res.error);
        return 0;
      }
      return (res.data || []).length;
    } catch (err) {
      console.warn('[datastore] purge cleared tasks threw', err);
      return 0;
    }
  }

  async _upsertTimeEntries(entries) {
    const rows = entries
      .filter(entry => entry.userId === this.currentUser)
      .map(entry => ({
        id: entry.id,
        user_id: entry.userId,
        task_id: entry.taskId,
        start_at: new Date(entry.start).toISOString(),
        end_at: new Date(entry.end).toISOString(),
        duration_ms: Math.max(0, Math.round(entry.durationMs || 0)),
        note: entry.note || '',
      }));
    if (!rows.length) return;
    const res = await this.supabase.from('time_entries').upsert(rows, { onConflict: 'id' });
    this._throwIfError(res, 'saving time entries');
  }

  async _syncActiveTimer(activeTimers) {
    const mine = activeTimers[this.currentUser];
    if (mine) {
      const res = await this.supabase.from('active_timers').upsert([{
        user_id: this.currentUser,
        task_id: mine.taskId,
        started_at: new Date(mine.startedAt).toISOString(),
        task_title: mine.taskTitle || null,
        task_company: mine.taskCompany || null,
      }], { onConflict: 'user_id' });
      this._throwIfError(res, 'saving active timer');
    } else {
      const res = await this.supabase.from('active_timers').delete().eq('user_id', this.currentUser);
      this._throwIfError(res, 'clearing active timer');
    }
  }

  async _upsertNotifications(notifications) {
    const rows = (notifications || []).map(notification => ({
      id: notification.id,
      member_id: this.currentUser,
      task_id: notification.taskId || null,
      meta: notification.meta || '',
      html: notification.html || '',
      read: !!notification.read,
    }));
    if (!rows.length) return;
    const res = await this.supabase.from('notifications').upsert(rows, { onConflict: 'id' });
    this._throwIfError(res, 'saving notifications');
  }

  /* Deliver in-app notifications to OTHER members (assignees, watchers).
     RLS lets sales/supervisor/admin/construction_supervisor insert rows for any
     member_id, so recipients see them in their own inbox on next load/poll. */
  async sendNotifications(recipients) {
    const rows = (recipients || [])
      .filter(r => r && r.memberId && r.memberId !== this.currentUser)
      .map(r => ({
        id: App.utils.uid('n'),
        member_id: r.memberId,
        task_id: r.taskId || null,
        meta: r.meta || '',
        html: r.html || '',
        read: false,
      }));
    if (!rows.length) return;
    let res = await this.supabase.from('notifications').insert(rows);
    // notifications.task_id is a FK to tasks.id, but it's only a deep-link —
    // the message in `html` stands on its own. If the task isn't persisted
    // (a just-created task still mid-save, or one already deleted) the insert
    // trips notifications_task_id_fkey and the whole statement rolls back. Re-
    // try once with task_id cleared so the recipient still gets the alert
    // rather than losing it to a transient/edge condition.
    if (this._isTaskFkViolation(res.error) && rows.some(row => row.task_id)) {
      res = await this.supabase
        .from('notifications')
        .insert(rows.map(row => ({ ...row, task_id: null })));
    }
    this._throwIfError(res, 'sending notifications');
  }

  // True only for a foreign-key violation (23503) on the task_id FK — so we
  // retry by dropping the deep-link, not for an unrelated FK (e.g. member_id),
  // where a null task_id wouldn't help and the error should surface.
  _isTaskFkViolation(error) {
    if (!error || error.code !== '23503') return false;
    const msg = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
    return msg.includes('task_id');
  }

  /* Best-effort email via the `notify-email` Edge Function. Returns
     { ok, skipped?, error? } and never throws, so a missing/undeployed function
     degrades gracefully to in-app only. */
  async sendEmail({ to, subject, html }) {
    const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
    if (!recipients.length) return { ok: false, skipped: true };
    try {
      const { data, error } = await this.supabase.functions.invoke('notify-email', {
        body: { to: recipients, subject, html },
      });
      if (error) return { ok: false, error: (error && error.message) || String(error) };
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }

  async updateProfileAccess(profileId, updates) {
    const patch = {
      role: updates.role,
      approved: !!updates.approved,
    };
    // supervisorId / companyIds are optional; only set them when provided.
    if ('supervisorId' in updates) patch.supervisor_id = updates.supervisorId || null;
    if ('companyIds' in updates) patch.company_ids = Array.isArray(updates.companyIds) ? updates.companyIds : [];
    const res = await this.supabase
      .from('profiles')
      .update(patch)
      .eq('id', profileId)
      .select(this._profileColumns)
      .single();
    this._throwIfError(res, 'updating profile access');
    return res.data;
  }

  /* Remove a user's access by hard-deleting their profile row, then prune
     their team_members row so they also drop out of the assignee picker
     (App.PEOPLE). RLS gates the profile delete to managers (migration 024's
     "managers can delete profiles" policy) and forbids deleting your own.

     The team_members delete is best-effort: the member-side FKs on tasks /
     time_entries are ON DELETE RESTRICT, so if the person is still load-
     bearing for real data the delete fails — we swallow that and keep the
     row so their name still renders on historical tasks. Only truly
     orphaned members (no remaining references) actually get removed, which
     mirrors the prune in migration 025. With no profile the account is
     treated as unapproved and gated out of the app (AuthModel.isApproved). */
  /* Fully delete a user. Prefers the delete-user Edge Function, which also
     removes the Auth login (freeing the email for re-registration) using the
     service role. Falls back to a profile-only delete if the function isn't
     deployed yet, so the button still revokes access in the meantime.
     Returns { emailFreed: boolean }. */
  async deleteProfile(profileId, memberId) {
    if (!profileId) return { emailFreed: false };

    try {
      const { data, error } = await this.supabase.functions.invoke('delete-user', {
        body: { profileId, memberId: memberId || null },
      });
      if (error) throw error;
      if (data && data.ok) return { emailFreed: data.emailFreed !== false };
      throw new Error((data && data.error) || 'delete-user did not confirm success');
    } catch (err) {
      // Function unavailable (not deployed) or errored — fall back to removing
      // the profile directly so access is still revoked. The email stays
      // reserved until the function is deployed.
      console.warn('[datastore] delete-user function unavailable; profile-only fallback:', err && err.message);
      const res = await this.supabase.from('profiles').delete().eq('id', profileId);
      this._throwIfError(res, 'deleting profile');
      if (memberId) {
        const memberRes = await this.supabase.from('team_members').delete().eq('id', memberId);
        if (memberRes && memberRes.error) {
          console.warn('[datastore] team_member kept (still referenced or blocked):', memberRes.error.message);
        }
      }
      return { emailFreed: false };
    }
  }

  /* Create a brand-new user (admin-created account). Invokes the create-user
     Edge Function, which makes the Auth login (the browser can't), approves the
     profile with the chosen role/company/supervisor, and emails the person their
     default password. Returns { ok, profileId, memberId, emailSent }. Throws an
     Error carrying the function's message on failure (e.g. duplicate email). */
  async createUser({ fullName, email, role, companyIds, supervisorId }) {
    const { data, error } = await this.supabase.functions.invoke('create-user', {
      body: {
        fullName,
        email,
        role,
        companyIds: Array.isArray(companyIds) ? companyIds : [],
        supervisorId: supervisorId || null,
      },
    });
    if (error) {
      // Supabase wraps a non-2xx as `error`; the JSON body (with our message)
      // is on error.context. Surface the function's message when we can read it.
      let message = error.message || 'Could not add the person.';
      try {
        const body = await error.context?.json?.();
        if (body && body.error) message = body.error;
      } catch { /* fall back to error.message */ }
      throw new Error(message);
    }
    if (!data || !data.ok) throw new Error((data && data.error) || 'Could not add the person.');
    return data;
  }

  _mapTaskRow(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      type: row.type || 'admin',
      // DB stores NULL for "no label"; the app uses the 'none' sentinel
      // everywhere (display + the picker), so normalise on the way in.
      label: row.label || 'none',
      bidStatus: row.bid_status || null,
      company: row.company_id,
      creator: row.creator_id,
      assignee: row.assignee_id,
      due: row.due,
      dueTime: row.due_time || null,
      reminderAt: row.reminder_at || null,
      priority: row.priority || row.urgency || 'medium',
      status: row.status,
      project: row.project_id || null,
      watchers: Array.isArray(row.watchers) ? row.watchers : [],
      subtasks: Array.isArray(row.subtasks) ? row.subtasks : [],
      activity: Array.isArray(row.activity) ? row.activity : [],
      clearedAt: row.cleared_at || null,
      createdAt: row.created_at || null,
      completedAt: row.completed_at || null,
      // Focus list (execution order) sort-key. null = not in the assignee's Focus.
      focusSeq: (row.focus_seq === null || row.focus_seq === undefined) ? null : Number(row.focus_seq),
    };
  }

  _mapNotificationRow(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      meta: row.meta,
      html: row.html,
      read: !!row.read,
      createdAt: row.created_at || null,
    };
  }

  _mapPeople(rows) {
    return rows.reduce((acc, row) => {
      acc[row.id] = {
        id: row.id,
        name: row.name || row.full_name || row.email || row.id,
        full: row.full_name || row.name || row.email || row.id,
        email: row.email || '',
        color: App.utils.safeColor(row.color),
        avatar_url: row.avatar_url || null,
        // Companies this member belongs to (mirrored from profiles, migration 045).
        // Lets the assignee/watcher pickers stay company-scoped even for workers,
        // who can't read profiles and so build the picker straight from this roster.
        company_ids: Array.isArray(row.company_ids) ? row.company_ids : [],
        // Backed by an approved profile? Used to filter the assignee/watcher
        // picker for non-manager sessions, which can't read profiles directly
        // (migration 039). Absent column (pre-migration) -> treat as active.
        active: row.active !== false,
      };
      return acc;
    }, {});
  }

  _throwIfError(result, label) {
    if (result && result.error) {
      // Defensive: App.errors should always be loaded (errors.js precedes this
      // file in HTML script order), but fall back to a plain Error rather than
      // a TypeError if something's mis-wired.
      if (App.errors && App.errors.fromSupabase) {
        throw App.errors.fromSupabase(result.error, label);
      }
      throw new Error(`Supabase ${label} failed: ${result.error.message}`);
    }
  }
};
