-- Retain the original record and raw file; only detach its search index entry.
ALTER TABLE documents ADD COLUMN superseded_by uuid REFERENCES documents(id);
ALTER TABLE documents ADD CONSTRAINT documents_no_self_replacement CHECK (superseded_by IS NULL OR superseded_by <> id);
