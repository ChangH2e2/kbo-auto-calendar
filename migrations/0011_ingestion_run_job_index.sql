-- 파이프라인별 최신 실행 조회(ingestion-status)를 위한 인덱스.
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_job_type ON ingestion_runs(job_type, started_at DESC);
