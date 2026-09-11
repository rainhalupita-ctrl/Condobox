-- ==============================================================================
-- MIGRATION 008: ISOLAMENTO TOTAL DE DADOS MULTI-TENANT POR CONDOMÍNIO (RLS)
-- Garante que nenhum condomínio acesse dados (unidades, moradores, encomendas, equipe)
-- de outro condomínio. Apenas o Dono do Sistema (Master / Super Admin) possui visão global.
-- ==============================================================================

-- 1. Função auxiliar para obter o condomínio do usuário autenticado
CREATE OR REPLACE FUNCTION public.get_my_condo_id()
RETURNS UUID AS $$
  SELECT condo_id FROM public.profiles WHERE id = (SELECT auth.uid()) LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. Função auxiliar para identificar o Dono Master (Super Admin)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT role = 'ADMIN' AND condo_id IS NULL FROM public.profiles WHERE id = (SELECT auth.uid())),
    false
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 3. Índices de performance para checagens de RLS rápidas
CREATE INDEX IF NOT EXISTS idx_units_condo_id ON public.units(condo_id);
CREATE INDEX IF NOT EXISTS idx_packages_condo_id ON public.packages(condo_id);
CREATE INDEX IF NOT EXISTS idx_profiles_condo_id ON public.profiles(condo_id);
CREATE INDEX IF NOT EXISTS idx_residents_unit_id ON public.residents(unit_id);

-- ==============================================================================
-- 4. POLÍTICAS: UNITS (UNIDADES)
-- ==============================================================================
DROP POLICY IF EXISTS "Units select policy" ON public.units;
DROP POLICY IF EXISTS "Units manage policy" ON public.units;

CREATE POLICY "Units select policy" ON public.units
    FOR SELECT TO authenticated, anon
    USING (
        condo_id = (SELECT public.get_my_condo_id())
        OR (SELECT public.is_super_admin())
    );

CREATE POLICY "Units manage policy" ON public.units
    FOR ALL TO authenticated
    USING (
        (public.is_staff() AND condo_id = (SELECT public.get_my_condo_id()))
        OR (SELECT public.is_super_admin())
    )
    WITH CHECK (
        (public.is_staff() AND condo_id = (SELECT public.get_my_condo_id()))
        OR (SELECT public.is_super_admin())
    );

-- ==============================================================================
-- 5. POLÍTICAS: PACKAGES (ENCOMENDAS)
-- ==============================================================================
DROP POLICY IF EXISTS "Packages select policy" ON public.packages;
DROP POLICY IF EXISTS "Packages staff manage policy" ON public.packages;

CREATE POLICY "Packages select policy" ON public.packages
    FOR SELECT TO authenticated
    USING (
        (condo_id = (SELECT public.get_my_condo_id()) AND public.is_staff())
        OR unit_id = (SELECT public.get_my_unit_id())
        OR (SELECT public.is_super_admin())
    );

CREATE POLICY "Packages staff manage policy" ON public.packages
    FOR ALL TO authenticated
    USING (
        (public.is_staff() AND condo_id = (SELECT public.get_my_condo_id()))
        OR (SELECT public.is_super_admin())
    )
    WITH CHECK (
        (public.is_staff() AND condo_id = (SELECT public.get_my_condo_id()))
        OR (SELECT public.is_super_admin())
    );

-- ==============================================================================
-- 6. POLÍTICAS: RESIDENTS (MORADORES)
-- ==============================================================================
DROP POLICY IF EXISTS "Residents select policy" ON public.residents;
DROP POLICY IF EXISTS "Residents insert policy" ON public.residents;
DROP POLICY IF EXISTS "Residents update policy" ON public.residents;
DROP POLICY IF EXISTS "Residents delete policy" ON public.residents;
DROP POLICY IF EXISTS "Residents manage policy" ON public.residents;

CREATE POLICY "Residents select policy" ON public.residents
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR unit_id = (SELECT public.get_my_unit_id())
        OR EXISTS (
            SELECT 1 FROM public.units u
            WHERE u.id = residents.unit_id
            AND u.condo_id = (SELECT public.get_my_condo_id())
            AND public.is_staff()
        )
        OR (SELECT public.is_super_admin())
    );

CREATE POLICY "Residents manage policy" ON public.residents
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.units u
            WHERE u.id = residents.unit_id
            AND u.condo_id = (SELECT public.get_my_condo_id())
            AND public.is_staff()
        )
        OR (SELECT public.is_super_admin())
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.units u
            WHERE u.id = residents.unit_id
            AND u.condo_id = (SELECT public.get_my_condo_id())
            AND public.is_staff()
        )
        OR (SELECT public.is_super_admin())
    );

-- ==============================================================================
-- 7. POLÍTICAS: PROFILES (EQUIPE E USUÁRIOS)
-- ==============================================================================
DROP POLICY IF EXISTS "Profiles select policy" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;

CREATE POLICY "Profiles select policy" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR (public.is_staff() AND condo_id = (SELECT public.get_my_condo_id()))
        OR (SELECT public.is_super_admin())
    );

CREATE POLICY "Profiles update policy" ON public.profiles
    FOR UPDATE TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR (public.is_staff() AND condo_id = (SELECT public.get_my_condo_id()))
        OR (SELECT public.is_super_admin())
    );
