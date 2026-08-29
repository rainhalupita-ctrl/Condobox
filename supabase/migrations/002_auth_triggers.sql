-- ==============================================================================
-- MIGRATION 002: Trigger automático de perfil + função de signup de porteiro
-- Execute este SQL no Supabase SQL Editor
-- ==============================================================================

-- 1. Trigger que cria um profile RESIDENT automaticamente ao se cadastrar
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_name TEXT;
  v_phone TEXT;
  v_role TEXT;
BEGIN
  -- Ler dados do metadata do usuário (passados no signUp)
  v_name  := COALESCE(NEW.raw_user_meta_data->>'name', NEW.email);
  v_phone := COALESCE(NEW.raw_user_meta_data->>'phone', '');
  v_role  := COALESCE(NEW.raw_user_meta_data->>'role', 'RESIDENT');

  -- Garantir que somente roles válidos passem
  IF v_role NOT IN ('ADMIN', 'SYNDIC', 'GUARD', 'RESIDENT') THEN
    v_role := 'RESIDENT';
  END IF;

  INSERT INTO public.profiles (id, name, phone, role)
  VALUES (NEW.id, v_name, v_phone, v_role::user_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remover trigger anterior se existir
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Criar o trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- 2. Função para o Síndico criar porteiros/admins (chamada via service role)
-- O cadastro de porteiros é feito pelo síndico no painel /admin, não pelo próprio porteiro.
-- Para criar porteiros manualmente via SQL:
--
-- INSERT INTO auth.users (...) ... (via Supabase Dashboard > Authentication > Users)
-- Depois atualizar o role:
-- UPDATE public.profiles SET role = 'GUARD' WHERE id = 'UUID_DO_PORTEIRO';


-- 3. Garantir que profiles tenha política pública de INSERT para o trigger funcionar
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
CREATE POLICY "Service role can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (true);

-- 4. Política para usuário atualizar seu próprio perfil
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
