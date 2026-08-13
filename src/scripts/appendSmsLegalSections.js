'use strict';
/**
 * One-off content update: appends SMS-consent language (required for Twilio
 * A2P 10DLC campaign registration) to the Terms and Privacy Page records.
 * Safe to re-run — skips a page if it already has the section.
 *
 * Usage: node src/scripts/appendSmsLegalSections.js
 */
const { Page } = require('../models');

const TERMS_ADDITION = `<p></p><h2><strong>SMS&nbsp;Messaging&nbsp;Terms</strong></h2><p>By&nbsp;providing&nbsp;your&nbsp;phone&nbsp;number&nbsp;and&nbsp;opting&nbsp;in&nbsp;to&nbsp;SMS&nbsp;verification,&nbsp;you&nbsp;agree&nbsp;to&nbsp;receive&nbsp;transactional&nbsp;text&nbsp;messages&nbsp;from&nbsp;MatchCreatorz,&nbsp;including&nbsp;one-time&nbsp;verification&nbsp;codes.&nbsp;Message&nbsp;frequency&nbsp;varies.&nbsp;Message&nbsp;and&nbsp;data&nbsp;rates&nbsp;may&nbsp;apply.&nbsp;Reply&nbsp;STOP&nbsp;to&nbsp;opt&nbsp;out.</p>`;

const PRIVACY_ADDITION = `<p></p><h2><strong>SMS&nbsp;Communications</strong></h2><p>MatchCreatorz&nbsp;may&nbsp;use&nbsp;your&nbsp;phone&nbsp;number&nbsp;to&nbsp;send&nbsp;transactional&nbsp;SMS&nbsp;messages&nbsp;such&nbsp;as&nbsp;one-time&nbsp;verification&nbsp;codes&nbsp;when&nbsp;you&nbsp;request&nbsp;authentication&nbsp;or&nbsp;phone&nbsp;verification.&nbsp;We&nbsp;do&nbsp;not&nbsp;use&nbsp;these&nbsp;verification&nbsp;messages&nbsp;for&nbsp;promotional&nbsp;or&nbsp;marketing&nbsp;purposes.</p>`;

(async () => {
  const terms = await Page.findOne({ where: { slug: 'terms' } });
  if (!terms) throw new Error('terms page not found');
  if (!terms.content.includes('SMS&nbsp;Messaging&nbsp;Terms')) {
    await terms.update({ content: terms.content + TERMS_ADDITION });
    console.log('✅ terms updated');
  } else {
    console.log('terms already has SMS section, skipped');
  }

  const privacy = await Page.findOne({ where: { slug: 'privacy' } });
  if (!privacy) throw new Error('privacy page not found');
  if (!privacy.content.includes('SMS&nbsp;Communications')) {
    await privacy.update({ content: privacy.content + PRIVACY_ADDITION });
    console.log('✅ privacy updated');
  } else {
    console.log('privacy already has SMS section, skipped');
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
