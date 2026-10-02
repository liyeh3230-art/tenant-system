const WEBHOOK_URL = 'https://hpphlfmtyxrulirpyejp.supabase.co/functions/v1/line-webhook';

async function testWebhook() {
  console.log("=== Testing Webhook Live Endpoint ===");

  // 1. GET health check
  console.log("1. Testing GET health check...");
  const getRes = await fetch(WEBHOOK_URL);
  const getData = await getRes.json();
  console.log("GET Response:", getRes.status, getData);

  // 2. POST LINE verify probe (empty events)
  console.log("2. Testing POST LINE verification probe...");
  const postRes = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: [] })
  });
  const postData = await postRes.json();
  console.log("POST Verify Probe Response:", postRes.status, postData);
}

testWebhook().catch(console.error);
