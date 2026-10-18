ReDuX — подключение Supabase

1. В Supabase SQL Editor один раз выполни supabase.sql из этого архива.
   Скрипт создаёт/обновляет redux_users, redux_mods, redux_updates,
   включает RLS, Storage bucket redux-assets и фиксирует пароль президента.

2. Realtime уже подключён к проекту. Таблицы redux_users, redux_mods и
   redux_updates должны находиться в publication supabase_realtime.

3. config.js уже содержит URL проекта и публичный publishable key.
   Service-role/secret key в сайт НЕ добавляется.

4. Пароль президента: Worixy123. Подтверждение по email/коду не используется.

5. После загрузки файлов на GitHub Pages очисти кеш страницы (Ctrl+F5).
