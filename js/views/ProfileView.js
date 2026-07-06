window.App = window.App || {};

App.ProfileView = class ProfileView {
  constructor({ controller }) {
    this.controller = controller;
    this.modal = null;
    this.pendingFile = null;
    this.removePending = false;
  }

  open() {
    if (this.modal) return;
    this.pendingFile = null;
    this.removePending = false;

    this.modal = document.createElement('div');
    this.modal.className = 'modal-backdrop';
    this.modal.id = 'profileModal';
    this.modal.innerHTML = this.template();
    document.body.appendChild(this.modal);

    this.bindEvents();
    setTimeout(() => {
      const input = document.getElementById('pf-name');
      if (input) { input.focus(); input.select(); }
    }, 50);
  }

  close() {
    if (!this.modal) return;
    this.modal.remove();
    this.modal = null;
  }

  template() {
    const profile = App.currentProfile || {};
    const currentName = profile.full_name || '';
    const currentAvatar = this._currentAvatarUrl();
    const initials = this._initialsOf(currentName);

    return `
      <div class="modal" data-stop>
        <div class="modal-head">
          <div class="modal-title">Edit profile</div>
          <button class="icon-btn" data-action="close" aria-label="Close"><i class="ti ti-x"></i></button>
        </div>
        <div class="modal-body">
          <div class="profile-avatar-row">
            <div class="profile-avatar-preview" id="pf-preview">
              ${currentAvatar
                ? `<img src="${App.utils.escapeHtml(currentAvatar)}" alt="Current avatar" />`
                : `<span class="profile-avatar-initials">${App.utils.escapeHtml(initials)}</span>`}
            </div>
            <div class="profile-avatar-actions">
              <label class="btn">
                <i class="ti ti-upload"></i> Upload photo
                <input type="file" id="pf-file" accept="image/*" style="display:none;" />
              </label>
              <button type="button" class="btn-link ${currentAvatar ? '' : 'hidden'}" id="pf-remove">Remove photo</button>
              <div class="profile-hint">JPG or PNG, up to 2 MB. Auto-resized to 512×512.</div>
            </div>
          </div>

          <div class="field" style="margin-top:18px;">
            <label class="field-label" for="pf-name">Display name</label>
            <input type="text" id="pf-name" value="${App.utils.escapeHtml(currentName)}" placeholder="Your name" maxlength="80" />
          </div>

          <button type="button" class="btn-link pf-pw-toggle" id="pf-pw-toggle" style="margin-top:14px;font-size:13px;">Change password</button>

          <div id="pf-pw-section" style="display:none;">
            <div class="field" style="margin-top:14px;">
              <label class="field-label" for="pf-current-password">Current password</label>
              <input type="password" id="pf-current-password" placeholder="Required to change your password" autocomplete="current-password" maxlength="128" />
            </div>

            <div class="field" style="margin-top:12px;">
              <label class="field-label" for="pf-password">New password</label>
              <input type="password" id="pf-password" placeholder="At least 8 characters" autocomplete="new-password" maxlength="128" />
              <div class="profile-hint">Upper- and lowercase letters, a number, and a special character.</div>
            </div>

            <div class="field" style="margin-top:12px;">
              <label class="field-label" for="pf-password-confirm">Confirm new password</label>
              <input type="password" id="pf-password-confirm" placeholder="Re-enter new password" autocomplete="new-password" maxlength="128" />
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn" data-action="close">Cancel</button>
            <button class="btn btn-primary" data-action="submit">Save changes</button>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
    this.modal.querySelectorAll('[data-action="close"]').forEach(el => {
      el.addEventListener('click', () => this.close());
    });
    this.modal.querySelector('[data-action="submit"]').addEventListener('click', () => this.submit());

    const removeBtn = document.getElementById('pf-remove');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        this.removePending = true;
        this.pendingFile = null;
        document.getElementById('pf-file').value = '';
        const initials = this._initialsOf(document.getElementById('pf-name').value);
        document.getElementById('pf-preview').innerHTML =
          `<span class="profile-avatar-initials">${App.utils.escapeHtml(initials)}</span>`;
        removeBtn.classList.add('hidden');
      });
    }

    document.getElementById('pf-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        this._inlineError('Please choose an image file.');
        e.target.value = '';
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this._inlineError('Image must be 2 MB or smaller.');
        e.target.value = '';
        return;
      }
      this.pendingFile = file;
      this.removePending = false;
      const reader = new FileReader();
      reader.onload = (ev) => {
        document.getElementById('pf-preview').innerHTML =
          `<img src="${ev.target.result}" alt="New avatar preview" />`;
        if (removeBtn) removeBtn.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    });

    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      }
    });

    const pwToggle = document.getElementById('pf-pw-toggle');
    const pwSection = document.getElementById('pf-pw-section');
    if (pwToggle && pwSection) {
      pwToggle.addEventListener('click', () => {
        const open = pwSection.style.display !== 'none';
        pwSection.style.display = open ? 'none' : 'block';
        pwToggle.textContent = open ? 'Change password' : 'Cancel password change';
        if (!open) {
          setTimeout(() => {
            const first = document.getElementById('pf-current-password');
            if (first) first.focus();
          }, 0);
        } else {
          document.getElementById('pf-current-password').value = '';
          document.getElementById('pf-password').value = '';
          document.getElementById('pf-password-confirm').value = '';
        }
      });
    }

    // Name change updates the initials preview when no photo is showing.
    document.getElementById('pf-name').addEventListener('input', () => {
      if (!this.pendingFile && (this.removePending || !this._currentAvatarUrl())) {
        const initials = this._initialsOf(document.getElementById('pf-name').value);
        document.getElementById('pf-preview').innerHTML =
          `<span class="profile-avatar-initials">${App.utils.escapeHtml(initials)}</span>`;
      }
    });
  }

  async submit() {
    const nameRaw = (document.getElementById('pf-name').value || '').trim();
    if (!nameRaw) {
      this._inlineError('Display name is required.');
      return;
    }

    // Password change is optional: blank fields mean "keep current password".
    // Validate the strength + match BEFORE we touch the network so the user
    // gets the precise rule that failed without a half-applied save.
    const currentPw = document.getElementById('pf-current-password').value || '';
    const pw = document.getElementById('pf-password').value || '';
    const pwConfirm = document.getElementById('pf-password-confirm').value || '';
    const wantsPasswordChange = pw.length > 0 || pwConfirm.length > 0;
    if (wantsPasswordChange) {
      if (!currentPw) {
        this._inlineError('Enter your current password to change it.');
        return;
      }
      try {
        App.validate.strongPassword(pw, { field: 'password' });
      } catch (err) {
        this._inlineError((err && err.message) || 'Password does not meet the requirements.');
        return;
      }
      if (pw !== pwConfirm) {
        this._inlineError('Passwords do not match.');
        return;
      }
      if (pw === currentPw) {
        this._inlineError('New password must be different from your current one.');
        return;
      }
    }

    const submitBtn = this.modal.querySelector('[data-action="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    try {
      let avatarUrl = this._currentAvatarUrl();
      let avatarChanged = false;

      if (this.pendingFile) {
        avatarUrl = await this._uploadAvatar(this.pendingFile);
        avatarChanged = true;
      } else if (this.removePending) {
        avatarUrl = null;
        avatarChanged = true;
      }

      await this._saveProfile(nameRaw, avatarUrl, avatarChanged);

      // Update the auth credential last. Verify the CURRENT password first
      // (Supabase's updateUser would otherwise let anyone on an unlocked session
      // change it), then set the new one on the live session.
      if (wantsPasswordChange) {
        await this._verifyCurrentPassword(currentPw);
        const { error } = await App.supabase.auth.updateUser({ password: pw });
        if (error) throw error;
      }

      if (this.controller && this.controller.toastView) {
        this.controller.toastView.show({
          title: wantsPasswordChange ? 'Profile & password updated' : 'Profile updated',
          sub: '',
        });
      }
      this.close();
    } catch (err) {
      console.error('[profile] save failed', err);
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
      this._inlineError((err && err.message) || 'Could not save profile.');
    }
  }

  /* Confirm the caller knows the current password before changing it. Supabase
     has no "verify password" endpoint, so we sign in on a SHORT-LIVED, ISOLATED
     client (persistSession:false) — a wrong or right attempt there never touches
     the live session or fires the app's onAuthStateChange. Throws a user-safe
     Error on mismatch / when verification can't run. */
  async _verifyCurrentPassword(currentPw) {
    const email = (App.currentAuthUser && App.currentAuthUser.email)
      || (App.currentProfile && App.currentProfile.email) || '';
    if (!email) throw new Error('Could not determine your account email.');
    if (!window.supabase || !App.supabaseUrl || !App.supabaseAnonKey) {
      throw new Error('Password change is unavailable right now.');
    }

    const probe = window.supabase.createClient(App.supabaseUrl, App.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error } = await probe.auth.signInWithPassword({ email, password: currentPw });
    try { await probe.auth.signOut(); } catch (e) { /* nothing was persisted */ }

    if (error) {
      // A configured captcha (Turnstile) would block this sign-in for lack of a
      // token — surface that distinctly so it isn't mistaken for a wrong password.
      if (/captcha/i.test(error.message || '')) {
        throw new Error('Could not verify your password — captcha is enabled on sign-in for this project.');
      }
      throw new Error('Current password is incorrect.');
    }
  }

  async _uploadAvatar(file) {
    const resized = await this._resizeImage(file, 512);
    const uid = App.currentAuthUser && App.currentAuthUser.id;
    if (!uid) throw new Error('Not signed in.');

    const path = `${uid}/avatar.jpg`;
    const { error } = await App.supabase.storage
      .from('avatars')
      .upload(path, resized, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '0',
      });
    if (error) throw error;

    const { data } = App.supabase.storage.from('avatars').getPublicUrl(path);
    return `${data.publicUrl}?v=${Date.now()}`;
  }

  _resizeImage(file, maxDim) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            blob => blob ? resolve(blob) : reject(new Error('Image encode failed.')),
            'image/jpeg',
            0.85
          );
        };
        img.onerror = () => reject(new Error('Could not load image.'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsDataURL(file);
    });
  }

  async _saveProfile(fullName, avatarUrl, avatarChanged) {
    const profile = App.currentProfile;
    const memberId = profile && profile.member_id;
    const firstName = fullName.split(/\s+/)[0] || fullName;

    const profileUpdate = { full_name: fullName };
    if (avatarChanged) profileUpdate.avatar_url = avatarUrl;

    const profileRes = await App.supabase
      .from('profiles')
      .update(profileUpdate)
      .eq('id', profile.id);
    if (profileRes.error) throw profileRes.error;

    if (memberId) {
      const memberUpdate = { name: firstName, full_name: fullName };
      if (avatarChanged) memberUpdate.avatar_url = avatarUrl;

      // Best-effort: only managers can write team_members (RLS). For everyone
      // else this is rejected — that's fine, the profile is the source of truth
      // and the UI overlays profile name/avatar onto the roster anyway.
      const memberRes = await App.supabase
        .from('team_members')
        .update(memberUpdate)
        .eq('id', memberId);
      if (memberRes.error) {
        console.warn('[profile] team_members sync skipped (likely RLS):', memberRes.error.message);
      }
    }

    if (avatarChanged) {
      try {
        await App.supabase.auth.updateUser({ data: { avatar_url: avatarUrl } });
      } catch (e) { /* metadata mirror is best-effort */ }
    }

    App.currentProfile = Object.assign({}, profile, profileUpdate);
    if (memberId && App.PEOPLE && App.PEOPLE[memberId]) {
      App.PEOPLE[memberId].name = firstName;
      App.PEOPLE[memberId].full = fullName;
      if (avatarChanged) App.PEOPLE[memberId].avatar_url = avatarUrl;
    }

    this._repaintTopbarAvatar(fullName, avatarChanged ? avatarUrl : (App.currentProfile.avatar_url || null));
    App.EventBus.emit('profile:changed');
    App.EventBus.emit('tasks:changed');
  }

  _repaintTopbarAvatar(name, avatarUrl) {
    const avatar = document.getElementById('userAvatar');
    if (!avatar) return;
    if (avatarUrl) {
      avatar.style.background = 'transparent';
      avatar.innerHTML = `<img src="${App.utils.escapeHtml(avatarUrl)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
    } else {
      avatar.style.background = 'var(--amber)';
      avatar.style.color = 'var(--color-accent-ink)';
      avatar.innerHTML = '';
      avatar.textContent = this._initialsOf(name);
    }
  }

  _currentAvatarUrl() {
    const p = App.currentProfile || {};
    const meta = (App.currentAuthUser && App.currentAuthUser.user_metadata) || {};
    return p.avatar_url || meta.avatar_url || '';
  }

  _initialsOf(name) {
    return (name || '').trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  }

  _inlineError(msg) {
    const existing = this.modal.querySelector('.profile-inline-error');
    if (existing) existing.remove();
    const div = document.createElement('div');
    div.className = 'profile-inline-error';
    div.textContent = msg;
    const actions = this.modal.querySelector('.modal-actions');
    actions.parentNode.insertBefore(div, actions);
    setTimeout(() => { if (div.parentNode) div.remove(); }, 4000);
  }
};
