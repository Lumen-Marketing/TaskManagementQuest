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
    this.modeTabsEl = document.getElementById('modeTabs');
    this.modeTabs = document.querySelectorAll('#modeTabs .auth-tab');
    this.signInMode = document.getElementById('signInMode');
    this.signUpMode = document.getElementById('signUpMode');

    // Password-reset request ("Forgot password?") + set-new-password (recovery).
    this.forgotPwLink = document.getElementById('forgotPwLink');
    this.resetRequestMode = document.getElementById('resetRequestMode');
    this.resetEmail = document.getElementById('resetEmail');
    this.backToSignIn = document.getElementById('backToSignIn');
    this.resetCard = document.getElementById('resetCard');
    this.resetPasswordForm = document.getElementById('resetPasswordForm');
    this.newPassword = document.getElementById('newPassword');
    this.newPasswordConfirm = document.getElementById('newPasswordConfirm');
    this.resetBackToSignIn = document.getElementById('resetBackToSignIn');
    this.resetErrorEl = document.getElementById('resetError');
    this.resetInfoEl = document.getElementById('resetInfo');

    // True between arriving on a recovery link and finishing (or leaving) the
    // password reset. While set, render() always shows the reset card and
    // messages route to the reset card's own error/info bar.
    this.recovery = false;

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
    App.EventBus.on('auth:recovery', () => this._enterRecovery());
    App.EventBus.on('auth:recovery-done', () => this._exitRecovery());
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
      // Same strong-password policy as the change-password flow (App.validate.
      // strongPassword): >=8 chars with an uppercase letter, number, and symbol.
      try {
        App.validate.strongPassword(pw);
      } catch (err) {
        return this.showError((err && err.message) || 'Password does not meet the requirements.');
      }
      if (pw !== confirm) return this.showError('Passwords do not match.');
      let captchaToken;
      try { captchaToken = await this._getCaptchaToken(); }
      catch (err) { return this.showError(err.message || 'Captcha failed.'); }
      this.controller.signUp(email, pw, name, captchaToken);
    });

    // Forgot password → swap the sign-in area for the reset-request panel.
    this.forgotPwLink.addEventListener('click', () => this._showResetRequest());
    this.backToSignIn.addEventListener('click', () => this._exitResetRequest());

    // Reset request: email a recovery link.
    this.resetRequestMode.addEventListener('submit', async (e) => {
      e.preventDefault();
      this._clearMessages();
      const email = this.resetEmail.value.trim();
      if (!email) return this.showError('Enter your email.');
      let captchaToken;
      try { captchaToken = await this._getCaptchaToken(); }
      catch (err) { return this.showError(err.message || 'Captcha failed.'); }
      this.controller.sendPasswordReset(email, captchaToken);
    });

    // Set new password (recovery landing). No captcha — the recovery session
    // already proves possession of the emailed link.
    this.resetPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      this._clearMessages();
      const pw = this.newPassword.value;
      const confirm = this.newPasswordConfirm.value;
      if (!pw) return this.showError('Enter a new password.');
      try {
        App.validate.strongPassword(pw);
      } catch (err) {
        return this.showError((err && err.message) || 'Password does not meet the requirements.');
      }
      if (pw !== confirm) return this.showError('Passwords do not match.');
      this.controller.resetPassword(pw);
    });

    // Escape hatch from the reset card (e.g. an expired link) back to sign-in.
    this.resetBackToSignIn.addEventListener('click', () => {
      this._exitRecovery();
      this.render({});
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

  /* Show the "enter your email for a reset link" panel, hiding the sign-in /
     sign-up modes and the top-level tabs while it's up. */
  _showResetRequest() {
    this._clearMessages();
    this.modeTabs.forEach(t => t.classList.remove('active'));
    this.signInMode.classList.add('hidden');
    this.signUpMode.classList.add('hidden');
    if (this.modeTabsEl) this.modeTabsEl.classList.add('hidden');
    this.resetRequestMode.classList.remove('hidden');
    if (this.resetEmail) this.resetEmail.value = this.pwEmail ? this.pwEmail.value.trim() : '';
    if (this.titleEl) this.titleEl.textContent = 'Reset your password';
    if (this.subEl) this.subEl.textContent = 'Enter your email and we’ll send a reset link.';
  }

  /* Return from the reset-request panel to the normal sign-in view. */
  _exitResetRequest() {
    this.resetRequestMode.classList.add('hidden');
    if (this.modeTabsEl) this.modeTabsEl.classList.remove('hidden');
    this._switchMode('signin');
  }

  /* Arrived on a recovery link: lock the page to the set-new-password card
     until the reset completes (or the user navigates away). */
  _enterRecovery() {
    this.recovery = true;
    this.render({});
  }

  /* Reset finished: drop the recovery lock and strip the token from the URL so
     a refresh doesn't re-enter recovery. The subsequent sign-out's auth:changed
     re-renders the clean sign-in card. */
  _exitRecovery() {
    this.recovery = false;
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } else {
      window.location.hash = '';
    }
  }

  render({ user, profile } = {}) {
    this._clearMessages();

    // Recovery overrides everything: the emailed link signs the user in with a
    // temporary session, so without this they'd be routed to the app/pending
    // card instead of being asked to set a new password.
    if (this.recovery) {
      this.signedOutCard.classList.add('hidden');
      this.pendingCard.classList.add('hidden');
      this.signedInCard.classList.add('hidden');
      this.resetCard.classList.remove('hidden');
      return;
    }
    this.resetCard.classList.add('hidden');

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

  /* The set-new-password card has its own message bar; route there while it's
     the visible card so errors aren't stranded on the hidden sign-in card. */
  _msgEls() {
    return this.recovery
      ? { errorEl: this.resetErrorEl, infoEl: this.resetInfoEl }
      : { errorEl: this.errorEl, infoEl: this.infoEl };
  }

  showError(msg) {
    const { errorEl, infoEl } = this._msgEls();
    infoEl.classList.add('hidden');
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  }

  showInfo(msg) {
    const { errorEl, infoEl } = this._msgEls();
    errorEl.classList.add('hidden');
    infoEl.textContent = msg;
    infoEl.classList.remove('hidden');
  }

  _clearMessages() {
    this.errorEl.classList.add('hidden');
    this.infoEl.classList.add('hidden');
    if (this.resetErrorEl) this.resetErrorEl.classList.add('hidden');
    if (this.resetInfoEl) this.resetInfoEl.classList.add('hidden');
  }
};
