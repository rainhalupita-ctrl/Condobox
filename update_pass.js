
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://isurnvsehvjdslpnxirn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdXJudnNlaHZqZHNscG54aXJuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODAzNjM4NCwiZXhwIjoyMTAzNjEyMzg0fQ.2PO_jbeh-rpMmLFbN17aHbJwxHaQr8aeWi6A2hkg708'
);

async function run() {
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users.users.find(u => u.email === 'klebervenancio2002@icloud.com');
  
  const { data, error } = await supabase.auth.admin.updateUserById(
    user.id,
    { password: 'condobox2026' } 
  );
  
  if (error) {
    console.error('Erro:', error);
  } else {
    console.log('Senha atualizada com sucesso para: condobox2026');
  }
}

run();

