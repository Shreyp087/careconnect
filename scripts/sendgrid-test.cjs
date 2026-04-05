// using Twilio SendGrid's v3 Node.js Library
// https://github.com/sendgrid/sendgrid-nodejs
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const sgMail = require('@sendgrid/mail');

const apiKey = (process.env.SENDGRID_API_KEY || '').trim();
const fromEmail = (process.env.SENDGRID_FROM_EMAIL || '').trim();
const toEmail = process.argv[2] || 'shreyp087@gmail.com';

if (!apiKey) {
  console.error('SENDGRID_API_KEY is missing. This test script now loads it from .env.');
  process.exit(1);
}

if (!apiKey.startsWith('SG.')) {
  console.error('SENDGRID_API_KEY is present but does not start with "SG.".');
  process.exit(1);
}

if (!fromEmail || fromEmail === 'yourverifiedemail@yourdomain.com') {
  console.error(
    'SENDGRID_FROM_EMAIL is not set to a real verified sender. SendGrid will return 403 until you use a verified sender identity.'
  );
  process.exit(1);
}

sgMail.setApiKey(apiKey);
// sgMail.setDataResidency('eu');
// uncomment the above line if you are sending mail using a regional EU subuser

const msg = {
  to: toEmail, // Change to your recipient or pass one as the first CLI argument
  from: fromEmail, // Must be a verified sender in SendGrid
  subject: 'Sending with SendGrid is Fun',
  text: 'and easy to do anywhere, even with Node.js',
  html: '<strong>and easy to do anywhere, even with Node.js</strong>'
};

sgMail
  .send(msg)
  .then(() => {
    console.log('Email sent');
  })
  .catch((error) => {
    console.error('SendGrid request failed.');
    console.error('Status:', error.code || error.response?.statusCode || 'unknown');

    if (error.response?.body) {
      console.error('Response body:', JSON.stringify(error.response.body, null, 2));
    } else {
      console.error(error);
    }
  });
