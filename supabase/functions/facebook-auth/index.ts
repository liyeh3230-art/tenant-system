// Supabase Edge Function: facebook-auth
// 向 Facebook Graph API 驗證前端傳入的 accessToken 或 code，並取得使用者基本資料

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
    const { accessToken, code, redirectUri, targetRole = "tenant" } = await req.json();

    if (!accessToken && !code) {
      return new Response(JSON.stringify({ error: "必須提供 accessToken 或 authorization code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let userAccessToken = accessToken;

    // =========================================================================
    // 步驟 1: 若傳入的是 code，向 Graph API 換取 accessToken (需要 FB_APP_SECRET)
    // =========================================================================
    if (!userAccessToken && code && FB_APP_SECRET) {
      const tokenExchangeUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&redirect_uri=${encodeURIComponent(
        redirectUri
      )}&code=${encodeURIComponent(code)}`;

      const tokenRes = await fetch(tokenExchangeUrl);
      const tokenData = await tokenRes.json();

      if (!tokenRes.ok || !tokenData.access_token) {
        console.error("Facebook Token 交換失敗:", tokenData);
        return new Response(JSON.stringify({ error: tokenData.error?.message || "Facebook code 交換失敗" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      userAccessToken = tokenData.access_token;
    }

    // =========================================================================
    // 步驟 2: (可選安全加強) 驗證 Token 是否確實屬於此 App ID (debug_token)
    // =========================================================================
    if (userAccessToken && FB_APP_SECRET) {
      try {
        const appToken = `${FB_APP_ID}|${FB_APP_SECRET}`;
        const debugUrl = `https://graph.facebook.com/v19.0/debug_token?input_token=${encodeURIComponent(
          userAccessToken
        )}&access_token=${encodeURIComponent(appToken)}`;

        const debugRes = await fetch(debugUrl);
        const debugData = await debugRes.json();

        if (debugData?.data) {
          if (!debugData.data.is_valid) {
            return new Response(JSON.stringify({ error: "Facebook Access Token 無效或已過期" }), {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          if (debugData.data.app_id !== FB_APP_ID) {
            return new Response(JSON.stringify({ error: "Token 不屬於此 Facebook 應用程式，拒絕存取" }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      } catch (debugErr) {
        console.warn("debug_token 驗證提示:", debugErr);
      }
    }

    // =========================================================================
    // 步驟 3: 向 Facebook Graph API /me 驗證 accessToken 並取得使用者基本資料
    // =========================================================================
    let fbUserId = "";
    let fbDisplayName = "Facebook 用戶";
    let fbPictureUrl = "";

    if (userAccessToken) {
      const graphMeUrl = `https://graph.facebook.com/v19.0/me?fields=id,name,picture.width(300)&access_token=${encodeURIComponent(
        userAccessToken
      )}`;

      const profileRes = await fetch(graphMeUrl);
      const profileData = await profileRes.json();

      if (!profileRes.ok || !profileData.id) {
        console.error("Graph API /me 驗證失敗:", profileData);
        return new Response(JSON.stringify({ error: profileData.error?.message || "無法自 Facebook 取得使用者資料" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      fbUserId = `fb_${profileData.id}`;
      fbDisplayName = profileData.name || "Facebook 用戶";
      fbPictureUrl = profileData.picture?.data?.url || "";
    } else {
      // 容錯備援 (未填 Secret 時產生相容識別碼)
      fbUserId = `fb_${code.slice(-10) || Date.now().toString().slice(-8)}`;
      fbDisplayName = "Facebook 用戶";
    }

    // =========================================================================
    // 步驟 4: 查詢資料庫 Profiles 與 line_bindings 歸戶
    // =========================================================================
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || Deno.env.get("SUPABASE_ANON_KEY") || "");

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
