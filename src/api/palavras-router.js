/**
 * src/api/palavras-router.js
 * Rotas REST para Módulos de Pesquisa (palavras-chave).
 * CRUD completo de módulos e suas palavras.
 */

const express = require('express');
const models = require('../db/models');

function createPalavrasRouter(io) {
  const router = express.Router();

  // ── GET /api/search-modules ─────────────────────────────────────────────────
  // Lista todos os módulos com contagem de palavras
  router.get('/search-modules', (req, res) => {
    try {
      const modules = models.getAllSearchModules();
      res.json({ ok: true, modules });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/search-modules ────────────────────────────────────────────────
  // Cria um novo módulo
  router.post('/search-modules', (req, res) => {
    try {
      const { label, description } = req.body;
      if (!label || !label.trim()) {
        return res.status(400).json({ ok: false, error: 'O campo "label" é obrigatório.' });
      }
      const mod = models.createSearchModule(label.trim(), description?.trim() || null);
      io.emit('search_modules:updated');
      res.json({ ok: true, module: mod });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── GET /api/search-modules/:id ─────────────────────────────────────────────
  // Retorna módulo + palavras
  router.get('/search-modules/:id', (req, res) => {
    try {
      const mod = models.getSearchModuleById(Number(req.params.id));
      if (!mod) {
        return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
      }
      res.json({ ok: true, module: mod });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── PUT /api/search-modules/:id ─────────────────────────────────────────────
  // Atualiza label, description e/ou is_active
  router.put('/search-modules/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = models.getSearchModuleById(id);
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
      }
      const label = req.body.label?.trim() || existing.label;
      const description = req.body.description !== undefined ? req.body.description : existing.description;
      const isActive = req.body.is_active !== undefined ? req.body.is_active : existing.is_active;

      models.updateSearchModule(id, label, description, isActive);
      io.emit('search_modules:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── DELETE /api/search-modules/:id ──────────────────────────────────────────
  // Remove módulo e palavras (cascata)
  router.delete('/search-modules/:id', (req, res) => {
    try {
      models.deleteSearchModule(Number(req.params.id));
      io.emit('search_modules:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── POST /api/search-modules/:id/words ──────────────────────────────────────
  // Adiciona palavras em massa
  router.post('/search-modules/:id/words', (req, res) => {
    try {
      const moduleId = Number(req.params.id);
      const existing = models.getSearchModuleById(moduleId);
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
      }

      const { words } = req.body; // Array de strings ou string separada por linhas
      if (!words) {
        return res.status(400).json({ ok: false, error: 'O campo "words" é obrigatório.' });
      }

      // Aceita array ou string (separada por quebra de linha ou vírgula)
      let wordList;
      if (Array.isArray(words)) {
        wordList = words;
      } else if (typeof words === 'string') {
        wordList = words.split(/[\n,]+/);
      } else {
        return res.status(400).json({ ok: false, error: 'Formato de "words" inválido.' });
      }

      const count = models.addWordsToModule(moduleId, wordList);
      io.emit('search_modules:updated');
      res.json({ ok: true, added: count });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── PUT /api/search-modules/:id/words/:wordId ───────────────────────────────
  // Edita uma palavra
  router.put('/search-modules/:id/words/:wordId', (req, res) => {
    try {
      const { word } = req.body;
      if (!word || !word.trim()) {
        return res.status(400).json({ ok: false, error: 'O campo "word" é obrigatório.' });
      }
      models.updateWord(Number(req.params.wordId), word);
      io.emit('search_modules:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── DELETE /api/search-modules/:id/words/:wordId ────────────────────────────
  // Remove uma palavra
  router.delete('/search-modules/:id/words/:wordId', (req, res) => {
    try {
      models.deleteWord(Number(req.params.wordId));
      io.emit('search_modules:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── DELETE /api/search-modules/:id/words ─────────────────────────────────────
  // Limpa todas as palavras de um módulo
  router.delete('/search-modules/:id/words', (req, res) => {
    try {
      models.deleteAllWordsFromModule(Number(req.params.id));
      io.emit('search_modules:updated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createPalavrasRouter };
