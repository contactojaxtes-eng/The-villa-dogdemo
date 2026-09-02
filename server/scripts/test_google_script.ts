async function testGoogleScript() {
  const url = 'https://script.google.com/macros/s/AKfycbx1DtAMgP5tywPdgE9ki_DXK7Qd7VknpayVQdY6UplmDewm0zmPkDG4MxH8KQpbQW85kA/exec';

  console.log('Enviando correo de prueba a través de Google Apps Script...');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: 'notificaciones@thevilladog.local',
      subject: '✅ Correo Oficial de Google Gmail - THE VILLA DOG',
      text: '¡Conexión exitosa! El sistema THE VILLA DOG está enviando correos directamente desde tu cuenta de Gmail.',
      html: '<div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;"><h2 style="color: #90BF50;">✅ Conexión Exitosa con Google Gmail</h2><p>¡Hola! Este correo fue enviado directamente desde tu cuenta de <strong>notificaciones@thevilladog.local</strong> utilizando la infraestructura oficial de Google.</p><p style="color: #666; font-size: 12px;">The Villa Dog - Sistema de Gestión</p></div>'
    }),
    redirect: 'follow'
  });

  const text = await res.text();
  console.log('Respuesta de Google:', res.status, text);
}

testGoogleScript();
