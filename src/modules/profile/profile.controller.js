const ProfileService = require('./profile.service');

async function getProfile(req, res) {
  try {
    const profile = await ProfileService.getProfile(req.userId);
    return res.json({ success: true, data: profile });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error fetching profile', error: error.message });
  }
}

async function updateProfile(req, res) {
  try {
    const updated = await ProfileService.updateProfile(req.body, req.userId);
    return res.json({ success: true, message: 'Profile and TDEE goals updated successfully', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating profile', error: error.message });
  }
}

async function checkEmail(req, res) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    const exists = await ProfileService.checkEmailExists(email);
    return res.json({ success: true, exists });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error checking email', error: error.message });
  }
}

module.exports = { checkEmail, getProfile, updateProfile };
