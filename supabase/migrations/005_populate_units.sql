-- ==============================================================================
-- MIGRATION 005: Povoamento e Estrutura dos Blocos e Unidades Reais
-- ==============================================================================

-- Gerar apartamentos do Bloco A (Andares 1 a 8, apartamentos 0 a 7 por andar: 100-107, ..., 800-807)
DO $$
DECLARE
  floor_num INT;
  apt_num INT;
  unit_str TEXT;
BEGIN
  FOR floor_num IN 1..8 LOOP
    FOR apt_num IN 0..7 LOOP
      unit_str := (floor_num * 100 + apt_num)::TEXT;
      INSERT INTO public.units (block, unit_number)
      VALUES ('Bloco A', unit_str)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
