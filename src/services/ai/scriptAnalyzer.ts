export interface RawSceneData {
  sceneNumber: number;
  prompt: string;
  imagePrompt: string;
  narrationText: string;
  duration: number;
  cameraEffect: 'pan-right' | 'pan-left' | 'zoom-in' | 'zoom-out' | 'static';
  sfxTrack?: string;
  transition: 'fade' | 'crossfade' | 'dissolve' | 'wipe' | 'slide' | 'zoom';
}

export interface ScriptAnalysisResult {
  title: string;
  summary: string;
  suggestedStyle: string;
  suggestedMusicTrack: string;
  suggestedVoiceId: string;
  scenes: RawSceneData[];
}

/**
 * Service to analyze user text ideas or uploaded script files and produce structured scene storyboards.
 */
export class ScriptAnalyzerService {
  /**
   * Extracts the core topic/subject from the user's input prompt by stripping action wrappers.
   */
  public static extractMainTopic(prompt: string): string {
    const cleaned = prompt
      .trim()
      .replace(/^(create|make|generate|produce|build)\s+(a|an)?\s*(\d+[\s-]*(?:min|minute|sec|second)s?)?\s*(cinematic|epic|documentary|dramatic|anime|3d|photorealistic|short|long)?\s*(video|film|clip|story|trailer|movie)?\s*(about|of|on|showcasing|exploring|with|featuring)?\s*/i, '')
      .replace(/^(video|film|clip|story|trailer)\s+(about|of|on|exploring|showcasing|featuring)\s+/i, '')
      .trim();

    return cleaned.length > 3 ? cleaned : prompt.trim();
  }

