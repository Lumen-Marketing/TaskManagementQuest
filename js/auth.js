/* Bootstrap for the login page.
   Wires the AuthModel, LoginView, and AuthController together. */
document.addEventListener('DOMContentLoaded', async () => {
  const loginUrl = App.routes ? App.routes.login : window.location.origin + '/';
  const appUrl = App.routes ? App.routes.app : window.location.origin + '/app.html';

  // Wait for runtime config (env.json -> Supabase client) before touching auth.
  if (App.configReady) await App.configReady;

  const authModel = new App.AuthModel();
  const controller = new App.AuthController({
    authModel,
    appUrl,
    emailRedirect: loginUrl,
  });
  new App.LoginView({ controller });

  try {
    await authModel.init();
  } catch (err) {
    console.error('[auth] init failed', err);
    App.EventBus.emit('auth:error', (err && err.message) || 'Failed to initialize auth.');
  }

  // If the user is already signed in AND approved, send them straight to the app.
  if (authModel.isAuthenticated() && authModel.isApproved()) {
    window.location.replace(appUrl);
  }

  // While a signed-in user is awaiting approval, poll their profile so they're
  // forwarded automatically the moment an admin approves them — no manual refresh.
  let approvalPoll = null;
  const maybeStartApprovalPoll = () => {
    const pending = authModel.isAuthenticated() && !authModel.isApproved();
    if (pending && !approvalPoll) {
      approvalPoll = window.setInterval(async () => {
        try {
          await authModel.refreshProfile();
          if (authModel.isApproved()) {
            window.clearInterval(approvalPoll);
            approvalPoll = null;
            window.location.replace(appUrl);
          }
        } catch (e) { /* transient — keep polling */ }
      }, 15000);
    } else if (!pending && approvalPoll) {
      window.clearInterval(approvalPoll);
      approvalPoll = null;
    }
  };
  App.EventBus.on('auth:changed', maybeStartApprovalPoll);
  maybeStartApprovalPoll();
});
