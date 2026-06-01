window.App = window.App || {};

App.AuthController = class AuthController {
  constructor({ authModel, appUrl, emailRedirect }) {
    this.authModel = authModel;
    this.appUrl = appUrl;
    this.emailRedirect = emailRedirect || appUrl;
  }

  async signIn(email, password, captchaToken) {
    try {
      const cleanEmail = App.validate.email(email);
      const cleanPw = App.validate.password(password);
      await this.authModel.signInWithPassword(cleanEmail, cleanPw, captchaToken);
    } catch (err) {
      App.EventBus.emit('auth:error', this._friendly(err));
    }
  }

  async signUp(email, password, fullName, captchaToken) {
    try {
      const cleanName = App.validate.displayName(fullName);
      const cleanEmail = App.validate.email(email);
      const cleanPw = App.validate.password(password);
      const data = await this.authModel.signUpWithPassword(cleanEmail, cleanPw, this.emailRedirect, cleanName, captchaToken);
      if (data && data.session) {
        App.EventBus.emit('auth:info', 'Account created. Continuing to Quest HQ.');
        window.setTimeout(() => this.goToApp(), 300);
      } else {
        App.EventBus.emit('auth:info', 'Account created, but Supabase still requires email confirmation. Turn off Confirm email in Auth > Providers > Email for demo signups.');
      }
    } catch (err) {
      App.EventBus.emit('auth:error', this._friendly(err));
    }
  }

  async sendMagicLink(email, captchaToken) {
    try {
      const cleanEmail = App.validate.email(email);
      await this.authModel.sendMagicLink(cleanEmail, this.emailRedirect, captchaToken);
      App.EventBus.emit('auth:info', `Magic link sent to ${cleanEmail}. Check your inbox.`);
    } catch (err) {
      App.EventBus.emit('auth:error', this._friendly(err));
    }
  }

  async signOut() {
    try {
      await this.authModel.signOut();
    } catch (err) {
      App.EventBus.emit('auth:error', this._friendly(err));
    }
  }

  goToApp() {
    window.location.href = this.appUrl;
  }

  /* Map any error (typed AppError, raw Supabase auth error, fetch failure)
     to a single safe string for the auth UI. Never leak stack traces. */
  _friendly(err) {
    const errors = App.errors;
    // Send anything that isn't a user-input error to observability. Validation
    // errors are noise (users mis-typing emails) — skip those. The rest
    // (network, timeout, auth failures, unexpected throws) are signal.
    if (App.observability && !(errors && err instanceof errors.ValidationError)) {
      App.observability.captureException(err, { source: 'auth-controller' });
    }
    if (errors) {
      if (err instanceof errors.ValidationError) return err.message;
      if (err instanceof errors.TimeoutError) return 'The server took too long to respond. Try again.';
      if (err instanceof errors.NetworkError) return 'Network unreachable. Check your connection.';
      if (err instanceof errors.PermissionError) return err.message;
    }
    const msg = (err && err.message) || 'Something went wrong';
    if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/user already registered/i.test(msg)) return 'That email is already registered - try signing in.';
    if (/email signups are disabled|email provider disabled/i.test(msg)) return 'Supabase Email provider is disabled. Enable Auth > Providers > Email, then turn Confirm email off for demo signups.';
    if (/email logins are disabled/i.test(msg)) return 'Supabase Email login is disabled. Enable Auth > Providers > Email.';
    if (/failed to fetch|networkerror|fetch failed/i.test(msg)) return 'Network unreachable. Check your connection.';
    if (/timeout|aborted/i.test(msg)) return 'The server took too long to respond. Try again.';
    return msg;
  }
};