  /**
   * Parses requested target duration (in seconds) from user prompt if present.
   */
  public static parseDurationFromPrompt(prompt: string): number | undefined {
    // e.g. "2-minute", "2 minute", "2 minutes", "1.5 mins"
    const minMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:-|–|\s)?(?:min|minute)s?\b/i);
    if (minMatch) {
      const mins = parseFloat(minMatch[1]);
      if (!isNaN(mins) && mins > 0) return Math.round(mins * 60);
    }
    // e.g. "45-second", "45 second", "45 seconds", "90s"
    const secMatch = prompt.match(/(\d+)\s*(?:-|–|\s)?(?:sec|second)s?\b/i);
    if (secMatch) {
      const secs = parseInt(secMatch[1], 10);
      if (!isNaN(secs) && secs > 0) return secs;
    }
    return undefined;
  }

  /**
   * Analyzes an idea or script and breaks it down into scenes.
   */
  static async analyzeScript(
    userPrompt: string,
    requestedStyle: string = 'cinematic',
    preferredDuration?: number
  ): Promise<ScriptAnalysisResult> {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    const mainTopic = this.extractMainTopic(userPrompt);
    const targetDuration = preferredDuration || this.parseDurationFromPrompt(userPrompt);

    let rawResult: ScriptAnalysisResult | null = null;

    // Check Gemini API key first (Free AI script breakdown engine)
    if (geminiKey && geminiKey.trim() !== '') {
      try {
        rawResult = await this.analyzeWithGemini(userPrompt, mainTopic, requestedStyle, geminiKey, targetDuration);
      } catch (err) {
        console.warn('Gemini Script Analyzer failed, trying secondary fallback:', err);
      }
    }

    if (!rawResult && openaiKey && openaiKey.trim() !== '') {
      try {
        rawResult = await this.analyzeWithOpenAI(userPrompt, mainTopic, requestedStyle, openaiKey, targetDuration);
      } catch (err) {
        console.warn('OpenAI Script Analyzer failed, trying secondary fallback:', err);
      }
    }

    // High quality intelligent template engine fallback
    if (!rawResult) {
      rawResult = this.generateIntelligentBreakdown(userPrompt, requestedStyle, targetDuration);
    }

    // Post-process all scenes to strictly enforce main topic alignment & timeline consistency
    return this.enforceTopicAndDurationAlignment(rawResult, mainTopic, targetDuration, requestedStyle);
  }

  private static async analyzeWithOpenAI(
    userPrompt: string,
    mainTopic: string,
    style: string,
    apiKey: string,
    targetDuration?: number
  ): Promise<ScriptAnalysisResult> {
    const durationNote = targetDuration
      ? `The user requested an approximate total video duration of ${targetDuration} seconds. Divide this into scenes accordingly (between 4 and 8 scenes, with scene durations between 5 and 25 seconds).`
      : `Provide between 4 and 6 scenes with natural scene durations (between 5 and 15 seconds each).`;

    const systemPrompt = `You are an expert film director and AI video producer. Analyze the user's video idea or script.
CRITICAL TOPIC REQUIREMENT:
The core topic is: "${mainTopic}".
Every scene's "imagePrompt" and "prompt" MUST strictly depict and center on "${mainTopic}".
Do NOT substitute generic futuristic explorers or neon cities unless explicitly requested in "${mainTopic}".

${durationNote}

Return a JSON object with:
- title: concise catchy video title directly reflecting "${mainTopic}"
- summary: 1 sentence concept summary
- suggestedStyle: video visual style (${style})
- suggestedMusicTrack: ambient-epic, sci-fi-synth, lo-fi-chill, dramatic-tension, or upbeat-synth
- suggestedVoiceId: adam-deep, rachel-soft, alex-narrator, or synth-ai
- scenes: array of scene objects:
  - sceneNumber (1, 2, 3...)
  - prompt: short visual scene summary featuring ${mainTopic}
  - imagePrompt: detailed prompt for AI image generator specifically depicting ${mainTopic} (include cinematic lighting, shot type, color palette, style: ${style})
  - narrationText: engaging narrative voiceover for this scene (ensure narration text has enough substance for the duration, ~2.5 words per second)
  - duration: estimated duration in seconds
  - cameraEffect: pan-right, pan-left, zoom-in, zoom-out, or static
  - sfxTrack: rain, wind, city, footsteps, whoosh, explosions, or none
  - transition: fade, crossfade, dissolve, wipe, slide, or zoom`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' }
      })
    });

    if (!res.ok) {
      throw new Error(`OpenAI API error ${res.status}`);
    }

    const data = await res.json();
    const rawContent = data.choices[0]?.message?.content || '';
    return this.cleanAndParseJson<ScriptAnalysisResult>(rawContent);
  }

  private static async analyzeWithGemini(
    userPrompt: string,
    mainTopic: string,
    style: string,
    apiKey: string,
    targetDuration?: number
  ): Promise<ScriptAnalysisResult> {
    const durationNote = targetDuration
      ? `The user requested an approximate total video length of ${targetDuration} seconds. Break the video into appropriate scenes to achieve this length.`
      : `Provide between 4 and 6 scenes.`;

    const prompt = `Analyze this video idea into a cinematic JSON script breakdown.
CRITICAL TOPIC REQUIREMENT:
The core video topic is strictly: "${mainTopic}".
Every scene's "imagePrompt" and "prompt" MUST specifically depict and visualize "${mainTopic}".
Do NOT use generic explorers, neon cities, or unrelated sci-fi citadels unless specified in "${mainTopic}".
${durationNote}

Structure:
{
  "title": "Concise catchy title about ${mainTopic}",
  "summary": "1 sentence concept summary",
  "suggestedStyle": "${style}",
  "suggestedMusicTrack": "ambient-epic",
  "suggestedVoiceId": "adam-deep",
  "scenes": [
    {
      "sceneNumber": 1,
      "prompt": "Description specifically showcasing ${mainTopic}",
      "imagePrompt": "Detailed AI image prompt explicitly visualizing ${mainTopic} with cinematic lighting, ${style} aesthetic",
      "narrationText": "Engaging voiceover line matching the scene duration",
      "duration": 6,
      "cameraEffect": "zoom-in",
      "sfxTrack": "wind",
      "transition": "fade"
    }
  ]
}
User prompt: "${userPrompt}"`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
    const json = await res.json();
    const rawContent = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return this.cleanAndParseJson<ScriptAnalysisResult>(rawContent);
  }

  private static cleanAndParseJson<T>(rawText: string): T {
    let cleanText = rawText.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    return JSON.parse(cleanText) as T;
  }

  /**
   * Post-processes scene breakdowns to ensure every visual prompt is strictly anchored to the user's topic.
   */
  private static enforceTopicAndDurationAlignment(
    result: ScriptAnalysisResult,
    mainTopic: string,
    targetDuration: number | undefined,
    style: string
  ): ScriptAnalysisResult {
    const lowerTopic = mainTopic.toLowerCase();

    // Ensure title reflects topic if placeholder or generic
    if (!result.title || result.title === 'Cinematic Journey' || result.title === 'Title' || result.title === 'Generating Video...') {
      result.title = mainTopic.charAt(0).toUpperCase() + mainTopic.slice(1);
    }

    result.scenes = result.scenes.map((scene, idx) => {
      let imagePrompt = scene.imagePrompt || scene.prompt || mainTopic;
      let scenePrompt = scene.prompt || `Scene ${scene.sceneNumber}: ${mainTopic}`;

      // Strictly inject main topic into visual prompt if not already explicitly present
      if (!imagePrompt.toLowerCase().includes(lowerTopic)) {
        imagePrompt = `${mainTopic}, ${imagePrompt}`;
      }

      // Ensure style is included in image prompt
      if (style && !imagePrompt.toLowerCase().includes(style.toLowerCase())) {
        imagePrompt = `${imagePrompt}, ${style} style`;
      }

      // Ensure scene prompt mentions the topic
      if (!scenePrompt.toLowerCase().includes(lowerTopic)) {
        scenePrompt = `${scenePrompt} (${mainTopic})`;
      }

      // Ensure duration is reasonable
      const duration = typeof scene.duration === 'number' && scene.duration >= 3 ? scene.duration : 6.0;

      return {
        ...scene,
        sceneNumber: idx + 1,
        prompt: scenePrompt,
        imagePrompt,
        duration
      };
    });

    return result;
  }

  /**
   * Generates a dynamic, highly contextual scene breakdown when external APIs are offline or not provided.
   */
  public static generateIntelligentBreakdown(
    userPrompt: string,
    style: string = 'cinematic',
    preferredDuration?: number
  ): ScriptAnalysisResult {
    const mainTopic = this.extractMainTopic(userPrompt);
    const targetDuration = preferredDuration || this.parseDurationFromPrompt(userPrompt) || 24;
    const uppercaseTitle = mainTopic.charAt(0).toUpperCase() + mainTopic.slice(1);

    // Determine mood & theme based on user's actual topic
    const isSciFi = /cyberpunk|neon|future|alien|space|spaceship|galaxy|robot|sci-fi|android/i.test(mainTopic);
    const isNature = /nature|forest|ocean|sea|mountain|relaxing|rain|wildlife|animal|tree|river/i.test(mainTopic);
    const isHistory = /history|ancient|king|war|battle|castle|egypt|pyramid|tomb|pharaoh|rome|knight/i.test(mainTopic);
    const isAction = /chase|race|car|speed|explosion|fight|hero|combat/i.test(mainTopic);

    let musicTrack = 'ambient-epic';
    let voiceId = 'adam-deep';
    let defaultSfx = 'wind';

    if (isSciFi) {
      musicTrack = 'sci-fi-synth';
      voiceId = 'alex-narrator';
      defaultSfx = 'city';
    } else if (isNature) {
      musicTrack = 'lo-fi-chill';
      voiceId = 'rachel-soft';
      defaultSfx = 'rain';
    } else if (isHistory) {
      musicTrack = 'dramatic-tension';
      voiceId = 'adam-deep';
      defaultSfx = 'wind';
    } else if (isAction) {
      musicTrack = 'upbeat-synth';
      voiceId = 'synth-ai';
      defaultSfx = 'whoosh';
    }

    // Determine number of scenes and duration per scene based on targetDuration
    let sceneCount = 4;
    if (targetDuration >= 120) sceneCount = 6;
    else if (targetDuration >= 60) sceneCount = 5;

    const baseDuration = Math.round((targetDuration / sceneCount) * 10) / 10;

    // Narrative arcs dynamically tailored to the user's actual topic
    const sceneTemplates = [
      {
        prompt: `Grand cinematic opening establishing ${mainTopic}`,
        imagePrompt: `A breathtaking cinematic wide establishing shot of ${mainTopic}, sweeping vista, majestic atmospheric lighting, 8k resolution, ultra detailed, photorealistic, ${style} aesthetic`,
        narration: `Across time and imagination, few subjects capture the spirit of wonder like ${mainTopic}. Here, our journey begins.`,
        cameraEffect: 'pan-right' as const,
        sfx: defaultSfx,
        transition: 'fade' as const
      },
      {
        prompt: `Intricate close-up discovery within ${mainTopic}`,
        imagePrompt: `An intricate cinematic close-up shot capturing the hidden secrets and authentic details of ${mainTopic}, volumetric light rays, tactile textures, cinematic depth of field, 4k, ${style} lighting`,
        narration: `Delving deeper into ${mainTopic}, forgotten secrets and intricate details begin to reveal their true significance.`,
        cameraEffect: 'zoom-in' as const,
        sfx: 'whoosh',
        transition: 'crossfade' as const
      },
      {
        prompt: `Dramatic core reveal at the heart of ${mainTopic}`,
        imagePrompt: `An epic low-angle dramatic view revealing the central marvel of ${mainTopic}, monumental scale, striking chiaroscuro shadows, hyper-realistic detail, ${style} composition`,
        narration: `At the very heart of ${mainTopic}, the true scale of this marvel commands attention and inspires awe.`,
        cameraEffect: 'pan-left' as const,
        sfx: isHistory ? 'footsteps' : defaultSfx,
        transition: 'dissolve' as const
      },
      {
        prompt: `Climactic panoramic vision and lasting legacy of ${mainTopic}`,
        imagePrompt: `An awe-inspiring climactic panoramic perspective overlooking ${mainTopic}, golden sunset brilliance, atmospheric haze and light rays, epic cinematic framing, ${style} masterpiece`,
        narration: `The enduring story of ${mainTopic} echoes far into the future—a timeless testament to discovery and human imagination.`,
        cameraEffect: 'zoom-out' as const,
        sfx: defaultSfx,
        transition: 'slide' as const
      },
      {
        prompt: `Atmospheric perspective exploring the surroundings of ${mainTopic}`,
        imagePrompt: `A dramatic cinematic perspective exploring the wider environment surrounding ${mainTopic}, atmospheric depth, volumetric fog, dynamic lighting, ${style} realism`,
        narration: `Every vantage point surrounding ${mainTopic} paints an evocative picture of a world shaped by wonder.`,
        cameraEffect: 'pan-right' as const,
        sfx: defaultSfx,
        transition: 'crossfade' as const
      },
      {
        prompt: `Final reflection and iconic silhouette of ${mainTopic}`,
        imagePrompt: `An iconic cinematic parting shot of ${mainTopic}, twilight skies, ethereal glow, cinematic lens flare, masterclass lighting, ${style}`,
        narration: `As the horizon fades, the vision of ${mainTopic} remains etched in memory, an unforgettable story told.`,
        cameraEffect: 'zoom-in' as const,
        sfx: 'whoosh',
        transition: 'fade' as const
      }
    ];

    const scenes: RawSceneData[] = [];
    for (let i = 0; i < sceneCount; i++) {
      const template = sceneTemplates[i % sceneTemplates.length];
      scenes.push({
        sceneNumber: i + 1,
        prompt: template.prompt,
        imagePrompt: template.imagePrompt,
        narrationText: template.narration,
        duration: baseDuration,
        cameraEffect: template.cameraEffect,
        sfxTrack: template.sfx,
        transition: template.transition
      });
    }

    return {
      title: uppercaseTitle,
      summary: `A ${style} visual story centered on ${mainTopic}`,
      suggestedStyle: style,
      suggestedMusicTrack: musicTrack,
      suggestedVoiceId: voiceId,
      scenes
    };
  }
}
