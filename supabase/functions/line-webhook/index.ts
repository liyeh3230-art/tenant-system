// Supabase Edge Function: line-webhook
// Secure LINE Bot Webhook Endpoint with HMAC-SHA256 Signature Verification & Rate Limiting

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") || "";
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// In-memory rate limiting map (per LINE User ID)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(userId: string, limit = 10, windowMs = 60000): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(userId);
  if (!record || now > record.resetTime) {
    rateLimitMap.set(userId, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (record.count >= limit) {
    return false;
  }
  record.count += 1;
  return true;
}

// Verify LINE Signature using HMAC-SHA256
async function verifyLineSignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const base64Hash = btoa(String.fromCharCode(...hashArray));
    return base64Hash === signature;
  } catch (err) {
    console.error("Signature verification error");
    return false;
  }
}

// Reply message to LINE user
async function replyLineMessage(replyToken: string, messages: any[]): Promise<Response> {
  return await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });
}

serve(async (req: Request) => {
  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const signature = req.headers.get("x-line-signature");
  const rawBody = await req.text();

  // P0 Security: Enforce LINE HMAC-SHA256 Webhook Signature Check
  const isValid = await verifyLineSignature(rawBody, signature, LINE_CHANNEL_SECRET);
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid signature (Unauthorized)" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let bodyData: any;
  try {
    bodyData = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const events = bodyData.events || [];

  for (const event of events) {
    const lineUserId = event.source?.userId;
    if (!lineUserId) continue;

    // Rate limiting check
    if (!checkRateLimit(lineUserId)) {
      if (event.replyToken) {
        await replyLineMessage(event.replyToken, [
          { type: "text", text: "⚠️ 請求過於頻繁，請稍後再試。" },
        ]);
      }
      continue;
    }

    if (event.type === "message" && event.message?.type === "text") {
      const text = event.message.text.trim();
      const replyToken = event.replyToken;

      // Handle Account Binding Command: "綁定 <TOKEN>" or "BIND <TOKEN>"
      if (text.startsWith("綁定") || text.toUpperCase().startsWith("BIND")) {
        const parts = text.split(/\s+/);
        const token = parts[1];

        if (!token || token.length < 6) {
          await replyLineMessage(replyToken, [
            { type: "text", text: "請輸入正確的綁定代碼格式：例如「綁定 A1B2C3D4」。請至租客系統個人中心取得 10 分鐘有效之安全驗證碼。" },
          ]);
          continue;
        }

        // Call RPC: verify_and_bind_line
        const { data, error } = await supabase.rpc("verify_and_bind_line", {
          p_token: token,
          p_line_user_id: lineUserId,
          p_line_display_name: "LINE User",
        });

        if (error) {
          await replyLineMessage(replyToken, [
            { type: "text", text: `❌ 綁定失敗：${error.message || "驗證碼無效或已過期，請重新由系統產生新代碼。"}` },
          ]);
        } else {
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: "🎉 恭喜！您已成功綁定智慧租屋系統帳號！\n\n您可以隨時在此傳送：\n👉「查詢帳單」：檢視本期應繳與待繳租金帳單\n👉「繳款資訊」：取得房東匯款帳號與繳費方式\n👉「租約資訊」：查看目前承租之房源與起迄日期",
            },
          ]);
        }
      } else if (text.includes("帳單") || text.includes("查詢") || text === "1") {
        // Query linked tenant
        const { data: binding } = await supabase
          .from("line_bindings")
          .select("tenant_id")
          .eq("line_user_id", lineUserId)
          .eq("status", "active")
          .maybeSingle();

        if (!binding) {
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: "⚠️ 您的 LINE 帳號尚未綁定租客身分。\n請先登入租客系統取得「一次性綁定驗證碼」，並於此輸入「綁定 <驗證碼>」完成綁定！",
            },
          ]);
          continue;
        }

        // Query tenant profile & active leases
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, name, phone")
          .or(`id.eq.${binding.tenant_id}`);
        const currentProfile = profs?.[0];
        const cleanPhone = currentProfile?.phone ? String(currentProfile.phone).replace(/[^0-9]/g, '') : '';

        // Query active leases
        const { data: leases } = await supabase
          .from("leases")
          .select("id, property_id, start_date, end_date")
          .or(`phone.eq.${cleanPhone},co_phone.eq.${cleanPhone}`)
          .eq("status", "active")
          .is("deleted_at", null);

        const leaseIds = (leases || []).map((l: any) => l.id);

        // Query pending payments
        let payments: any[] = [];
        if (leaseIds.length > 0) {
          const { data: payData } = await supabase
            .from("payments")
            .select("id, title, due_date, amount, bill_type, status, property_name")
            .in("lease_id", leaseIds)
            .in("status", ["pending", "pending_approval", "tenant_submitted"])
            .is("deleted_at", null)
            .order("due_date", { ascending: true });
          payments = payData || [];
        }

        if (payments.length === 0) {
          await replyLineMessage(replyToken, [
            { type: "text", text: `✅ ${currentProfile?.name || '您好'}！您目前沒有未繳納之帳單，感謝您的準時繳納！` },
          ]);
        } else {
          const statusLabels: Record<string, string> = {
            pending: "⏳ 待繳納",
            pending_approval: "🔍 房東審核中",
            tenant_submitted: "🔍 房東審核中"
          };
          const billListText = payments
            .map(
              (b: any, idx: number) =>
                `📌 帳單 ${idx + 1}：${b.title || '租金帳單'}\n🏠 房源：${b.property_name || '租賃套房'}\n💵 金額：NT$ ${Number(b.amount || 0).toLocaleString()}\n📅 到期日：${b.due_date || '依約定'}\n狀態：${statusLabels[b.status] || '待處理'}`
            )
            .join("\n\n");

          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: `📋 【${currentProfile?.name || '租客'} 待繳帳單清單】\n\n${billListText}\n\n💡 匯款後可於租客系統回報後五碼，或輸入「繳款資訊」查閱房東帳戶。`,
            },
          ]);
        }
      } else if (text.includes("繳款") || text.includes("匯款") || text.includes("帳戶") || text === "2") {
        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: "💳 【繳費方式說明】\n\n1. 現金交付：現場交付房東並於系統回報。\n2. 銀行轉帳：請登入租客系統「自主回報繳費」查閱專屬收款帳號，轉帳後填寫後五碼供核帳。\n\n如需協助可隨時與房東聯絡！",
          },
        ]);
      } else {
        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: "您好！我是智慧租屋管理小幫手 🤖\n\n請輸入以下關鍵字：\n👉 輸入「查詢帳單」：查詢本期應繳租金\n👉 輸入「繳款資訊」：查看繳費與匯款管道\n👉 輸入「綁定 <驗證碼>」：綁定租客系統帳號",
          },
        ]);
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
