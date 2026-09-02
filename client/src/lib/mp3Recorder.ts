// @ts-ignore
import lamejs from 'lamejs';

export class Mp3Recorder {
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private pcmChunks: Float32Array[] = [];

  async start() {
    this.pcmChunks = [];
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    this.audioContext = new AudioContextClass();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
    
    // 4096 buffer size, 1 input channel, 1 output channel
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
    
    this.scriptProcessor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      this.pcmChunks.push(new Float32Array(inputData));
    };
    
    this.sourceNode.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  stop(): Blob {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor.onaudioprocess = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
    }
    
    const sampleRate = this.audioContext?.sampleRate || 44100;
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }

    let totalLength = 0;
    for (const chunk of this.pcmChunks) {
      totalLength += chunk.length;
    }
    const mergedPcm = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.pcmChunks) {
      mergedPcm.set(chunk, offset);
      offset += chunk.length;
    }

    const int16Samples = new Int16Array(mergedPcm.length);
    for (let i = 0; i < mergedPcm.length; i++) {
      const s = Math.max(-1, Math.min(1, mergedPcm[i]));
      int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const channels = 1; // Mono
    const kbps = 128;
    const mp3Encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const mp3Chunks: BlobPart[] = [];

    const sampleBlockSize = 1152;
    for (let i = 0; i < int16Samples.length; i += sampleBlockSize) {
      const chunk = int16Samples.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3Encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        mp3Chunks.push(new Uint8Array(mp3buf));
      }
    }

    const flushBuf = mp3Encoder.flush();
    if (flushBuf.length > 0) {
      mp3Chunks.push(new Uint8Array(flushBuf));
    }

    return new Blob(mp3Chunks, { type: 'audio/mp3' });
  }

  cancel() {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor.onaudioprocess = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    this.pcmChunks = [];
  }
}
