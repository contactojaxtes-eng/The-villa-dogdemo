const nodemailer = require('nodemailer');

async function testEmail() {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 465,
    secure: true,
    auth: {
      user: 'b2682c001@smtp-brevo.com', 
      pass: 'xsmtpsib-82ea7a9185cf9aefe0e5905b8ad994fc582901efec2e65bdf9b52dd932c6f960-mbEajCKJW1B4NmgU'
    },
    connectionTimeout: 5000,
  });

  try {
    const info = await transporter.sendMail({
      from: 'notificaciones@thevilladog.local',
      to: 'notificaciones@thevilladog.local',
      subject: 'Test Email from Node (465)',
      text: 'This is a test email on port 465'
    });
    console.log('Success on 465:', info.messageId);
  } catch (err) {
    console.error('Error sending email on 465:', err.message);
  }
}

testEmail();
