/**
 * Motor de audio de alta fidelidad para alertas de salón y cocina.
 * Diseñado para superar las restricciones de autoplay de Chrome, iOS y Android.
 */

// Generador de audio WAV de campana en base64 para reproducción instantánea vía HTML5 Audio
function createBellWavDataUri(): string {
  const sampleRate = 22050
  const durationSec = 0.65
  const numSamples = Math.floor(sampleRate * durationSec)
  const buffer = new ArrayBuffer(44 + numSamples * 2)
  const view = new DataView(buffer)

  // Header RIFF
  view.setUint32(0, 0x52494646, false) // 'RIFF'
  view.setUint32(4, 36 + numSamples * 2, true)
  view.setUint32(8, 0x57415645, false) // 'WAVE'
  // Header fmt
  view.setUint32(12, 0x666d7420, false) // 'fmt '
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  // Header data
  view.setUint32(36, 0x64617461, false) // 'data'
  view.setUint32(40, numSamples * 2, true)

  // Generar tono doble de campana de restaurante (880Hz + 1320Hz armónico)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const envelope = Math.exp(-t * 5.5) // Caída natural de campana
    const tone1 = Math.sin(2 * Math.PI * 880 * t)
    const tone2 = Math.sin(2 * Math.PI * 1320 * t) * 0.6
    const sample = Math.max(-1, Math.min(1, (tone1 + tone2) * envelope * 0.8)) * 32767
    view.setInt16(44 + i * 2, sample, true)
  }

  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return 'data:audio/wav;base64,' + btoa(binary)
}

let bellAudioElement: HTMLAudioElement | null = null
let sharedAudioContext: AudioContext | null = null
let isUnlocked = false

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioCtx) return null
  if (!sharedAudioContext) {
    try {
      sharedAudioContext = new AudioCtx()
    } catch {
      return null
    }
  }
  return sharedAudioContext
}

// Desbloquear audio automáticamente con el primer toque o clic del usuario
export function unlockAudio() {
  if (isUnlocked) return
  try {
    const ctx = getAudioContext()
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    // Desbloquear elemento HTML5 Audio
    if (!bellAudioElement && typeof window !== 'undefined') {
      bellAudioElement = new Audio(createBellWavDataUri())
      bellAudioElement.volume = 1.0
      // Silencioso breve para que el navegador lo marque como interactuado
      bellAudioElement.play().then(() => {
        bellAudioElement?.pause()
        if (bellAudioElement) bellAudioElement.currentTime = 0
      }).catch(() => {})
    }
    isUnlocked = true
  } catch {}
}

if (typeof window !== 'undefined') {
  const handler = () => {
    unlockAudio()
    window.removeEventListener('click', handler)
    window.removeEventListener('touchstart', handler)
    window.removeEventListener('pointerdown', handler)
  }
  window.addEventListener('click', handler, { passive: true })
  window.addEventListener('touchstart', handler, { passive: true })
  window.addEventListener('pointerdown', handler, { passive: true })
}

/**
 * Reproduce el sonido de alerta urgente para el mesero o cocina.
 * Usa doble motor (HTML5 Audio + Web Audio API) para máxima compatibilidad móvil.
 */
export function playUrgentBell() {
  try {
    // 1. Intentar con elemento de audio HTML5
    if (!bellAudioElement && typeof window !== 'undefined') {
      bellAudioElement = new Audio(createBellWavDataUri())
      bellAudioElement.volume = 1.0
    }
    if (bellAudioElement) {
      bellAudioElement.currentTime = 0
      bellAudioElement.play().catch(() => {
        // Fallback a Web Audio si aún no se interactuó
      })
    }

    // 2. Ejecutar también con Web Audio API en paralelo para garantizar volumen alto
    const ctx = getAudioContext()
    if (ctx) {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }
      const now = ctx.currentTime
      const osc1 = ctx.createOscillator()
      const gain1 = ctx.createGain()
      osc1.type = 'sine'
      osc1.frequency.setValueAtTime(880, now)
      gain1.gain.setValueAtTime(0.6, now)
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
      osc1.connect(gain1)
      gain1.connect(ctx.destination)
      osc1.start(now)
      osc1.stop(now + 0.6)

      const osc2 = ctx.createOscillator()
      const gain2 = ctx.createGain()
      osc2.type = 'sine'
      osc2.frequency.setValueAtTime(1320, now + 0.08)
      gain2.gain.setValueAtTime(0.5, now + 0.08)
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7)
      osc2.connect(gain2)
      gain2.connect(ctx.destination)
      osc2.start(now + 0.08)
      osc2.stop(now + 0.7)
    }
  } catch (err) {
    console.warn('[Sound] Error al reproducir campana:', err)
  }
}
