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

    this._turnstileWidgetId = null;
    this._pendingCaptcha = null;
    this._initTurnstile();

    this._bind();

    App.EventBus.on('auth:changed', (state) => this.render(state));
    App.EventBus.on('auth:error', (msg) => this.showError(msg));
    App.EventBus.on('auth:info', (msg) => this.showInfo(msg));
  }

  /* Render the invisible Turnstile widget once on page load, in 'execute'
     mode so the challenge only fires when we call turnstile.execute() on
     form submit. If no site key is configured (env.json.turnstileSiteKey
     empty), this is a no-op and the auth flow proceeds without a token. */
  _initTurnstile() {
    if (!App.turnstileSiteKey) return;

    const tryRender = () => {
      if (this._turnstileWidgetId !== null) return true;
      if (!window.turnstile || !window.turnstile.render) return false;
      try {
        this._turnstileWidgetId = window.turnstile.render('#turnstileMount', {
          sitekey: App.turnstileSiteKey,
          size: 'invisible',
          execution: 'execute',
          callback: (token) => {
            const pending = this._pendingCaptcha;
            this._pendingCaptcha = null;
            if (pending) pending.resolve(token);
          },
          'error-callback': () => {
            const pending = this._pendingCaptcha;
            this._pendingCaptcha = null;
            if (pending) pending.reject(new Error('Captcha verification failed. Try again.'));
          },
          'timeout-callback': () => {
            const pending = this._pendingCaptcha;
            this._pendingCaptcha = null;
            if (pending) pending.reject(new Error('Captcha timed out. Try again.'));
          },
        });
        return true;
      } catch (e) {
        console.warn('[captcha] render failed', e);
        return false;
      }
    };

    if (tryRender()) return;
    // The Turnstile api.js script is deferred; poll briefly until it's ready.
    let attempts = 0;
    const poll = () => {
      if (tryRender()) return;
      if (attempts++ > 60) {
        console.warn('[captcha] Turnstile API never became available.');
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  }

  /* Resolves to a fresh Turnstile token, or null if captcha is not configured.
     Throws if captcha IS configured but the widget can't produce a token —
     fail closed so a blocked CDN can't silently disable the protection. */
  async _getCaptchaToken() {
    if (!App.turnstileSiteKey) return null;
    if (!window.turnstile || this._turnstileWidgetId === null) {
      throw new Error('Captcha is unavailable. Refresh the page and try again.');
    }
    return new Promise((resolve, reject) => {
      if (this._pendingCaptcha) {
        this._pendingCaptcha.reject(new Error('Captcha cancelled.'));
      }
      this._pendingCaptcha = { resolve, reject };
      try {
        window.turnstile.reset(this._turnstileWidgetId);
        window.turnstile.execute(this._turnstileWidgetId);
      } catch (e) {
        this._pendingCaptcha = null;
        reject(e);
      }
    });
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
    this.pwForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this._clearMessages();
      const email = this.pwEmail.value.trim();
      const pw = this.pwPassword.value;
      if (!email || !pw) return this.showError('Enter your email and password.');
      let captchaToken;
      try { captchaToken = await this._getCaptchaToken(); }
      catch (err) { return this.showError(err.message || 'Captcha failed.'); }
      this.controller.signIn(email, pw, captchaToken);
    });

    // Sign in (magic link)
    this.magicForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this._clearMessages();
      const email = this.magicEmail.value.trim();
      if (!email) return this.showError('Enter your email.');
      let captchaToken;
      try { captchaToken = await this._getCaptchaToken(); }
      catch (err) { return this.showError(err.message || 'Captcha failed.'); }
      this.controller.sendMagicLink(email, captchaToken);
    });

    // Create account
    this.signUpMode.addEventListener('submit', async (e) => {
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
      let captchaToken;
      try { captchaToken = await this._getCaptchaToken(); }
      catch (err) { return this.showError(err.message || 'Captcha failed.'); }
      this.controller.signUp(email, pw, name, captchaToken);
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
        // Build the <img> via the DOM, not an innerHTML template. meta.avatar_url
        // comes from auth user_metadata, which the account owner can set to an
        // arbitrary string; interpolating it as `<img src="${url}">` lets a value
        // like `"><img src=x onerror=...>` execute on the LOGIN page (the auth
        // origin, where the session token lives). Setting img.src as a DOM
        // property is XSS-safe. Mirrors the pattern in auth-guard.js.
        const img = document.createElement('img');
        img.src = meta.avatar_url;
        img.alt = '';
        avatarEl.replaceChildren(img);
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
