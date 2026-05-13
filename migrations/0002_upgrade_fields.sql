-- Migration: 0002_upgrade_fields.sql
-- Adds seed control, style preset, and quality columns to shots table

ALTER TABLE shots ADD COLUMN seed INTEGER;
ALTER TABLE shots ADD COLUMN style_preset TEXT;
ALTER TABLE shots ADD COLUMN quality TEXT;
ALTER TABLE shots ADD COLUMN image_r2_key TEXT;  -- R2 key for uploaded reference images
