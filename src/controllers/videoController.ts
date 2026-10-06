import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ScriptAnalyzerService } from '../services/ai/scriptAnalyzer';
import { VisualGeneratorService } from '../services/ai/visualGenerator';
import { NarrationService } from '../services/ai/narrationService';
import { MusicSfxService } from '../services/ai/musicSfxService';
import { FFmpegComposerService, ComposeSceneInput } from '../services/video/ffmpegComposer';

const prisma = new PrismaClient();

// In-memory store for real-time progress polling per project
export const activeGenerationProgress: Record<string, { percent: number; step: string }> = {};

export class VideoController {
  /**
   * Main AI Video Generation Workflow (Triggers the 12-step pipeline)
   */
  static async createVideoFromPrompt(req: Request, res: Response) {
    try {
      const { prompt, scriptText, style = 'cinematic', aspectRatio = '16:9', voiceId = 'adam-deep', musicTrack = 'ambient-epic' } = req.body;

      if (!prompt || prompt.trim() === '') {
        return res.status(400).json({ error: 'Prompt or video description is required.' });
      }

      // Step 1: Create Initial Draft Project in DB
      const project = await prisma.project.create({
        data: {
          title: 'Generating Video...',
          originalPrompt: prompt,
          scriptText: scriptText || null,
          style,
          aspectRatio,
          voiceId,
          musicTrack,
          renderStatus: 'analyzing',
          renderProgress: 5
        }
      });

      activeGenerationProgress[project.id] = { percent: 10, step: 'Analyzing your idea & breaking into scenes...' };

      // Return project ID immediately so client can poll or show progress screen
      res.status(201).json({ projectId: project.id, status: 'started' });

      // Run generation pipeline asynchronously
      VideoController.executeGenerationPipeline(project.id, prompt, style, aspectRatio, voiceId, musicTrack).catch((err: any) => {
        console.error(`Pipeline error for project ${project.id}:`, err);
        activeGenerationProgress[project.id] = { percent: 0, step: `Failed: ${err.message || 'Pipeline execution error'}` };
        prisma.project.update({
          where: { id: project.id },
          data: { renderStatus: 'failed' }
        }).catch(console.error);
      });
    } catch (err: any) {
      console.error('Create video error:', err);
      res.status(500).json({ error: err.message || 'Failed to start video generation' });
    }
  }

  /**
   * Asynchronous Video Generation Pipeline execution
   */
  private static async executeGenerationPipeline(
    projectId: string,
    prompt: string,
    style: string,
    aspectRatio: string,
    voiceId: string,
    musicTrack: string
  ) {
    // 1. Script Analysis
    activeGenerationProgress[projectId] = { percent: 15, step: 'Analyzing script & creating story breakdown...' };
    const scriptResult = await ScriptAnalyzerService.analyzeScript(prompt, style);

    await prisma.project.update({
      where: { id: projectId },
      data: {
        title: scriptResult.title,
        voiceId: scriptResult.suggestedVoiceId || voiceId,
        musicTrack: scriptResult.suggestedMusicTrack || musicTrack
      }
    });

    // 2. Scene Creation & Media Generation
    activeGenerationProgress[projectId] = { percent: 30, step: 'Generating scene storyboards & AI visuals...' };
    const scenesToCreate = scriptResult.scenes;
    const sceneRecords = [];

    const musicUrl = await MusicSfxService.getMusicTrackUrl(musicTrack, 30);

    for (let i = 0; i < scenesToCreate.length; i++) {
      const rawScene = scenesToCreate[i];
      const progressPercent = Math.floor(35 + (i / scenesToCreate.length) * 35);
      activeGenerationProgress[projectId] = {
        percent: progressPercent,
        step: `Generating Scene ${rawScene.sceneNumber} visual artwork & TTS narration...`
      };

      // Visual artwork
      const visualUrl = await VisualGeneratorService.generateVisual({
        prompt: rawScene.prompt,
        imagePrompt: rawScene.imagePrompt,
        style,
        aspectRatio,
        sceneNumber: rawScene.sceneNumber,
        projectId
      });

      // Narration audio
      const narrationResult = await NarrationService.generateNarration({
        narrationText: rawScene.narrationText,
        voiceId,
        sceneNumber: rawScene.sceneNumber,
        projectId,
        desiredDuration: rawScene.duration
      });

      // SFX track
      let sfxUrl = null;
      if (rawScene.sfxTrack && rawScene.sfxTrack !== 'none') {
        sfxUrl = await MusicSfxService.getSfxUrl(rawScene.sfxTrack, rawScene.duration);
      }

      // Save Scene to DB
      const sceneRecord = await prisma.scene.create({
        data: {
          projectId,
          sceneNumber: rawScene.sceneNumber,
          prompt: rawScene.prompt,
          imagePrompt: rawScene.imagePrompt,
          visualUrl,
          visualType: 'image',
          narrationText: rawScene.narrationText,
          narrationUrl: narrationResult.audioUrl,
          duration: narrationResult.duration,
          transition: rawScene.transition,
          sfxTrack: rawScene.sfxTrack || 'none',
          cameraEffect: rawScene.cameraEffect
        }
      });

      sceneRecords.push(sceneRecord);
    }

    // 3. FFmpeg Composition & Final Rendering
    activeGenerationProgress[projectId] = { percent: 75, step: 'Stitching video scenes, transitions & mixing music track...' };

    const composeScenes: ComposeSceneInput[] = sceneRecords.map(s => ({
      sceneNumber: s.sceneNumber,
      visualPath: s.visualUrl!,
      narrationPath: s.narrationUrl || undefined,
      duration: s.duration,
      narrationText: s.narrationText,
      transition: s.transition,
      cameraEffect: s.cameraEffect
    }));

    const renderResult = await FFmpegComposerService.renderFullVideo({
      projectId,
      title: scriptResult.title,
      scenes: composeScenes,
      musicPath: musicUrl,
      captionStyle: 'modern-yellow',
      aspectRatio
    }, (percent, stepName) => {
      activeGenerationProgress[projectId] = { percent, step: stepName };
    });

    // 4. Update Project Complete Status
    await prisma.project.update({
      where: { id: projectId },
      data: {
        renderStatus: 'completed',
        renderProgress: 100,
        videoUrl: renderResult.videoUrl,
        thumbnailUrl: sceneRecords[0]?.visualUrl,
        duration: renderResult.totalDuration
      }
    });

    activeGenerationProgress[projectId] = { percent: 100, step: 'Finalizing your video render...' };
  }

