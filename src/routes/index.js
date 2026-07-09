'use strict';
const router = require('express').Router();

router.use('/auth',       require('./auth'));
router.use('/admin',      require('./admin'));
router.use('/seller',     require('./seller'));
router.use('/buyer',      require('./buyer'));
router.use('/categories', require('./categories'));

module.exports = router;
