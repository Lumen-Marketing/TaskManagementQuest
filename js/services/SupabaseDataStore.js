window.App = window.App || {};

App.SupabaseDataStore = class SupabaseDataStore {
  constructor({ supabase, currentUser, role }) {
    if (!supabase) throw new Error('Supabase client is required.');
    this.supabase = supabase;
    this.currentUser = currentUser;
    this.role = role || 'member';
  }

  async load() {
    const [
      peopleRes,
      tasksRes,
      watchersRes,
      subtasksRes,
      activityRes,
      entriesRes,
      timersRes,
      notificationsRes,
      profilesRes,
    ] = await Promise.all([
      this.supabase.from('team_members').select('*').order('name', { ascending: true }),
      this.supabase.from('tasks').select('*').order('created_at', { ascending: true }),
      this.supabase.from('task_watchers').select('*'),
      this.supabase.from('task_subtasks').select('*').order('sort_order', { ascending: true }),
      this.supabase.from('task_activity').select('*').order('created_at', { ascending: false }),
      this.supabase.from('time_entries').select('*').order('start_at', { ascending: false }),
      this.supabase.from('active_timers').select('*'),
      this.supabase.from('notifications').select('*').eq('member_id', this.currentUser).order('created_at', { ascending: false }),
      App.can('roles.manage')
        ? this.supabase.from('profiles').select('id, email, full_name, approved, role, email_verified, member_id, created_at').order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    this._throwIfError(peopleRes, 'people');
    this._throwIfError(tasksRes, 'tasks');
    this._throwIfError(watchersRes, 'task watchers');
    this._throwIfError(subtasksRes, 'subtasks');
    this._throwIfError(activityRes, 'activity');
    this._throwIfError(entriesRes, 'time entries');
    this._throwIfError(timersRes, 'active timers');
    this._throwIfError(notificationsRes, 'notifications');
    this._throwIfError(profilesRes, 'profiles');

    const watchersByTask = this._group(watchersRes.data || [], 'task_id');
    const subtasksByTask = this._group(subtasksRes.data || [], 'task_id');
    const activityByTask = this._group(activityRes.data || [], 'task_id');

    return {
      people: this._mapPeople(peopleRes.data || []),
      profiles: profilesRes.data || [],
      tasks: (tasksRes.data || []).map(row => ({
        id: row.id,
        title: row.title,
        description: row.description || '',
        company: row.company_id,
        creator: row.creator_id,
        assignee: row.assignee_id,
        due: row.due,
        priority: row.priority,
        urgency: row.urgency,
        status: row.status,
        project: row.project_id || null,
        watchers: (watchersByTask[row.id] || []).map(w => w.member_id),
        subtasks: this._jsonArray(row.subtasks, (subtasksByTask[row.id] || []).map(s => ({ t: s.body, d: !!s.done }))),
        activity: this._jsonArray(row.activity, (activityByTask[row.id] || []).map(a => ({ who: a.who, what: a.what, when: a.when_label }))),
      })),
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
      notifications: (notificationsRes.data || []).map(row => ({
        id: row.id,
        taskId: row.task_id,
        meta: row.meta,
        html: row.html,
        read: !!row.read,
      })),
    };
  }

  async save({ tasks, timeEntries, activeTimers, notifications }) {
    if (App.can('tasks.write')) {
      await this._upsertTasks(tasks || []);
      await this._replaceTaskChildren(tasks || []);
    }
    await this._replaceTimeEntries(timeEntries || []);
    await this._replaceActiveTimers(activeTimers || {});
    await this._replaceNotifications(notifications || []);
  }

  async _upsertTasks(tasks) {
    if (!tasks.length) return;
    const rows = tasks.map(task => ({
      id: task.id,
      title: task.title,
      description: task.description || '',
      company_id: task.company,
      creator_id: task.creator,
      assignee_id: task.assignee,
      project_id: task.project || null,
      due: task.due,
      priority: task.priority || 'medium',
      urgency: task.urgency || 'medium',
      status: task.status || 'todo',
      subtasks: task.subtasks || [],
      activity: task.activity || [],
    }));
    const res = await this.supabase.from('tasks').upsert(rows, { onConflict: 'id' });
    this._throwIfError(res, 'saving tasks');
  }

  async _replaceTaskChildren(tasks) {
    const taskIds = tasks.map(task => task.id);
    if (!taskIds.length) return;

    await this._deleteIn('task_watchers', 'task_id', taskIds, 'clearing task watchers');
    await this._deleteIn('task_subtasks', 'task_id', taskIds, 'clearing subtasks');
    await this._deleteIn('task_activity', 'task_id', taskIds, 'clearing activity');

    const watchers = [];
    const subtasks = [];
    const activity = [];

    tasks.forEach(task => {
      (task.watchers || []).forEach(memberId => watchers.push({ task_id: task.id, member_id: memberId }));
      (task.subtasks || []).forEach((subtask, index) => {
        subtasks.push({ task_id: task.id, body: subtask.t || '', done: !!subtask.d, sort_order: index });
      });
      (task.activity || []).forEach(entry => {
        activity.push({
          task_id: task.id,
          who: entry.who || 'Unknown',
          what: entry.what || '',
          when_label: entry.when || 'just now',
        });
      });
    });

    await this._insertIfAny('task_watchers', watchers, 'saving task watchers');
    await this._insertIfAny('task_subtasks', subtasks, 'saving subtasks');
    await this._insertIfAny('task_activity', activity, 'saving activity');
  }

  async _replaceTimeEntries(entries) {
    const clearRes = await this.supabase.from('time_entries').delete().eq('user_id', this.currentUser);
    this._throwIfError(clearRes, 'clearing your time entries');
    const rows = entries.filter(entry => entry.userId === this.currentUser).map(entry => ({
      id: entry.id,
      user_id: entry.userId,
      task_id: entry.taskId,
      start_at: new Date(entry.start).toISOString(),
      end_at: new Date(entry.end).toISOString(),
      duration_ms: Math.max(0, Math.round(entry.durationMs || 0)),
      note: entry.note || '',
    }));
    await this._insertIfAny('time_entries', rows, 'saving time entries');
  }

  async _replaceActiveTimers(activeTimers) {
    const clearRes = await this.supabase.from('active_timers').delete().eq('user_id', this.currentUser);
    this._throwIfError(clearRes, 'clearing your active timer');
    const rows = Object.entries(activeTimers).filter(([userId]) => userId === this.currentUser).map(([userId, timer]) => ({
      user_id: userId,
      task_id: timer.taskId,
      started_at: new Date(timer.startedAt).toISOString(),
    }));
    await this._insertIfAny('active_timers', rows, 'saving active timers');
  }

  async _replaceNotifications(notifications) {
    const clearRes = await this.supabase.from('notifications').delete().eq('member_id', this.currentUser);
    this._throwIfError(clearRes, 'clearing notifications');
    const rows = notifications.map(notification => ({
      id: notification.id,
      member_id: this.currentUser,
      task_id: notification.taskId || null,
      meta: notification.meta || '',
      html: notification.html || '',
      read: !!notification.read,
    }));
    await this._insertIfAny('notifications', rows, 'saving notifications');
  }

  async _deleteIn(table, column, values, label) {
    if (!values.length) return;
    const res = await this.supabase.from(table).delete().in(column, values);
    this._throwIfError(res, label);
  }

  async _insertIfAny(table, rows, label) {
    if (!rows.length) return;
    const res = await this.supabase.from(table).insert(rows);
    this._throwIfError(res, label);
  }

  async updateProfileAccess(profileId, updates) {
    const res = await this.supabase
      .from('profiles')
      .update({
        role: updates.role,
        approved: !!updates.approved,
      })
      .eq('id', profileId)
      .select('id, email, full_name, approved, role, email_verified, member_id, created_at')
      .single();
    this._throwIfError(res, 'updating profile access');
    return res.data;
  }

  _group(rows, key) {
    return rows.reduce((acc, row) => {
      const value = row[key];
      acc[value] = acc[value] || [];
      acc[value].push(row);
      return acc;
    }, {});
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

  _jsonArray(value, fallback) {
    return Array.isArray(value) ? value : fallback;
  }

  _throwIfError(result, label) {
    if (result && result.error) {
      throw new Error(`Supabase ${label} failed: ${result.error.message}`);
    }
  }
};
