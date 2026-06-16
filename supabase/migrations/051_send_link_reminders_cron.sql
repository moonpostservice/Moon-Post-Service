-- 051_send_link_reminders_cron.sql
--
-- Schedule the "remind me when my moon rises" sender (send-link-reminders edge
-- function) every 5 minutes. Standalone from the per-minute release-messages
-- cron so the reminder path never touches the critical release pipeline.
-- Reminders aren't second-critical, so a 5-minute cadence is plenty.

SELECT cron.schedule(
  'send-link-reminders',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://znfqqehthxcrizcixzpu.supabase.co/functions/v1/send-link-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZnFxZWh0aHhjcml6Y2l4enB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MzMyMDgsImV4cCI6MjA4NjAwOTIwOH0.Twf3d9QEhVq6j9yVKaS9QNhnvygYgxPj0zg6Ug5pAq0',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZnFxZWh0aHhjcml6Y2l4enB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MzMyMDgsImV4cCI6MjA4NjAwOTIwOH0.Twf3d9QEhVq6j9yVKaS9QNhnvygYgxPj0zg6Ug5pAq0'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
