/* Guards index.html — three states:
   - No session       -> bounce to login.html
   - Not approved     -> bounce to login.html (which renders pending card)
   - Approved         -> let the app load, wire sign-out, paint avatar */
(async function () {
  const { data: sessionData } = await App.supabase.auth.getSession();
  if (!sessionData.session) {
    window.location.replace('login.html');
    return;
  }

  const user = sessionData.session.user;
  const { data: profile, error } = await App.supabase
    .from('profiles')
    .select('id, email, full_name, approved, role')
    .eq('id', user.id)
    .single();

  if (error || !profile || !profile.approved) {
    window.location.replace('login.html');
    return;
  }

  App.currentSession = sessionData.session;
  App.currentAuthUser = user;
  App.currentProfile = profile;

  App.signOut = async function () {
    await App.supabase.auth.signOut();
    window.location.replace('login.html');
  };

  App.supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) window.location.replace('login.html');
  });

  const wire = () => {
    const btn = document.getElementById('signOutBtn');
    const avatar = document.getElementById('userAvatar');
    if (btn) btn.addEventListener('click', App.signOut);
    if (avatar) avatar.addEventListener('click', App.signOut);

    const name = profile.full_name || user.email || '';
    if (avatar) {
      avatar.title = `Sign out (${user.email || name})`;
      const meta = user.user_metadata || {};
      if (meta.avatar_url) {
        avatar.style.background = 'transparent';
        avatar.innerHTML = `<img src="${meta.avatar_url}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
      } else {
        const initials = name.trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
        if (initials) avatar.textContent = initials;
      }
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
