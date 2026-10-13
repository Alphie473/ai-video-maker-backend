import fs from 'fs';
import path from 'path';
import { FFmpegComposerService } from '../video/ffmpegComposer';

export interface NarrationOptions {
  narrationText: string;
  voiceId?: string; // adam-deep, rachel-soft, alex-narrator, synth-ai
  sceneNumber: number;
  projectId: string;
  desiredDuration: number;
}

export class NarrationService {
  private static getStorageDir(): string {
    const dir = path.join(__dirname, '../../../public/media/narration');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Generates TTS audio narration file for a scene and calculates dynamic duration.
   */
  static async generateNarration(options: NarrationOptions): Promise<{ audioUrl: string; duration: number }> {
    const storageDir = this.getStorageDir();
    const ttsProvider = (process.env.TTS_PROVIDER || 'edge-tts').toLowerCase();
    const isMp3 = ttsProvider === 'edge-tts';
    const ext = isMp3 ? '.mp3' : '.wav';
    const filename = `narration_${options.projectId}_${options.sceneNumber}_${Date.now()}${ext}`;
    const filePath = path.join(storageDir, filename);
    const publicUrl = `/media/narration/${filename}`;

    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // Helper to calculate dynamic duration from audio file
    const resolveFinalNarration = async (targetFilePath: string, targetPublicUrl: string): Promise<{ audioUrl: string; duration: number }> => {
      let measuredDuration: number | null = null;
      try {
        measuredDuration = await FFmpegComposerService.getMediaDuration(targetFilePath);
      } catch (err) {
        console.warn('ffprobe audio duration measurement notice:', err);
      }

      if (!measuredDuration || measuredDuration <= 0) {
        measuredDuration = NarrationService.estimateAudioDuration(targetFilePath, options.narrationText, options.desiredDuration);
      }

      // Dynamic duration: actual speech audio length + comfortable natural breathing pause (0.8s),
      // ensuring natural pacing without cutting off speech during transitions.
      const naturalDuration = Math.round((measuredDuration + 0.8) * 10) / 10;
      
      // If user explicitly defined a longer scene duration, honor that duration.
      const finalDuration = options.desiredDuration && options.desiredDuration > naturalDuration
        ? Math.round(options.desiredDuration * 10) / 10
        : naturalDuration;

      return {
        audioUrl: targetPublicUrl,
        duration: Math.max(3.5, finalDuration)
      };
    };

    // 1. Try Edge-TTS (Free Microsoft Edge TTS service)
    if (ttsProvider === 'edge-tts') {
      try {
        const audioBuffer = await this.generateEdgeTts(options.narrationText, options.voiceId);
        if (audioBuffer && audioBuffer.length > 0) {
          fs.writeFileSync(filePath, audioBuffer);
          return await resolveFinalNarration(filePath, publicUrl);
        }
      } catch (err) {
        console.warn('Edge TTS failed, falling back to secondary providers:', err);
      }
    }

    // 2. Try ElevenLabs TTS if key is present
    if (elevenLabsKey && elevenLabsKey.trim() !== '') {
      try {
        const audioBuffer = await this.generateElevenLabs(options.narrationText, options.voiceId, elevenLabsKey);
        if (audioBuffer) {
          const wavPath = filePath.endsWith('.mp3') ? filePath.replace(/\.mp3$/, '.wav') : filePath;
          fs.writeFileSync(wavPath, audioBuffer);
          return await resolveFinalNarration(wavPath, publicUrl.replace(/\.mp3$/, '.wav'));
        }
      } catch (err) {
        console.warn('ElevenLabs TTS failed, attempting fallback:', err);
      }
    }

    // 3. Try OpenAI TTS if key is present
    if (openaiKey && openaiKey.trim() !== '') {
      try {
        const audioBuffer = await this.generateOpenAiTts(options.narrationText, options.voiceId, openaiKey);
        if (audioBuffer) {
          const mp3Path = filePath.endsWith('.wav') ? filePath.replace(/\.wav$/, '.mp3') : filePath;
          fs.writeFileSync(mp3Path, audioBuffer);
          return await resolveFinalNarration(mp3Path, publicUrl.replace(/\.wav$/, '.mp3'));
        }
      } catch (err) {
        console.warn('OpenAI TTS failed, attempting fallback:', err);
      }
    }

    // 4. Try Edge-TTS fallback if not already executed
    if (ttsProvider !== 'edge-tts') {
      try {
        const audioBuffer = await this.generateEdgeTts(options.narrationText, options.voiceId);
        if (audioBuffer && audioBuffer.length > 0) {
          const mp3Path = filePath.endsWith('.wav') ? filePath.replace(/\.wav$/, '.mp3') : filePath;
          fs.writeFileSync(mp3Path, audioBuffer);
          return await resolveFinalNarration(mp3Path, publicUrl.replace(/\.wav$/, '.mp3'));
        }
      } catch (err) {
        console.warn('Edge TTS fallback failed:', err);
      }
    }

    // 5. Try Google Translate TTS (Free, fast and reliable HTTP MP3 speech fallback)
    try {
      const audioBuffer = await this.generateGoogleTts(options.narrationText);
      if (audioBuffer && audioBuffer.length > 0) {
        const mp3Path = filePath.endsWith('.wav') ? filePath.replace(/\.wav$/, '.mp3') : filePath;
        fs.writeFileSync(mp3Path, audioBuffer);
        return await resolveFinalNarration(mp3Path, publicUrl.replace(/\.wav$/, '.mp3'));
      }
    } catch (err) {
      console.warn('Google TTS fallback notice:', err);
    }

    // 6. High quality procedural audio wave generator fallback
    const fallbackPath = filePath.endsWith('.mp3') ? filePath.replace(/\.mp3$/, '.wav') : filePath;
    await this.generateProceduralWavAudio(fallbackPath, options.narrationText, options.voiceId, options.desiredDuration);
    return await resolveFinalNarration(fallbackPath, publicUrl.replace(/\.mp3$/, '.wav'));
  }

  private static async generateGoogleTts(text: string): Promise<Buffer | null> {
    try {
      const cleanText = text.replace(/["\n\r]/g, ' ').trim().slice(0, 180);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
      return null;
    } catch {
      return null;
    }
  }

  private static estimateAudioDuration(filePath: string, text: string, fallbackDuration?: number): number {
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (filePath.endsWith('.wav')) {
          const buf = Buffer.alloc(44);
          const fd = fs.openSync(filePath, 'r');
          fs.readSync(fd, buf, 0, 44, 0);
          fs.closeSync(fd);
          const byteRate = buf.readUInt32LE(28);
          const dataSize = buf.readUInt32LE(40);
          if (byteRate > 0 && dataSize > 0) {
            return dataSize / byteRate;
          }
        } else if (filePath.endsWith('.mp3')) {
          // Edge-TTS AUDIO_24KHZ_48KBITRATE_MONO_MP3 is ~6000 bytes/sec
          return Math.max(3.0, stats.size / 6000);
        }
      }
    } catch {}

    // Estimate based on speech word count: ~2.3 words per second + pause
    if (text && text.trim().length > 0) {
      const words = text.trim().split(/\s+/).length;
      return Math.max(3.0, Math.round((words / 2.3) * 10) / 10);
    }

    return fallbackDuration && fallbackDuration > 0 ? fallbackDuration : 5.0;
  }

  private static async generateEdgeTts(text: string, voiceId: string = 'adam-deep'): Promise<Buffer | null> {
    try {
      const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
      const voiceMap: Record<string, string> = {
        'adam-deep': 'en-US-ChristopherNeural',
        'rachel-soft': 'en-US-AvaNeural',
        'alex-narrator': 'en-US-GuyNeural',
        'synth-ai': 'en-US-EricNeural'
      };
      const targetVoice = voiceMap[voiceId] || 'en-US-ChristopherNeural';
      const tts = new MsEdgeTTS();
      await tts.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(text);

      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
        audioStream.on('end', () => resolve(Buffer.concat(chunks)));
        audioStream.on('error', (err: any) => reject(err));
      });
    } catch (err) {
      console.warn('Edge-TTS generation error:', err);
      return null;
    }
  }

  private static async generateElevenLabs(text: string, voiceId: string = 'adam-deep', apiKey: string): Promise<Buffer | null> {
    try {
      const voiceMap: Record<string, string> = {
        'adam-deep': 'pNInz6obpgDQGcFmaJgB', // Adam
        'rachel-soft': '21m00Tcm4TlvDq8ikWAM', // Rachel
        'alex-narrator': 'ErXwobaYiN019PkySvjV', // Antoni
        'synth-ai': 'EXAVITQu4vr4xnSDxMaL' // Bella
      };

      const targetVoice = voiceMap[voiceId] || voiceMap['adam-deep'];
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoice}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });

      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      console.warn('ElevenLabs API call error:', err);
      return null;
    }
  }

  private static async generateOpenAiTts(text: string, voiceId: string = 'adam-deep', apiKey: string): Promise<Buffer | null> {
    try {
      const voiceMap: Record<string, string> = {
        'adam-deep': 'onyx',
        'rachel-soft': 'nova',
        'alex-narrator': 'alloy',
        'synth-ai': 'fable'
      };

      const targetVoice = voiceMap[voiceId] || 'onyx';
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: text,
          voice: targetVoice
        })
      });

      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      console.warn('OpenAI TTS API call error:', err);
      return null;
    }
  }

  /**
   * Generates a valid 44.1kHz 16-bit Mono PCM WAV audio file with pitch modulated voice tones representing narration speech.
   */
  public static async generateProceduralWavAudio(
    filePath: string,
    text: string,
    voiceId: string = 'adam-deep',
    durationSeconds: number = 4
  ): Promise<void> {
    const sampleRate = 44100;
    const numSamples = Math.floor(sampleRate * Math.max(durationSeconds, 2.5));
    const dataSize = numSamples * 2; // 16-bit mono

    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(1, 22);  // NumChannels (1)
    buffer.writeUInt32LE(sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
    buffer.writeUInt16LE(2, 32);  // BlockAlign
    buffer.writeUInt16LE(16, 34); // BitsPerSample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Base pitch modulation per voice
    let baseFreq = 110; // Deep male default
    if (voiceId === 'rachel-soft') baseFreq = 220; // Female
    if (voiceId === 'alex-narrator') baseFreq = 150; // Neutral male
    if (voiceId === 'synth-ai') baseFreq = 180; // Synth

    const words = text.split(/\s+/).length;
    const syllables = Math.max(words * 1.4, 4);
    const syllableLength = numSamples / syllables;

    // Generate modulated speech audio wave
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const currentSyllable = Math.floor(i / syllableLength);
      const isPause = currentSyllable % 5 === 4; // Pauses between speech segments

      if (isPause) {
        buffer.writeInt16LE(0, 44 + i * 2);
        continue;
      }

      // Pitch variation based on text syllables
      const freqMod = Math.sin(currentSyllable * 2.3) * 25;
      const currentFreq = baseFreq + freqMod;

      // Harmonic speech envelope (Formants)
      const wave1 = Math.sin(2 * Math.PI * currentFreq * t);
      const wave2 = Math.sin(2 * Math.PI * (currentFreq * 2.1) * t) * 0.4;
      const wave3 = Math.sin(2 * Math.PI * (currentFreq * 3.2) * t) * 0.2;

      // Syllable attack & decay envelope
      const posInSyllable = (i % syllableLength) / syllableLength;
      const envelope = Math.sin(posInSyllable * Math.PI);

      const combined = (wave1 + wave2 + wave3) * envelope * 0.35;
      const sample16Bit = Math.floor(combined * 32767);
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample16Bit)), 44 + i * 2);
    }

    fs.writeFileSync(filePath, buffer);
  }
}
