/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * newsPublic.ts
 * Public News & Announcements endpoints and safely confined uploaded media serving.
 * Strictly returns ONLY PUBLISHED announcements; drafts, pending, scheduled,
 * and archived announcements are never exposed.
 */

import { Router } from 'express';
import fs from 'fs';
import { newsCmsService } from '../services/cms/NewsCmsService.js';
import { resolveSafeMediaPath } from '../services/cms/MediaValidationService.js';

export const newsPublicRouter = Router();

// GET /api/public/news
newsPublicRouter.get('/news', (req, res) => {
  try {
    const result = newsCmsService.listPublicAnnouncements({
      category: typeof req.query.category === 'string' ? req.query.category : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 12
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/public/news/:slug
newsPublicRouter.get('/news/:slug', (req, res) => {
  const article = newsCmsService.getPublicAnnouncementBySlug(req.params.slug);
  if (!article) {
    return res.status(404).json({ error: 'Announcement not found' });
  }
  res.json(article);
});

// GET /api/public/media/:filename
newsPublicRouter.get('/media/:filename', (req, res) => {
  const resolved = resolveSafeMediaPath(req.params.filename);
  if (!resolved || !fs.existsSync(resolved.filePath)) {
    return res.status(404).json({ error: 'Media asset not found' });
  }

  res.setHeader('Content-Type', resolved.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(resolved.filePath);
});
