import fs from 'fs';
import path from 'path';

export interface VisualGenerationOptions {
  prompt: string;
  imagePrompt: string;
  style?: string;
  aspectRatio?: string; // 16:9, 9:16, 1:1
  sceneNumber: number;
  projectId: string;
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
    const filename = `scene_${options.projectId}_${options.sceneNumber}_${Date.now()}.svg`;
    const filePath = path.join(storageDir, filename);
    const publicUrl = `/media/visuals/${filename}`;

    const openaiKey = process.env.OPENAI_API_KEY;

    if (openaiKey && openaiKey.trim() !== '') {
      try {
        const url = await this.generateDallE(options.imagePrompt, openaiKey);
        if (url) {
          const res = await fetch(url);
          const arrayBuffer = await res.arrayBuffer();
          const pngPath = filePath.replace('.svg', '.png');
          fs.writeFileSync(pngPath, Buffer.from(arrayBuffer));
          return publicUrl.replace('.svg', '.png');
        }
      } catch (err) {
        console.warn('DALL-E generation failed, using procedural visual artwork:', err);
      }
    }

    // Try Pollinations.ai (Free AI image API)
    try {
      const encodedPrompt = encodeURIComponent(`${options.imagePrompt}, ${options.style || 'cinematic'} lighting, ultra detailed 8k cinematic masterpiece`);
      const width = options.aspectRatio === '9:16' ? 720 : options.aspectRatio === '1:1' ? 800 : 1280;
      const height = options.aspectRatio === '9:16' ? 1280 : options.aspectRatio === '1:1' ? 800 : 720;
      const pollinationsUrl = `https://pollinations.ai/p/${encodedPrompt}?width=${width}&height=${height}&seed=${options.sceneNumber + 42}&nologo=true`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

      const res = await fetch(pollinationsUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const pngPath = filePath.replace('.svg', '.png');
        fs.writeFileSync(pngPath, Buffer.from(arrayBuffer));
        return publicUrl.replace('.svg', '.png');
      }
    } catch (err) {
      console.log('Pollinations API fetch timed out, creating procedural visual artwork');
    }

    // High quality procedural SVG artwork generator
    this.createProceduralSvgVisual(filePath, options);
    return publicUrl;
  }

  private static async generateDallE(prompt: string, apiKey: string): Promise<string | null> {
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
    return data.data[0]?.url || null;
  }

  /**
   * Generates a high quality cinematic SVG artwork with gradient skies, glowing suns, starfield, mountain/city silhouettes, and protagonist figure.
   */
  public static createProceduralSvgVisual(
    filePath: string,
    options: VisualGenerationOptions
  ): void {
    const width = options.aspectRatio === '9:16' ? 720 : options.aspectRatio === '1:1' ? 800 : 1280;
    const height = options.aspectRatio === '9:16' ? 1280 : options.aspectRatio === '1:1' ? 800 : 720;
    const style = (options.style || 'cinematic').toLowerCase();
    const seed = (options.sceneNumber * 137) % 360;

    let skyGradStart = '#0b0c10';
    let skyGradMid = '#1f2833';
    let skyGradEnd = '#c5a059';
    let sunColor = '#fff9ee';
    let sunGlow = '#ff7832';

    if (style.includes('cyberpunk') || seed % 3 === 0) {
      skyGradStart = '#0a051b';
      skyGradMid = '#2a0e4e';
      skyGradEnd = '#06b6d4';
      sunColor = '#00f0ff';
      sunGlow = '#ff007f';
    } else if (style.includes('anime') || seed % 3 === 1) {
      skyGradStart = '#0d253f';
      skyGradMid = '#1e5f74';
      skyGradEnd = '#f39422';
      sunColor = '#fff5e6';
      sunGlow = '#ffaa33';
    }

    const sunX = width * 0.45;
    const sunY = height * 0.35;

    // Build star dots
    let starsSvg = '';
    for (let i = 0; i < 60; i++) {
      const cx = ((i * 19 + seed * 7) % width);
      const cy = ((i * 23 + seed * 3) % (height * 0.6));
      const r = (i % 3) * 0.8 + 0.8;
      starsSvg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="${(i % 5 + 3) / 10}" />`;
    }

    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${skyGradStart}" />
      <stop offset="45%" stop-color="${skyGradMid}" />
      <stop offset="85%" stop-color="${skyGradEnd}" />
      <stop offset="100%" stop-color="#07090e" />
    </linearGradient>

    <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${sunColor}" stop-opacity="1" />
      <stop offset="40%" stop-color="${sunGlow}" stop-opacity="0.6" />
      <stop offset="100%" stop-color="${sunGlow}" stop-opacity="0" />
    </radialGradient>

    <linearGradient id="vignette" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#000" stop-opacity="0.2" />
      <stop offset="100%" stop-color="#000" stop-opacity="0.6" />
    </linearGradient>
  </defs>

  <!-- Sky Background -->
  <rect width="100%" height="100%" fill="url(#skyGrad)" />

  <!-- Stars -->
  ${starsSvg}

  <!-- Glowing Sun / Core -->
  <circle cx="${sunX}" cy="${sunY}" r="${Math.min(width, height) * 0.25}" fill="url(#sunGlow)" />
  <circle cx="${sunX}" cy="${sunY}" r="${Math.min(width, height) * 0.08}" fill="${sunColor}" />

  <!-- Mountain Silhouette Layer 1 -->
  <path d="M0,${height} L0,${height * 0.55} Q${width * 0.25},${height * 0.42} ${width * 0.5},${height * 0.52} T${width},${height * 0.48} L${width},${height} Z" fill="rgba(15, 20, 35, 0.7)" />

  <!-- Mountain Silhouette Layer 2 -->
  <path d="M0,${height} L0,${height * 0.65} Q${width * 0.35},${height * 0.55} ${width * 0.7},${height * 0.68} T${width},${height * 0.6} L${width},${height} Z" fill="#0b0e17" />

  <!-- Hero Platform & Silhouette -->
  <ellipse cx="${width * 0.5}" cy="${height * 0.88}" rx="${width * 0.25}" ry="${height * 0.05}" fill="#040508" />
  
  <!-- Hero Figure -->
  <circle cx="${width * 0.5}" cy="${height * 0.76}" r="10" fill="#040508" />
  <rect x="${width * 0.5 - 8}" y="${height * 0.77}" width="16" height="36" rx="4" fill="#040508" />
  <rect x="${width * 0.5 - 11}" y="${height * 0.83}" width="9" height="28" fill="#040508" />
  <rect x="${width * 0.5 + 2}" y="${height * 0.83}" width="9" height="28" fill="#040508" />

  <!-- Vignette -->
  <rect width="100%" height="100%" fill="url(#vignette)" style="mix-blend-mode: multiply;" />

  <!-- Title Badge -->
  <rect x="25" y="25" width="120" height="32" rx="8" fill="rgba(0,0,0,0.6)" />
  <text x="37" y="46" font-family="sans-serif" font-size="14" font-weight="bold" fill="#06b6d4">SCENE #${options.sceneNumber}</text>
</svg>`;

    fs.writeFileSync(filePath, svgContent, 'utf8');
  }
}
