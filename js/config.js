window.App = window.App || {};

App.supabase = window.supabase.createClient(
  'https://qqvmcsvdxhgjooirznrj.supabase.co',
  'sb_publishable_JUrrgjsEL9nnxGvzwYBDkA_cIeRtcIh'
);

App.basePath = window.location.pathname.toLowerCase().startsWith('/taskmanagementquest/')
  ? '/TaskManagementQuest/'
  : '/';

App.routes = {
  login: `${window.location.origin}${App.basePath}`,
  app: `${window.location.origin}${App.basePath}app.html`,
};
