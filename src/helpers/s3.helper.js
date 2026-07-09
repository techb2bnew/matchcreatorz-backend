'use strict';
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path           = require('path');
const env            = require('../config/env');

const s3 = new S3Client({
  region: env.AWS_S3_REGION,
  credentials: {
    accessKeyId:     env.AWS_S3_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_S3_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload a file buffer to S3 and return the public URL.
 * @param {Express.Multer.File} file  - multer file object (has .buffer, .mimetype, .originalname)
 * @param {string} folder             - S3 sub-folder e.g. 'resumes', 'profiles'
 * @returns {Promise<string>}         - public URL
 */
const uploadToS3 = async (file, folder = 'uploads') => {
  const ext = path.extname(file.originalname).toLowerCase();
  const key = `${folder}/${uuidv4()}${ext}`;

  const params = {
    Bucket:      env.AWS_S3_BUCKET,
    Key:         key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  };

  // Only set ACL if bucket supports it (Object Ownership = ACLs enabled)
  if (env.AWS_S3_ACL) params.ACL = env.AWS_S3_ACL;

  await s3.send(new PutObjectCommand(params));

  return `${env.AWS_S3_BASE}${key}`;
};

module.exports = { uploadToS3 };
