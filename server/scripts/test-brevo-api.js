async function testBrevoApi() {
  const apiKey = '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';
  const from = 'notificaciones@thevilladog.local';
  const to = 'josignmargal@gmail.com'; // the user's test email from the photo

  console.log('Sending request to Brevo API...');
  
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: from, name: 'The Villa Dog Domicilios Test' },
        to: [{ email: to }],
        subject: 'API Test - The Villa Dog',
        textContent: 'It works via API!',
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Success!', data);
    } else {
      const err = await response.text();
      console.error('Error from Brevo:', response.status, err);
    }
  } catch (err) {
    console.error('Network Error:', err.message);
  }
}

testBrevoApi();
