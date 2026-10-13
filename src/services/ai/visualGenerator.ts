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
  duration?: number;
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
   * Generates visual image or video asset for a scene.
   */
  static async generateVisual(options: VisualGenerationOptions): Promise<string> {
    const storageDir = this.getStorageDir();
    const filename = `scene_${options.projectId}_${options.sceneNumber}_${Date.now()}.bmp`;
    const filePath = path.join(storageDir, filename);
    const publicUrl = `/media/visuals/${filename}`;

    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateKey = process.env.REPLICATE_API_KEY;
    const falKey = process.env.FAL_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    // Ensure user topic is strictly included in the final image prompt
    const effectivePrompt = options.topic && !options.imagePrompt.toLowerCase().includes(options.topic.toLowerCase())
      ? `${options.topic}, ${options.imagePrompt}`
      : options.imagePrompt;

    // 1. Try Google Veo (via configured GEMINI_API_KEY) for realistic moving video
    if (geminiKey && geminiKey.trim() !== '') {
      try {
        const videoBuffer = await this.generateGoogleVeoVideo(effectivePrompt, geminiKey, options.aspectRatio, options.duration);
        if (videoBuffer) {
          const mp4Filename = `scene_${options.projectId}_${options.sceneNumber}_${Date.now()}.mp4`;
          const mp4Path = path.join(storageDir, mp4Filename);
          fs.writeFileSync(mp4Path, videoBuffer);
          return `/media/visuals/${mp4Filename}`;
        }
      } catch (err: any) {
        console.warn('Google Veo video generation notice:', err.message || err);
      }
    }

    // 2. Try Replicate Text-to-Video if key is configured
    if (replicateKey && replicateKey.trim() !== '') {
      try {
        const videoUrl = await this.generateReplicateVideo(effectivePrompt, replicateKey, options.aspectRatio);
        if (videoUrl) {
          const res = await fetch(videoUrl);
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            const mp4Filename = `scene_${options.projectId}_${options.sceneNumber}_${Date.now()}.mp4`;
            const mp4Path = path.join(storageDir, mp4Filename);
            fs.writeFileSync(mp4Path, buffer);
            return `/media/visuals/${mp4Filename}`;
          }
        }
      } catch (err) {
        console.warn('Replicate video generation failed, falling back:', err);
      }
    }

    // 2. Try Fal.ai Text-to-Video if key is configured
    if (falKey && falKey.trim() !== '') {
      try {
        const videoUrl = await this.generateFalVideo(effectivePrompt, falKey, options.aspectRatio);
        if (videoUrl) {
          const res = await fetch(videoUrl);
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer());
            const mp4Filename = `scene_${options.projectId}_${options.sceneNumber}_${Date.now()}.mp4`;
            const mp4Path = path.join(storageDir, mp4Filename);
            fs.writeFileSync(mp4Path, buffer);
            return `/media/visuals/${mp4Filename}`;
          }
        }
      } catch (err) {
        console.warn('Fal.ai video generation failed, falling back:', err);
      }
    }

    // 3. Try DALL-E 3 image generation
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

    // Try Pollinations.ai (Free AI image API) with extended timeout and dynamic seed
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000); // 18s timeout for high-res AI generation
    try {
      const encodedPrompt = encodeURIComponent(`${effectivePrompt}, ${options.style || 'cinematic'} style, highly detailed`);
      const width = options.aspectRatio === '9:16' ? 720 : options.aspectRatio === '1:1' ? 800 : 1280;
      const height = options.aspectRatio === '9:16' ? 1280 : options.aspectRatio === '1:1' ? 800 : 720;
      const seed = Math.floor(Math.abs(Math.sin(options.sceneNumber * 997 + Date.now()) * 100000));
      const pollinationsUrl = `https://pollinations.ai/p/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

      const res = await fetch(pollinationsUrl, { signal: controller.signal });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const contentType = res.headers.get('content-type') || '';
        const isJpeg = contentType.includes('jpeg') || contentType.includes('jpg');
        const fileExt = isJpeg ? '.jpg' : '.png';
        const targetPath = filePath.replace('.bmp', fileExt);
        fs.writeFileSync(targetPath, Buffer.from(arrayBuffer));
        return publicUrl.replace('.bmp', fileExt);
      }
    } catch (err) {
      console.log('Pollinations API fetch timed out or offline, creating procedural visual artwork');
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

  private static async generateReplicateVideo(
    prompt: string,
    apiKey: string,
    aspectRatio?: string
  ): Promise<string | null> {
    try {
      const response = await fetch('https://api.replicate.com/v1/models/minimax/video-01/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          input: {
            prompt: prompt.slice(0, 500),
            prompt_optimizer: true
          }
        })
      });

      if (!response.ok) {
        // Fallback to zeroscope if minimax endpoint is busy or needs model-level routing
        const res2 = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            version: '9f747673945c628663f397019a9794b2f0b0d16387ac47c751279daac479440b',
            input: {
              prompt: prompt.slice(0, 300),
              num_frames: 24,
              fps: 24
            }
          })
        });
        if (!res2.ok) return null;
        const pred = await res2.json();
        return await this.pollReplicatePrediction(pred.urls?.get || `https://api.replicate.com/v1/predictions/${pred.id}`, apiKey);
      }

      const prediction = await response.json();
      return await this.pollReplicatePrediction(prediction.urls?.get || `https://api.replicate.com/v1/predictions/${prediction.id}`, apiKey);
    } catch (err) {
      console.warn('Replicate video generation notice:', err);
      return null;
    }
  }

  private static async pollReplicatePrediction(getUrl: string, apiKey: string): Promise<string | null> {
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const res = await fetch(getUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.status === 'succeeded') {
        const out = data.output;
        return typeof out === 'string' ? out : Array.isArray(out) ? out[0] : null;
      }
      if (data.status === 'failed' || data.status === 'canceled') return null;
    }
    return null;
  }

  private static async generateFalVideo(
    prompt: string,
    apiKey: string,
    aspectRatio?: string
  ): Promise<string | null> {
    try {
      const res = await fetch('https://queue.fal.run/fal-ai/minimax/video-01/text-to-video', {
        method: 'POST',
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt.slice(0, 500)
        })
      });
      if (!res.ok) return null;
      const queue = await res.json();
      if (!queue.status_url) return null;

      const maxAttempts = 25;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch(queue.status_url, {
          headers: { 'Authorization': `Key ${apiKey}` }
        });
        if (!statusRes.ok) continue;
        const statusData = await statusRes.json();
        if (statusData.status === 'COMPLETED') {
          const resultRes = await fetch(queue.response_url, {
            headers: { 'Authorization': `Key ${apiKey}` }
          });
          if (resultRes.ok) {
            const resultData = await resultRes.json();
            return resultData.video?.url || null;
          }
        }
        if (statusData.status === 'FAILED') return null;
      }
      return null;
    } catch (err) {
      console.warn('Fal.ai video generation notice:', err);
      return null;
    }
  }

  private static async generateGoogleVeoVideo(
    prompt: string,
    apiKey: string,
    aspectRatio?: string,
    duration?: number
  ): Promise<Buffer | null> {
    try {
      const ar = aspectRatio === '9:16' ? '9:16' : aspectRatio === '1:1' ? '1:1' : '16:9';
      const dur = Math.min(8, Math.max(4, Math.round(duration || 5)));

      const params: Record<string, any> = {
        sampleCount: 1,
        aspectRatio: ar
      };
      if (dur >= 4 && dur <= 8) {
        params.durationSeconds = dur;
      }

      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning', {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          instances: [
            {
              prompt: prompt.slice(0, 480)
            }
          ],
          parameters: params
        })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || `HTTP ${response.status}`;
        console.warn(`Google Veo request returned status ${response.status}: ${errMsg}`);
        return null;
      }

      const op = await response.json();
      if (!op.name) return null;

      // Poll long-running operation
      const maxAttempts = 30; // 30 * 5s = 150s timeout
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const checkRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${op.name}?key=${apiKey}`);
        if (!checkRes.ok) continue;

        const checkData = await checkRes.json();
        if (checkData.done) {
          if (checkData.error) {
            console.warn('Google Veo operation failed:', checkData.error.message);
            return null;
          }
          const videoObj = checkData.response?.generatedVideos?.[0]?.video;
          if (videoObj?.bytesBase64Encoded) {
            return Buffer.from(videoObj.bytesBase64Encoded, 'base64');
          }
          if (videoObj?.uri) {
            const dlRes = await fetch(videoObj.uri, {
              headers: { 'x-goog-api-key': apiKey }
            });
            if (dlRes.ok) {
              return Buffer.from(await dlRes.arrayBuffer());
            }
          }
          return null;
        }
      }
      return null;
    } catch (err: any) {
      console.warn('Google Veo execution error:', err.message || err);
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

    // Theme color palette selection tailored to actual scene topic, action & visual style
    const textContext = `${options.topic || ''} ${options.prompt} ${options.imagePrompt}`.toLowerCase();
    let rTop = 20, gTop = 15, bTop = 10;
    let rMid = 80, gMid = 55, bMid = 30;
    let rBot = 220, gBot = 165, bBot = 75; // Default warm golden cinematic atmosphere

    if (textContext.match(/sing|dance|dancing|singing|child|kid|joy|happy|celebrat/)) {
      // Cheerful / Dance / Kids: radiant sunrise coral, gold & warm magenta
      rTop = 38; gTop = 16; bTop = 42;
      rMid = 185; gMid = 75; bMid = 95;
      rBot = 255; gBot = 195; bBot = 90;
    } else if (textContext.match(/walk|walking|talk|talking|speak|discuss|conversation|street/)) {
      // Walk & Talk / Urban: elegant daylight slate, warm avenue amber
      rTop = 20; gTop = 28; bTop = 42;
      rMid = 70; gMid = 95; bMid = 120;
      rBot = 235; gBot = 210; bBot = 175;
    } else if (textContext.match(/cook|chef|food|kitchen|bake|pizza|pasta/)) {
      // Culinary: warm terracotta, saffron gold & olive warmth
      rTop = 38; gTop = 18; bTop = 12;
      rMid = 160; gMid = 75; bMid = 35;
      rBot = 245; gBot = 185; bBot = 65;
    } else if (textContext.match(/pyramid|egypt|desert|ancient|pharaoh|tomb|dune|sand/)) {
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
      // Anime: vibrant twilight blue to vivid sunrise orange
      rTop = 13; gTop = 37; bTop = 63;
      rMid = 30; gMid = 95; bMid = 116;
      rBot = 243; gBot = 148; bBot = 34;
    } else if (style.includes('documentary')) {
      // Documentary: warm archival sepia and authentic charcoal
      rTop = 24; gTop = 20; bTop = 18;
      rMid = 85; gMid = 75; bMid = 62;
      rBot = 215; gBot = 195; bBot = 165;
    } else if (style.includes('3d')) {
      // 3D Render: deep indigo with electric teal and magenta highlights
      rTop = 14; gTop = 10; bTop = 38;
      rMid = 28; gMid = 105; bMid = 165;
      rBot = 240; gBot = 125; bBot = 195;
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
