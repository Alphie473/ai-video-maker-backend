import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class SettingsController {
  /**
   * Fetches settings with safe fallbacks and environment variable overrides.
   */
  static async getResolvedSettings() {
    let settings = await prisma.settings.findUnique({ where: { id: 'default' } });
    if (!settings) {
      settings = await prisma.settings.create({
        data: {
          id: 'default',
          defaultResolution: '1080p',
          defaultFps: 30,
          enableAiMockFallback: true,
          maxScenesPerRequest: 3,
          maxDurationPerScene: 5,
          maxCostPerRequest: 1.50,
          veoPricePerSecond: 0.15,
          strictVideoMode: true
        }
      });
    }

    return {
      ...settings,
      maxScenesPerRequest: settings.maxScenesPerRequest ?? 3,
      maxDurationPerScene: settings.maxDurationPerScene ?? 5,
      maxCostPerRequest: settings.maxCostPerRequest ?? 1.50,
      veoPricePerSecond: settings.veoPricePerSecond ?? 0.15,
      strictVideoMode: settings.strictVideoMode ?? true
    };
  }

  static async getSettings(req: Request, res: Response) {
    try {
      const settings = await SettingsController.getResolvedSettings();

      // Hide API keys sensitive characters for security when sending to frontend
      const masked = {
        ...settings,
        openaiApiKey: settings.openaiApiKey ? '••••••••' + settings.openaiApiKey.slice(-4) : '',
        geminiApiKey: settings.geminiApiKey ? '••••••••' + settings.geminiApiKey.slice(-4) : '',
        elevenlabsApiKey: settings.elevenlabsApiKey ? '••••••••' + settings.elevenlabsApiKey.slice(-4) : '',
        replicateApiKey: settings.replicateApiKey ? '••••••••' + settings.replicateApiKey.slice(-4) : '',
        falApiKey: settings.falApiKey ? '••••••••' + settings.falApiKey.slice(-4) : ''
      };

      res.json(masked);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateSettings(req: Request, res: Response) {
    try {
      const {
        openaiApiKey,
        geminiApiKey,
        elevenlabsApiKey,
        replicateApiKey,
        falApiKey,
        defaultResolution,
        defaultFps,
        enableAiMockFallback,
        maxScenesPerRequest,
        maxDurationPerScene,
        maxCostPerRequest,
        veoPricePerSecond,
        strictVideoMode
      } = req.body;

      // Update process.env runtime variables as well
      if (openaiApiKey && !openaiApiKey.startsWith('••••')) process.env.OPENAI_API_KEY = openaiApiKey;
      if (geminiApiKey && !geminiApiKey.startsWith('••••')) process.env.GEMINI_API_KEY = geminiApiKey;
      if (elevenlabsApiKey && !elevenlabsApiKey.startsWith('••••')) process.env.ELEVENLABS_API_KEY = elevenlabsApiKey;
      if (replicateApiKey && !replicateApiKey.startsWith('••••')) process.env.REPLICATE_API_KEY = replicateApiKey;
      if (falApiKey && !falApiKey.startsWith('••••')) process.env.FAL_API_KEY = falApiKey;

      const dataToUpdate: any = {
        defaultResolution: defaultResolution || '1080p',
        defaultFps: defaultFps || 30,
        enableAiMockFallback: enableAiMockFallback ?? true
      };

      if (maxScenesPerRequest !== undefined) {
        dataToUpdate.maxScenesPerRequest = Math.max(1, Math.min(10, Math.floor(Number(maxScenesPerRequest) || 3)));
      }
      if (maxDurationPerScene !== undefined) {
        // Veo 3.1 supported duration range is between 4 and 8 seconds
        dataToUpdate.maxDurationPerScene = Math.max(4, Math.min(8, Math.floor(Number(maxDurationPerScene) || 5)));
      }
      if (maxCostPerRequest !== undefined) {
        dataToUpdate.maxCostPerRequest = Math.max(0.10, Number(maxCostPerRequest) || 1.50);
      }
      if (veoPricePerSecond !== undefined) {
        dataToUpdate.veoPricePerSecond = Math.max(0.01, Number(veoPricePerSecond) || 0.15);
      }
      if (strictVideoMode !== undefined) {
        dataToUpdate.strictVideoMode = Boolean(strictVideoMode);
      }

      if (openaiApiKey && !openaiApiKey.startsWith('••••')) dataToUpdate.openaiApiKey = openaiApiKey;
      if (geminiApiKey && !geminiApiKey.startsWith('••••')) dataToUpdate.geminiApiKey = geminiApiKey;
      if (elevenlabsApiKey && !elevenlabsApiKey.startsWith('••••')) dataToUpdate.elevenlabsApiKey = elevenlabsApiKey;
      if (replicateApiKey && !replicateApiKey.startsWith('••••')) dataToUpdate.replicateApiKey = replicateApiKey;
      if (falApiKey && !falApiKey.startsWith('••••')) dataToUpdate.falApiKey = falApiKey;

      const settings = await prisma.settings.upsert({
        where: { id: 'default' },
        update: dataToUpdate,
        create: { id: 'default', ...dataToUpdate }
      });

      res.json({ message: 'Settings saved securely', settings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
