import crypto from 'crypto';

const WEBHOOK_URL = 'https://hpphlfmtyxrulirpyejp.supabase.co/functions/v1/line-webhook';
const LINE_CHANNEL_SECRET = "e44eaf2457cd877830f4372b1b2d3ba2";
const TEST_USER_ID = "U604565299ab45b4cb7bcb2e1f2472358"; // 徐立業

function signBody(body) {
  return crypto.createHmac('sha256', LINE_CHANNEL_SECRET).update(body).digest('base64');
}

async function sendEvent(event) {
  const payload = JSON.stringify({
    destination: "U1234567890abcdef",
    events: [event]
  });
  const sig = signBody(payload);

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": sig
    },
    body: payload
  });
  return { status: res.status, data: await res.json() };
}

async function runTests() {
  console.log("=== Testing Webhook Real-World Event Handling ===");

  // 1. Postback: Switch to Landlord Mode
  console.log("\n1. Testing Postback: switch_role -> landlord...");
  const res1 = await sendEvent({
    type: "postback",
    replyToken: "ffffffffffffffffffffffffffffffff", // dummy token (LINE API will return error 400 for dummy token, but our server should process and return 200 OK)
    source: { type: "user", userId: TEST_USER_ID },
    postback: { data: "action=switch_role&target=landlord" }
  });
  console.log("Result 1:", res1);

  // 2. Message: "經營概況" (in Landlord mode)
  console.log("\n2. Testing Message: '經營概況'...");
  const res2 = await sendEvent({
    type: "message",
    replyToken: "ffffffffffffffffffffffffffffffff",
    source: { type: "user", userId: TEST_USER_ID },
    message: { id: "123456", type: "text", text: "經營概況" }
  });
  console.log("Result 2:", res2);

  // 3. Message: "待核帳單" (in Landlord mode)
  console.log("\n3. Testing Message: '待核帳單'...");
  const res3 = await sendEvent({
    type: "message",
    replyToken: "ffffffffffffffffffffffffffffffff",
    source: { type: "user", userId: TEST_USER_ID },
    message: { id: "123457", type: "text", text: "待核帳單" }
  });
  console.log("Result 3:", res3);

  // 4. Message: "房源現況" (in Landlord mode)
  console.log("\n4. Testing Message: '房源現況'...");
  const res4 = await sendEvent({
    type: "message",
    replyToken: "ffffffffffffffffffffffffffffffff",
    source: { type: "user", userId: TEST_USER_ID },
    message: { id: "123458", type: "text", text: "房源現況" }
  });
  console.log("Result 4:", res4);

  // 5. Postback: Switch back to Tenant Mode
  console.log("\n5. Testing Postback: switch_role -> tenant...");
  const res5 = await sendEvent({
    type: "postback",
    replyToken: "ffffffffffffffffffffffffffffffff",
    source: { type: "user", userId: TEST_USER_ID },
    postback: { data: "action=switch_role&target=tenant" }
  });
  console.log("Result 5:", res5);

  // 6. Message: "我的租約" (in Tenant mode)
  console.log("\n6. Testing Message: '我的租約'...");
  const res6 = await sendEvent({
    type: "message",
    replyToken: "ffffffffffffffffffffffffffffffff",
    source: { type: "user", userId: TEST_USER_ID },
    message: { id: "123459", type: "text", text: "我的租約" }
  });
  console.log("Result 6:", res6);
}

runTests().catch(console.error);
