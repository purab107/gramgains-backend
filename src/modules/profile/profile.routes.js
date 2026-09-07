const { Router } = require('express');
const ProfileController = require('./profile.controller');

const router = Router();

router.get('/', ProfileController.getProfile);
router.put('/', ProfileController.updateProfile);

module.exports = router;
