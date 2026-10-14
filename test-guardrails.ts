import { SettingsController } from './src/controllers/settingsController';
import { ScriptAnalyzerService, RawSceneData, ScriptAnalysisResult } from './src/services/ai/scriptAnalyzer';
import { VisualGeneratorService } from './src/services/ai/visualGenerator';
import { VideoController } from './src/controllers/videoController';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runTests() {
  console.log('=== Starting Google Veo 3.1 Cost Protection & Safeguard Verification Tests ===\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - Detail: ${detail || 'Assertion failed'}`);
    }
  }

  // TEST 1: Default Settings & Guardrail Limits
  console.log('--- Test Suite 1: Resolved Settings Guardrails & Defaults ---');
  const settings = await SettingsController.getResolvedSettings();
  assert(settings.maxScenesPerRequest === 3, 'Default maxScenesPerRequest is 3');
  assert(settings.maxDurationPerScene === 5, 'Default maxDurationPerScene is 5');
  assert(settings.maxCostPerRequest === 1.50, 'Default maxCostPerRequest ceiling is $1.50');
  assert(settings.veoPricePerSecond === 0.15, 'Configured Veo model price rate is $0.15/sec');
  assert(settings.strictVideoMode === true, 'Strict Video Mode is enabled by default');

  // TEST 2: API Key Security Masking
  console.log('\n--- Test Suite 2: API Key Masking Security ---');
  let capturedResponse: any = null;
  const mockRes: any = {
    json: (data: any) => { capturedResponse = data; },
    status: (code: number) => mockRes
  };
  await SettingsController.getSettings({} as any, mockRes);
  assert(capturedResponse !== null, 'SettingsController.getSettings returns response payload');
  if (capturedResponse.geminiApiKey) {
    assert(capturedResponse.geminiApiKey.startsWith('••••••••'), 'Gemini/Veo API key is masked with bullet prefix');
      const testApiKey = process.env.GEMINI_API_KEY;
      assert(
        !testApiKey || !capturedResponse.geminiApiKey.includes(testApiKey),
        'Gemini API key is not exposed in plaintext'
      );
    }

  // TEST 3: Scene Limit Truncation & Veo Duration Clamping
  console.log('\n--- Test Suite 3: Scene Truncation & Duration Clamping ---');
  const excessiveScenes: RawSceneData[] = [
    { sceneNumber: 1, prompt: 'A', imagePrompt: 'A', narrationText: 'N1', duration: 12, cameraEffect: 'static', transition: 'fade' },
    { sceneNumber: 2, prompt: 'B', imagePrompt: 'B', narrationText: 'N2', duration: 2, cameraEffect: 'static', transition: 'fade' },
    { sceneNumber: 3, prompt: 'C', imagePrompt: 'C', narrationText: 'N3', duration: 7, cameraEffect: 'static', transition: 'fade' },
    { sceneNumber: 4, prompt: 'D', imagePrompt: 'D', narrationText: 'N4', duration: 6, cameraEffect: 'static', transition: 'fade' },
    { sceneNumber: 5, prompt: 'E', imagePrompt: 'E', narrationText: 'N5', duration: 9, cameraEffect: 'static', transition: 'fade' }
  ];

  const mockScriptResult: ScriptAnalysisResult = {
    title: 'Egyptian Pyramids',
    summary: 'A documentary on pyramids',
    suggestedStyle: 'cinematic',
    suggestedMusicTrack: 'ambient-epic',
    suggestedVoiceId: 'adam-deep',
    scenes: excessiveScenes
  };

  const aligned = ScriptAnalyzerService.enforceTopicAndDurationAlignment(
    mockScriptResult,
    'Egyptian Pyramids',
    24,
    'cinematic',
    3, // maxScenes
    5  // maxSceneDuration
  );

  assert(aligned.scenes.length === 3, 'Excessive scenes truncated strictly to maxScenes (3 scenes)', `Got ${aligned.scenes.length}`);
  assert(aligned.scenes[0].duration === 5, 'Scene 1 clamped down from 12s to maxSceneDuration (5s)', `Got ${aligned.scenes[0].duration}`);
  assert(aligned.scenes[1].duration === 4, 'Scene 2 clamped up from 2s to minimum supported Veo duration (4s)', `Got ${aligned.scenes[1].duration}`);
  assert(aligned.scenes[2].duration === 5, 'Scene 3 clamped down from 7s to maxSceneDuration (5s)', `Got ${aligned.scenes[2].duration}`);
  assert(aligned.scenes.every(s => s.duration >= 4 && s.duration <= 8), 'All scenes strictly obey Veo 4-8s API requirement');

  // TEST 4: Pre-Flight Budget Limit Rejection (No paid API calls made)
  console.log('\n--- Test Suite 4: Pre-Flight Budget Ceiling Enforcement ---');
  // Temporarily set maxCostPerRequest to $0.10 in database to simulate low budget ceiling
  await prisma.settings.upsert({
    where: { id: 'default' },
    update: { maxCostPerRequest: 0.10 },
    create: { id: 'default', maxCostPerRequest: 0.10 }
  });

  let rejectionStatus = 0;
  let rejectionBody: any = null;
  const mockBudgetRes: any = {
    status: (code: number) => {
      rejectionStatus = code;
      return {
        json: (body: any) => { rejectionBody = body; }
      };
    }
  };

  await VideoController.createVideoFromPrompt({
    body: {
      prompt: 'A cinematic video of a futuristic neon city'
    }
  } as any, mockBudgetRes);

  assert(rejectionStatus === 400, 'Pre-flight budget check returns HTTP 400 when projected cost exceeds ceiling', `Status: ${rejectionStatus}`);
  assert(rejectionBody?.error?.includes('Budget Limit Exceeded'), 'Rejection error message clearly identifies Budget Limit Exceeded');
  assert(rejectionBody?.error?.includes('Pricing is an estimate based on'), 'Rejection message includes disclosure regarding pricing estimation limitation');

  // Restore maxCostPerRequest to $1.50
  await prisma.settings.update({
    where: { id: 'default' },
    data: { maxCostPerRequest: 1.50 }
  });

  // TEST 5: Strict Video Mode Blocks Silent Slideshow Fallback
  console.log('\n--- Test Suite 5: Strict Video Mode (No Silent Image Fallback) ---');
  let strictModeError: any = null;
  try {
    // Calling generateVisual with an empty prompt / test ID under strictVideoMode
    await VisualGeneratorService.generateVisual({
      prompt: 'Test video generation under quota exhaustion',
      imagePrompt: 'Test video generation under quota exhaustion',
      sceneNumber: 1,
      projectId: 'test-guardrail-project',
      duration: 5,
      strictVideoMode: true
    });
  } catch (err: any) {
    strictModeError = err;
  }

  assert(strictModeError !== null, 'Strict Video Mode threw an explicit error when video generation failed');
  assert(
    strictModeError?.message?.includes('Real video generation failed') &&
    strictModeError?.message?.includes('Strict Video Mode is enabled'),
    'Error message explicitly specifies real video generation failed and strict mode prevented silent fallback',
    strictModeError?.message
  );

  console.log(`\n======================================================`);
  console.log(`Test Results: ${passed} / ${total} tests passed.`);
  console.log(`======================================================\n`);

  await prisma.$disconnect();
  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(async (e) => {
  console.error('Test execution failed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
