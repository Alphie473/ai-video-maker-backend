import { Request, Response } from 'express';

export interface VideoTemplate {
  id: string;
  title: string;
  description: string;
  category: 'Sci-Fi' | 'Fantasy' | 'History' | 'Commercial' | 'Nature' | 'Thriller';
  prompt: string;
  style: string;
  thumbnailUrl: string;
  duration: string;
  sceneCount: number;
}

const TEMPLATES: VideoTemplate[] = [
  {
    id: 'tpl-cyberpunk-city',
    title: 'The Abandoned Cyber City',
    description: 'A atmospheric 2-minute cinematic journey of a lone explorer walking through a rainy futuristic neon city at night.',
    category: 'Sci-Fi',
    prompt: 'Create a 2-minute cinematic video about a young man discovering an abandoned neon city at night in misty rain.',
    style: 'cyberpunk',
    thumbnailUrl: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=800&q=80',
    duration: '2m 15s',
    sceneCount: 4
  },
  {
    id: 'tpl-ancient-egypt',
    title: 'Mysteries of Ancient Dynasties',
    description: 'Documentary style narrative uncovering golden pharaoh tombs, sunlit obelisks, and lost desert monuments.',
    category: 'History',
    prompt: 'A historical documentary video exploring the construction of ancient Egyptian pyramids and secret underground chambers.',
    style: 'documentary',
    thumbnailUrl: 'https://images.unsplash.com/photo-1503177119275-0aa32b3a9368?auto=format&fit=crop&w=800&q=80',
    duration: '1m 45s',
    sceneCount: 4
  },
  {
    id: 'tpl-deep-space',
    title: 'Interstellar Voyage to Alpha Centauri',
    description: 'High concept sci-fi trailer showcasing deep space exploration, black hole accretion disks, and alien worlds.',
    category: 'Sci-Fi',
    prompt: 'Generate an epic sci-fi space exploration trailer of a starship entering a wormhole towards an alien solar system.',
    style: 'cinematic',
    thumbnailUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=800&q=80',
    duration: '2m 00s',
    sceneCount: 4
  },
  {
    id: 'tpl-nature-relaxing',
    title: 'Sanctuary of the Ancient Forest',
    description: 'Calming nature story with soft female narration, sunbeams filtering through ancient redwoods, and tranquil streams.',
    category: 'Nature',
    prompt: 'A peaceful, meditative nature video showing morning fog in an ancient redwood forest with serene wildlife.',
    style: 'photorealistic',
    thumbnailUrl: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=800&q=80',
    duration: '1m 30s',
    sceneCount: 4
  },
  {
    id: 'tpl-future-product',
    title: 'Quantum Drone X - Product Reveal',
    description: 'Sleek, high-impact commercial reveal for next-generation AI aerospace technology with bold music and energetic shots.',
    category: 'Commercial',
    prompt: 'A high energy 3D commercial reveal video showcasing a futuristic stealth flying drone hovering over futuristic skyline.',
    style: '3d',
    thumbnailUrl: 'https://images.unsplash.com/photo-1527977966376-1c8408f9f108?auto=format&fit=crop&w=800&q=80',
    duration: '1m 15s',
    sceneCount: 4
  }
];

export class TemplateController {
  static async getTemplates(req: Request, res: Response) {
    res.json(TEMPLATES);
  }
}
