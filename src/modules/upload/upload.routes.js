const express = require('express');
const multer = require('multer');
const router = express.Router();
const uploadController = require('./upload.controller');
const { requireAuth } = require('../../middlewares/auth');

// Multer memory storage configuration (Max 5MB, Images only)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|jpg|png|webp|gif)/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, WEBP, and GIF images are allowed.'));
    }
  },
});

// POST /api/upload/image
router.post('/image', requireAuth, upload.single('image'), uploadController.uploadImage);

module.exports = router;
