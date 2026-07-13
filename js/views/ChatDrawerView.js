window.App = window.App || {};

/* ChatDrawerView — read-only "Ask your tasks" chat. Opens from a topbar button
   as a right-side drawer (bottom sheet on mobile). Builds a compact snapshot of
   the tasks the viewer can already see (controller.taskModel, RLS-scoped) and
   sends it with the question to the ai-assistant `chat` action. Conversation is
   in memory only; nothing is written to the DB. Degrades to an error bubble. */
App.ChatDrawerView = class ChatDrawerView {
  constructor({ controller, dataStore }) {
    this.controller = controller;
    this.dataStore = dataStore;
    this.el = null;
    this.messages = [];   // { role: 'user'|'assistant', content }
    this.busy = false;
    this.client = App.ChatClient ? new App.ChatClient({ dataStore }) : null;
  }

  toggle() { if (this.el) this.close(); else this.open(); }

  open() {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.className = 'chat-scrim';
    this.el.innerHTML = this.template();
    document.body.appendChild(this.el);
    // Next frame: add .open so the drawer transitions in from off-screen.
    requestAnimationFrame(() => { if (this.el) this.el.classList.add('open'); });
    this.bindEvents();
    this.renderMessages();
    setTimeout(() => { const i = document.getElementById('chat-input'); if (i) i.focus(); }, 60);
  }

  close() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    el.classList.remove('open');
    setTimeout(() => el.remove(), 220); // let the slide-out finish
  }

  template() {
    const chips = ["What's overdue?", 'What did I finish this week?', "Who's busiest right now?"];
    return `
      <div class="chat-drawer" data-stop role="dialog" aria-label="Ask your tasks">
        <div class="chat-head">
          <div class="chat-title"><i class="ti ti-sparkles" aria-hidden="true"></i> Ask your tasks</div>
          <button class="icon-btn" data-action="close" aria-label="Close chat"><i class="ti ti-x"></i></button>
        </div>
        <div class="chat-body" id="chat-body">
          <div class="chat-empty" id="chat-empty">
            <div class="chat-empty-title">Ask about your tasks</div>
            <div class="chat-empty-sub">Answers come only from what you can see. I can't change anything.</div>
            <div class="chat-chips">
              ${chips.map((c) => `<button type="button" class="chat-chip">${App.utils.escapeHtml(c)}</button>`).join('')}
            </div>
          </div>
        </div>
        <form class="chat-input-row" id="chat-form">
          <input type="text" id="chat-input" autocomplete="off" placeholder="Ask a question…" aria-label="Ask a question" />
          <button type="submit" class="icon-btn chat-send" aria-label="Send"><i class="ti ti-send"></i></button>
        </form>
      </div>`;
  }

  bindEvents() {
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
    this.el.querySelectorAll('[data-action="close"]').forEach((b) => b.addEventListener('click', () => this.close()));
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    const form = this.el.querySelector('#chat-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('chat-input');
      this.send(input ? input.value : '');
    });
    this.el.querySelectorAll('.chat-chip').forEach((chip) => {
      chip.addEventListener('click', () => this.send(chip.textContent));
    });
  }

  // Normalize the RLS-scoped task model into the snapshot item shape.
  _items() {
    const all = (this.controller.taskModel.all() || []).filter((t) => t && !t.clearedAt);
    return all.map((t) => ({
      title: t.title,
      company: (App.directory.company(t.company) || App.directory.companyFallback(t.company)).label,
      assignee: (App.directory.person(t.assignee) || App.directory.personFallback(t.assignee)).name,
      priority: t.priority,
      status: t.status,
      due: t.due,
      completedAt: t.completedAt,
      done: App.taxonomy.isDone(t),
    }));
  }

  async send(text) {
    const q = String(text || '').trim();
    if (!q || this.busy || !this.client) return;
    this.messages.push({ role: 'user', content: q });
    this.busy = true;
    const input = document.getElementById('chat-input');
    if (input) input.value = '';
    this.renderMessages();
    this.renderTyping(true);

    const today = App.utils.todayISO(0);
    const snap = App.ChatClient.buildSnapshot(this._items(), { today });
    const history = App.ChatClient.trimHistory(this.messages.slice(0, -1)); // exclude the just-sent question
    const { answer } = await this.client.ask({ question: q, history, tasks: snap.lines, today, truncated: snap.truncated });

    if (!this.el) return; // closed while in flight
    this.renderTyping(false);
    this.busy = false;
    this.messages.push({ role: 'assistant', content: answer || "I couldn't answer that right now. Please try again." });
    this.renderMessages();
  }

  renderMessages() {
    const body = document.getElementById('chat-body');
    if (!body) return;
    const empty = document.getElementById('chat-empty');
    if (empty) empty.style.display = this.messages.length ? 'none' : '';
    body.querySelectorAll('.chat-msg').forEach((n) => n.remove());
    for (const m of this.messages) {
      const div = document.createElement('div');
      div.className = 'chat-msg ' + (m.role === 'user' ? 'chat-msg-user' : 'chat-msg-ai');
      div.textContent = m.content; // textContent: never render model/user text as HTML
      body.appendChild(div);
    }
    body.scrollTop = body.scrollHeight;
  }

  renderTyping(on) {
    const body = document.getElementById('chat-body');
    if (!body) return;
    const existing = body.querySelector('.chat-typing');
    if (on) {
      if (existing) return;
      const div = document.createElement('div');
      div.className = 'chat-msg chat-msg-ai chat-typing';
      div.innerHTML = '<span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span>';
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
    } else if (existing) {
      existing.remove();
    }
  }
};
