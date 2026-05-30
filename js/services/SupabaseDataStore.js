window.App = window.App || {};

App.SupabaseDataStore = class SupabaseDataStore {
  constructor({ supabase, currentUser, role }) {
    if (!supabase) throw new Error('Supabase client is required.');
    this.supabase = supabase;
    this.currentUser = currentUser;
    this.role = role || 'member';
    this._profileColumns = 'id, email, full_name, approved, role, email_verified, member_id, supervisor_id, company_id, created_at';
    // Last-seen updated_at per task id — used as an optimistic-concurrency guard
    // so a save can't silently clobber an edit made elsewhere.
    this._taskVersions = {};
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
    const res = await this.supabase
      .from('notifications')
      .select('*')
      .eq('member_id', this.currentUser)
      .order('created_at', { ascending: false });
    this._throwIfError(res, 'notifications');
    return (res.data || []).map(row => this._mapNotificationRow(row));
  }

  async load() {
    const [
      peopleRes,
      tasksRes,
      entriesRes,
      timersRes,
      notificationsRes,
      profilesRes,
    ] = await Promise.all([
      this.supabase.from('team_members').select('*').order('name', { ascending: true }),
      this.supabase.from('tasks').select('*').order('created_at', { ascending: true }),
      this.supabase.from('time_entries').select('*').order('start_at', { ascending: false }),
      this.supabase.from('active_timers').select('*'),
      this.supabase.from('notifications').select('*').eq('member_id', this.currentUser).order('created_at', { ascending: false }),
      (App.can('roles.manage') || App.can('team.view'))
        ? this.supabase.from('profiles').select(this._profileColumns).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    this._throwIfError(peopleRes, 'people');
    this._throwIfError(tasksRes, 'tasks');
    this._throwIfError(entriesRes, 'time entries');
    this._throwIfError(timersRes, 'active timers');
    this._throwIfError(notificationsRes, 'notifications');
    this._throwIfError(profilesRes, 'profiles');

    this._taskVersions = {};
    const tasks = (tasksRes.data || []).map(row => {
      this._taskVersions[row.id] = row.updated_at;
      return this._mapTaskRow(row);
    });

    return {
      people: this._mapPeople(peopleRes.data || []),
      profiles: profilesRes.data || [],
      tasks,
      timeEntries: (entriesRes.data || []).map(row => ({
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
        { taskId: row.task_id, startedAt: Date.parse(row.started_at) },
      ])),
      notifications: (notificationsRes.data || []).map(row => this._mapNotificationRow(row)),
    };
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
          const fresh = await this._refetchTask(task.id);
          if (fresh) {
            this._taskVersions[fresh.row.id] = fresh.updatedAt;
            conflicts.push(fresh.task);
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

  _taskRow(task) {
    return {
      id: task.id,
      title: task.title,
      description: task.description || '',
      type: task.type || 'admin',
      bid_status: task.type === 'bid' ? (task.bidStatus || 'queue') : null,
      company_id: task.company,
      creator_id: task.creator,
      assignee_id: task.assignee,
      project_id: task.project || null,
      due: task.due,
      due_time: task.dueTime || null,
      priority: task.priority || 'medium',
      urgency: task.priority || 'medium',
      status: task.status || 'todo',
      watchers: task.watchers || [],
      subtasks: task.subtasks || [],
      activity: task.activity || [],
    };
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
    const res = await this.supabase.from('notifications').insert(rows);
    this._throwIfError(res, 'sending notifications');
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
    // supervisorId / companyId are optional; only set them when provided.
    if ('supervisorId' in updates) patch.supervisor_id = updates.supervisorId || null;
    if ('companyId' in updates) patch.company_id = updates.companyId || null;
    const res = await this.supabase
      .from('profiles')
      .update(patch)
      .eq('id', profileId)
      .select(this._profileColumns)
      .single();
    this._throwIfError(res, 'updating profile access');
    return res.data;
  }

  _mapTaskRow(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      type: row.type || 'admin',
      bidStatus: row.bid_status || null,
      company: row.company_id,
      creator: row.creator_id,
      assignee: row.assignee_id,
      due: row.due,
      dueTime: row.due_time || null,
      priority: row.priority || row.urgency || 'medium',
      status: row.status,
      project: row.project_id || null,
      watchers: Array.isArray(row.watchers) ? row.watchers : [],
      subtasks: Array.isArray(row.subtasks) ? row.subtasks : [],
      activity: Array.isArray(row.activity) ? row.activity : [],
    };
  }

  _mapNotificationRow(row) {
    return {
      id: row.id,
      taskId: row.task_id,
      meta: row.meta,
      html: row.html,
      read: !!row.read,
    };
  }

  _mapPeople(rows) {
    return rows.reduce((acc, row) => {
      acc[row.id] = {
        id: row.id,
        name: row.name || row.full_name || row.email || row.id,
        full: row.full_name || row.name || row.email || row.id,
        email: row.email || '',
        color: row.color || '#E8A03A',
      };
      return acc;
    }, {});
  }

  _throwIfError(result, label) {
    if (result && result.error) {
      throw new Error(`Supabase ${label} failed: ${result.error.message}`);
    }
  }
};
