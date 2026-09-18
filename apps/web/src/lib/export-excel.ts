import * as XLSX from 'xlsx';

export interface ExportUnit {
  id: string;
  block?: string | null;
  unit_number?: string | null;
  condo_id?: string | null;
}

export interface ExportResident {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  unit_id?: string | null;
  is_primary?: boolean | null;
  active?: boolean | null;
  created_at?: string | null;
  unit?: {
    id?: string;
    block?: string | null;
    unit_number?: string | null;
  } | null;
}

export function exportCondoSpreadsheet(
  condoName: string,
  units: ExportUnit[],
  residents: ExportResident[]
) {
  // Ordena as unidades logicamente por Bloco e depois por Número do Apartamento
  const sortedUnits = [...units].sort((a, b) => {
    const blockA = (a.block || '').toString().toLowerCase();
    const blockB = (b.block || '').toString().toLowerCase();
    if (blockA !== blockB) {
      return blockA.localeCompare(blockB, undefined, { numeric: true });
    }
    const numA = (a.unit_number || '').toString();
    const numB = (b.unit_number || '').toString();
    return numA.localeCompare(numB, undefined, { numeric: true });
  });

  const coveredResidentIds = new Set<string>();
  const rows: Array<{
    'Bloco': string;
    'Apartamento': string;
    'Nome do Morador': string;
    'WhatsApp / Telefone': string;
    'E-mail': string;
    'Tipo': string;
    'Status': string;
  }> = [];

  // 1. Percorre as unidades e seus respectivos moradores
  sortedUnits.forEach((unit) => {
    const unitResidents = residents.filter(
      (r) =>
        r.unit_id === unit.id ||
        (r.unit &&
          (r.unit.block || 'Bloco A').trim().toUpperCase() === (unit.block || 'Bloco A').trim().toUpperCase() &&
          (r.unit.unit_number || '').trim() === (unit.unit_number || '').trim())
    );

    if (unitResidents.length === 0) {
      // Unidade sem nenhum morador cadastrado ainda (vaga)
      rows.push({
        'Bloco': unit.block || 'Bloco A',
        'Apartamento': unit.unit_number || '',
        'Nome do Morador': 'Sem morador cadastrado',
        'WhatsApp / Telefone': '',
        'E-mail': '',
        'Tipo': 'Unidade Vaga',
        'Status': 'Vago',
      });
    } else {
      // Ordena moradores: Titular primeiro, depois por nome
      const sortedResidents = [...unitResidents].sort((a, b) => {
        if (a.is_primary && !b.is_primary) return -1;
        if (!a.is_primary && b.is_primary) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });

      sortedResidents.forEach((r) => {
        coveredResidentIds.add(r.id);
        rows.push({
          'Bloco': unit.block || 'Bloco A',
          'Apartamento': unit.unit_number || '',
          'Nome do Morador': r.name || '',
          'WhatsApp / Telefone': r.phone || '',
          'E-mail': r.email || '',
          'Tipo': r.is_primary ? 'Titular' : 'Dependente',
          'Status': r.active !== false ? 'Ativo' : 'Inativo',
        });
      });
    }
  });

  // 2. Inclui moradores que porventura não tenham unidade correspondente na lista
  residents.forEach((r) => {
    if (!coveredResidentIds.has(r.id)) {
      rows.push({
        'Bloco': r.unit?.block || 'Geral',
        'Apartamento': r.unit?.unit_number || 'Sem Unidade',
        'Nome do Morador': r.name || '',
        'WhatsApp / Telefone': r.phone || '',
        'E-mail': r.email || '',
        'Tipo': r.is_primary ? 'Titular' : 'Dependente',
        'Status': r.active !== false ? 'Ativo' : 'Inativo',
      });
    }
  });

  // Cria a planilha principal
  const ws = XLSX.utils.json_to_sheet(rows);

  // Ajusta a largura das colunas para visualização perfeita
  ws['!cols'] = [
    { wch: 16 }, // Bloco
    { wch: 16 }, // Apartamento
    { wch: 34 }, // Nome do Morador
    { wch: 22 }, // WhatsApp / Telefone
    { wch: 32 }, // E-mail
    { wch: 18 }, // Tipo
    { wch: 14 }, // Status
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Moradores e Unidades');

  // Segunda aba: Resumo do Condomínio
  const occupiedUnitsCount = units.filter((u) =>
    residents.some(
      (r) =>
        r.unit_id === u.id ||
        (r.unit?.block === u.block && r.unit?.unit_number === u.unit_number)
    )
  ).length;

  const vacantUnitsCount = Math.max(0, units.length - occupiedUnitsCount);

  const summaryRows = [
    { 'Informação': 'Condomínio', 'Valor': condoName || 'Condomínio' },
    { 'Informação': 'Data de Exportação', 'Valor': new Date().toLocaleString('pt-BR') },
    { 'Informação': 'Total de Unidades / Apartamentos', 'Valor': units.length },
    { 'Informação': 'Total de Moradores Cadastrados', 'Valor': residents.length },
    { 'Informação': 'Unidades com Moradores', 'Valor': occupiedUnitsCount },
    { 'Informação': 'Unidades Vagas', 'Valor': vacantUnitsCount },
    { 'Informação': 'Sistema', 'Valor': 'CondoBox - Gestão de Portaria Inteligente' },
  ];

  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 32 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Resumo Geral');

  // Nome do arquivo com timestamp
  const sanitizedName = (condoName || 'Condominio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `CondoBox_${sanitizedName}_Moradores_${dateStr}.xlsx`;

  // Dispara o download local imediato
  XLSX.writeFile(wb, filename);
}
