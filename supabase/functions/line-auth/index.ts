// Supabase Edge Function: line-auth
// Exchanges LINE OAuth Authorization Code for User Profile & Session

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const LINE_CHANNEL_ID = Deno.env.get("LINE_CHANNEL_ID") || "2011231660";
const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") || "7498965ccf869f7d567a496cd46dcb5f";
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

    // 1. Exchange code for access_token & id_token with LINE API
    const tokenParams = new URLSearchParams();
    tokenParams.append("grant_type", "authorization_code");
    tokenParams.append("code", code);
    tokenParams.append("redirect_uri", redirectUri);
    tokenParams.append("client_id", LINE_CHANNEL_ID);
    tokenParams.append("client_secret", LINE_CHANNEL_SECRET);

    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("LINE Token exchange failed:", tokenData);
      return new Response(JSON.stringify({ error: tokenData.error_description || "LINE token exchange failed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Fetch User Profile from LINE API
    const profileRes = await fetch("https://api.line.me/v2/profile", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const profileData = await profileRes.json();

    if (!profileRes.ok || !profileData.userId) {
      return new Response(JSON.stringify({ error: "Failed to fetch LINE profile" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lineUserId = profileData.userId;
    const lineDisplayName = profileData.displayName || "LINE 用戶";
    const linePictureUrl = profileData.pictureUrl || "";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || Deno.env.get("SUPABASE_ANON_KEY") || "");

    // 3. Check if this LINE User ID is already bound to an existing account
    const { data: binding } = await supabase
      .from("line_bindings")
      .select("tenant_id, line_user_id, status")
      .eq("line_user_id", lineUserId)
      .maybeSingle();

    let matchedUser: any = null;
    let isNewUser = false;

    if (binding && binding.tenant_id) {
      // 舊使用者 → 找到既有會員
      const { data: profs } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", binding.tenant_id);

      if (profs && profs.length > 0) {
        matchedUser = profs[0];
      }
    }

    // 4. 若為新使用者 → 建立網站會員
    if (!matchedUser) {
      isNewUser = true;
      const newUserId = `line_${lineUserId.substring(0, 16)}_${Date.now()}`;
      const newPhone = `line_${lineUserId.substring(0, 10)}`;

      matchedUser = {
        id: newUserId,
        name: lineDisplayName,
        phone: newPhone,
        role: targetRole === "landlord" ? "landlord" : "tenant",
        avatar_url: linePictureUrl,
      };

      // 寫入 profiles 表
      await supabase.from("profiles").upsert({
        id: newUserId,
        role: matchedUser.role,
        name: lineDisplayName,
        phone: newPhone,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // 寫入對應的角色表 (tenants / landlords)
      if (matchedUser.role === "landlord") {
        await supabase.from("landlords").upsert({
          id: newUserId,
          name: lineDisplayName,
          phone: newPhone,
          status: "approved",
          ad_listing_enabled: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        await supabase.from("tenants").upsert({
          id: newUserId,
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      // 寫入 line_bindings 建立永久綁定關聯
      await supabase.from("line_bindings").upsert({
        tenant_id: newUserId,
        line_user_id: lineUserId,
        line_display_name: lineDisplayName,
        status: "active",
        updated_at: new Date().toISOString(),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        isNewUser,
        user: matchedUser,
        lineProfile: {
          userId: lineUserId,
          displayName: lineDisplayName,
          pictureUrl: linePictureUrl,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("line-auth server error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
