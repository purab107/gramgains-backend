const { Router } = require('express');
const ProfileController = require('./profile.controller');
const { requireAuth } = require('../../middlewares/auth');

const router = Router();

router.post('/check-email', ProfileController.checkEmail);
router.get('/', requireAuth, ProfileController.getProfile);
router.put('/', requireAuth, ProfileController.updateProfile);

module.exports = router;
