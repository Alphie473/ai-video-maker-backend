import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class SettingsController {
  static async getSettings(req: Request, res: Response) {
    try {
      let settings = await prisma.settings.findUnique({ where: { id: 'default' } });
      if (!settings) {
        settings = await prisma.settings.create({
          data: {
            id: 'default',
            defaultResolution: '1080p',
            defaultFps: 30,
            enableAiMockFallback: true
          }
        });
      }

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
        enableAiMockFallback
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
