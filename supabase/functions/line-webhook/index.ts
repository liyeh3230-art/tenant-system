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
              text: "🎉 恭喜！您已成功綁定智慧租屋系統帳號！\n\n您可以隨時在此傳送：\n👉「查詢帳單」：檢視本期應繳與待繳帳單\n👉「繳款資訊」：取得匯款帳號及回報方式\n👉「報修進度」：查看修繕申請狀態",
            },
          ]);
        }
      } else if (text === "查詢帳單" || text === "帳單") {
        // Query linked tenant
        const { data: lineAccount } = await supabase
          .from("tenant_line_accounts")
          .select("tenant_id")
          .eq("line_user_id", lineUserId)
          .eq("status", "active")
          .single();

        if (!lineAccount) {
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: "⚠️ 您的 LINE 帳號尚未綁定租客身分。\n請先登入租客系統取得「一次性綁定驗證碼」，並於此輸入「綁定 <驗證碼>」完成綁定！",
            },
          ]);
          continue;
        }

        // Query pending bills
        const { data: bills } = await supabase
          .from("bills")
          .select("id, title, due_date, total_amount, status")
          .eq("tenant_id", lineAccount.tenant_id)
          .eq("status", "pending")
          .is("deleted_at", null)
          .order("due_date", { ascending: true });

        if (!bills || bills.length === 0) {
          await replyLineMessage(replyToken, [
            { type: "text", text: "✅ 您目前沒有未繳納的帳單，感謝您的準時繳納！" },
          ]);
        } else {
          const billListText = bills
            .map(
              (b: any, idx: number) =>
                `📌 帳單 ${idx + 1}：${b.title}\n💵 金額：NT$ ${Number(b.total_amount).toLocaleString()}\n📅 到期日：${b.due_date}`
            )
            .join("\n\n");

          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: `📋 【待繳帳單查詢結果】\n\n${billListText}\n\n💡 繳款後請至系統或告知房東匯款末五碼進行核帳。`,
            },
          ]);
        }
      } else {
        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: "您好！我是智慧租屋管理小幫手。\n輸入「查詢帳單」可即時查詢待繳租金。\n輸入「綁定 <驗證碼>」可綁定您的租客帳號。",
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
