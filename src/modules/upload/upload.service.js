const cloudinary = require('../../config/cloudinary');

/**
 * Upload an image buffer directly to Cloudinary
 * @param {Buffer} buffer - Image file buffer
 * @param {string} folder - Folder name in Cloudinary
 * @returns {Promise<{ url: string, publicId: string }>}
 */
async function uploadImageBuffer(buffer, folder = 'gramgains/meals') {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: 'image',
        transformation: [
          { width: 1200, height: 1200, crop: 'limit' },
          { quality: 'auto:good' },
          { fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

/**
 * Delete an image from Cloudinary by public ID
 * @param {string} publicId
 */
async function deleteImage(publicId) {
  if (!publicId || !process.env.CLOUDINARY_CLOUD_NAME) return;
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error(`Failed to delete Cloudinary image ${publicId}:`, err);
  }
}

module.exports = {
  uploadImageBuffer,
  deleteImage,
};
