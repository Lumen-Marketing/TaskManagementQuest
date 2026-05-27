window.App = window.App || {};

App.AuthModel = class AuthModel {
  constructor() {
    this.user = null;
    this.session = null;
    this.profile = null;
    this._sb = App.supabase;
  }

  async init() {
    const { data } = await this._sb.auth.getSession();
    this.session = data.session || null;
    this.user = this.session ? this.session.user : null;
    if (this.user) await this._loadProfile();
    this._emit();

    this._sb.auth.onAuthStateChange(async (_event, session) => {
      this.session = session || null;
      this.user = session ? session.user : null;
      this.profile = null;
      if (this.user) await this._loadProfile();
      this._emit();
    });
  }

  async _loadProfile() {
    const { data, error } = await this._sb
      .from('profiles')
      .select('id, email, full_name, approved, role')
      .eq('id', this.user.id)
      .single();
    if (error) {
      console.warn('[AuthModel] profile load failed', error);
      this.profile = null;
      return;
    }
    this.profile = data;
  }

  _emit() {
    App.EventBus.emit('auth:changed', {
      user: this.user,
      session: this.session,
      profile: this.profile,
    });
  }

  async signInWithGoogle(redirectTo) {
    const { error } = await this._sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  }

  async signInWithPassword(email, password) {
    const { error } = await this._sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signUpWithPassword(email, password, redirectTo) {
    const { data, error } = await this._sb.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
    return data;
  }

  async sendMagicLink(email, redirectTo) {
    const { error } = await this._sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }

  async signOut() {
    const { error } = await this._sb.auth.signOut();
    if (error) throw error;
    this.user = null;
    this.session = null;
    this.profile = null;
    this._emit();
  }

  isAuthenticated() { return !!this.session; }
  isApproved() { return !!(this.profile && this.profile.approved); }
};
