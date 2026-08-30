import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { residents } = await req.json();

    if (!residents || !Array.isArray(residents) || residents.length === 0) {
      return NextResponse.json({ error: 'Nenhum registro para importar.' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Configurações do Supabase não encontradas.' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Carrega todas as unidades existentes
    const { data: existingUnits, error: uErr } = await supabase.from('units').select('id, block, unit_number');
    if (uErr) {
      console.error('Erro ao buscar unidades:', uErr);
      return NextResponse.json({ error: 'Falha ao consultar unidades existentes.' }, { status: 500 });
    }

    const unitMap = new Map<string, string>();
    existingUnits?.forEach((u) => {
      const key = `${(u.block || 'Bloco A').trim().toUpperCase()}__${(u.unit_number || '').trim()}`;
      unitMap.set(key, u.id);
    });

    // 2. Identifica e cria novas unidades que ainda não existem
    const unitsToCreate = new Map<string, { block: string; unit_number: string }>();
    residents.forEach((r) => {
      const block = (r.block || 'Bloco A').trim();
      const unitNumber = String(r.unitNumber || '').trim();
      if (!unitNumber) return;

      const key = `${block.toUpperCase()}__${unitNumber}`;
      if (!unitMap.has(key) && !unitsToCreate.has(key)) {
        unitsToCreate.set(key, { block, unit_number: unitNumber });
      }
    });

    let unitsCreatedCount = 0;
    if (unitsToCreate.size > 0) {
      const newUnitsArray = Array.from(unitsToCreate.values());
      const { data: createdUnits, error: insertUErr } = await supabase
        .from('units')
        .insert(newUnitsArray)
        .select('id, block, unit_number');

      if (insertUErr) {
        console.error('Erro ao criar novas unidades:', insertUErr);
      } else if (createdUnits) {
        unitsCreatedCount = createdUnits.length;
        createdUnits.forEach((u) => {
          const key = `${u.block.trim().toUpperCase()}__${u.unit_number.trim()}`;
          unitMap.set(key, u.id);
        });
      }
    }

    // 3. Carrega moradores existentes para evitar duplicações
    const { data: existingResidents } = await supabase.from('residents').select('id, name, phone, unit_id');

    let createdCount = 0;
    let updatedCount = 0;
    const errors: string[] = [];

    for (const r of residents) {
      const name = (r.name || '').trim();
      const block = (r.block || 'Bloco A').trim();
      const unitNumber = String(r.unitNumber || '').trim();
      let phone = String(r.phone || '').replace(/\D/g, '');
      const email = r.email ? String(r.email).trim().toLowerCase() : null;

      if (!name || !unitNumber) {
        errors.push(`Ignorado: Registro sem nome ou apartamento (${name || 'Sem nome'} - Apto ${unitNumber || 'Sem ap'})`);
        continue;
      }

      // Formata telefone nacional brasileiro com DDI 55
      if (phone.length === 10 || phone.length === 11) {
        phone = `55${phone}`;
      }

      const unitKey = `${block.toUpperCase()}__${unitNumber}`;
      const unitId = unitMap.get(unitKey);

      if (!unitId) {
        errors.push(`Erro: Unidade ${block} - ${unitNumber} não encontrada.`);
        continue;
      }

      // Verifica se o morador já existe (por nome na mesma unidade ou por telefone)
      const existing = existingResidents?.find(
        (ex) =>
          (ex.unit_id === unitId && ex.name.toLowerCase() === name.toLowerCase()) ||
          (phone && ex.phone === phone)
      );

      if (existing) {
        // Atualiza morador existente
        const { error: upErr } = await supabase
          .from('residents')
          .update({
            name,
            phone: phone || existing.phone,
            email: email || undefined,
            active: true
          })
          .eq('id', existing.id);

        if (!upErr) updatedCount++;
      } else {
        // Insere novo morador
        const { error: insErr } = await supabase.from('residents').insert({
          unit_id: unitId,
          name,
          phone: phone || '5500000000000',
          email,
          is_authorized_receiver: true,
          is_primary: true,
          active: true
        });

        if (!insErr) {
          createdCount++;
        } else {
          errors.push(`Erro ao cadastrar ${name}: ${insErr.message}`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      createdCount,
      updatedCount,
      unitsCreatedCount,
      errors
    });
  } catch (error: any) {
    console.error('Erro no batch-import:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
