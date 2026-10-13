import fs from 'fs';
import path from 'path';

export interface VisualGenerationOptions {
  prompt: string;
  imagePrompt: string;
  style?: string;
  aspectRatio?: string; // 16:9, 9:16, 1:1
  sceneNumber: number;
  projectId: string;
  topic?: string;
}

export class VisualGeneratorService {
  private static getStorageDir(): string {
    const dir = path.join(__dirname, '../../../public/media/visuals');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Generates visual image asset for a scene.
   */
  static async generateVisual(options: VisualGenerationOptions): Promise<string> {
    const storageDir = this.getStorageDir();
    const filename = `scene_${options.projectId}_${options.sceneNumber}_${Date.now()}.bmp`;
    const filePath = path.join(storageDir, filename);
    const publicUrl = `/media/visuals/${filename}`;

    const openaiKey = process.env.OPENAI_API_KEY;

    // Ensure user topic is strictly included in the final image prompt
    const effectivePrompt = options.topic && !options.imagePrompt.toLowerCase().includes(options.topic.toLowerCase())
      ? `${options.topic}, ${options.imagePrompt}`
      : options.imagePrompt;

    if (openaiKey && openaiKey.trim() !== '') {
      try {
        const url = await this.generateDallE(effectivePrompt, openaiKey);
        if (url) {
          const res = await fetch(url);
          if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            const pngPath = filePath.replace('.bmp', '.png');
            fs.writeFileSync(pngPath, Buffer.from(arrayBuffer));
            return publicUrl.replace('.bmp', '.png');
          }
        }
      } catch (err) {
        console.warn('DALL-E generation failed, using procedural visual artwork:', err);
      }
    }

    // Try Pollinations.ai (Free AI image API)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout
    try {
      const encodedPrompt = encodeURIComponent(`${effectivePrompt}, ${options.style || 'cinematic'} lighting, ultra detailed 8k cinematic masterpiece`);
      const width = options.aspectRatio === '9:16' ? 720 : options.aspectRatio === '1:1' ? 800 : 1280;
      const height = options.aspectRatio === '9:16' ? 1280 : options.aspectRatio === '1:1' ? 800 : 720;
      const pollinationsUrl = `https://pollinations.ai/p/${encodedPrompt}?width=${width}&height=${height}&seed=${options.sceneNumber + 42}&nologo=true`;

      const res = await fetch(pollinationsUrl, { signal: controller.signal });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const pngPath = filePath.replace('.bmp', '.png');
        fs.writeFileSync(pngPath, Buffer.from(arrayBuffer));
        return publicUrl.replace('.bmp', '.png');
      }
    } catch (err) {
      console.log('Pollinations API fetch timed out, creating procedural visual artwork');
    } finally {
      clearTimeout(timeoutId);
    }

