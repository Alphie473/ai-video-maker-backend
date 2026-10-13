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
   * Extracts the core topic/subject from the user's input prompt by stripping action wrappers while preserving key verbs.
   */
  public static extractMainTopic(prompt: string): string {
    const cleaned = prompt
      .trim()
      .replace(/^(?:please\s+)?(?:create|make|generate|produce|build|render)\s+(?:a|an)?\s*(?:\d+[\s-]*(?:min|minute|sec|second)s?)?\s*(?:cinematic|epic|documentary|dramatic|anime|3d|photorealistic|short|long)?\s*(?:video|film|clip|story|trailer|movie)?\s*(?:about|of|on|showcasing|exploring|with|featuring)?\s*/i, '')
      .replace(/^(?:video|film|clip|story|trailer)\s+(?:about|of|on|exploring|showcasing|featuring)\s+/i, '')
      .trim();

    return cleaned.length > 2 ? cleaned : prompt.trim();
  }

  /**
   * Returns photography and rendering aesthetic modifiers for the requested visual style.
   */
  public static getStyleVisualModifiers(style: string): string {
    const s = (style || 'cinematic').toLowerCase();
    if (s.includes('cyberpunk')) {
      return 'neon-lit reflections, glowing holograms, wet street reflections, vibrant cyan and magenta tones, futuristic cyberpunk aesthetic';
    }
    if (s.includes('anime')) {
      return 'vibrant anime aesthetic, Makoto Shinkai and Studio Ghibli inspired, expressive hand-drawn animation art, dynamic emotional skies, crisp lines';
    }
    if (s.includes('documentary')) {
      return 'authentic documentary cinematography, National Geographic style, candid natural daylight, realistic historical texture, authentic atmosphere';
    }
    if (s.includes('3d')) {
      return 'photorealistic 3D render, Octane Render, Unreal Engine 5 cinematic CGI, raytraced volumetric lighting, high fidelity details';
    }
    if (s.includes('photorealistic')) {
      return 'ultra-photorealistic 8k DSLR photography, Hasselblad medium format lens, razor-sharp focus, natural depth of field, authentic lifelike realism';
    }
    // Default cinematic
    return 'cinematic 35mm film still, anamorphic lens, masterclass volumetric lighting, rich color grading, cinematic motion picture frame';
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
    preferredDuration?: number,
    scriptText?: string
  ): Promise<ScriptAnalysisResult> {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    const mainTopic = this.extractMainTopic(userPrompt);
    const targetDuration = preferredDuration || this.parseDurationFromPrompt(userPrompt);

    let rawResult: ScriptAnalysisResult | null = null;

    // Check Gemini API key first (Free AI script breakdown engine)
    if (geminiKey && geminiKey.trim() !== '') {
      try {
        rawResult = await this.analyzeWithGemini(userPrompt, mainTopic, requestedStyle, geminiKey, targetDuration, scriptText);
      } catch (err) {
        console.warn('Gemini Script Analyzer failed, trying secondary fallback:', err);
      }
    }

    if (!rawResult && openaiKey && openaiKey.trim() !== '') {
      try {
        rawResult = await this.analyzeWithOpenAI(userPrompt, mainTopic, requestedStyle, openaiKey, targetDuration, scriptText);
      } catch (err) {
        console.warn('OpenAI Script Analyzer failed, trying secondary fallback:', err);
      }
    }

    // High quality intelligent template engine fallback
    if (!rawResult) {
      rawResult = this.generateIntelligentBreakdown(userPrompt, requestedStyle, targetDuration, scriptText);
    }

    // Post-process all scenes to strictly enforce main topic alignment & timeline consistency
    return this.enforceTopicAndDurationAlignment(rawResult, mainTopic, targetDuration, requestedStyle);
  }

  private static async analyzeWithOpenAI(
    userPrompt: string,
    mainTopic: string,
    style: string,
    apiKey: string,
    targetDuration?: number,
    scriptText?: string
  ): Promise<ScriptAnalysisResult> {
    const durationNote = targetDuration
      ? `The user requested an approximate total video duration of ${targetDuration} seconds. Divide this into scenes accordingly (between 4 and 8 scenes, with scene durations between 5 and 25 seconds).`
      : `Provide between 4 and 6 scenes with natural scene durations (between 5 and 15 seconds each).`;

    const scriptContext = scriptText && scriptText.trim()
      ? `\nUSER UPLOADED SCRIPT / NARRATION:\n${scriptText}\nUse this script text directly for the scene narrationText values.\n`
      : '';

    const styleModifiers = this.getStyleVisualModifiers(style);

    const systemPrompt = `You are an expert film director and AI video producer. Analyze the user's video idea or script.
CRITICAL TOPIC & STYLE REQUIREMENT:
The core topic/action is: "${mainTopic}".
The requested visual style is: "${style}" (${styleModifiers}).
Every scene's "imagePrompt" and "prompt" MUST strictly depict and center on "${mainTopic}" using the "${style}" aesthetic.
If the prompt describes specific human actions (e.g., singing, dancing, walking, talking, cooking), every scene MUST depict those exact actions authentically.
Do NOT substitute generic futuristic explorers, neon citadels, or irrelevant sci-fi tropes.

${durationNote}
${scriptContext}

Return a JSON object with:
- title: concise catchy video title directly reflecting "${mainTopic}"
- summary: 1 sentence concept summary
- suggestedStyle: ${style}
- suggestedMusicTrack: ambient-epic, sci-fi-synth, lo-fi-chill, dramatic-tension, or upbeat-synth
- suggestedVoiceId: adam-deep, rachel-soft, alex-narrator, or synth-ai
- scenes: array of scene objects:
  - sceneNumber (1, 2, 3...)
  - prompt: short visual scene summary featuring ${mainTopic}
  - imagePrompt: detailed prompt for AI image generator explicitly depicting ${mainTopic} (include cinematic lighting, shot type, color palette, style: ${styleModifiers})
  - narrationText: engaging narrative voiceover for this scene (~2.3 words per second matching duration)
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
    targetDuration?: number,
    scriptText?: string
  ): Promise<ScriptAnalysisResult> {
    const durationNote = targetDuration
      ? `The user requested an approximate total video length of ${targetDuration} seconds. Break the video into appropriate scenes to achieve this length.`
      : `Provide between 4 and 6 scenes.`;

    const scriptContext = scriptText && scriptText.trim()
      ? `\nUser's uploaded script:\n${scriptText}\nUse this script text directly for the scene narrationText values.\n`
      : '';

    const styleModifiers = this.getStyleVisualModifiers(style);

    const prompt = `Analyze this video idea into a cinematic JSON script breakdown.
CRITICAL TOPIC & STYLE REQUIREMENT:
The core video topic is strictly: "${mainTopic}".
The visual style is: "${style}" (${styleModifiers}).
Every scene's "imagePrompt" and "prompt" MUST specifically depict and visualize "${mainTopic}" in the "${style}" aesthetic.
If the prompt describes specific human actions (e.g. singing, dancing, walking, talking, cooking), depict those actions accurately.
Do NOT use generic explorers or irrelevant sci-fi citadels unless specified in "${mainTopic}".
${durationNote}
${scriptContext}

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
      "imagePrompt": "Detailed AI image prompt explicitly visualizing ${mainTopic} with ${styleModifiers}",
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
   * Post-processes scene breakdowns to ensure every visual prompt is strictly anchored to the user's topic and visual style.
   */
  private static enforceTopicAndDurationAlignment(
    result: ScriptAnalysisResult,
    mainTopic: string,
    targetDuration: number | undefined,
    style: string
  ): ScriptAnalysisResult {
    const lowerTopic = mainTopic.toLowerCase();
    const styleModifiers = this.getStyleVisualModifiers(style);

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

      // Ensure style modifiers are included in image prompt
      if (style && !imagePrompt.toLowerCase().includes(style.toLowerCase())) {
        imagePrompt = `${imagePrompt}, ${styleModifiers}`;
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
   * Completely avoids hardcoded placeholder tropes and dynamically constructs actions, visuals, and narration.
   */
  public static generateIntelligentBreakdown(
    userPrompt: string,
    style: string = 'cinematic',
    preferredDuration?: number,
    scriptText?: string
  ): ScriptAnalysisResult {
    const mainTopic = this.extractMainTopic(userPrompt);
    const targetDuration = preferredDuration || this.parseDurationFromPrompt(userPrompt) || 24;
    const uppercaseTitle = mainTopic.charAt(0).toUpperCase() + mainTopic.slice(1);
    const styleModifiers = this.getStyleVisualModifiers(style);

    // Determine mood & theme based on user's actual prompt
    const lower = `${userPrompt} ${mainTopic}`.toLowerCase();
    const isDanceOrMusic = /sing|dance|dancing|singing|song|music|choir|concert|instrument|guitar|piano|ballet|hip-hop/i.test(lower);
    const isWalkOrTalk = /walk|walking|talk|talking|speak|speaking|discuss|conversation|interview|stroll|chat/i.test(lower);
    const isCulinary = /cook|cooking|chef|food|kitchen|bake|baking|pizza|pasta|dish|meal|restaurant/i.test(lower);
    const isSciFi = /cyberpunk|neon|future|alien|space|spaceship|galaxy|robot|sci-fi|android/i.test(lower);
    const isNature = /nature|forest|ocean|sea|mountain|relaxing|rain|wildlife|animal|tree|river|meadow|garden/i.test(lower);
    const isHistory = /history|ancient|king|war|battle|castle|egypt|pyramid|tomb|pharaoh|rome|knight/i.test(lower);
    const isAction = /chase|race|car|speed|explosion|fight|hero|combat|run|running/i.test(lower);

    let musicTrack = 'ambient-epic';
    let voiceId = 'adam-deep';
    let defaultSfx = 'wind';

    if (isDanceOrMusic) {
      musicTrack = 'upbeat-synth';
      voiceId = 'rachel-soft';
      defaultSfx = 'whoosh';
    } else if (isWalkOrTalk) {
      musicTrack = 'lo-fi-chill';
      voiceId = 'alex-narrator';
      defaultSfx = 'footsteps';
    } else if (isCulinary) {
      musicTrack = 'lo-fi-chill';
      voiceId = 'rachel-soft';
      defaultSfx = 'whoosh';
    } else if (isSciFi) {
      musicTrack = 'sci-fi-synth';
      voiceId = 'synth-ai';
      defaultSfx = 'city';
    } else if (isNature) {
      musicTrack = 'ambient-epic';
      voiceId = 'rachel-soft';
      defaultSfx = 'wind';
    } else if (isHistory) {
      musicTrack = 'dramatic-tension';
      voiceId = 'adam-deep';
      defaultSfx = 'wind';
    } else if (isAction) {
      musicTrack = 'dramatic-tension';
      voiceId = 'adam-deep';
      defaultSfx = 'whoosh';
    }

    // Determine number of scenes
    let sceneCount = 4;
    if (targetDuration >= 120) sceneCount = 6;
    else if (targetDuration >= 60) sceneCount = 5;

    const baseDuration = Math.round((targetDuration / sceneCount) * 10) / 10;

    // Check if user uploaded a script with paragraphs or sentences
    if (scriptText && scriptText.trim().length > 30) {
      const paragraphs = scriptText
        .split(/\n\s*\n|\.\s+(?=[A-Z])/)
        .map(p => p.trim())
        .filter(p => p.length > 10);

      if (paragraphs.length >= 2) {
        const count = Math.min(paragraphs.length, sceneCount);
        const scriptScenes: RawSceneData[] = [];
        const perSceneDuration = Math.round((targetDuration / count) * 10) / 10;

        for (let i = 0; i < count; i++) {
          const textChunk = paragraphs[i];
          const sceneNum = i + 1;
          scriptScenes.push({
            sceneNumber: sceneNum,
            prompt: `Scene ${sceneNum}: ${mainTopic} - ${textChunk.slice(0, 80)}`,
            imagePrompt: `${mainTopic}, action scene illustrating "${textChunk.slice(0, 100)}", ${styleModifiers}`,
            narrationText: textChunk,
            duration: perSceneDuration,
            cameraEffect: i % 2 === 0 ? 'zoom-in' : 'pan-right',
            sfxTrack: defaultSfx,
            transition: i === 0 ? 'fade' : 'crossfade'
          });
        }

        return {
          title: uppercaseTitle,
          summary: `A ${style} presentation of ${mainTopic}`,
          suggestedStyle: style,
          suggestedMusicTrack: musicTrack,
          suggestedVoiceId: voiceId,
          scenes: scriptScenes
        };
      }
    }

    // Dynamic scene templates tailored strictly to the action and subject
    let sceneTemplates: Array<{
      prompt: string;
      imagePrompt: string;
      narration: string;
      cameraEffect: 'pan-right' | 'pan-left' | 'zoom-in' | 'zoom-out' | 'static';
      sfx: string;
      transition: 'fade' | 'crossfade' | 'dissolve' | 'wipe' | 'slide' | 'zoom';
    }> = [];

    if (isDanceOrMusic) {
      sceneTemplates = [
        {
          prompt: `Joyful opening introducing the performers engaging in ${mainTopic}`,
          imagePrompt: `A vibrant wide establishing shot of ${mainTopic}, bright energetic atmosphere, joyful smiling faces, rhythmic movement, ${styleModifiers}`,
          narration: `A spark of music and motion fills the air as ${mainTopic} begins, bringing genuine energy and rhythm to life.`,
          cameraEffect: 'pan-right',
          sfx: 'whoosh',
          transition: 'fade'
        },
        {
          prompt: `Expressive close-up capturing dynamic movements and emotions in ${mainTopic}`,
          imagePrompt: `Intimate close-up shot capturing dynamic movements, radiant smiles, and authentic emotion during ${mainTopic}, shallow depth of field, ${styleModifiers}`,
          narration: `Every movement and beat resonates with passion, capturing the infectious warmth and spirit of the moment.`,
          cameraEffect: 'zoom-in',
          sfx: defaultSfx,
          transition: 'crossfade'
        },
        {
          prompt: `Dynamic fluid motion shot highlighting the choreography and interaction in ${mainTopic}`,
          imagePrompt: `Dynamic low-angle motion shot highlighting synchronized movement and lively rhythm in ${mainTopic}, volumetric lighting, ${styleModifiers}`,
          narration: `Moving in lively harmony, the performance builds momentum, carrying an uplifting celebration of sound and motion.`,
          cameraEffect: 'pan-left',
          sfx: 'whoosh',
          transition: 'dissolve'
        },
        {
          prompt: `Grand celebratory finale of ${mainTopic}`,
          imagePrompt: `An uplifting climactic finale of ${mainTopic}, radiant golden lighting, triumphant celebratory poses, cheering atmosphere, ${styleModifiers}`,
          narration: `As the final note echoes, the joy and warmth of ${mainTopic} leave an unforgettable, heartwarming impression.`,
          cameraEffect: 'zoom-out',
          sfx: defaultSfx,
          transition: 'slide'
        },
        {
          prompt: `Encore moments capturing heartfelt connection during ${mainTopic}`,
          imagePrompt: `A candid cinematic perspective of the performers laughing and celebrating together in ${mainTopic}, warm twilight glow, ${styleModifiers}`,
          narration: `Laughter and shared happiness linger, proving that simple rhythm can unite hearts anywhere.`,
          cameraEffect: 'pan-right',
          sfx: 'whoosh',
          transition: 'crossfade'
        },
        {
          prompt: `Lasting parting frame honoring the spirit of ${mainTopic}`,
          imagePrompt: `An artistic iconic wide silhouette shot of ${mainTopic}, sunbeams, celebration fading into peaceful evening, ${styleModifiers}`,
          narration: `Long after the music fades, the inspiring memory of ${mainTopic} continues to shine brightly.`,
          cameraEffect: 'zoom-in',
          sfx: defaultSfx,
          transition: 'fade'
        }
      ];
    } else if (isWalkOrTalk) {
      sceneTemplates = [
        {
          prompt: `Medium shot of a person walking and beginning an engaging conversation (${mainTopic})`,
          imagePrompt: `A captivating medium shot of a person walking and speaking naturally, thoughtful gestures, authentic expression, daytime atmosphere, ${styleModifiers}`,
          narration: `Stepping forward along the path, an engaging dialogue begins, turning a simple walk into a meaningful exchange.`,
          cameraEffect: 'pan-right',
          sfx: 'footsteps',
          transition: 'fade'
        },
        {
          prompt: `Smooth tracking profile shot following their stride and conversation in ${mainTopic}`,
          imagePrompt: `A cinematic tracking profile shot following the person walking and discussing ideas, natural street environment, ${styleModifiers}`,
          narration: `With each stride, thoughts unfold with honesty and clarity, weaving ideas into the flow of the journey.`,
          cameraEffect: 'zoom-in',
          sfx: 'footsteps',
          transition: 'crossfade'
        },
        {
          prompt: `Over-the-shoulder perspective capturing the ambiance and conversational energy in ${mainTopic}`,
          imagePrompt: `An expressive over-the-shoulder shot capturing the surrounding atmosphere as the conversation deepens, golden natural daylight, ${styleModifiers}`,
          narration: `Surrounded by the open atmosphere, the dialogue finds its rhythm, blending genuine insight with the beauty of movement.`,
          cameraEffect: 'pan-left',
          sfx: 'footsteps',
          transition: 'dissolve'
        },
        {
          prompt: `Thoughtful concluding pause delivering a final reflection on ${mainTopic}`,
          imagePrompt: `A poignant shot of the person pausing at an open scenic vantage point, smiling and speaking with confidence, horizon glow, ${styleModifiers}`,
          narration: `Reaching their destination, a final reflective thought lingers, leaving a lasting and resonant impression.`,
          cameraEffect: 'zoom-out',
          sfx: 'wind',
          transition: 'slide'
        },
        {
          prompt: `Reflective vista looking out over the surroundings (${mainTopic})`,
          imagePrompt: `A wide scenic perspective overlooking the pathway, gentle breeze, thoughtful atmosphere, ${styleModifiers}`,
          narration: `Every conversation leaves its mark, opening new paths of understanding and curiosity.`,
          cameraEffect: 'pan-right',
          sfx: 'wind',
          transition: 'crossfade'
        },
        {
          prompt: `Closing profile continuing the peaceful stride (${mainTopic})`,
          imagePrompt: `A peaceful closing shot continuing the gentle walk toward the sunset horizon, soft backlight, ${styleModifiers}`,
          narration: `And as the walk continues, the story moves ever forward toward new horizons.`,
          cameraEffect: 'zoom-in',
          sfx: 'footsteps',
          transition: 'fade'
        }
      ];
    } else if (isCulinary) {
      sceneTemplates = [
        {
          prompt: `Opening presentation of fresh culinary ingredients for ${mainTopic}`,
          imagePrompt: `Artisanal wide shot showcasing fresh ingredients, rustic kitchen counter, natural morning daylight, ${styleModifiers}`,
          narration: `Every extraordinary culinary creation begins with fresh ingredients and a passion for flavor in ${mainTopic}.`,
          cameraEffect: 'pan-right',
          sfx: defaultSfx,
          transition: 'fade'
        },
        {
          prompt: `Skillful culinary preparation and close-up craftsmanship in ${mainTopic}`,
          imagePrompt: `Close-up shot of skilled chef hands slicing, seasoning, and preparing with precision, shallow depth of field, ${styleModifiers}`,
          narration: `Care and precision guide every touch, blending textures and aromas into a symphony of taste.`,
          cameraEffect: 'zoom-in',
          sfx: 'whoosh',
          transition: 'crossfade'
        },
        {
          prompt: `Dynamic cooking action with steam and sizzling heat in ${mainTopic}`,
          imagePrompt: `Dynamic cooking shot with rising steam, sizzling heat, vibrant colors in the pan, glowing kitchen lighting, ${styleModifiers}`,
          narration: `Heat and timing come together in perfect harmony, transforming raw ingredients into culinary art.`,
          cameraEffect: 'pan-left',
          sfx: 'whoosh',
          transition: 'dissolve'
        },
        {
          prompt: `Magnificent plated dish presentation of ${mainTopic}`,
          imagePrompt: `Masterpiece plate presentation of ${mainTopic}, mouthwatering garnishes, restaurant elegance, immaculate lighting, ${styleModifiers}`,
          narration: `Plated to perfection, the finished creation stands ready—a delightful feast for the senses.`,
          cameraEffect: 'zoom-out',
          sfx: defaultSfx,
          transition: 'slide'
        }
      ];
    } else {
      // General dynamic action/subject breakdown
      sceneTemplates = [
        {
          prompt: `Grand opening establishing ${mainTopic}`,
          imagePrompt: `A breathtaking wide establishing shot of ${mainTopic}, majestic atmospheric lighting, vivid detail, authentic scene elements, ${styleModifiers}`,
          narration: `Our story opens with ${mainTopic}, capturing immediate attention and setting the stage for what is to unfold.`,
          cameraEffect: 'pan-right',
          sfx: defaultSfx,
          transition: 'fade'
        },
        {
          prompt: `Intimate focus exploring the defining action and elements of ${mainTopic}`,
          imagePrompt: `An intricate and detailed shot capturing the core action and defining details of ${mainTopic}, volumetric lighting, tactile textures, ${styleModifiers}`,
          narration: `Looking closer into ${mainTopic}, each unique detail reveals character and purpose, deepening the narrative.`,
          cameraEffect: 'zoom-in',
          sfx: 'whoosh',
          transition: 'crossfade'
        },
        {
          prompt: `Dynamic perspective capturing the movement and atmosphere of ${mainTopic}`,
          imagePrompt: `A dynamic dramatic perspective showcasing the scale, energy, and atmosphere of ${mainTopic}, striking composition, ${styleModifiers}`,
          narration: `With compelling energy, the heart of ${mainTopic} commands the screen, creating an unforgettable presence.`,
          cameraEffect: 'pan-left',
          sfx: isHistory ? 'footsteps' : defaultSfx,
          transition: 'dissolve'
        },
        {
          prompt: `Climactic panoramic conclusion celebrating ${mainTopic}`,
          imagePrompt: `An awe-inspiring climactic perspective celebrating ${mainTopic}, golden illumination, emotional resonance, ${styleModifiers}`,
          narration: `The vision of ${mainTopic} concludes on an inspiring note—leaving a lasting impression that lingers long after.`,
          cameraEffect: 'zoom-out',
          sfx: defaultSfx,
          transition: 'slide'
        },
        {
          prompt: `Expansive viewpoint surveying the environment of ${mainTopic}`,
          imagePrompt: `A wide atmospheric shot capturing the broader context and setting of ${mainTopic}, volumetric depth, ${styleModifiers}`,
          narration: `Seen from an expansive vantage point, the full horizon of ${mainTopic} unfolds in all its glory.`,
          cameraEffect: 'pan-right',
          sfx: defaultSfx,
          transition: 'crossfade'
        },
        {
          prompt: `Final iconic reflection of ${mainTopic}`,
          imagePrompt: `An iconic parting silhouette or sunset view of ${mainTopic}, twilight skies, ethereal glow, masterclass ${styleModifiers}`,
          narration: `As the final scene draws to a close, ${mainTopic} remains etched in memory as an inspiring visual story.`,
          cameraEffect: 'zoom-in',
          sfx: 'whoosh',
          transition: 'fade'
        }
      ];
    }

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
