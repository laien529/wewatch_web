USE mex_cloud;

CREATE TABLE IF NOT EXISTS upload_record_compensations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  record_id BIGINT NOT NULL,
  min_amount DECIMAL(12,2) NOT NULL,
  max_amount DECIMAL(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  unit VARCHAR(32) NOT NULL DEFAULT 'unspecified',
  quote VARCHAR(300) NOT NULL DEFAULT '',
  confidence DECIMAL(4,3) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_compensation_range (min_amount, max_amount),
  INDEX idx_compensation_record (record_id)
);

CREATE TABLE IF NOT EXISTS upload_tasks (
  task_id VARCHAR(64) PRIMARY KEY,
  status ENUM('analyzing', 'completed', 'failed') NOT NULL,
  received_count INT NOT NULL DEFAULT 0,
  inserted_count INT NOT NULL DEFAULT 0,
  filtered_count INT NOT NULL DEFAULT 0,
  analysis_batches INT NOT NULL DEFAULT 0,
  last_error VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  INDEX idx_upload_tasks_status_created (status, created_at)
);
