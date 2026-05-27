/* Bootstrap for the login page.
   Wires the AuthModel, LoginView, and AuthController together. */
document.addEventListener('DOMContentLoaded', async () => {
  // Where Supabase should send the user after they click an email link.
  // We send them back to login.html so we can render the right state
  // (pending vs approved) before bouncing them to the app.
  const emailRedirect = window.location.origin + '/login.html';
  const appUrl = window.location.origin + '/index.html';

  const authModel = new App.AuthModel();
  const controller = new App.AuthController({
    authModel,
    appUrl,
    emailRedirect,
  });
  new App.LoginView({ controller });

  await authModel.init();
});
