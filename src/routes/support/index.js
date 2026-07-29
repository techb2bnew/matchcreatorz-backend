'use strict';
const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../../middlewares/auth.middleware');
const c = require('../../controllers/support/support.controller');

// Support is cross-role (buyer / seller open tickets, admins handle the queue).
router.use(authenticate);

// Attachment upload (image / pdf / doc / etc., max 10 MB)
const supportUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = new Set([
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'application/zip',
    ]);
    ok.has(file.mimetype) ? cb(null, true) : cb(new Error('Unsupported file type'));
  },
});
router.post('/upload', supportUpload.single('file'), c.uploadAttachment);

router.get   ('/unread-count',            c.getUnreadCount);
router.get   ('/tickets',                 c.listTickets);
router.post  ('/tickets',                 c.openTicket);
router.get   ('/tickets/:id',             c.getTicket);
router.get   ('/tickets/:id/messages',    c.getMessages);
router.post  ('/tickets/:id/messages',    c.sendMessage);
router.patch ('/tickets/:id/assign',      c.assignTicket);
router.patch ('/tickets/:id/status',      c.updateStatus);
router.patch ('/tickets/:id/read',        c.markRead);

module.exports = router;