  /**
   * Poll generation progress for active project
   */
  static async getGenerationProgress(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const progress = activeGenerationProgress[projectId] || { percent: 0, step: 'Initializing...' };

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true, renderStatus: true, videoUrl: true }
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      res.json({
        projectId,
        renderStatus: project.renderStatus,
        videoUrl: project.videoUrl,
        ...progress
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to check progress' });
    }
  }

  /**
   * Regenerates a single scene prompt & visual artwork without regenerating full video
   */
  static async regenerateSingleScene(req: Request, res: Response) {
    try {
      const { sceneId } = req.params;
      const { prompt, imagePrompt, cameraEffect } = req.body;

      const scene = await prisma.scene.findUnique({
        where: { id: sceneId },
        include: { project: true }
      });

      if (!scene) {
        return res.status(404).json({ error: 'Scene not found' });
      }

      const updatedPrompt = prompt || scene.prompt;
      const updatedImagePrompt = imagePrompt || scene.imagePrompt || updatedPrompt;

      // Re-generate visual
      const visualUrl = await VisualGeneratorService.generateVisual({
        prompt: updatedPrompt,
        imagePrompt: updatedImagePrompt,
        style: scene.project.style,
        aspectRatio: scene.project.aspectRatio,
        sceneNumber: scene.sceneNumber,
        projectId: scene.projectId
      });

      const updatedScene = await prisma.scene.update({
        where: { id: sceneId },
        data: {
          prompt: updatedPrompt,
          imagePrompt: updatedImagePrompt,
          visualUrl,
          cameraEffect: cameraEffect || scene.cameraEffect
        }
      });

      res.json(updatedScene);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to regenerate scene' });
    }
  }

  /**
   * Replace scene visual with custom upload or generated URL
   */
  static async replaceSceneVisual(req: Request, res: Response) {
    try {
      const { sceneId } = req.params;
      const { visualUrl } = req.body;

      const scene = await prisma.scene.update({
        where: { id: sceneId },
        data: { visualUrl }
      });

      res.json(scene);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Re-render complete video after project changes in editor
   */
  static async reRenderFullVideo(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } }
      });

      if (!project) return res.status(404).json({ error: 'Project not found' });

      await prisma.project.update({
        where: { id: projectId },
        data: { renderStatus: 'rendering', renderProgress: 10 }
      });

      activeGenerationProgress[projectId] = { percent: 10, step: 'Re-rendering updated video composition...' };

      res.json({ message: 'Re-render started', projectId });

      // Run async render
      const composeScenes: ComposeSceneInput[] = project.scenes.map(s => ({
        sceneNumber: s.sceneNumber,
        visualPath: s.visualUrl!,
        narrationPath: s.narrationUrl || undefined,
        duration: s.duration,
        narrationText: s.narrationText,
        transition: s.transition,
        cameraEffect: s.cameraEffect
      }));

      const musicUrl = await MusicSfxService.getMusicTrackUrl(project.musicTrack, project.duration);

      FFmpegComposerService.renderFullVideo({
        projectId,
        title: project.title,
        scenes: composeScenes,
        musicPath: musicUrl,
        musicVolume: project.musicVolume,
        captionStyle: project.captionStyle,
        aspectRatio: project.aspectRatio
      }, (percent, stepName) => {
        activeGenerationProgress[projectId] = { percent, step: stepName };
      }).then(async (result) => {
        await prisma.project.update({
          where: { id: projectId },
          data: {
            renderStatus: 'completed',
            renderProgress: 100,
            videoUrl: result.videoUrl,
            duration: result.totalDuration
          }
        });
      }).catch(async (err: any) => {
        console.error(`Re-render error for project ${projectId}:`, err);
        activeGenerationProgress[projectId] = { percent: 0, step: `Failed: ${err.message || 'Re-render failed'}` };
        await prisma.project.update({
          where: { id: projectId },
          data: { renderStatus: 'failed' }
        }).catch(console.error);
      });

    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to start re-render process' });
    }
  }
}
