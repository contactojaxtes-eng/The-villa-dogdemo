const nodemailer = require('nodemailer');

async function testEmail() {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: 'b2682c001@smtp-brevo.com',
      pass: 'xsmtpsib-82ea7a9185cf9aefe0e5905b8ad994fc582901efec2e65bdf9b52dd932c6f960-mbEajCKJW1B4NmgU'
    }
  });

  try {
    const info = await transporter.sendMail({
      from: 'b2682c001@smtp-brevo.com',
      to: 'josign...', // The user's test email
      subject: 'Test Email',
      text: 'This is a test email'
    });
    console.log('Success:', info.messageId);
  } catch (err) {
    console.error('Error sending email:', err.message);
  }

  try {
    const info2 = await transporter.sendMail({
      from: 'notificaciones@thevilladog.local', // Their actual brevo account email
      to: 'notificaciones@thevilladog.local',
      subject: 'Test Email',
      text: 'This is a test email'
    });
    console.log('Success 2:', info2.messageId);
  } catch (err) {
    console.error('Error sending email 2:', err.message);
  }
}

testEmail();
