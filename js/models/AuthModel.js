window.App = window.App || {};

App.AuthModel = class AuthModel {
  constructor() {
    this.user = null;
    this.session = null;
    this.profile = null;
    this._sb = App.supabase || null;
    this._loadError = App.supabaseLoadError || null;
  }

  _requireClient() {
    if (!this._sb || !this._sb.auth) {
      throw new Error(this._loadError || 'Auth service is not available. Refresh the page and try again.');
    }
  }

  async init() {
    if (!this._sb || !this._sb.auth) {
      App.EventBus.emit('auth:error', this._loadError || 'Auth service is not available. Refresh the page and try again.');
      this._emit();
      return;
    }

    try {
      const { data } = await this._sb.auth.getSession();
      this.session = data.session || null;
      this.user = this.session ? this.session.user : null;
      if (this.user) await this._loadProfile();
    } catch (err) {
      console.warn('[AuthModel] init failed', err);
    }
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
      .select('id, email, full_name, approved, role, email_verified, member_id')
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

  async signInWithPassword(email, password) {
    this._requireClient();
    const { data, error } = await this._sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data && data.session) {
      this.session = data.session;
      this.user = data.user;
      await this._loadProfile();
      this._emit();
    }
  }

  async signUpWithPassword(email, password, redirectTo, fullName) {
    this._requireClient();
    const trimmedName = (fullName || '').trim();
    const { data, error } = await this._sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: trimmedName ? { full_name: trimmedName } : undefined,
      },
    });
    if (error) throw error;
    if (data && data.session) {
      this.session = data.session;
      this.user = data.user;
      await this._loadProfile();
      this._emit();
    }
    return data;
  }

  async sendMagicLink(email, redirectTo) {
    this._requireClient();
    const { error } = await this._sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }

  async signOut() {
    this._requireClient();
    const { error } = await this._sb.auth.signOut();
    if (error) throw error;
    this.user = null;
    this.session = null;
    this.profile = null;
    this._emit();
  }

  async refreshProfile() {
    if (!this.user) return null;
    await this._loadProfile();
    this._emit();
    return this.profile;
  }

  isAuthenticated() { return !!this.session; }
  isApproved() { return !!(this.profile && this.profile.approved); }
};
