import { Metadata } from 'next';
import { Suspense } from 'react';
import LoginPage from './page';

export const metadata: Metadata = {
  title: 'Login — CondoBox',
  description: 'Acesse o sistema de encomendas do seu condomínio',
};

export default function LoginLayout() {
  return (
    <Suspense>
      <LoginPage />
    </Suspense>
  );
}
