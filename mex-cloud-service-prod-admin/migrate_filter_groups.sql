USE mex_cloud;

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
