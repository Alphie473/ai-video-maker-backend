import { Router } from 'express';
import { VideoController } from '../controllers/videoController';
import { ProjectController } from '../controllers/projectController';
import { SettingsController } from '../controllers/settingsController';
import { TemplateController } from '../controllers/templateController';
import multer from 'multer';
import path from 'path';

const router = Router();
const upload = multer({ dest: path.join(__dirname, '../../public/media/uploads') });

// Video Generation Pipeline Routes
router.post('/generate', VideoController.createVideoFromPrompt);
router.get('/generate/progress/:projectId', VideoController.getGenerationProgress);
router.post('/scenes/:sceneId/regenerate', VideoController.regenerateSingleScene);
router.post('/scenes/:sceneId/replace-visual', VideoController.replaceSceneVisual);
router.post('/projects/:projectId/rerender', VideoController.reRenderFullVideo);

// Project Management Routes
router.get('/projects', ProjectController.getAllProjects);
router.get('/projects/:id', ProjectController.getProjectById);
router.put('/projects/:id', ProjectController.updateProject);
router.delete('/projects/:id', ProjectController.deleteProject);
router.post('/projects/:projectId/scenes', ProjectController.addSceneToProject);
router.delete('/scenes/:sceneId', ProjectController.deleteScene);

// Templates & Settings
router.get('/templates', TemplateController.getTemplates);
router.get('/settings', SettingsController.getSettings);
router.post('/settings', SettingsController.updateSettings);

// Script File Upload route (.txt, .md script upload)
router.post('/upload-script', upload.single('scriptFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No script file uploaded' });
  const fs = require('fs');
  const textContent = fs.readFileSync(req.file.path, 'utf8');
  res.json({ scriptText: textContent, filename: req.file.originalname });
});

export default router;
