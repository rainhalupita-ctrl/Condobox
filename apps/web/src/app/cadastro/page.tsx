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
  const [selectedBlock, setSelectedBlock] = useState('Bloco A');
  const [selectedUnitNumber, setSelectedUnitNumber] = useState('');
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
        if (data) {
          const uniqueMap = new Map<string, Unit>();
          (data as Unit[]).forEach((u) => {
            const key = `${(u.block || 'Bloco A').trim().toUpperCase()}__${(u.unit_number || '').trim()}`;
            if (!uniqueMap.has(key)) {
              uniqueMap.set(key, u);
            }
          });
          const deduped = Array.from(uniqueMap.values());
          setUnits(deduped);
          if (deduped.length > 0) {
            setSelectedBlock(deduped[0].block || 'Bloco A');
          }
        }
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

    const cleanPhone = phone.replace(/\D/g, '');

    try {
      // 1. Enviar para a API de Registro (Server-Side com confirmação imediata e zero trava de SMTP)
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone: cleanPhone,
          password,
          unitId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Erro ao realizar o cadastro. Tente novamente.');
        setLoading(false);
        return;
      }

      // 2. Fazer login automático com a senha cadastrada
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (loginError) {
        console.warn('Login pós cadastro:', loginError);
      }

      setSuccess(true);
      setLoading(false);

      // Redirecionar para o painel do morador
      setTimeout(() => {
        window.location.href = '/morador';
      }, 1500);
    } catch (err: any) {
      console.error('Erro inesperado no cadastro:', err);
      setError(err?.message || 'Erro de conexão ao processar o cadastro.');
      setLoading(false);
    }
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

          {/* Bloco e Apartamento Separados */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Bloco / Torre</label>
              <div className="relative">
                <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <select
                  required
                  value={selectedBlock}
                  onChange={e => {
                    setSelectedBlock(e.target.value);
                    setSelectedUnitNumber('');
                    setUnitId('');
                  }}
                  disabled={loadingUnits}
                  className="w-full pl-9 pr-8 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm appearance-none focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition disabled:opacity-50"
                >
                  {Array.from(new Set(units.map(u => u.block || 'Bloco A'))).sort().map(blockName => (
                    <option key={blockName} value={blockName}>
                      {blockName}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Apartamento</label>
              <div className="relative">
                <select
                  required
                  value={unitId}
                  onChange={e => {
                    setUnitId(e.target.value);
                    const found = units.find(u => u.id === e.target.value);
                    if (found) setSelectedUnitNumber(found.unit_number);
                  }}
                  disabled={loadingUnits}
                  className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm appearance-none focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition disabled:opacity-50 font-bold"
                >
                  <option value="">Selecione o apto...</option>
                  {units
                    .filter(u => (u.block || 'Bloco A').toUpperCase() === (selectedBlock || 'Bloco A').toUpperCase())
                    .sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }))
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        Apto {u.unit_number}
                      </option>
                    ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              </div>
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
