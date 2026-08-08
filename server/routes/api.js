const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { analyzeError, getScenarioMetadata } = require('../services/ai');

// Get all scenarios metadata
router.get('/scenarios', (req, res) => {
  const scenarios = ['missing-config', 'db-schema', 'service-down'];
  const list = scenarios.map(id => getScenarioMetadata(id)).filter(Boolean);
  res.json(list);
});

// Get specific scenario metadata
router.get('/scenarios/:id', (req, res) => {
  const meta = getScenarioMetadata(req.params.id);
  if (!meta) {
    return res.status(404).json({ error: 'Scenario not found' });
  }
  res.json(meta);
});

// Analyze error evidence and generate reproduction spec
router.post('/analyze', async (req, res) => {
  const { log } = req.body;

  if (!log) {
    return res.status(400).json({ error: 'Log content is required for analysis' });
  }

  try {
    const result = await analyzeError(log);
    res.json(result);
  } catch (err) {
    console.error('Error in /analyze endpoint:', err);
    res.status(500).json({ error: 'Analysis failed', message: err.message });
  }
});

module.exports = router;
