'use client';

import { useEffect } from 'react';

/**
 * CookieConsent: Garante silenciosamente as preferências operacionais no dispositivo
 * sem exibir banners intrusivos na tela de login ou portaria.
 */
export function CookieConsent() {
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        // Marca como aceito permanentemente no localStorage
        localStorage.setItem('condobox_cookie_consent', 'accepted');
        localStorage.setItem('condobox_camera_permanent', 'granted');
        localStorage.setItem('condobox_cache_enabled', 'true');

        // Marca cookie permanente com flags seguras (SameSite=Lax; Secure)
        const tenYears = 315360000;
        const isSecure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `condobox_cookie_consent=accepted; path=/; max-age=${tenYears}; SameSite=Lax${isSecure}`;
        document.cookie = `condobox_camera_permanent=granted; path=/; max-age=${tenYears}; SameSite=Lax${isSecure}`;
        document.cookie = `condobox_cache_enabled=true; path=/; max-age=${tenYears}; SameSite=Lax${isSecure}`;
      }
    } catch {
      // Ignora silenciosamente em ambientes restritos (Private Browsing / iframes)
    }
  }, []);

  return null;
}
