'use strict';
const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../../middlewares/auth.middleware');
const c = require('../../controllers/chat/chat.controller');

// Chat is cross-role (buyer / seller / admin) — any authenticated user.
router.use(authenticate);

// Attachment upload (image / pdf / doc / etc., max 10 MB)
const chatUpload = multer({
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
router.post('/upload', chatUpload.single('file'), c.uploadAttachment);

router.get   ('/unread-count',                 c.getUnreadCount);
router.get   ('/conversations',                c.listConversations);
router.post  ('/conversations',                c.openConversation);
router.get   ('/conversations/:id',            c.getConversation);
router.delete('/conversations/:id',            c.archiveConversation);
router.get   ('/conversations/:id/messages',   c.getMessages);
router.post  ('/conversations/:id/messages',   c.sendMessage);
router.patch ('/conversations/:id/read',       c.markRead);

module.exports = router;
