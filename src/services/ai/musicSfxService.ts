import fs from 'fs';
import path from 'path';

export class MusicSfxService {
  private static getMusicDir(): string {
    const dir = path.join(__dirname, '../../../public/media/audio/music');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private static getSfxDir(): string {
    const dir = path.join(__dirname, '../../../public/media/audio/sfx');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Ensures a background music track exists or generates a high-quality ambient audio WAV file for it.
   */
  static async getMusicTrackUrl(trackId: string = 'ambient-epic', totalDurationSeconds: number = 30): Promise<string> {
    const musicDir = this.getMusicDir();
    const filename = `${trackId}.wav`;
    const filePath = path.join(musicDir, filename);
    const publicUrl = `/media/audio/music/${filename}`;

    if (!fs.existsSync(filePath)) {
      await this.generateProceduralMusic(filePath, trackId, Math.max(totalDurationSeconds, 45));
    }

    return publicUrl;
  }

  /**
   * Ensures a sound effect file exists.
   */
  static async getSfxUrl(sfxId: string = 'wind', durationSeconds: number = 5): Promise<string> {
    const sfxDir = this.getSfxDir();
    const filename = `${sfxId}.wav`;
    const filePath = path.join(sfxDir, filename);
    const publicUrl = `/media/audio/sfx/${filename}`;

    if (!fs.existsSync(filePath)) {
      await this.generateProceduralSfx(filePath, sfxId, durationSeconds);
    }

    return publicUrl;
  }

  /**
   * Procedurally generates continuous cinematic ambient background music tracks.
   */
  public static async generateProceduralMusic(
    filePath: string,
    trackId: string,
    durationSeconds: number
  ): Promise<void> {
    const sampleRate = 44100;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const dataSize = numSamples * 2;

    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Chords and scale tones based on track style
    let chords = [130.81, 164.81, 196.00, 246.94]; // C major 7
    if (trackId === 'sci-fi-synth') chords = [146.83, 174.61, 220.00, 261.63]; // D minor 7
    if (trackId === 'dramatic-tension') chords = [110.00, 130.81, 164.81, 207.65]; // A minor 7
    if (trackId === 'lo-fi-chill') chords = [174.61, 220.00, 261.63, 329.63]; // F major 7

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;

      // Chord progression shift every 4 seconds
      const chordIndex = Math.floor(t / 4) % chords.length;
      const baseFreq = chords[chordIndex];

      // Layered synth pad + slow LFO filter swell
      const lfo = Math.sin(2 * Math.PI * 0.25 * t) * 0.5 + 0.5;
      const tone1 = Math.sin(2 * Math.PI * baseFreq * t);
      const tone2 = Math.sin(2 * Math.PI * (baseFreq * 1.5) * t) * 0.4;
      const tone3 = Math.sin(2 * Math.PI * (baseFreq * 2.0) * t) * 0.25;

      const combined = (tone1 + tone2 + tone3) * lfo * 0.18;
      const sample16Bit = Math.floor(combined * 32767);
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample16Bit)), 44 + i * 2);
    }

    fs.writeFileSync(filePath, buffer);
  }

  /**
   * Generates procedural ambient SFX (wind, rain, city noise, whoosh).
   */
  public static async generateProceduralSfx(
    filePath: string,
    sfxId: string,
    durationSeconds: number
  ): Promise<void> {
    const sampleRate = 44100;
    const numSamples = Math.floor(sampleRate * durationSeconds);
    const dataSize = numSamples * 2;

    const buffer = Buffer.alloc(44 + dataSize);

    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;

      if (sfxId === 'whoosh') {
        const envelope = Math.sin((i / numSamples) * Math.PI);
        const noise = Math.random() * 2 - 1;
        sample = noise * envelope * 0.4;
      } else if (sfxId === 'rain') {
        const noise = Math.random() * 2 - 1;
        sample = noise * 0.12;
      } else {
        // Wind / City hum
        const noise = Math.random() * 2 - 1;
        const swell = Math.sin(2 * Math.PI * 0.4 * t) * 0.5 + 0.5;
        sample = noise * swell * 0.15;
      }

      const sample16Bit = Math.floor(sample * 32767);
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, sample16Bit)), 44 + i * 2);
    }

    fs.writeFileSync(filePath, buffer);
  }
}
