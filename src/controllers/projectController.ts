import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class ProjectController {
  /**
   * Get all video projects
   */
  static async getAllProjects(req: Request, res: Response) {
    try {
      const projects = await prisma.project.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } }
      });
      res.json(projects);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Get project by ID with scenes
   */
  static async getProjectById(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const project = await prisma.project.findUnique({
        where: { id },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } }
      });

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      res.json(project);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Update project settings (title, voice, music, caption style, aspect ratio)
   */
  static async updateProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { title, voiceId, musicTrack, musicVolume, captionStyle, style, aspectRatio } = req.body;

      const project = await prisma.project.update({
        where: { id },
        data: {
          title,
          voiceId,
          musicTrack,
          musicVolume,
          captionStyle,
          style,
          aspectRatio
        },
        include: { scenes: { orderBy: { sceneNumber: 'asc' } } }
      });

      res.json(project);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Delete project
   */
  static async deleteProject(req: Request, res: Response) {
    try {
      const { id } = req.params;
      await prisma.project.delete({ where: { id } });
      res.json({ message: 'Project deleted successfully' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Add new scene to project
   */
  static async addSceneToProject(req: Request, res: Response) {
    try {
      const { projectId } = req.params;
      const { prompt, narrationText, transition, cameraEffect } = req.body;

      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: { scenes: true }
      });

      if (!project) return res.status(404).json({ error: 'Project not found' });

      const newSceneNumber = project.scenes.length + 1;
      const defaultPrompt = prompt || `Scene ${newSceneNumber}: Cinematic visual moment`;
      const defaultNarration = narrationText || `And so the story continues into new horizons.`;

      const scene = await prisma.scene.create({
        data: {
          projectId,
          sceneNumber: newSceneNumber,
          prompt: defaultPrompt,
          imagePrompt: `${defaultPrompt}, 8k cinematic lighting`,
          visualUrl: `/media/visuals/scene_placeholder.png`,
          narrationText: defaultNarration,
          duration: 4.5,
          transition: transition || 'fade',
          cameraEffect: cameraEffect || 'pan-right'
        }
      });

      res.status(201).json(scene);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Delete scene from project
   */
  static async deleteScene(req: Request, res: Response) {
    try {
      const { sceneId } = req.params;
      const scene = await prisma.scene.findUnique({ where: { id: sceneId } });

      if (!scene) return res.status(404).json({ error: 'Scene not found' });

      await prisma.scene.delete({ where: { id: sceneId } });

      // Re-order remaining scene numbers
      const remainingScenes = await prisma.scene.findMany({
        where: { projectId: scene.projectId },
        orderBy: { sceneNumber: 'asc' }
      });

      for (let i = 0; i < remainingScenes.length; i++) {
        await prisma.scene.update({
          where: { id: remainingScenes[i].id },
          data: { sceneNumber: i + 1 }
        });
      }

      res.json({ message: 'Scene deleted and sequence reordered' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
