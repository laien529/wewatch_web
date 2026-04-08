USE mex_cloud;

ALTER TABLE upload_records ADD COLUMN sender VARCHAR(255) DEFAULT '';
ALTER TABLE upload_records ADD COLUMN is_read TINYINT NOT NULL DEFAULT 0;
CREATE INDEX idx_sender ON upload_records(sender);
CREATE INDEX idx_is_read ON upload_records(is_read);
