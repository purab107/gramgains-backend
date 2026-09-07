const ProfileService = require('./profile.service');

async function getProfile(req, res) {
  try {
    const profile = await ProfileService.getProfile();
    return res.json({ success: true, data: profile });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching profile', error: error.message });
  }
}

async function updateProfile(req, res) {
  try {
    const updated = await ProfileService.updateProfile(req.body);
    return res.json({ success: true, message: 'Profile and TDEE goals updated successfully', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating profile', error: error.message });
  }
}

module.exports = { getProfile, updateProfile };
