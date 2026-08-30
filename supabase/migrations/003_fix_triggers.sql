-- Fix trigger to prevent blocking user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, phone, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email, 'Usuário'),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    CASE 
      WHEN NEW.raw_user_meta_data->>'role' = 'ADMIN' THEN 'ADMIN'::public.user_role
      WHEN NEW.raw_user_meta_data->>'role' = 'SYNDIC' THEN 'SYNDIC'::public.user_role
      WHEN NEW.raw_user_meta_data->>'role' = 'GUARD' THEN 'GUARD'::public.user_role
      ELSE 'RESIDENT'::public.user_role
    END
  )
  ON CONFLICT (id) DO UPDATE
  SET role = EXCLUDED.role,
      name = EXCLUDED.name;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
