window.App = window.App || {};

App.AuthController = class AuthController {
  constructor({ authModel, appUrl, emailRedirect }) {
    this.authModel = authModel;
    this.appUrl = appUrl;
    this.emailRedirect = emailRedirect || appUrl;
  }

  async signInWithGoogle() {
    try {
      await this.authModel.signInWithGoogle(this.emailRedirect);
    } catch (err) {
      App.EventBus.emit('auth:error', this._friendly(err));
    }
  }

  async signIn(email, password) {
    try {
      await this.authModel.signInWithPassword(email, password);
    } catch (err) {
      App.EventBus.emit('auth:error', this._friendly(err));
    }
  }

  async signUp(email, password) {
    try {
      const data = await this.authModel.signUpWithPassword(email, password, this.emailRedirect);
      if (data && data.session) {
        App.EventBus.emit('auth:info', 'Account created. An admin must approve you before you can access the app.');
      } else {
        App.EventBus.emit('auth:info', 'Account created. Check your email to verify — then an admin must approve you.');
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
    if (/user already registered/i.test(msg)) return 'That email is already registered — try signing in.';
    return msg;
  }
};
