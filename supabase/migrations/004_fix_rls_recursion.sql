-- ==============================================================================
-- MIGRATION 004: Correção de Recursão Infinita no RLS (Erro 500 do Supabase)
-- ==============================================================================

-- 1. Funções SECURITY DEFINER para checar permissão sem disparar RLS recursivo
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT role IN ('ADMIN', 'SYNDIC', 'GUARD') FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_my_unit_id()
RETURNS UUID AS $$
  SELECT unit_id FROM public.residents WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. Limpar políticas antigas com recursão
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Guards and Admins can view all profiles in condo" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;

DROP POLICY IF EXISTS "Authenticated users can view units" ON public.units;
DROP POLICY IF EXISTS "Admins can manage units" ON public.units;

DROP POLICY IF EXISTS "Residents can view members in their own unit" ON public.residents;
DROP POLICY IF EXISTS "Admins and Guards can manage residents" ON public.residents;

DROP POLICY IF EXISTS "Residents can view packages for their unit" ON public.packages;
DROP POLICY IF EXISTS "Guards and Admins can insert and update packages" ON public.packages;

DROP POLICY IF EXISTS "Profiles select policy" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;
DROP POLICY IF EXISTS "Profiles insert policy" ON public.profiles;

-- 3. Novas políticas para PROFILES
CREATE POLICY "Profiles select policy" ON public.profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.is_staff());

CREATE POLICY "Profiles update policy" ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid() OR public.is_staff());

CREATE POLICY "Profiles insert policy" ON public.profiles
    FOR INSERT TO authenticated, anon
    WITH CHECK (true);

-- 4. Novas políticas para UNITS
CREATE POLICY "Units select policy" ON public.units
    FOR SELECT TO authenticated, anon
    USING (true);

CREATE POLICY "Units manage policy" ON public.units
    FOR ALL TO authenticated
    USING (public.is_staff());

-- 5. Novas políticas para RESIDENTS
CREATE POLICY "Residents select policy" ON public.residents
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid() 
        OR unit_id = public.get_my_unit_id() 
        OR public.is_staff()
    );

CREATE POLICY "Residents insert policy" ON public.residents
    FOR INSERT TO authenticated, anon
    WITH CHECK (true);

CREATE POLICY "Residents update policy" ON public.residents
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() OR public.is_staff());

CREATE POLICY "Residents delete policy" ON public.residents
    FOR DELETE TO authenticated
    USING (public.is_staff());

-- 6. Novas políticas para PACKAGES
CREATE POLICY "Packages select policy" ON public.packages
    FOR SELECT TO authenticated
    USING (
        unit_id = public.get_my_unit_id() 
        OR public.is_staff()
    );

CREATE POLICY "Packages staff manage policy" ON public.packages
    FOR ALL TO authenticated
    USING (public.is_staff());
