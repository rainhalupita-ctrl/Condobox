/**
 * Serviço de Voz e Alertas Sonoros da Portaria (CondoBox)
 * Fala em voz alta as notificações e toca efeitos sonoros de confirmação.
 */

export class VoiceService {
  private static isVoiceEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('condobox_voice_alerts') !== 'false';
  }

  public static setVoiceEnabled(enabled: boolean) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('condobox_voice_alerts', enabled ? 'true' : 'false');
    }
  }

  /**
   * Fala uma frase em voz alta em Português do Brasil
   */
  public static speak(text: string) {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (!this.isVoiceEnabled()) return;

    try {
      window.speechSynthesis.cancel(); // Cancela fala anterior se houver
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.05; // Velocidade agradável e ágil
      utterance.pitch = 1.0;

      // Busca voz em português se disponível no sistema operacional
      const voices = window.speechSynthesis.getVoices();
      const ptVoice = voices.find(v => v.lang.startsWith('pt') || v.lang.includes('BR'));
      if (ptVoice) {
        utterance.voice = ptVoice;
      }

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[VoiceService] Erro ao sintetizar voz:', err);
    }
  }

  /**
   * Toca um bip sonoro de sucesso usando a Web Audio API (sem precisar de arquivos mp3 externos)
   */
  public static playSuccessBeep() {
    if (typeof window === 'undefined') return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Nota A5
      osc.frequency.exponentialRampToValueAtTime(1320, audioCtx.currentTime + 0.12); // Nota E6

      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.12);
    } catch {}
  }

  /**
   * Toca um bip sonoro de erro ou atenção
   */
  public static playErrorBeep() {
    if (typeof window === 'undefined') return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, audioCtx.currentTime);
      osc.frequency.setValueAtTime(180, audioCtx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch {}
  }
}
