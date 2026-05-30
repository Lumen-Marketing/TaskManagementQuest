window.App = window.App || {};

App.AuthController = class AuthController {
  constructor({ authModel, appUrl, emailRedirect }) {
    this.authModel = authModel;
    this.appUrl = appUrl;
    this.emailRedirect = emailRedirect || appUrl;
  }

  async signIn(email, password) {
    try {
      await this.authModel.signInWithPassword(email, password);
    } catch (err) {
      App.EventBus.emit('auth:error', this._friendly(err));
    }
  }

  async signUp(email, password, fullName) {
    try {
      const data = await this.authModel.signUpWithPassword(email, password, this.emailRedirect, fullName);
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

  async sendMagicLink(email) {
    try {
      await this.authModel.sendMagicLink(email, this.emailRedirect);
      App.EventBus.emit('auth:info', `Magic link sent to ${email}. Check your inbox.`);
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

  _friendly(err) {
    const msg = (err && err.message) || 'Something went wrong';
    if (/invalid login credentials/i.test(msg)) return 'Wrong email or password.';
    if (/user already registered/i.test(msg)) return 'That email is already registered - try signing in.';
    if (/email signups are disabled|email provider disabled/i.test(msg)) return 'Supabase Email provider is disabled. Enable Auth > Providers > Email, then turn Confirm email off for demo signups.';
    if (/email logins are disabled/i.test(msg)) return 'Supabase Email login is disabled. Enable Auth > Providers > Email.';
    return msg;
  }
};
