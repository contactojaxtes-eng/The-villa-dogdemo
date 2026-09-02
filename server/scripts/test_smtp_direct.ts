import * as nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = 'notificaciones@thevilladog.local';
  const pass = 'hyjdhmyysltvkryy';

  console.log('Testing SMTP connection with service: gmail...');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  try {
    await transporter.verify();
    console.log('✅ Google SMTP Verification SUCCESSFUL with service: gmail!');

    // Update settings in database
    const settings = [
      { key: 'smtp_host', value: 'smtp.gmail.com' },
      { key: 'smtp_port', value: '587' },
      { key: 'smtp_user', value: user },
      { key: 'smtp_pass', value: pass },
      { key: 'smtp_from', value: `The Villa Dog <${user}>` },
    ];

    for (const s of settings) {
      await prisma.appSetting.upsert({
        where: { key: s.key },
        create: s,
        update: { value: s.value },
      });
    }
    console.log('✅ Database SMTP settings updated successfully in Aiven DB!');

    const info = await transporter.sendMail({
      from: `"The Villa Dog" <${user}>`,
      to: user,
      subject: '✅ Conexión Exitosa - THE VILLA DOG Correo Activo',
      text: '¡La configuración de correo con Google para el Sistema The Villa Dog quedó 100% activa y funcionando correctamente!',
      html: '<div style="font-family: Arial, sans-serif; padding: 20px;"><h2 style="color:#90BF50;">✅ Conexión Exitosa</h2><p>¡La configuración de correo con Google para el <strong>Sistema The Villa Dog</strong> quedó 100% activa y funcionando correctamente!</p></div>',
    });
    console.log('✅ Test email sent successfully! MessageId:', info.messageId);
  } catch (err: any) {
    console.error('❌ Error during Gmail test:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
