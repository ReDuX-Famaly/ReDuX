ReDuX — GitHub Pages + realtime chat

1) The site itself is static and can be hosted on GitHub Pages.
2) Only the CHAT uses Supabase realtime. Redux files can remain on Yandex Disk and videos by link.
3) Create a free Supabase project.
4) In Supabase SQL Editor, run supabase.sql from this archive.
5) Copy Project URL and the public anon key into config.js:
   window.REDUX_SUPABASE = { url: 'https://YOUR_PROJECT.supabase.co', anonKey: 'YOUR_ANON_KEY' };
6) Upload index.html, style.css, app.js and config.js to GitHub Pages.
7) The chat works without page reload: messages are delivered through Supabase Realtime.

The ReDuX registration remains visual/local: no email or SMS confirmation is required.

Security note: the SQL policies are intentionally open because this prototype uses visual/local registration.
For a real public service, switch to Supabase Auth and strict RLS before handling sensitive data.
