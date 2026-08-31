export function speakText(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  // Cancela a fala atual se houver
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'pt-BR';
  utterance.rate = 1.1; // Ligeiramente mais rápido
  utterance.pitch = 1.0;

  // Busca voz feminina do Google em pt-BR se possível, ou a padrão
  const voices = window.speechSynthesis.getVoices();
  const ptVoice = voices.find(v => v.lang === 'pt-BR' && v.name.includes('Google')) || voices.find(v => v.lang === 'pt-BR');
  
  if (ptVoice) {
    utterance.voice = ptVoice;
  }

  window.speechSynthesis.speak(utterance);
}
