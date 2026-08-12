CREATE DATABASE IF NOT EXISTS mex_cloud;
USE mex_cloud;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_records (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_id VARCHAR(64),
  record_key VARCHAR(128),
  sender VARCHAR(255) DEFAULT '',
  content_json JSON,
  is_read TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_task_record (task_id, record_key),
  INDEX idx_created_at (created_at),
  INDEX idx_sender (sender),
  INDEX idx_is_read (is_read)
);

CREATE TABLE IF NOT EXISTS filter_groups (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  match_mode ENUM('any', 'all') NOT NULL DEFAULT 'any',
  enabled TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_filter_groups_enabled (enabled)
);

CREATE TABLE IF NOT EXISTS filter_conditions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  group_id BIGINT NOT NULL,
  condition_type VARCHAR(32) NOT NULL,
  condition_value TEXT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_filter_conditions_group (group_id),
  INDEX idx_filter_conditions_type (condition_type),
  INDEX idx_filter_conditions_enabled (enabled)
);

CREATE TABLE IF NOT EXISTS upload_record_filter_matches (
  record_id BIGINT NOT NULL,
  group_id BIGINT NOT NULL,
  condition_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (record_id, group_id, condition_id),
  INDEX idx_matches_group_record (group_id, record_id),
  INDEX idx_matches_condition_record (condition_id, record_id)
);

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
