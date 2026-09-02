const nodemailer = require('nodemailer');

async function testEmail() {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: 'b2682c001@smtp-brevo.com', // Brevo SMTP login
      pass: 'xsmtpsib-82ea7a9185cf9aefe0e5905b8ad994fc582901efec2e65bdf9b52dd932c6f960-mbEajCKJW1B4NmgU' // API Key
    },
    // Adding timeout so it doesn't hang infinitely if blocked
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });

  try {
    const info = await transporter.sendMail({
      from: 'notificaciones@thevilladog.local', // The actual registered email
      to: 'notificaciones@thevilladog.local', // Sending to themselves
      subject: 'Test Email from Node',
      text: 'This is a test email on port 587'
    });
    console.log('Success on 587:', info.messageId);
  } catch (err) {
    console.error('Error sending email on 587:', err.message);
  }
}

testEmail();
