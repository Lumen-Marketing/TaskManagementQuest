window.App = window.App || {};

App.LoginView = class LoginView {
  constructor({ controller }) {
    this.controller = controller;
    this.signedInCard = document.getElementById('signedInCard');
    this.signedOutCard = document.getElementById('signedOutCard');
    this.pendingCard = document.getElementById('pendingCard');

    this.titleEl = document.getElementById('authTitle');
    this.subEl = document.getElementById('authSub');

    // Top-level mode tabs (signin / signup)
    this.modeTabs = document.querySelectorAll('#modeTabs .auth-tab');
    this.signInMode = document.getElementById('signInMode');
    this.signUpMode = document.getElementById('signUpMode');

    // Sub-tabs inside sign-in (password / magic)
    this.subTabs = document.querySelectorAll('.auth-subtabs .auth-tab');
    this.pwForm = document.getElementById('pwForm');
    this.magicForm = document.getElementById('magicForm');
    this.pwEmail = document.getElementById('pwEmail');
    this.pwPassword = document.getElementById('pwPassword');
    this.magicEmail = document.getElementById('magicEmail');

    // Create-account form
    this.suName = document.getElementById('suName');
    this.suEmail = document.getElementById('suEmail');
    this.suPassword = document.getElementById('suPassword');
    this.suConfirm = document.getElementById('suConfirm');

    this.signOutBtn = document.getElementById('signOutBtn');
    this.pendingSignOutBtn = document.getElementById('pendingSignOutBtn');
    this.refreshBtn = document.getElementById('refreshStatusBtn');
    this.continueBtn = document.getElementById('continueAppBtn');

    this.userEmailEl = document.getElementById('userEmail');
    this.userNameEl = document.getElementById('userName');
    this.userAvatarEl = document.getElementById('userAvatar');

    this.pendingEmailEl = document.getElementById('pendingEmail');
    this.pendingNameEl = document.getElementById('pendingName');
    this.pendingAvatarEl = document.getElementById('pendingAvatar');

    this.errorEl = document.getElementById('authError');
    this.infoEl = document.getElementById('authInfo');

    this._bind();

    App.EventBus.on('auth:changed', (state) => this.render(state));
    App.EventBus.on('auth:error', (msg) => this.showError(msg));
    App.EventBus.on('auth:info', (msg) => this.showInfo(msg));
  }

  _bind() {
    // Top-level: switch between Sign in / Create account
    this.modeTabs.forEach(tab => {
      tab.addEventListener('click', () => this._switchMode(tab.dataset.mode));
    });

    // Sub-level: switch between Password / Magic link within Sign in
    this.subTabs.forEach(tab => {
      tab.addEventListener('click', () => this._switchSubTab(tab.dataset.tab));
    });

    // Sign in (password)
    this.pwForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this._clearMessages();
      const email = this.pwEmail.value.trim();
      const pw = this.pwPassword.value;
      if (!email || !pw) return this.showError('Enter your email and password.');
      this.controller.signIn(email, pw);
    });

    // Sign in (magic link)
    this.magicForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this._clearMessages();
      const email = this.magicEmail.value.trim();
      if (!email) return this.showError('Enter your email.');
      this.controller.sendMagicLink(email);
    });

    // Create account
    this.signUpMode.addEventListener('submit', (e) => {
      e.preventDefault();
      this._clearMessages();
      const name = this.suName.value.trim();
      const email = this.suEmail.value.trim();
      const pw = this.suPassword.value;
      const confirm = this.suConfirm.value;
      if (!name) return this.showError('Enter a display name.');
      if (!email || !pw) return this.showError('Enter an email and password.');
      if (pw.length < 6) return this.showError('Password must be at least 6 characters.');
      if (pw !== confirm) return this.showError('Passwords do not match.');
      this.controller.signUp(email, pw, name);
    });

    this.signOutBtn.addEventListener('click', () => this.controller.signOut());
    this.pendingSignOutBtn.addEventListener('click', () => this.controller.signOut());
    this.refreshBtn.addEventListener('click', () => window.location.reload());
    this.continueBtn.addEventListener('click', () => this.controller.goToApp());
  }

  _switchMode(name) {
    this._clearMessages();
    this.modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === name));
    const isSignIn = name === 'signin';
    this.signInMode.classList.toggle('hidden', !isSignIn);
    this.signUpMode.classList.toggle('hidden', isSignIn);
    if (this.titleEl && this.subEl) {
      if (isSignIn) {
        this.titleEl.textContent = 'Welcome back';
        this.subEl.textContent = 'Sign in to continue.';
      } else {
        this.titleEl.textContent = 'Create your account';
        this.subEl.textContent = 'Sign up to request access to Quest HQ.';
      }
    }
  }

  _switchSubTab(name) {
    this._clearMessages();
    this.subTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    this.pwForm.classList.toggle('hidden', name !== 'password');
    this.magicForm.classList.toggle('hidden', name !== 'magic');
  }

  render({ user, profile } = {}) {
    this._clearMessages();

    if (!user) {
      this.signedOutCard.classList.remove('hidden');
      this.pendingCard.classList.add('hidden');
      this.signedInCard.classList.add('hidden');
      return;
    }

    const approved = !!(profile && profile.approved);

    if (!approved) {
      this.signedOutCard.classList.add('hidden');
      this.signedInCard.classList.add('hidden');
      this.pendingCard.classList.remove('hidden');
      this._paintUser(user, profile, {
        emailEl: this.pendingEmailEl,
        nameEl: this.pendingNameEl,
        avatarEl: this.pendingAvatarEl,
      });
      return;
    }

    this.signedOutCard.classList.add('hidden');
    this.pendingCard.classList.add('hidden');
    this.signedInCard.classList.remove('hidden');
    this._paintUser(user, profile, {
      emailEl: this.userEmailEl,
      nameEl: this.userNameEl,
      avatarEl: this.userAvatarEl,
    });
  }

  _paintUser(user, profile, { emailEl, nameEl, avatarEl }) {
    const meta = user.user_metadata || {};
    const name = (profile && profile.full_name) || meta.full_name || meta.name || user.email || '';
    if (emailEl) emailEl.textContent = user.email || '';
    if (nameEl) nameEl.textContent = name;
    if (avatarEl) {
      if (meta.avatar_url) {
        avatarEl.innerHTML = `<img src="${meta.avatar_url}" alt="" />`;
      } else {
        const initial = (name || '?').trim().charAt(0).toUpperCase();
        avatarEl.textContent = initial;
      }
    }
  }

  showError(msg) {
    this.infoEl.classList.add('hidden');
    this.errorEl.textContent = msg;
    this.errorEl.classList.remove('hidden');
  }

  showInfo(msg) {
    this.errorEl.classList.add('hidden');
    this.infoEl.textContent = msg;
    this.infoEl.classList.remove('hidden');
  }

  _clearMessages() {
    this.errorEl.classList.add('hidden');
    this.infoEl.classList.add('hidden');
  }
};
