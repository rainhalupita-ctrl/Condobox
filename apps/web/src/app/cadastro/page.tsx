'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Building2, User, Phone, Mail, Lock, Eye, EyeOff, ChevronDown, Loader2, CheckCircle } from 'lucide-react';
import Link from 'next/link';

interface Unit {
  id: string;
  block: string;
  unit_number: string;
}

export default function CadastroPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  // Carregar unidades do condomínio
  useEffect(() => {
    supabase
      .from('units')
      .select('id, block, unit_number')
      .order('block')
      .order('unit_number')
      .then(({ data }) => {
        setUnits((data as Unit[]) || []);
        setLoadingUnits(false);
      });
  }, []);

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    if (password.length < 6) {
      setError('A senha deve ter no mínimo 6 caracteres.');
      return;
    }
    if (!unitId) {
      setError('Selecione seu apartamento/unidade.');
      return;
    }

    setLoading(true);

    // 1. Criar usuário no Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name, phone: phone.replace(/\D/g, '') },
      },
    });

    if (authError || !authData.user) {
      setError(authError?.message === 'User already registered'
        ? 'Este e-mail já está cadastrado. Faça login.'
        : 'Erro ao criar conta. Tente novamente.');
      setLoading(false);
      return;
    }

    const userId = authData.user.id;

    // 2. Criar perfil com role RESIDENT
    const { error: profileError } = await supabase.from('profiles').insert({
      id: userId,
      name,
      phone: phone.replace(/\D/g, ''),
      role: 'RESIDENT',
    });

    if (profileError) {
      setError('Erro ao salvar perfil. Contate o suporte.');
      setLoading(false);
      return;
    }

    // 3. Vincular como residente na unidade selecionada
    await supabase.from('residents').insert({
      unit_id: unitId,
      user_id: userId,
      name,
      phone: phone.replace(/\D/g, ''),
      email,
      is_primary: true,
      is_authorized_receiver: true,
      active: true,
    });

    setSuccess(true);
    setLoading(false);

    // Redirecionar após 2s
    setTimeout(() => router.push('/morador'), 2000);
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4"
        style={{ background: 'radial-gradient(ellipse at top left, #0f2027, #203a43, #2c5364)' }}>
        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={40} className="text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Cadastro realizado!</h2>
          <p className="text-slate-400">Redirecionando para sua área...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 py-12"
      style={{ background: 'radial-gradient(ellipse at top left, #0f2027, #203a43, #2c5364)' }}>
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-3"
            style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
            <Building2 size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Criar conta de Morador</h1>
          <p className="text-slate-400 text-sm mt-1">Preencha os dados para se cadastrar no condomínio</p>
        </div>

        <form onSubmit={handleSubmit}
          className="rounded-2xl border border-slate-700 bg-slate-900/70 backdrop-blur-md p-6 space-y-4 shadow-2xl">

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          {/* Nome */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Nome completo</label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="João da Silva"
                className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
              />
            </div>
          </div>

          {/* Telefone */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Celular / WhatsApp</label>
            <div className="relative">
              <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="tel"
                required
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
              />
            </div>
          </div>

          {/* E-mail */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">E-mail</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
              />
            </div>
          </div>

          {/* Unidade */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Seu Apartamento / Unidade</label>
            <div className="relative">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <select
                required
                value={unitId}
                onChange={e => setUnitId(e.target.value)}
                disabled={loadingUnits}
                className="w-full pl-9 pr-8 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm appearance-none focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition disabled:opacity-50"
              >
                <option value="">
                  {loadingUnits ? 'Carregando unidades...' : 'Selecione seu apartamento'}
                </option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.block} — Apto {u.unit_number}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            </div>
          </div>

          {/* Senha */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Senha</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPass ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="w-full pl-9 pr-10 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
              />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirmar Senha */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Confirmar Senha</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPass ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repita a senha"
                className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`w-full py-3 rounded-xl font-semibold text-white text-sm flex items-center justify-center gap-2 bg-green-600 transition-all ${
              loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-green-500 active:scale-[0.98]'
            }`}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            {loading ? 'Criando conta...' : 'Criar conta de Morador'}
          </button>

          <p className="text-center text-slate-500 text-xs pt-1">
            Ao se cadastrar, você concorda com o uso dos seus dados para fins de controle de encomendas.
          </p>
        </form>

        <p className="text-center text-slate-500 text-sm mt-6">
          Já tem conta?{' '}
          <Link href="/login" className="text-green-400 hover:text-green-300 font-medium">
            Fazer login
          </Link>
        </p>
      </div>
    </div>
  );
}
