-- Voeg pit_lane_start toe als penalty type op beide tabellen

ALTER TABLE public.penalties
  DROP CONSTRAINT IF EXISTS penalties_penalty_type_check;

ALTER TABLE public.penalties
  ADD CONSTRAINT penalties_penalty_type_check
  CHECK (penalty_type IN (
    'time_penalty',
    'points_deduction',
    'warning',
    'disqualification',
    'abandon',
    'grid_penalty',
    'race_ban',
    'pit_lane_start'
  ));

ALTER TABLE public.protests
  DROP CONSTRAINT IF EXISTS protests_penalty_type_check;

ALTER TABLE public.protests
  ADD CONSTRAINT protests_penalty_type_check
  CHECK (penalty_type IN (
    'warning',
    'points_deduction',
    'disqualification',
    'time_penalty',
    'grid_penalty',
    'race_ban',
    'pit_lane_start'
  ));
