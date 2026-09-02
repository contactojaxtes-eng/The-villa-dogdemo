async function runTest() {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      id: "1255261377669525",
      changes: [{
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "573003229261", phone_number_id: "1255261377669525" },
          statuses: [{
            id: "wamid.TEST_CHECK_GATEWAY",
            status: "delivered",
            timestamp: Math.floor(Date.now() / 1000),
            recipient_id: "573215580510"
          }]
        },
        field: "messages"
      }]
    }]
  };

  console.log("Testing Cloudflare Worker POST...");
  const res = await fetch("https://niche-whatsapp-gateway.softwaresjja.workers.dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  console.log("Status:", res.status, await res.text());
}

runTest().catch(console.error);
