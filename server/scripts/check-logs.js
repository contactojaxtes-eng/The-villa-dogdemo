async function checkLogs() {
  const apiKey = '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';

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/statistics/events?limit=5&sort=desc', {
      headers: {
        'api-key': apiKey,
        'Accept': 'application/json'
      }
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error fetching logs:', err.message);
  }
}

checkLogs();
