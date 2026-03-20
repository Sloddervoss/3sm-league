-- Allow races without a league (standalone races)
ALTER TABLE races ALTER COLUMN league_id DROP NOT NULL;
