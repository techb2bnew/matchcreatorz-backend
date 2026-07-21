'use strict';
const nodemailer = require('nodemailer');
const env        = require('../config/env');

// ── Transporter ─────────────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host:   env.SMTP_HOST,
  port:   env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },
});

// Verify on startup (only in production)
if (env.NODE_ENV === 'production') {
  transporter.verify((err) => {
    if (err) console.error('❌  SMTP connection failed:', err.message);
    else     console.log('✅  SMTP ready');
  });
}

// ── Logo URL ─────────────────────────────────────────────────────────

const logoUrl = () => `https://matchcreatorz.s3.us-east-1.amazonaws.com/portfolios/logo.svg`;

// ── Base template ───────────────────────────────────────────────────

const baseTemplate = (content) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>MatchCreatorz</title>
  <style>
    body { margin:0; padding:0; background:#efefef; font-family:Arial,sans-serif; }
    .wrap { max-width:580px; margin:40px auto; background:#fff;
            border-radius:16px; overflow:hidden;
            border:1px solid #e8e8e8; box-shadow:0 2px 12px rgba(0,0,0,.06); }
    .header { background:#e84545; padding:28px 40px 24px; text-align:center; }
    .body   { padding:36px 40px; color:#1a1a1a; line-height:1.65; }
    .body h2 { margin-top:0; font-size:20px; }
    .btn    { display:inline-block; background:#e84545; color:#fff!important;
              padding:14px 32px; border-radius:12px; text-decoration:none;
              font-weight:700; font-size:15px; margin:20px 0; }
    .otp    { font-size:40px; font-weight:900; color:#e84545;
              letter-spacing:10px; text-align:center; padding:20px 0; }
    .footer { padding:20px 40px; text-align:center; font-size:12px;
              color:#9ca3af; border-top:1px solid #f0f0f0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div style="display:inline-block;background:#ffffff;border-radius:12px;padding:8px 20px;margin-bottom:0;line-height:0;">
        <img src="${logoUrl()}" alt="MatchCreatorz" width="140" height="114" style="display:block;width:140px;height:114px;border:0;" />
      </div>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} MatchCreatorz. All rights reserved.<br/>
      If you didn't request this email, please ignore it.
    </div>
  </div>
</body>
</html>
`;

// ── Send helper ─────────────────────────────────────────────────────

const sendMail = async ({ to, subject, html }) => {
  const info = await transporter.sendMail({
    from:    env.EMAIL_FROM,
    to,
    subject,
    html,
  });
  if (env.NODE_ENV !== 'production') {
    console.log(`📧  Email sent to ${to} — ${subject}`);
  }
  return info;
};

// ── Email templates ─────────────────────────────────────────────────

/**
 * Welcome email after registration
 */
const sendWelcome = (to, name) =>
  sendMail({
    to,
    subject: 'Welcome to MatchCreatorz!',
    html: baseTemplate(`
      <h2>Welcome, ${name}! 🎉</h2>
      <p>We're excited to have you on board. Your account has been created successfully.</p>
      <p>Start exploring services, post jobs, and connect with top professionals.</p>
      <a class="btn" href="${env.CLIENT_URL}">Get Started</a>
      <p>If you have any questions, feel free to reply to this email.</p>
    `),
  });

/**
 * OTP email for email verification / login
 */
const sendOtp = (to, name, otp) =>
  sendMail({
    to,
    subject: `${otp} — Your MatchCreatorz OTP`,
    html: baseTemplate(`
      <h2>Verify your email</h2>
      <p>Hi ${name}, use the OTP below to verify your account.</p>
      <div class="otp">${otp}</div>
      <p style="text-align:center;color:#6b7280;font-size:13px;">
        This OTP expires in <strong>${env.OTP_EXPIRES_MIN} minutes</strong>.
        Do not share it with anyone.
      </p>
    `),
  });

/**
 * Forgot password — reset link
 */
const sendPasswordReset = (to, name, resetLink) =>
  sendMail({
    to,
    subject: 'Reset your MatchCreatorz password',
    html: baseTemplate(`
      <h2>Reset your password</h2>
      <p>Hi ${name}, we received a request to reset your password.</p>
      <a class="btn" href="${resetLink}">Reset Password</a>
      <p>This link expires in <strong>30 minutes</strong>.</p>
      <p>If you didn't request a password reset, you can safely ignore this email.</p>
    `),
  });

/**
 * Password changed confirmation
 */
const sendPasswordChanged = (to, name) =>
  sendMail({
    to,
    subject: 'Your password has been changed',
    html: baseTemplate(`
      <h2>Password changed</h2>
      <p>Hi ${name}, your MatchCreatorz password was successfully changed.</p>
      <p>If this wasn't you, please <a href="${env.CLIENT_URL}/support">contact support</a> immediately.</p>
    `),
  });

/**
 * New bid notification to buyer
 */
const sendNewBidNotification = (to, buyerName, jobTitle, sellerName) =>
  sendMail({
    to,
    subject: `New bid on your job: ${jobTitle}`,
    html: baseTemplate(`
      <h2>You have a new bid!</h2>
      <p>Hi ${buyerName}, <strong>${sellerName}</strong> has placed a bid on your job:</p>
      <p style="font-size:18px;font-weight:bold;color:#1a1a1a;">"${jobTitle}"</p>
      <a class="btn" href="${env.CLIENT_URL}/buyer/jobs">View Bids</a>
    `),
  });

/**
 * Booking confirmation
 */
const sendBookingConfirmed = (to, name, serviceName, date) =>
  sendMail({
    to,
    subject: `Booking confirmed — ${serviceName}`,
    html: baseTemplate(`
      <h2>Booking confirmed! ✅</h2>
      <p>Hi ${name}, your booking for <strong>${serviceName}</strong> has been confirmed.</p>
      <p>Date: <strong>${new Date(date).toDateString()}</strong></p>
      <a class="btn" href="${env.CLIENT_URL}/buyer/bookings">View Booking</a>
    `),
  });

/**
 * Connects added — notify seller
 */
const sendConnectsAdded = (to, name, amount, note) =>
  sendMail({
    to,
    subject: `${amount} connects added to your account`,
    html: baseTemplate(`
      <h2>${amount} Connects Added!</h2>
      <p>Hi ${name}, <strong>${amount} connects</strong> have been credited to your MatchCreatorz account.</p>
      ${note ? `<p>Note: ${note}</p>` : ''}
      <a class="btn" href="${env.CLIENT_URL}/seller/connects">View Connects</a>
    `),
  });

/**
 * Account created by admin — sends login credentials to new user
 */
const sendAdminWelcome = (to, name, role, tempPassword) => {
  const roleLower   = role.toLowerCase();
  const roleColor   = roleLower === 'seller' ? '#7c3aed' : '#0ea5e9';
  const roleBg      = roleLower === 'seller' ? '#f5f3ff' : '#f0f9ff';
  const roleIcon    = roleLower === 'seller' ? '🎨' : '🛒';
  const logoSrc     = logoUrl();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Welcome to MatchCreatorz</title>
</head>
<body style="margin:0;padding:0;background:#efefef;font-family:Arial,Helvetica,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#efefef;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e8e8e8;box-shadow:0 4px 24px rgba(0,0,0,.07);">

        <!-- HEADER -->
        <tr>
          <td bgcolor="#e84545" style="background-color:#e84545;padding:32px 40px 28px;text-align:center;">
            <!-- Logo on white pill -->
            <div style="display:inline-block;background:#ffffff;border-radius:14px;padding:10px 24px;margin-bottom:18px;line-height:0;">
              <img src="${logoSrc}" alt="MatchCreatorz" width="160" height="130" style="display:block;width:160px;height:130px;border:0;" />
            </div>
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.5px;font-family:Arial,sans-serif;">Your Account is Ready!</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,.85);font-size:14px;font-family:Arial,sans-serif;">Welcome aboard, <strong>${name}</strong></p>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="padding:36px 40px;">

            <!-- Role badge -->
            <div style="text-align:center;margin-bottom:28px;">
              <span style="display:inline-flex;align-items:center;gap:6px;background:${roleBg};color:${roleColor};border:1px solid ${roleColor}33;border-radius:50px;padding:6px 18px;font-size:13px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;">
                ${roleIcon} ${role} Account
              </span>
            </div>

            <p style="margin:0 0 8px;color:#1a1a1a;font-size:15px;line-height:1.6;">
              Hi <strong>${name}</strong>, an admin has created your <strong>${role}</strong> account on MatchCreatorz.
              Use the credentials below to log in.
            </p>

            <!-- Credentials card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border-radius:14px;overflow:hidden;border:1px solid #e8e8e8;">

              <!-- Card header -->
              <tr>
                <td colspan="2" style="background:#f8f8f8;padding:12px 20px;border-bottom:1px solid #e8e8e8;">
                  <span style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:1.5px;text-transform:uppercase;">Login Credentials</span>
                </td>
              </tr>

              <!-- Email row -->
              <tr>
                <td style="padding:16px 20px;width:110px;vertical-align:top;">
                  <span style="display:inline-block;background:#fef2f2;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;color:#e84545;text-transform:uppercase;letter-spacing:.5px;">Email</span>
                </td>
                <td style="padding:16px 20px;vertical-align:middle;border-left:1px solid #f0f0f0;">
                  <span style="font-size:15px;font-weight:700;color:#1a1a1a;">${to}</span>
                </td>
              </tr>

              <!-- Divider -->
              <tr><td colspan="2" style="height:1px;background:#f0f0f0;padding:0;"></td></tr>

              <!-- Password row -->
              <tr>
                <td style="padding:16px 20px;width:110px;vertical-align:top;">
                  <span style="display:inline-block;background:#fef2f2;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;color:#e84545;text-transform:uppercase;letter-spacing:.5px;">Password</span>
                </td>
                <td style="padding:16px 20px;vertical-align:middle;border-left:1px solid #f0f0f0;">
                  <span style="font-size:22px;font-weight:900;color:#e84545;letter-spacing:4px;font-family:'Courier New',monospace;">${tempPassword}</span>
                </td>
              </tr>

            </table>

            <!-- Security notice -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;background:#fffbeb;border-radius:12px;border:1px solid #fde68a;">
              <tr>
                <td style="padding:14px 18px;">
                  <span style="font-size:13px;color:#92400e;line-height:1.5;">
                    ⚠️&nbsp; <strong>Security tip:</strong> Please log in and change your password immediately. Never share your credentials with anyone.
                  </span>
                </td>
              </tr>
            </table>

            <!-- CTA Button -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="padding:4px 0 8px;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" bgcolor="#e84545" style="border-radius:14px;">
                        <a href="${env.CLIENT_URL}/login"
                           style="display:inline-block;background-color:#e84545;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:16px 48px;border-radius:14px;letter-spacing:.3px;mso-padding-alt:0;font-family:Arial,sans-serif;">
                          &#x2192;&nbsp; Login to MatchCreatorz
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- Steps -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
              <tr>
                <td>
                  <p style="margin:0 0 16px;font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">What's next?</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:32px;vertical-align:top;padding-top:2px;">
                        <span style="display:inline-block;width:22px;height:22px;background:#e84545;border-radius:50%;text-align:center;color:#fff;font-size:11px;font-weight:700;line-height:22px;">1</span>
                      </td>
                      <td style="padding-bottom:12px;padding-left:8px;font-size:14px;color:#374151;">
                        <strong>Log in</strong> with the credentials above
                      </td>
                    </tr>
                    <tr>
                      <td style="width:32px;vertical-align:top;padding-top:2px;">
                        <span style="display:inline-block;width:22px;height:22px;background:#e84545;border-radius:50%;text-align:center;color:#fff;font-size:11px;font-weight:700;line-height:22px;">2</span>
                      </td>
                      <td style="padding-bottom:12px;padding-left:8px;font-size:14px;color:#374151;">
                        <strong>Change your password</strong> from account settings
                      </td>
                    </tr>
                    <tr>
                      <td style="width:32px;vertical-align:top;padding-top:2px;">
                        <span style="display:inline-block;width:22px;height:22px;background:#e84545;border-radius:50%;text-align:center;color:#fff;font-size:11px;font-weight:700;line-height:22px;">3</span>
                      </td>
                      <td style="padding-left:8px;font-size:14px;color:#374151;">
                        <strong>Complete your profile</strong> and start ${roleLower === 'seller' ? 'getting hired' : 'hiring creators'}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #f0f0f0;text-align:center;">
            <p style="margin:0 0 6px;font-size:12px;color:#9ca3af;">
              &copy; ${new Date().getFullYear()} MatchCreatorz. All rights reserved.
            </p>
            <p style="margin:0;font-size:11px;color:#d1d5db;">
              If you did not expect this email, please ignore it or
              <a href="mailto:support@matchcreatorz.com" style="color:#e84545;text-decoration:none;">contact support</a>.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;

  return sendMail({
    to,
    subject: `${roleIcon} Your MatchCreatorz ${role} account is ready — Login credentials inside`,
    html,
  });
};

// ── Seller account approved by admin ───────────────────────────────────
const sendSellerApproved = (to, name) =>
  sendMail({
    to,
    subject: 'Your seller account has been approved! 🎉',
    html: baseTemplate(`
      <h2>Account Approved! 🎉</h2>
      <p>Hi ${name}, great news! Your MatchCreatorz seller account has been <strong style="color:#16a34a;">approved</strong> by our team.</p>
      <p>You can now create services, receive bookings, and start earning.</p>
      <a class="btn" href="${env.CLIENT_URL}/seller/dashboard">Go to Dashboard</a>
      <p style="color:#6b7280;font-size:13px;">Complete your profile to attract more clients.</p>
    `),
  });

// ── Seller account rejected by admin ───────────────────────────────────
const sendSellerRejected = (to, name) =>
  sendMail({
    to,
    subject: 'Update on your MatchCreatorz seller application',
    html: baseTemplate(`
      <h2>Application Status Update</h2>
      <p>Hi ${name}, after reviewing your seller account application, our team has decided not to approve it at this time.</p>
      <p>This could be due to incomplete profile information or not meeting our quality standards.</p>
      <p>You can update your profile and reapply, or <a href="mailto:support@matchcreatorz.com" style="color:#e84545;">contact support</a> for more information.</p>
      <a class="btn" href="${env.CLIENT_URL}/seller/profile">Update Profile</a>
    `),
  });

// ── Account blocked ─────────────────────────────────────────────────────
const sendAccountBlocked = (to, name, role) =>
  sendMail({
    to,
    subject: 'Your MatchCreatorz account has been suspended',
    html: baseTemplate(`
      <h2>Account Suspended</h2>
      <p>Hi ${name}, your MatchCreatorz ${role} account has been <strong style="color:#dc2626;">suspended</strong> by our admin team.</p>
      <p>If you believe this is a mistake, please contact our support team.</p>
      <a class="btn" href="mailto:support@matchcreatorz.com">Contact Support</a>
    `),
  });

// ── Account unblocked ───────────────────────────────────────────────────
const sendAccountUnblocked = (to, name, role) =>
  sendMail({
    to,
    subject: 'Your MatchCreatorz account has been reinstated',
    html: baseTemplate(`
      <h2>Account Reinstated ✅</h2>
      <p>Hi ${name}, your MatchCreatorz ${role} account has been <strong style="color:#16a34a;">reinstated</strong>. You can now log in and use the platform.</p>
      <a class="btn" href="${env.CLIENT_URL}/login">Login Now</a>
    `),
  });

// ── Bid withdrawn → buyer ───────────────────────────────────────────────
const sendBidWithdrawn = (to, buyerName, jobTitle, sellerName) =>
  sendMail({
    to,
    subject: `A bid was withdrawn — "${jobTitle}"`,
    html: baseTemplate(`
      <h2>Bid Withdrawn</h2>
      <p>Hi ${buyerName}, <strong>${sellerName}</strong> has withdrawn their bid on your job <strong>"${jobTitle}"</strong>.</p>
      <p>Don't worry — other sellers may still bid on your job.</p>
      <a class="btn" href="${env.CLIENT_URL}/buyer/jobs">View Job</a>
    `),
  });

// ── Bid accepted → seller ───────────────────────────────────────────────
const sendBidAccepted = (to, sellerName, jobTitle) =>
  sendMail({
    to,
    subject: `Your bid was accepted — "${jobTitle}"`,
    html: baseTemplate(`
      <h2>Bid Accepted! 🎉</h2>
      <p>Hi ${sellerName}, your bid on the job <strong>"${jobTitle}"</strong> has been <strong style="color:#16a34a;">accepted</strong> by the buyer.</p>
      <p>A booking has been automatically created. Please accept the order to start working.</p>
      <a class="btn" href="${env.CLIENT_URL}/seller/bookings">View Booking</a>
    `),
  });

// ── Bid rejected → seller ───────────────────────────────────────────────
const sendBidRejected = (to, sellerName, jobTitle) =>
  sendMail({
    to,
    subject: `Bid update — "${jobTitle}"`,
    html: baseTemplate(`
      <h2>Bid Not Selected</h2>
      <p>Hi ${sellerName}, the buyer reviewed all bids for <strong>"${jobTitle}"</strong> and selected a different seller this time.</p>
      <p>Don't worry — there are many other opportunities waiting for you!</p>
      <a class="btn" href="${env.CLIENT_URL}/seller/jobs">Browse Jobs</a>
    `),
  });

// ── Booking received → seller ───────────────────────────────────────────
const sendBookingReceived = (to, sellerName, bookingTitle) =>
  sendMail({
    to,
    subject: `New booking request — "${bookingTitle}"`,
    html: baseTemplate(`
      <h2>New Booking Request 📥</h2>
      <p>Hi ${sellerName}, you have received a new booking request for <strong>"${bookingTitle}"</strong>.</p>
      <p>Please review and accept or decline the booking within 24 hours.</p>
      <a class="btn" href="${env.CLIENT_URL}/seller/bookings">View Booking</a>
    `),
  });

// ── Work submitted → buyer ──────────────────────────────────────────────
const sendWorkSubmitted = (to, buyerName, bookingTitle) =>
  sendMail({
    to,
    subject: `Work submitted for review — "${bookingTitle}"`,
    html: baseTemplate(`
      <h2>Work Ready for Review 📋</h2>
      <p>Hi ${buyerName}, the seller has submitted work for your booking <strong>"${bookingTitle}"</strong>.</p>
      <p>Please review the deliverables and either <strong>accept</strong> the work or <strong>raise a dispute</strong> if revisions are needed.</p>
      <a class="btn" href="${env.CLIENT_URL}/buyer/bookings">Review Work</a>
      <p style="color:#6b7280;font-size:13px;">You have 5 days to review. After that, the work will be auto-accepted.</p>
    `),
  });

// ── Work accepted → seller ──────────────────────────────────────────────
const sendWorkAccepted = (to, sellerName, bookingTitle) =>
  sendMail({
    to,
    subject: `Work accepted — "${bookingTitle}" is complete!`,
    html: baseTemplate(`
      <h2>Work Accepted! ✅</h2>
      <p>Hi ${sellerName}, the buyer has accepted your work for <strong>"${bookingTitle}"</strong>.</p>
      <p>The booking is now marked as <strong style="color:#16a34a;">completed</strong>. Great work!</p>
      <a class="btn" href="${env.CLIENT_URL}/seller/bookings">View Bookings</a>
    `),
  });

// ── Dispute raised → seller ─────────────────────────────────────────────
const sendDisputeRaised = (to, sellerName, bookingTitle) =>
  sendMail({
    to,
    subject: `Dispute raised on "${bookingTitle}"`,
    html: baseTemplate(`
      <h2>Dispute Raised ⚠️</h2>
      <p>Hi ${sellerName}, the buyer has raised a dispute on the booking <strong>"${bookingTitle}"</strong>.</p>
      <p>Our support team will review the case and reach out to both parties. Please be patient.</p>
      <a class="btn" href="${env.CLIENT_URL}/seller/bookings">View Booking</a>
      <p style="color:#6b7280;font-size:13px;">If you have questions, <a href="mailto:support@matchcreatorz.com" style="color:#e84545;">contact support</a>.</p>
    `),
  });

// ── Booking cancelled ───────────────────────────────────────────────────
const sendBookingCancelled = (to, name, bookingTitle, cancelledBy) =>
  sendMail({
    to,
    subject: `Booking cancelled — "${bookingTitle}"`,
    html: baseTemplate(`
      <h2>Booking Cancelled</h2>
      <p>Hi ${name}, the booking <strong>"${bookingTitle}"</strong> has been cancelled by the <strong>${cancelledBy}</strong>.</p>
      <p>If you have any questions, please <a href="mailto:support@matchcreatorz.com" style="color:#e84545;">contact support</a>.</p>
      <a class="btn" href="${env.CLIENT_URL}/${cancelledBy === 'buyer' ? 'seller' : 'buyer'}/bookings">View Bookings</a>
    `),
  });

// ── Review received → seller ────────────────────────────────────────────
const sendReviewReceived = (to, sellerName, buyerName, rating, serviceName) => {
  const stars = '⭐'.repeat(Number(rating));
  return sendMail({
    to,
    subject: `New ${rating}-star review received`,
    html: baseTemplate(`
      <h2>New Review! ${stars}</h2>
      <p>Hi ${sellerName}, <strong>${buyerName}</strong> left you a <strong>${rating}-star</strong> review${serviceName ? ` for <strong>"${serviceName}"</strong>` : ''}.</p>
      <div style="text-align:center;font-size:36px;padding:16px 0;">${stars}</div>
      <a class="btn" href="${env.CLIENT_URL}/seller/reviews">View All Reviews</a>
    `),
  });
};

module.exports = {
  sendWelcome,
  sendOtp,
  sendPasswordReset,
  sendPasswordChanged,
  sendNewBidNotification,
  sendBookingConfirmed,
  sendConnectsAdded,
  sendAdminWelcome,
  // new
  sendSellerApproved,
  sendSellerRejected,
  sendAccountBlocked,
  sendAccountUnblocked,
  sendBidWithdrawn,
  sendBidAccepted,
  sendBidRejected,
  sendBookingReceived,
  sendWorkSubmitted,
  sendWorkAccepted,
  sendDisputeRaised,
  sendBookingCancelled,
  sendReviewReceived,
};
