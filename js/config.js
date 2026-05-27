window.App = window.App || {};

App.SUPABASE_URL = 'https://qqvmcsvdxhgjooirznrj.supabase.co';
App.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_JUrrgjsEL9nnxGvzwYBDkA_cIeRtcIh';

if (!window.supabase || !window.supabase.createClient) {
  throw new Error('Supabase SDK failed to load before js/config.js');
}

App.supabase = window.supabase.createClient(
  App.SUPABASE_URL,
  App.SUPABASE_PUBLISHABLE_KEY
);
