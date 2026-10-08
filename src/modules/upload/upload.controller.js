const uploadService = require('./upload.service');

async function uploadImage(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const result = await uploadService.uploadImageBuffer(req.file.buffer, 'gramgains/meals');
    return res.status(200).json({
      success: true,
      url: result.url,
      publicId: result.publicId,
    });
  } catch (error) {
    console.error('Image upload failed:', error);
    return res.status(500).json({
      error: error.message || 'Failed to upload image to Cloudinary',
    });
  }
}

module.exports = {
  uploadImage,
};