    // High quality procedural 24-bit BMP raster image generator (compatible natively with FFmpeg)
    this.createProceduralBmpVisual(filePath, options);
    return publicUrl;
  }

  private static async generateDallE(prompt: string, apiKey: string): Promise<string | null> {
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: prompt.slice(0, 950),
          n: 1,
          size: '1024x1024'
        })
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.data?.[0]?.url || null;
    } catch (err) {
      console.warn('Error calling OpenAI DALL-E API:', err);
      return null;
    }
  }

  /**
   * Generates a valid 24-bit uncompressed BMP raster image file natively readable by FFmpeg and browsers.
   */
  public static createProceduralBmpVisual(
    filePath: string,
    options: VisualGenerationOptions
  ): void {
    const width = options.aspectRatio === '9:16' ? 720 : options.aspectRatio === '1:1' ? 800 : 1280;
    const height = options.aspectRatio === '9:16' ? 1280 : options.aspectRatio === '1:1' ? 800 : 720;
    const style = (options.style || 'cinematic').toLowerCase();
    const seed = (options.sceneNumber * 137) % 360;

    // BMP Row padding to 4 bytes
    const rowSize = Math.floor((24 * width + 31) / 32) * 4;
    const pixelArraySize = rowSize * height;
    const fileSize = 54 + pixelArraySize;

    const buffer = Buffer.alloc(fileSize);

    // BMP Header (14 bytes)
    buffer.write('BM', 0); // Signature
    buffer.writeUInt32LE(fileSize, 2); // File size
    buffer.writeUInt32LE(0, 6); // Reserved
    buffer.writeUInt32LE(54, 10); // Offset to pixel data

    // DIB Header (40 bytes - BITMAPINFOHEADER)
    buffer.writeUInt32LE(40, 14); // Header size
    buffer.writeInt32LE(width, 18); // Width
    buffer.writeInt32LE(height, 22); // Height (positive = bottom-up)
    buffer.writeUInt16LE(1, 26); // Color planes
    buffer.writeUInt16LE(24, 28); // Bits per pixel (24-bit RGB)
    buffer.writeUInt32LE(0, 30); // Compression (0 = BI_RGB)
    buffer.writeUInt32LE(pixelArraySize, 34); // Image size
    buffer.writeInt32LE(2835, 38); // Horizontal resolution (pixels/m)
    buffer.writeInt32LE(2835, 42); // Vertical resolution
    buffer.writeUInt32LE(0, 46); // Colors in palette
    buffer.writeUInt32LE(0, 50); // Important colors

    // Theme color palette selection tailored to actual scene topic & prompt
    const textContext = `${options.topic || ''} ${options.prompt} ${options.imagePrompt}`.toLowerCase();
    let rTop = 20, gTop = 15, bTop = 10;
    let rMid = 80, gMid = 55, bMid = 30;
    let rBot = 220, gBot = 165, bBot = 75; // Default warm golden cinematic atmosphere

    if (textContext.match(/pyramid|egypt|desert|ancient|pharaoh|tomb|dune|sand/)) {
      // Ancient Egypt: warm golden sands, terracotta & amber
      rTop = 28; gTop = 16; bTop = 8;
      rMid = 145; gMid = 85; bMid = 35;
      rBot = 245; gBot = 185; bBot = 75;
    } else if (textContext.match(/nature|forest|jungle|tree|mountain|river|green|meadow/)) {
      // Nature: deep forest emerald & golden canopy
      rTop = 8; gTop = 28; bTop = 18;
      rMid = 24; gMid = 78; bMid = 45;
      rBot = 110; gBot = 195; bBot = 90;
    } else if (textContext.match(/ocean|sea|underwater|water|beach|marine|aquatic/)) {
      // Ocean: deep navy azure & cyan radiance
      rTop = 5; gTop = 15; bTop = 35;
      rMid = 12; gMid = 65; bMid = 115;
      rBot = 45; gBot = 180; bBot = 215;
    } else if (textContext.match(/space|galaxy|cosmos|star|nebula|astronomy|planet/)) {
      // Deep Space: cosmic void & nebula violet
      rTop = 6; gTop = 4; bTop = 18;
      rMid = 35; gMid = 15; bMid = 65;
      rBot = 120; gBot = 140; bBot = 230;
    } else if (style.includes('cyberpunk') || textContext.match(/cyberpunk|neon|synth|futuristic/)) {
      // Cyberpunk: neon magenta & cyan
      rTop = 10; gTop = 5; bTop = 27;
      rMid = 42; gMid = 14; bMid = 78;
      rBot = 6; gBot = 182; bBot = 212;
    } else if (style.includes('anime')) {
      rTop = 13; gTop = 37; bTop = 63;
      rMid = 30; gMid = 95; bMid = 116;
      rBot = 243; gBot = 148; bBot = 34;
    }

    // Render gradient + sun glow pixel data into buffer
    for (let y = 0; y < height; y++) {
      const rowOffset = 54 + (height - 1 - y) * rowSize; // BMP stores bottom-to-top
      const factor = y / height;

      for (let x = 0; x < width; x++) {
        const offset = rowOffset + x * 3;

        // Gradient color computation
        let r = factor < 0.5 
          ? rTop + (rMid - rTop) * (factor * 2) 
          : rMid + (rBot - rMid) * ((factor - 0.5) * 2);
        let g = factor < 0.5 
          ? gTop + (gMid - gTop) * (factor * 2) 
          : gMid + (gBot - gMid) * ((factor - 0.5) * 2);
        let b = factor < 0.5 
          ? bTop + (bMid - bTop) * (factor * 2) 
          : bMid + (bBot - bMid) * ((factor - 0.5) * 2);

        // Add glowing celestial sun / core
        const dx = x - width * 0.45;
        const dy = y - height * 0.35;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const sunRadius = Math.min(width, height) * 0.18;

        if (dist < sunRadius) {
          const sunIntensity = 1 - (dist / sunRadius);
          r = Math.min(255, r + 240 * sunIntensity);
          g = Math.min(255, g + 200 * sunIntensity);
          b = Math.min(255, b + 140 * sunIntensity);
        }

        // BMP format stores colors as BGR
        buffer[offset] = Math.floor(Math.max(0, Math.min(255, b)));
        buffer[offset + 1] = Math.floor(Math.max(0, Math.min(255, g)));
        buffer[offset + 2] = Math.floor(Math.max(0, Math.min(255, r)));
      }
    }

    fs.writeFileSync(filePath, buffer);
  }
}
