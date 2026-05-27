/* Bootstrap for the login page.
   Wires the AuthModel, LoginView, and AuthController together. */
document.addEventListener('DOMContentLoaded', async () => {
  const loginUrl = App.routes ? App.routes.login : window.location.origin + '/';
  const appUrl = App.routes ? App.routes.app : window.location.origin + '/app.html';

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
});
