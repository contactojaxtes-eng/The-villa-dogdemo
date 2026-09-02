async function testBrevoApi() {
  const apiKey = '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';
  
  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        sender: { email: 'josignmargal@gmail.com', name: 'The Villa Dog Test' }, // changed sender
        to: [{ email: 'josignmargal@gmail.com' }],
        subject: 'API Test Direct from Script',
        textContent: 'Testing direct API call.',
      })
    });

    console.log('Status:', response.status);
    const data = await response.text();
    console.log('Response Body:', data);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testBrevoApi();
