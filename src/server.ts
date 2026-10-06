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
app.use(cors());
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

// Serve static media files
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
