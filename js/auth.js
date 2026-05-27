/* Bootstrap for the login page.
   Wires the AuthModel, LoginView, and AuthController together. */
document.addEventListener('DOMContentLoaded', async () => {
  const loginUrl = window.location.origin + '/';
  const appUrl = window.location.origin + '/app.html';

  const authModel = new App.AuthModel();
  const controller = new App.AuthController({
    authModel,
    appUrl,
    emailRedirect: loginUrl,
  });
  new App.LoginView({ controller });

  await authModel.init();

  // If the user is already signed in AND approved, send them straight to the app.
  // (The signed-in card is only useful as a brief landing — no need to gate behind a click.)
  if (authModel.isAuthenticated() && authModel.isApproved()) {
    window.location.replace(appUrl);
  }
});
