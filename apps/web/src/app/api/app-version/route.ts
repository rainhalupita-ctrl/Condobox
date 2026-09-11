import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://isurnvsehvjdslpnxirn.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function getSupabaseAdmin() {
  return createSupabaseClient(supabaseUrl, supabaseServiceKey);
}

const PUBLIC_VERSION_STORAGE_URL = `${supabaseUrl}/storage/v1/object/public/labels/system/version.json`;

const DEFAULT_VERSIONS = {
  'condobox-desktop': {
    latest_version: '1.0.0',
    download_url: 'https://github.com/rainhalupita-ctrl/Condobox/releases/latest',
    release_notes: 'Versão estável do sistema CondoBox Portaria.',
    is_mandatory: false,
    updated_at: new Date().toISOString(),
  },
  'condobox-master': {
    latest_version: '1.0.0',
    download_url: 'https://github.com/rainhalupita-ctrl/Condobox/releases/latest',
    release_notes: 'Versão estável do painel CondoBox SaaS Master.',
    is_mandatory: false,
    updated_at: new Date().toISOString(),
  },
};

// Verifica autorização de Super Admin
async function verifyAdminAuth(request?: Request) {
  const supabaseAdmin = getSupabaseAdmin();
  let user: any = null;

  // 1. Tenta Bearer token
  const authHeader = request?.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.replace(/^bearer\s+/i, '').trim();
    if (token) {
      const { data: uData } = await supabaseAdmin.auth.getUser(token);
      if (uData?.user) user = uData.user;
    }
  }

  // 2. Fallback cookies
  if (!user) {
    try {
      const supabase = await createClient();
      const { data: uData } = await supabase.auth.getUser();
      user = uData?.user || null;
    } catch {}
  }

  if (!user) {
    return { error: 'Não autorizado.', status: 401 };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, role, condo_id')
    .eq('id', user.id)
    .maybeSingle();

  const userEmail = (user.email || '').toLowerCase();
  const superAdminEmails = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || 'rainhalupita@gmail.com,klebervenancio2002@icloud.com')
    .split(',')
    .map((e) => e.trim().toLowerCase());

  const isMaster =
    (profile?.role === 'ADMIN' && (!profile?.condo_id || superAdminEmails.includes(userEmail))) ||
    superAdminEmails.includes(userEmail);

  if (!isMaster) {
    return { error: 'Apenas o Dono do Sistema pode publicar versões.', status: 403 };
  }

  return { user };
}

// GET: Consulta pública da versão mais recente
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const appQuery = searchParams.get('app') || '';

    // Busca versão do Storage do Supabase (com cache-busting)
    let versionConfig = DEFAULT_VERSIONS;
    try {
      const res = await fetch(`${PUBLIC_VERSION_STORAGE_URL}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (res.ok) {
        versionConfig = await res.json();
      }
    } catch {}

    if (appQuery && (versionConfig as any)[appQuery]) {
      return NextResponse.json({
        app: appQuery,
        ...(versionConfig as any)[appQuery],
      });
    }

    return NextResponse.json(versionConfig);
  } catch (err: any) {
    console.error('[App Version API] Erro no GET:', err);
    return NextResponse.json(DEFAULT_VERSIONS);
  }
}

// POST: Publica uma nova versão (exclusivo para Super Admin)
export async function POST(request: Request) {
  try {
    const authCheck = await verifyAdminAuth(request);
    if ('error' in authCheck) {
      return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
    }

    const body = await request.json();
    const { app = 'condobox-desktop', latest_version, download_url, release_notes, is_mandatory = false } = body;

    if (!latest_version?.trim()) {
      return NextResponse.json({ error: 'O número da versão é obrigatório (ex: 1.0.1).' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Carrega o arquivo atual
    let currentConfig: any = DEFAULT_VERSIONS;
    try {
      const res = await fetch(`${PUBLIC_VERSION_STORAGE_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) currentConfig = await res.json();
    } catch {}

    // 2. Atualiza os dados do app selecionado
    currentConfig[app] = {
      latest_version: latest_version.trim(),
      download_url: download_url ? download_url.trim() : (currentConfig[app]?.download_url || ''),
      release_notes: release_notes ? release_notes.trim() : (currentConfig[app]?.release_notes || ''),
      is_mandatory: Boolean(is_mandatory),
      updated_at: new Date().toISOString(),
    };

    // 3. Salva no bucket público do Supabase Storage
    const jsonBuffer = Buffer.from(JSON.stringify(currentConfig, null, 2), 'utf-8');
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('labels')
      .upload('system/version.json', jsonBuffer, {
        contentType: 'application/json',
        upsert: true,
      });

    if (uploadErr) {
      return NextResponse.json({ error: `Erro ao gravar nova versão: ${uploadErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Versão ${latest_version} do ${app} publicada com sucesso!`,
      config: currentConfig[app],
    });
  } catch (err: any) {
    console.error('[App Version API] Erro no POST:', err);
    return NextResponse.json({ error: err.message || 'Erro ao publicar versão.' }, { status: 500 });
  }
}
