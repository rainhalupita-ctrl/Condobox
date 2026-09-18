-- Garante que label_image_path na tabela packages seja TEXT (suporta URLs longas e dados base64 com segurança)
ALTER TABLE IF EXISTS packages ALTER COLUMN label_image_path TYPE TEXT;
