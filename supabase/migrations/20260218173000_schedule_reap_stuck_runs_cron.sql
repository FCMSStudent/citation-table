-- Schedule periodic reaping of stuck research runs.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  job RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    FOR job IN
      SELECT jobid
      FROM cron.job
      WHERE jobname = 'reap_stuck_runs_every_10m'
    LOOP
      PERFORM cron.unschedule(job.jobid);
    END LOOP;

    PERFORM cron.schedule(
      'reap_stuck_runs_every_10m',
      '*/10 * * * *',
      $cmd$
      SELECT net.http_post(
        url := 'https://amzlrrrhjsqjndbrdume.supabase.co/functions/v1/reap-stuck-runs',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := '{"source": "pg_cron"}'::jsonb
      );
      $cmd$
    );
  END IF;
END;
$$;
