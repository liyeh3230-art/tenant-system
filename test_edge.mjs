async function testEdgeFunction() {
  const res = await fetch('https://hpphlfmtyxrulirpyejp.supabase.co/functions/v1/line-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ping: true })
  });
  console.log('Status:', res.status);
  const data = await res.json();
  console.log('Response:', data);
}

testEdgeFunction().catch(console.error);
