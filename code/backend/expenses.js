const express = require('express');
const auth = require('./auth');
const gemini = require('./gemini');
const router = express.Router();

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

// Photo -> draft expense. Saves nothing: the user confirms the draft first.
router.post('/parse-receipt', auth, async (req, res) => {
  const { image_base64, mime_type } = req.body || {};
  if (!image_base64 || !IMAGE_TYPES.includes(mime_type)) {
    return res.status(400).json({
      error: { code: 'bad_image', message: 'Send image_base64 and a mime_type of jpeg, png, webp or heic.' },
    });
  }
  const draft = await gemini.parseReceipt(image_base64, mime_type);
  res.json(draft ? { draft, source: 'gemini' } : { draft: null, source: 'manual' });
});

module.exports = router;
