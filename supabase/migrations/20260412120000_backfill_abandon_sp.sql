-- Zet categorie B en 3 SP op bestaande abandon-penalties die nog geen categorie hebben
UPDATE public.penalties
SET
  penalty_category = 'B',
  penalty_sp       = 3
WHERE source = 'abandon'
  AND revoked = false
  AND penalty_category IS NULL;
