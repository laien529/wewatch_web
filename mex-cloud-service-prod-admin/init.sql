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
