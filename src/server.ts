import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import apiRoutes from './routes/api';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
const allowedOrigins = [
  process.env.FRONTEND_URL?.replace(/\/$/, ''),
  'https://ai-video-maker-frontend.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(null, true); // Allow cross-origin requests for public video generation API
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure public static media folders exist
const publicDir = path.join(__dirname, '../public');
const mediaDirs = [
  'media/visuals',
  'media/narration',
  'media/audio/music',
  'media/audio/sfx',
  'media/videos',
  'media/uploads'
];

mediaDirs.forEach(sub => {
  const fullPath = path.join(publicDir, sub);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Set CORS, CORP and Range headers on all static media assets
app.use('/media', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Dedicated video streaming route supporting HTTP Range requests (206 Partial Content)
app.get('/media/videos/:filename', async (req, res, next) => {
  const filename = req.params.filename;
  const filePath = path.join(publicDir, 'media/videos', filename);

  // If file exists on disk, stream with byte-range support
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const chunksize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      });
      fileStream.pipe(res);
      return;
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // If file is missing on disk (e.g. Render container restart), check if project exists in database
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const project = await prisma.project.findFirst({
      where: {
        OR: [
          { videoUrl: { contains: filename } },
          { id: filename.replace(/^project_/, '').split('_')[0].replace(/\.mp4$/, '') }
        ]
      },
      include: { scenes: { orderBy: { sceneNumber: 'asc' } } }
    });

    if (project && project.scenes.length > 0) {
      console.log(`Video file ${filename} missing from ephemeral disk, auto-reconstructing for project ${project.id}...`);
      const { FFmpegComposerService } = require('./services/video/ffmpegComposer');
      const { MusicSfxService } = require('./services/ai/musicSfxService');

      const composeScenes = project.scenes.map((s: any) => ({
        sceneNumber: s.sceneNumber,
        visualPath: s.visualUrl || '',
        narrationPath: s.narrationUrl || undefined,
        duration: s.duration,
        narrationText: s.narrationText,
        transition: s.transition,
        cameraEffect: s.cameraEffect
      }));

      const totalDuration = project.scenes.reduce((acc: number, s: any) => acc + s.duration, 0);
      const musicUrl = await MusicSfxService.getMusicTrackUrl(project.musicTrack, totalDuration);

      const renderResult = await FFmpegComposerService.renderFullVideo({
        projectId: project.id,
        title: project.title,
        scenes: composeScenes,
        musicPath: musicUrl,
        musicVolume: project.musicVolume,
        captionStyle: project.captionStyle,
        aspectRatio: project.aspectRatio
      });

      const newFilePath = path.join(publicDir, 'media/videos', path.basename(renderResult.videoUrl));
      if (fs.existsSync(newFilePath)) {
        // Update DB with current video URL
        await prisma.project.update({
          where: { id: project.id },
          data: { videoUrl: renderResult.videoUrl, duration: renderResult.totalDuration }
        });
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        fs.createReadStream(newFilePath).pipe(res);
        return;
      }
    }
  } catch (reErr) {
    console.warn('Auto-reconstruction error:', reErr);
  }

  // Fallback to static handler or 404
  res.status(404).json({ error: 'Video file not found or still generating.' });
});

// Serve static media files (images, audio, uploads)
app.use('/media', express.static(path.join(publicDir, 'media')));

// API Routes
app.use('/api', apiRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    system: 'AI Video Generator API Service',
    ffmpegReady: true,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🎬 AI Video Generator Backend running on http://localhost:${PORT}`);
  console.log(`📁 Static Media Directory: ${path.join(publicDir, 'media')}`);
  console.log(`=======================================================`);
});
