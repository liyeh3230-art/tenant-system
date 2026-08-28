import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hpphlfmtyxrulirpyejp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TiqESe0SQ_HMFZjFpz-DBA_wOgnVUj3';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testRpc() {
  console.log('Testing delete_user_by_admin RPC call...');
  const { data, error } = await supabase.rpc('delete_user_by_admin', {
    target_user_id: 'f1dc993a-5a6e-4f6e-8cb4-4c491c682c87',
    target_phone: '0938302199'
  });
  console.log('RPC result:', data, 'Error:', error);
}

testRpc().catch(console.error);
