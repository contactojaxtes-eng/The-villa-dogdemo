async function checkEmails() {
  const apiKey = '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';
  
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/emails', {
      headers: { 'api-key': apiKey }
    });
    console.log(await res.json());
  } catch (err) {
    console.error(err);
  }
}
checkEmails();
