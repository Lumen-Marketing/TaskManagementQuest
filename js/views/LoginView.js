window.App = window.App || {};

App.LoginView = class LoginView {
  constructor({ controller }) {
    this.controller = controller;
    this.signedInCard = document.getElementById('signedInCard');
    this.signedOutCard = document.getElementById('signedOutCard');
    this.pendingCard = document.getElementById('pendingCard');

    this.tabs = document.querySelectorAll('.auth-tab');
    this.googleBtn = document.getElementById('googleSignInBtn');
    this.pwForm = document.getElementById('pwForm');
    this.magicForm = document.getElementById('magicForm');
    this.panelPassword = this.pwForm;
    this.panelMagic = this.magicForm;
    this.pwEmail = document.getElementById('pwEmail');
    this.pwPassword = document.getElementById('pwPassword');
    this.pwSignUpBtn = document.getElementById('pwSignUpBtn');
    this.magicEmail = document.getElementById('magicEmail');

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
    if (this.googleBtn) {
      this.googleBtn.addEventListener('click', () => {
        this._clearMessages();
        this.controller.signInWithGoogle();
      });
    }

    this.tabs.forEach(tab => {
      tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
    });

    this.pwForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this._clearMessages();
      this.controller.signIn(this.pwEmail.value.trim(), this.pwPassword.value);
    });

    this.pwSignUpBtn.addEventListener('click', () => {
      this._clearMessages();
      const email = this.pwEmail.value.trim();
      const pw = this.pwPassword.value;
      if (!email || !pw) return this.showError('Enter an email and password to create an account.');
      if (pw.length < 6) return this.showError('Password must be at least 6 characters.');
      this.controller.signUp(email, pw);
    });

    this.magicForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this._clearMessages();
      const email = this.magicEmail.value.trim();
      if (!email) return this.showError('Enter your email.');
      this.controller.sendMagicLink(email);
    });

    this.signOutBtn.addEventListener('click', () => this.controller.signOut());
    this.pendingSignOutBtn.addEventListener('click', () => this.controller.signOut());
    this.refreshBtn.addEventListener('click', () => window.location.reload());
    this.continueBtn.addEventListener('click', () => this.controller.goToApp());
  }

  _switchTab(name) {
    this._clearMessages();
    this.tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    this.panelPassword.classList.toggle('hidden', name !== 'password');
    this.panelMagic.classList.toggle('hidden', name !== 'magic');
  }

  render({ user, profile } = {}) {
    this._clearMessages();

    // State 1: signed out
    if (!user) {
      this.signedOutCard.classList.remove('hidden');
      this.pendingCard.classList.add('hidden');
      this.signedInCard.classList.add('hidden');
      return;
    }

    const approved = !!(profile && profile.approved);

    // State 2: signed in but not approved
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

    // State 3: signed in and approved
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
