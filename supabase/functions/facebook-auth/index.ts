// Supabase Edge Function: facebook-auth
// Exchanges Facebook OAuth Authorization Code for User Profile & Session

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const FB_APP_ID = Deno.env.get("FB_APP_ID") || "1633585894994695";
const FB_APP_SECRET = Deno.env.get("FB_APP_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://hpphlfmtyxrulirpyejp.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { code, redirectUri, targetRole = "tenant" } = await req.json();

    if (!code || !redirectUri) {
      return new Response(JSON.stringify({ error: "Missing code or redirectUri" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let fbUserId = "";
    let fbDisplayName = "Facebook 用戶";
    let fbPictureUrl = "";

    // 1. 若配置了真實的 FB_APP_SECRET，向 Facebook Graph API 換取 Access Token
    if (FB_APP_SECRET) {
      const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&code=${encodeURIComponent(code)}`;

      const tokenRes = await fetch(tokenUrl);
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok || !tokenData.access_token) {
        console.error("Facebook Token exchange failed:", tokenData);
        return new Response(JSON.stringify({ error: tokenData.error?.message || "Facebook token exchange failed" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2. 獲取使用者個人檔案
      const profileUrl = `https://graph.facebook.com/me?fields=id,name,picture.width(300)&access_token=${tokenData.access_token}`;
      const profileRes = await fetch(profileUrl);
      const profileData = await profileRes.json();

      if (!profileRes.ok || !profileData.id) {
        return new Response(JSON.stringify({ error: "Failed to fetch Facebook profile" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      fbUserId = `fb_${profileData.id}`;
      fbDisplayName = profileData.name || "Facebook 用戶";
      fbPictureUrl = profileData.picture?.data?.url || "";
    } else {
      // 開發/模擬測試容錯：產生合規識別碼
      fbUserId = `fb_${code.slice(-10) || Date.now().toString().slice(-8)}`;
      fbDisplayName = "Facebook 用戶";
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || Deno.env.get("SUPABASE_ANON_KEY") || "");

    // 3. 查詢是否已有該 Facebook ID 之現存綁定紀錄
    const { data: binding } = await supabase
      .from("line_bindings")
      .select("tenant_id, line_user_id, status")
      .eq("line_user_id", fbUserId)
      .maybeSingle();

    let matchedUser: any = null;
    let isNewUser = false;

    if (binding && binding.tenant_id) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", binding.tenant_id)
        .is("deleted_at", null);

      if (profs && profs.length > 0) {
        matchedUser = profs[0];
      }
    }

    if (!matchedUser) {
      isNewUser = true;
      matchedUser = {
        id: `soc_usr_${Date.now()}`,
        name: fbDisplayName,
        phone: "",
        role: targetRole,
        avatar_url: fbPictureUrl,
      };
    }

    return new Response(JSON.stringify({
      success: true,
      isNewUser,
      user: matchedUser,
      facebookProfile: {
        userId: fbUserId,
        displayName: fbDisplayName,
        pictureUrl: fbPictureUrl,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("facebook-auth error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
