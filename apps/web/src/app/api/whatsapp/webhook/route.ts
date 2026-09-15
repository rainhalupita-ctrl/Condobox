import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const RELATION_KEYWORDS = [
  'esposa', 'esposo', 'marido', 'filho', 'filha', 'mae', 'mãe', 'pai',
  'irmao', 'irmão', 'irma', 'irmã', 'sobrinho', 'sobrinha', 'primo', 'prima',
  'tio', 'tia', 'namorado', 'namorada', 'noivo', 'noiva', 'sogro', 'sogra',
  'cunhado', 'cunhada', 'diarista', 'secretaria', 'secretária', 'vizinho',
  'vizinha', 'amigo', 'amiga', 'porteiro', 'zelador', 'faxineira', 'terceiro'
];

function cleanName(str: string): string {
  const cleaned = str
    .replace(/^(?:o|a|os|as|meu|minha|o meu|a minha|um|uma|sr|sra|dona|seu)\s+/i, '')
    .replace(/\b(?:vai|que vai|pode|pra|para|buscar|retirar|pegar|hoje|depois|mais tarde|a tarde|amanha|amanhã|ok|obrigado|obrigada|valeu|por favor)\b.*/gi, '')
    .replace(/[^\w\sÀ-ÿ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function extractThirdParty(rawText: string): { name: string; relation: string | null } | null {
  const raw = rawText.trim();
  const norm = normalizeText(raw);

  if (/\b(eu mesmo|eu mesma|eu proprio|eu propria|vou eu|eu que vou|eu quem vou|pessoalmente)\b/i.test(norm)) {
    return null;
  }

  // 1. "Quem vai buscar é minha esposa Maria" / "Quem vai pegar é o Carlos"
  const quemVai = raw.match(/\bquem vai (?:buscar|retirar|pegar|descer)\s+(?:e|eh|é)\s+(?:o|a|meu|minha|o meu|a minha)?\s*([a-zA-ZÀ-ÿ\s]+)/i);
  if (quemVai && quemVai[1]) {
    let captured = quemVai[1].trim();
    let foundRelation: string | null = null;
    let candidate = captured;

    for (const rel of RELATION_KEYWORDS) {
      const relRegex = new RegExp(`^${rel}\\s+`, 'i');
      if (relRegex.test(candidate)) {
        foundRelation = rel.toLowerCase();
        candidate = candidate.replace(relRegex, '');
        break;
      } else if (new RegExp(`^${rel}$`, 'i').test(candidate)) {
        foundRelation = rel.toLowerCase();
        candidate = rel.charAt(0).toUpperCase() + rel.slice(1).toLowerCase();
        break;
      }
    }

    const finalName = cleanName(candidate);
    if (finalName && finalName.length >= 2) {
      return { name: finalName, relation: foundRelation };
    }
  }

  // 2. "Pode entregar para o Carlos" / "Pode liberar pro João da Silva"
  const entrega = raw.match(/\b(?:pode entregar|entrega|pode liberar|libera|liberado|autorizo|autorizado|autoriza)\s+(?:para|pro|pra|ao|a)?\s+(?:o|a|meu|minha)?\s*([a-zA-ZÀ-ÿ\s]+)/i);
  if (entrega && entrega[1]) {
    let captured = entrega[1].trim();
    let foundRelation: string | null = null;

    for (const rel of RELATION_KEYWORDS) {
      const relRegex = new RegExp(`^${rel}\\s+`, 'i');
      if (relRegex.test(captured)) {
        foundRelation = rel.toLowerCase();
        captured = captured.replace(relRegex, '');
        break;
      } else if (new RegExp(`^${rel}$`, 'i').test(captured)) {
        foundRelation = rel.toLowerCase();
        captured = rel.charAt(0).toUpperCase() + rel.slice(1).toLowerCase();
        break;
      }
    }

    const finalName = cleanName(captured);
    if (finalName && finalName.length >= 2) {
      return { name: finalName, relation: foundRelation || 'autorizado' };
    }
  }

  // 3. "Minha esposa Maria vai buscar" / "Meu filho João vai retirar"
  const relacaoVai = new RegExp(
    `\\b(?:meu|minha|o|a)?\\s*(${RELATION_KEYWORDS.join('|')})\\s+([a-zA-ZÀ-ÿ\\s]+?)\\s+(?:vai|que vai|pode)\\s+(?:buscar|retirar|pegar)`,
    'i'
  );
  const matchRelacao = raw.match(relacaoVai);
  if (matchRelacao && matchRelacao[1] && matchRelacao[2]) {
    const finalName = cleanName(matchRelacao[2]);
    if (finalName && finalName.length >= 2) {
      return { name: finalName, relation: matchRelacao[1].toLowerCase() };
    }
  }

  // 4. "Minha esposa vai retirar" / "Meu filho vai buscar" (sem nome próprio)
  const relacaoSozinha = new RegExp(
    `\\b(?:meu|minha|o|a)\\s+(${RELATION_KEYWORDS.join('|')})\\s+(?:vai|que vai|pode)\\s+(?:buscar|retirar|pegar)`,
    'i'
  );
  const matchSozinha = raw.match(relacaoSozinha);
  if (matchSozinha && matchSozinha[1]) {
    const rel = matchSozinha[1].toLowerCase();
    return { name: rel.charAt(0).toUpperCase() + rel.slice(1).toLowerCase(), relation: rel };
  }

  // 5. "Vou pedir pro meu irmão Pedro buscar"
  const pedir = raw.match(/\b(?:vou pedir|pedi|vou mandar|mandei)\s+(?:para|pro|pra|ao|a)\s+(?:o|a|meu|minha)?\s*([a-zA-ZÀ-ÿ\s]+?)\s+(?:buscar|retirar|pegar)/i);
  if (pedir && pedir[1]) {
    let captured = pedir[1].trim();
    let foundRelation: string | null = null;
    for (const rel of RELATION_KEYWORDS) {
      const relRegex = new RegExp(`^${rel}\\s+`, 'i');
      if (relRegex.test(captured)) {
        foundRelation = rel.toLowerCase();
        captured = captured.replace(relRegex, '');
        break;
      }
    }
    const finalName = cleanName(captured);
    if (finalName && finalName.length >= 2) {
      return { name: finalName, relation: foundRelation };
    }
  }

  return null;
}

async function sendWhatsAppMessage(phone: string, text: string) {
  const evolutionUrl = process.env.EVOLUTION_API_URL;
  const evolutionKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME || 'portaria';

  if (!evolutionUrl || !evolutionKey) return false;

  let cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone.startsWith('55') && cleanPhone.length >= 10) cleanPhone = `55${cleanPhone}`;

  try {
    const res = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evolutionKey,
      },
      body: JSON.stringify({ number: cleanPhone, text }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Aceita formato Evolution API (messages.upsert) ou payload genérico
    const messageData = body?.data || body;
    const key = messageData?.key || {};
    if (key?.fromMe) {
      return NextResponse.json({ ignored: true, reason: 'fromMe' });
    }

    const remoteJid: string = key?.remoteJid || body?.remoteJid || '';
    if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('broadcast')) {
      return NextResponse.json({ ignored: true, reason: 'group or broadcast' });
    }

    const text: string =
      messageData?.message?.conversation ||
      messageData?.message?.extendedTextMessage?.text ||
      body?.text ||
      '';

    if (!text || !text.trim()) {
      return NextResponse.json({ ignored: true, reason: 'empty text' });
    }

    const rawPhone = remoteJid.replace(/@s\.whatsapp\.net|@lid|\D/g, '');
    let cleanPhone = rawPhone;
    if (cleanPhone.startsWith('55') && cleanPhone.length > 11) {
      cleanPhone = cleanPhone.slice(2);
    }

    const supabase = getSupabase();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Busca morador e encomendas pendentes
    const { data: residents } = await supabase
      .from('residents')
      .select('id, name, phone, unit:units(block, unit_number)')
      .ilike('phone', `%${cleanPhone.slice(-8)}%`);

    const resident = residents?.[0];
    const residentName = resident?.name || 'Morador(a)';

    // Busca encomendas pendentes (RECEIVED ou NOTIFIED)
    let packageQuery = supabase
      .from('packages')
      .select('id, pickup_code, qr_token, carrier, notes, status, delivered_to_name')
      .in('status', ['RECEIVED', 'NOTIFIED']);

    if (resident?.id) {
      packageQuery = packageQuery.eq('resident_id', resident.id);
    } else {
      // Tenta por telefone nas notas ou destinatário
      packageQuery = packageQuery.ilike('notes', `%${cleanPhone.slice(-8)}%`);
    }

    const { data: pendingPkgs } = await packageQuery;
    if (!pendingPkgs || pendingPkgs.length === 0) {
      return NextResponse.json({ ignored: true, reason: 'no pending packages' });
    }

    const norm = normalizeText(text);
    const webBaseUrl = process.env.WEB_APP_URL || 'https://web-eight-rust-97.vercel.app';

    // 1. Contestação
    const isContest = /\b(nao e meu|nao eh meu|nao pedi|nao comprei|nao reconheco|deve ser engano|pacote errado|destinatario errado|nao autorizo)\b/i.test(norm);
    if (isContest) {
      const nowIso = new Date().toISOString();
      for (const p of pendingPkgs) {
        await supabase
          .from('packages')
          .update({ notes: `${p.notes || ''} | CONTESTADO_PELO_MORADOR: ${text} em ${nowIso}` })
          .eq('id', p.id);
      }
      await sendWhatsAppMessage(
        rawPhone,
        `⚠️ *REGISTRO DE NÃO RECONHECIMENTO DE ENCOMENDA*\n\n` +
        `Olá, *${residentName}*!\n\n` +
        `Registramos no sistema que você *não reconhece* a encomenda recebida.\n` +
        `A equipe da portaria já foi avisada para conferência física do pacote.\n\n` +
        `Agradecemos o aviso! 🏢 Portaria do Condomínio`
      );
      return NextResponse.json({ success: true, action: 'contested' });
    }

    // 2. Terceiro Autorizado ("Quem vai buscar é minha esposa Maria", "Pode entregar pro Carlos", etc.)
    const thirdParty = extractThirdParty(text);
    if (thirdParty && thirdParty.name) {
      const nowIso = new Date().toISOString();
      const relationLabel = thirdParty.relation ? ` (${thirdParty.relation})` : '';

      for (const p of pendingPkgs) {
        const noteEntry = `TERCEIRO_AUTORIZADO: ${thirdParty.name}${relationLabel} via WhatsApp em ${nowIso}`;
        const updatedNotes = p.notes ? `${p.notes} | ${noteEntry}` : noteEntry;
        await supabase
          .from('packages')
          .update({
            notes: updatedNotes,
            delivered_to_name: thirdParty.name,
            status: p.status === 'RECEIVED' ? 'NOTIFIED' : p.status,
          })
          .eq('id', p.id);

        // Broadcast realtime
        try {
          const bridge = supabase.channel('packages-morador-live');
          bridge.subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
              bridge.send({
                type: 'broadcast',
                event: 'package-authorized',
                payload: {
                  packageId: p.id,
                  pickupCode: p.pickup_code,
                  isThirdParty: true,
                  thirdPartyName: thirdParty.name,
                  notes: updatedNotes,
                },
              }).catch(() => {});
              setTimeout(() => {
                try { supabase.removeChannel(bridge); } catch {}
              }, 1000);
            }
          });
        } catch {}
      }

      let replyMsg = '';
      if (pendingPkgs.length === 1) {
        const pkg = pendingPkgs[0];
        const token = pkg.qr_token || pkg.pickup_code;
        const pickupUrl = `${webBaseUrl}/p/${token}`;
        const carrier = pkg.carrier || 'Encomenda';
        replyMsg =
          `🤝 *RETIRADA POR TERCEIRO AUTORIZADA!*\n\n` +
          `Olá, *${residentName}*! 👋\n\n` +
          `Registramos no sistema da portaria que *${thirdParty.name}*${relationLabel} está autorizado(a) a retirar sua encomenda da *${carrier}*.\n\n` +
          `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
          `📱 *Link do QR Code para repassar:*\n${pickupUrl}\n\n` +
          `🏢 A pessoa autorizada só precisa apresentar este código ou QR Code no balcão da portaria.`;
      } else {
        const items = pendingPkgs.map((pkg: any, idx: number) => {
          const token = pkg.qr_token || pkg.pickup_code;
          const pickupUrl = `${webBaseUrl}/p/${token}`;
          const carrier = pkg.carrier || 'Encomenda';
          return `📦 *${idx + 1}. ${carrier}*\n🔑 *Código:* *${pkg.pickup_code}*\n📱 *QR Code:* ${pickupUrl}`;
        }).join('\n\n');

        replyMsg =
          `🤝 *RETIRADA POR TERCEIRO AUTORIZADA!*\n\n` +
          `Olá, *${residentName}*! 👋\n\n` +
          `Registramos no sistema da portaria que *${thirdParty.name}*${relationLabel} está autorizado(a) a retirar suas *${pendingPkgs.length} encomendas*:\n\n` +
          `${items}\n\n` +
          `🏢 A pessoa autorizada só precisa apresentar os códigos ou QR Codes na portaria para retirar.`;
      }

      await sendWhatsAppMessage(rawPhone, replyMsg);
      return NextResponse.json({ success: true, action: 'authorized_third_party', thirdParty });
    }

    // 3. Ciência / Retirada Pessoal ("Eu mesmo", "OK", "Ciente", "Vou buscar", etc.)
    const isSelfOrAck =
      /\b(eu mesmo|eu mesma|vou eu|pessoalmente|ok|ciente|show|beleza|blz|valeu|vlw|obrigad[ao]|vou buscar|to descendo|tô descendo|pode deixar|confirmado|sim)\b/i.test(norm) ||
      text.includes('👍') ||
      text.includes('✅');

    if (isSelfOrAck) {
      const nowIso = new Date().toISOString();
      for (const p of pendingPkgs) {
        const noteEntry = `CIENTE:${nowIso}`;
        const updatedNotes = p.notes ? `${p.notes};${noteEntry}` : noteEntry;
        await supabase
          .from('packages')
          .update({
            notes: updatedNotes,
            status: p.status === 'RECEIVED' ? 'NOTIFIED' : p.status,
          })
          .eq('id', p.id);
      }

      let replyMsg = '';
      if (pendingPkgs.length === 1) {
        const pkg = pendingPkgs[0];
        const token = pkg.qr_token || pkg.pickup_code;
        const pickupUrl = `${webBaseUrl}/p/${token}`;
        const carrier = pkg.carrier || 'Encomenda';
        replyMsg =
          `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
          `Que bom que você está ciente da sua encomenda da *${carrier}*, *${residentName}*!\n\n` +
          `🔑 *Código de Retirada:* *${pkg.pickup_code}*\n\n` +
          `📱 *Acesse seu QR Code para retirada aqui:*\n${pickupUrl}\n\n` +
          `🏢 Apresente o QR Code no balcão da portaria para retirar.`;
      } else {
        const items = pendingPkgs.map((pkg: any, idx: number) => {
          const token = pkg.qr_token || pkg.pickup_code;
          const pickupUrl = `${webBaseUrl}/p/${token}`;
          const carrier = pkg.carrier || 'Encomenda';
          return `📦 *${idx + 1}. ${carrier}*\n🔑 *Código:* *${pkg.pickup_code}*\n📱 *QR Code:* ${pickupUrl}`;
        }).join('\n\n');

        replyMsg =
          `👍 *CONFIRMAÇÃO DE CIÊNCIA REGISTRADA!*\n\n` +
          `Que bom que você está ciente das suas *${pendingPkgs.length} encomendas*, *${residentName}*!\n\n` +
          `${items}\n\n` +
          `🏢 Apresente os códigos ou QR Codes na portaria para retirar.`;
      }

      await sendWhatsAppMessage(rawPhone, replyMsg);
      return NextResponse.json({ success: true, action: 'acknowledged' });
    }

    return NextResponse.json({ received: true, text });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
