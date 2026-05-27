/* Bootstrap for the login page.
   Wires the AuthModel, LoginView, and AuthController together. */
document.addEventListener('DOMContentLoaded', async () => {
  // index.html IS the login page (renamed from login.html so Vercel
  // serves it at /). app.html is the actual task manager.
  // Email-confirmation links bring users back to / so we can render
  // the right state (pending vs approved) before sending them to the app.
  const emailRedirect = window.location.origin + '/';
  const appUrl = window.location.origin + '/app.html';

  const authModel = new App.AuthModel();
  const controller = new App.AuthController({
    authModel,
    appUrl,
    emailRedirect,
  });
  new App.LoginView({ controller });

  await authModel.init();

  // If the user is already signed in AND approved, send them straight to the app.
  // (The signed-in card is only useful as a brief landing — no need to gate behind a click.)
  if (authModel.isAuthenticated() && authModel.isApproved()) {
    window.location.replace(appUrl);
  }
});
