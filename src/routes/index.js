'use strict';
const router = require('express').Router();

router.use('/auth',       require('./auth'));
router.use('/admin',      require('./admin'));
router.use('/seller',     require('./seller'));
router.use('/buyer',      require('./buyer'));
router.use('/chat',       require('./chat'));
router.use('/support',    require('./support'));
router.use('/wallet',     require('./wallet'));
router.use('/categories', require('./categories'));
router.use('/public',     require('./publicStats'));
router.use('/pages',      require('./pages'));

module.exports = router;
