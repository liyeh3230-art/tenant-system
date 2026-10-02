// Supabase Edge Function: line-webhook
// Comprehensive LINE Bot Webhook with Signature Verification, Rate Limiting, Flex Messages & Payment Reporting

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const LINE_CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") || "e44eaf2457cd877830f4372b1b2d3ba2";
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") || "3tRsfe2hSYJvT0Ygrvvu+vbkpgd+CkMbv0335PxTeGq+L7nklrr2/6e2ENGlpwZoHc+LVnmOzgPQPl1KUGr7byBd0PsjoQFhcJ8YastIH29ANr8RSWDR9kz97+6zlhpGIqofGT/lBL41ohwsH1MFDQdB04t89/1O/w1cDnyilFU=";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://hpphlfmtyxrulirpyejp.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// In-memory rate limiting map (per LINE User ID)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(userId: string, limit = 15, windowMs = 60000): boolean {
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
    console.error("Signature verification error:", err);
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

// Helper to fetch user profile from LINE API
async function getLineUserProfile(userId: string): Promise<{ displayName?: string; pictureUrl?: string } | null> {
  if (!userId || !LINE_CHANNEL_ACCESS_TOKEN) return null;
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("getLineUserProfile error:", err);
  }
  return null;
}

// Helper to calculate duration in months and remaining days
function calculateContractDuration(start: string, end: string) {
  if (!start || !end) return { months: 0, days: 0, formatted: "0 個月" };
  const d1 = new Date(start);
  const d2 = new Date(end);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return { months: 0, days: 0, formatted: "0 個月" };

  const y1 = d1.getFullYear(), m1 = d1.getMonth(), day1 = d1.getDate();
  const y2 = d2.getFullYear(), m2 = d2.getMonth(), day2 = d2.getDate();

  let months = (y2 - y1) * 12 + (m2 - m1);
  let days = day2 - day1;

  if (days < 0) {
    months -= 1;
    const prevMonthDays = new Date(y2, m2, 0).getDate();
    days += prevMonthDays;
  }

  if (months < 0) {
    months = 0;
    days = Math.max(0, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
  }

  let formatted = "";
  if (months > 0 && days > 0) {
    formatted = `${months} 個月又 ${days} 天`;
  } else if (months > 0) {
    formatted = `${months} 個月`;
  } else {
    formatted = `${days} 天`;
  }

  return { months, days, formatted };
}

// Helper to extract landlord bank info
function parseLandlordBank(landlord: any) {
  let bankName = landlord?.bank_name || "";
  let bankAccount = landlord?.bank_account || "";
  // ⚠️ 嚴格區分：landlordName 永遠代表合約出租人法定房東本人，絕不能被銀行受款戶名 (accountName) 覆蓋！
  let landlordName = landlord?.name || "房東";
  let accountName = landlord?.name || "房東";
  let landlordPhone = landlord?.phone || "未提供電話";
  let note = landlord?.note || "";

  if (landlord?.company_name) {
    try {
      const parsed = typeof landlord.company_name === 'string' ? JSON.parse(landlord.company_name) : landlord.company_name;
      if (parsed) {
        if (parsed.bankName) bankName = parsed.bankName;
        if (parsed.bankAccount) bankAccount = parsed.bankAccount;
        if (parsed.accountName) accountName = parsed.accountName; // 僅更新銀行帳戶戶名
        if (parsed.note) note = parsed.note;
      }
    } catch {}
  }
  if ((!bankName || !bankAccount) && landlord?.bank_info) {
    try {
      const parsed = typeof landlord.bank_info === 'string' ? JSON.parse(landlord.bank_info) : landlord.bank_info;
      if (parsed) {
        if (parsed.bankName) bankName = parsed.bankName;
        if (parsed.bankAccount) bankAccount = parsed.bankAccount;
        if (parsed.accountName) accountName = parsed.accountName; // 僅更新銀行帳戶戶名
        if (parsed.note) note = parsed.note;
      }
    } catch {}
  }
  return {
    bankName: bankName || "未填寫銀行名稱",
    bankAccount: bankAccount || "未填寫銀行帳號",
    accountName: accountName,       // 銀行收款戶名（公司或個人指定受款帳戶）
    landlordName: landlordName,     // 合約出租甲方（法定出租人，依法不可變更）
    landlordPhone: landlordPhone,
    note: note
  };
}

// Helper: 費用類別標準定義與視覺標籤設定
function getCategoryMeta(billType: string | undefined | null) {
  const type = String(billType || "").toLowerCase().trim();
  switch (type) {
    case "rent":
      return { key: "rent", label: "房屋租金", icon: "🏠", color: "#4F46E5", bg: "#EEF2FF", border: "#C7D2FE" };
    case "deposit":
      return { key: "deposit", label: "押金保證金", icon: "🔒", color: "#0D9488", bg: "#F0FDFA", border: "#99F6E4" };
    case "management":
      return { key: "management", label: "大樓管理費", icon: "🏢", color: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE" };
    case "electricity":
    case "power":
      return { key: "electricity", label: "用電費用", icon: "⚡", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" };
    case "water":
      return { key: "water", label: "自來水費", icon: "💧", color: "#0284C7", bg: "#F0F9FF", border: "#BAE6FD" };
    case "gas":
      return { key: "gas", label: "天然瓦斯", icon: "🔥", color: "#EA580C", bg: "#FFF7ED", border: "#FFEDD5" };
    case "utilities":
      return { key: "utilities", label: "水電瓦斯", icon: "⚡", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" };
    case "parking":
      return { key: "parking", label: "車位租金", icon: "🅿️", color: "#7C3AED", bg: "#F5F3FF", border: "#DDD6FE" };
    case "maintenance":
    case "repair":
      return { key: "maintenance", label: "修繕雜費", icon: "🔧", color: "#B45309", bg: "#FEF3C7", border: "#FDE68A" };
    default:
      return { key: "other", label: "待繳雜支", icon: "📋", color: "#475569", bg: "#F1F5F9", border: "#CBD5E1" };
  }
}

// Helper: 取得款項項目正確名稱（優先使用自訂標題，若無則依據費用類別顯示，絕不預設為「租金帳單」）
function getPaymentTitle(payment: any): string {
  const cat = getCategoryMeta(payment?.bill_type || payment?.billType);
  const rawTitle = (payment?.title || "").trim();
  if (!rawTitle) {
    return cat.label;
  }
  return rawTitle;
}

// -----------------------------------------------------------------------------
// LINE Flex Message Builders
// -----------------------------------------------------------------------------

// 1. 租約狀況 Flex Message
function buildLeaseFlex(lease: any, property: any, landlord: any, profile: any) {
  const duration = calculateContractDuration(lease.start_date, lease.end_date);
  const today = new Date();
  const dStart = new Date(lease.start_date);
  const dEnd = new Date(lease.end_date);
  const totalDays = Math.max(1, Math.round((dEnd.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24)));
  const daysPassed = Math.max(0, Math.round((today.getTime() - dStart.getTime()) / (1000 * 60 * 60 * 24)));
  const daysRemaining = Math.max(0, Math.round((dEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
  const isExpired = today > dEnd;
  const bankInfo = parseLandlordBank(landlord);
  const totalContractRent = (lease.total_contract_rent && Number(lease.total_contract_rent) > 0)
    ? Number(lease.total_contract_rent)
    : (Number(lease.monthly_rent || 0) * (duration.months > 0 ? duration.months : 1));

  return {
    type: "flex",
    altText: `📋 您的租約資訊 - ${property?.name || '承租房源'}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#4F46E5",
        paddingAll: "18px",
        contents: [
          {
            type: "text",
            text: "智慧租屋 · 我的租賃合約",
            color: "#C7D2FE",
            size: "xs",
            weight: "bold"
          },
          {
            type: "text",
            text: `${property?.name || '租賃房間'} · ${property?.type || '獨立套房'}`,
            color: "#FFFFFF",
            size: "xl",
            weight: "bold",
            margin: "sm"
          },
          {
            type: "text",
            text: isExpired ? "● 本期合約已屆期" : "● 正常履約生效中",
            color: isExpired ? "#FECDD3" : "#A7F3D0",
            size: "xs",
            weight: "bold",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "📍 物業地址", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: property?.address || "詳見合約約定", size: "xs", color: "#1E293B", weight: "bold", wrap: true, flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🗓️ 租賃期間", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `${lease.start_date} ~ ${lease.end_date}`, size: "xs", color: "#1E293B", weight: "bold", wrap: true, flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "✨ 合約約期", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `${duration.formatted} (已住 ${daysPassed} 天 · 倒數 ${daysRemaining} 天)`, size: "xs", color: "#D97706", weight: "bold", wrap: true, flex: 7 }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              {
                type: "box",
                layout: "vertical",
                flex: 1,
                contents: [
                  { type: "text", text: "合約總租金", size: "xxs", color: "#64748B" },
                  { type: "text", text: `NT$ ${totalContractRent.toLocaleString()}`, size: "sm", weight: "bold", color: "#4F46E5" }
                ]
              },
              {
                type: "box",
                layout: "vertical",
                flex: 1,
                contents: [
                  { type: "text", text: "履約保證押金", size: "xxs", color: "#64748B" },
                  { type: "text", text: `NT$ ${Number(lease.deposit || 0).toLocaleString()}`, size: "sm", weight: "bold", color: "#7C3AED" }
                ]
              }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "👤 出租甲方", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `${landlord?.name || bankInfo.landlordName || '房東'} (${landlord?.phone || bankInfo.landlordPhone || '未提供電話'})`, size: "xs", color: "#334155", weight: "bold", flex: 7 }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        paddingAll: "14px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#4F46E5",
            height: "sm",
            action: { type: "message", label: "⏳ 待繳帳單", text: "待繳帳單" }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "message", label: "💰 已繳紀錄", text: "已繳金額" }
          }
        ]
      }
    }
  };
}

// 2. 已繳金額與收據 Flex Message (簡潔直覺、一目了然清單排版)
function buildPaidPaymentsFlex(payments: any[], profile: any) {
  const totalPaid = (payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // 若無已繳款項，回傳空狀態 Bubble
  if (!payments || payments.length === 0) {
    return {
      type: "flex",
      altText: "💰 歷史繳費清單：目前尚無已核銷之繳費紀錄",
      contents: {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#059669",
          paddingAll: "16px",
          contents: [
            { type: "text", text: "智慧租屋 · 歷史繳費紀錄", color: "#A7F3D0", size: "xs", weight: "bold" },
            { type: "text", text: "已繳款項明細", color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" }
          ]
        },
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "20px",
          contents: [
            { type: "text", text: "目前尚無已核銷之繳費紀錄。", size: "sm", color: "#94A3B8", align: "center", margin: "lg" }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          paddingAll: "14px",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#059669",
              height: "sm",
              action: { type: "message", label: "⏳ 查詢待繳帳單", text: "待繳帳單" }
            }
          ]
        }
      }
    };
  }

  // 排序：最新繳納或最新建立的款項排在最前面
  const sortedPayments = [...payments].sort((a, b) => {
    const dateA = a.paid_date || a.due_date || a.created_at || "";
    const dateB = b.paid_date || b.due_date || b.created_at || "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    const timeA = new Date(a.created_at || 0).getTime();
    const timeB = new Date(b.created_at || 0).getTime();
    return timeB - timeA;
  });

  const ITEMS_PER_PAGE = 5; // 每頁 5 筆，簡約收據直覺清單呈現，一目了然
  const totalPages = Math.ceil(sortedPayments.length / ITEMS_PER_PAGE);

  const buildPageBubble = (pageIndex: number) => {
    const startIdx = pageIndex * ITEMS_PER_PAGE;
    const pageItems = sortedPayments.slice(startIdx, startIdx + ITEMS_PER_PAGE);
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === totalPages - 1;

    const bodyContents: any[] = [];

    // 第一頁顯示累計已繳總額概況看板
    if (isFirstPage) {
      bodyContents.push(
        {
          type: "box",
          layout: "horizontal",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "#ECFDF5",
          cornerRadius: "10px",
          paddingAll: "12px",
          contents: [
            {
              type: "box",
              layout: "vertical",
              contents: [
                { type: "text", text: "累計已核銷總額", size: "xxs", color: "#065F46", weight: "bold" },
                { type: "text", text: `NT$ ${totalPaid.toLocaleString()}`, size: "xl", weight: "bold", color: "#047857", margin: "xs" }
              ]
            },
            {
              type: "text",
              text: `共 ${sortedPayments.length} 筆已結清`,
              size: "xs",
              color: "#059669",
              weight: "bold"
            }
          ]
        },
        { type: "separator", margin: "md" }
      );
    }

    // 每一筆已繳費用清單（簡潔俐落清單：費用項目、金額、日期、方式，一目了然，去除多餘框框）
    pageItems.forEach((p, idx) => {
      const cat = getCategoryMeta(p.bill_type || p.billType);
      const rawTitle = (p.title || "").trim();
      const itemTitle = rawTitle || cat.label;
      const amtStr = Number(p.amount || 0).toLocaleString();
      const paidDate = p.paid_date || p.due_date || "已結清";
      const methodInfo = p.payment_method === "現金交付"
        ? "現金交付"
        : (p.transfer_last5 ? `轉帳(末五碼:${p.transfer_last5})` : "已入帳");

      if (idx > 0) {
        bodyContents.push({ type: "separator", margin: "md" });
      }

      bodyContents.push({
        type: "box",
        layout: "vertical",
        margin: "md",
        contents: [
          // 首列：項目名稱（左側大字粗體） + 已繳金額（右側綠色大字）
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            alignItems: "center",
            contents: [
              {
                type: "text",
                text: `${cat.icon} ${itemTitle}`,
                size: "sm",
                weight: "bold",
                color: "#1E293B",
                flex: 7,
                wrap: true
              },
              {
                type: "text",
                text: `NT$ ${amtStr}`,
                size: "md",
                weight: "bold",
                color: "#059669",
                align: "end",
                flex: 5
              }
            ]
          },
          // 次列：繳納日期 · 付款方式
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            alignItems: "center",
            margin: "xs",
            contents: [
              {
                type: "text",
                text: `📅 ${paidDate} · ${methodInfo}`,
                size: "xxs",
                color: "#64748B",
                flex: 8
              },
              {
                type: "text",
                text: "已結清",
                size: "xxs",
                color: "#059669",
                weight: "bold",
                align: "end",
                flex: 4
              }
            ]
          },
          ...(p.note && String(p.note).trim() ? [
            {
              type: "text",
              text: `📝 ${String(p.note).trim()}`,
              size: "xxs",
              color: "#94A3B8",
              margin: "xs",
              wrap: true
            }
          ] : [])
        ]
      });
    });

    // 頁尾
    const footerContents: any[] = [];

    if (totalPages > 1) {
      footerContents.push({
        type: "text",
        text: isLastPage
          ? `🎉 已顯示全數 ${sortedPayments.length} 筆已繳紀錄`
          : `👉 往左滑動檢視更早紀錄 (第 ${pageIndex + 2}/${totalPages} 頁)`,
        size: "xxs",
        color: isLastPage ? "#94A3B8" : "#059669",
        align: "center",
        margin: "none"
      });
    }

    footerContents.push({
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      margin: totalPages > 1 ? "sm" : "none",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#059669",
          height: "sm",
          action: { type: "message", label: "⏳ 待繳帳單", text: "待繳帳單" }
        },
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "message", label: "📋 我的租約", text: "租約狀況" }
        }
      ]
    });

    return {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#059669",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "智慧租屋 · 歷史繳費紀錄",
            color: "#A7F3D0",
            size: "xs",
            weight: "bold"
          },
          {
            type: "text",
            text: totalPages > 1 ? `已繳款項明細 (第 ${pageIndex + 1}/${totalPages} 頁)` : "已繳款項明細",
            color: "#FFFFFF",
            size: "lg",
            weight: "bold",
            margin: "xs"
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "14px",
        contents: footerContents
      }
    };
  };

  // 若只有 1 頁（<= 5 筆），以單卡呈現
  if (totalPages <= 1) {
    return {
      type: "flex",
      altText: `💰 已繳費紀錄總計：NT$ ${totalPaid.toLocaleString()} (共 ${sortedPayments.length} 筆)`,
      contents: buildPageBubble(0)
    };
  }

  // 多於 1 頁時，產生左右滑動之 Carousel 輪播卷軸（最多 10 頁）
  const carouselBubbles = [];
  const maxPages = Math.min(totalPages, 10);
  for (let i = 0; i < maxPages; i++) {
    carouselBubbles.push(buildPageBubble(i));
  }

  return {
    type: "flex",
    altText: `💰 已繳費紀錄總計：NT$ ${totalPaid.toLocaleString()} (共 ${sortedPayments.length} 筆，左右滑動卷軸翻頁)`,
    contents: {
      type: "carousel",
      contents: carouselBubbles
    }
  };
}

// 3. 待繳帳單 Flex Message (針對行動裝置與 LINE 閱讀全面優化排版)
function buildPendingBillsFlex(payments: any[], profile: any) {
  if (!payments || payments.length === 0) {
    return {
      type: "flex",
      altText: "🎉 太棒了！您目前沒有任何待繳帳單",
      contents: {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#10B981",
          paddingAll: "18px",
          contents: [
            { type: "text", text: "🎉 款項全數結清", color: "#FFFFFF", size: "lg", weight: "bold" }
          ]
        },
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "20px",
          contents: [
            { type: "text", text: `${profile?.name || '您好'}！目前沒有任何待繳納之帳單。`, size: "sm", color: "#334155", weight: "bold" },
            { type: "text", text: "感謝您的準時繳納，願您每天生活舒適愉快！", size: "xs", color: "#64748B", margin: "sm" }
          ]
        },
        footer: {
          type: "box",
          layout: "vertical",
          paddingAll: "14px",
          contents: [
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: { type: "message", label: "💰 查看已繳金額紀錄", text: "已繳金額" }
            }
          ]
        }
      }
    };
  }

  // 1. 統計待繳總額並排序（未回報者依到期日由近到遠優先，已回報核帳中放後方）
  const totalPending = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const todayStr = new Date().toISOString().split("T")[0];

  const sortedPayments = [...payments].sort((a, b) => {
    const isSubA = (a.status === "tenant_submitted" || a.status === "pending_approval");
    const isSubB = (b.status === "tenant_submitted" || b.status === "pending_approval");
    if (isSubA !== isSubB) return isSubA ? 1 : -1;
    const dueA = a.due_date || "9999-12-31";
    const dueB = b.due_date || "9999-12-31";
    return dueA.localeCompare(dueB);
  });

  // 每頁 2 筆，卡片更寬敞大器，保證手機全螢幕瀏覽不被截斷
  const ITEMS_PER_PAGE = 2;
  const totalPages = Math.ceil(sortedPayments.length / ITEMS_PER_PAGE);

  const buildPageBubble = (pageIndex: number) => {
    const startIdx = pageIndex * ITEMS_PER_PAGE;
    const pageItems = sortedPayments.slice(startIdx, startIdx + ITEMS_PER_PAGE);

    const billBoxes: any[] = [];
    pageItems.forEach((p, idx) => {
      const isSubmitted = (p.status === "tenant_submitted" || p.status === "pending_approval");
      const dueDateClean = p.due_date ? String(p.due_date).substring(0, 10) : "";
      const isOverdue = !isSubmitted && dueDateClean && dueDateClean < todayStr;
      const cat = getCategoryMeta(p.bill_type || p.billType);
      const title = getPaymentTitle(p);
      const amountStr = Number(p.amount || 0).toLocaleString();

      // 狀態顏色設定
      let cardBg = "#FFFBEB";
      let cardBorder = "#FDE68A";
      let statusBg = "#FEF3C7";
      let statusTextColor = "#B45309";
      let statusText = "⏳ 待繳納";
      let amountColor = "#92400E";

      if (isSubmitted) {
        cardBg = "#F8FAFC";
        cardBorder = "#CBD5E1";
        statusBg = "#EFF6FF";
        statusTextColor = "#2563EB";
        statusText = "🔍 核帳中";
        amountColor = "#475569";
      } else if (isOverdue) {
        cardBg = "#FEF2F2";
        cardBorder = "#FECACA";
        statusBg = "#FEE2E2";
        statusTextColor = "#DC2626";
        statusText = "⚠️ 已逾期";
        amountColor = "#DC2626";
      }

      billBoxes.push({
        type: "box",
        layout: "vertical",
        backgroundColor: cardBg,
        borderColor: cardBorder,
        borderWidth: "1px",
        cornerRadius: "14px",
        paddingAll: "14px",
        margin: idx > 0 ? "md" : "none",
        contents: [
          // 1. 標題列：類別圖示 + 名稱 + 狀態標籤 (左右對齊)
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            alignItems: "center",
            contents: [
              {
                type: "text",
                text: `${cat.icon} ${title}`,
                size: "sm",
                weight: "bold",
                color: "#1E293B",
                wrap: true,
                flex: 7
              },
              {
                type: "box",
                layout: "vertical",
                backgroundColor: statusBg,
                cornerRadius: "6px",
                paddingStart: "8px",
                paddingEnd: "8px",
                paddingTop: "2px",
                paddingBottom: "2px",
                flex: 0,
                contents: [
                  {
                    type: "text",
                    text: statusText,
                    size: "xxs",
                    color: statusTextColor,
                    weight: "bold"
                  }
                ]
              }
            ]
          },
          // 2. 應繳金額醒目區塊 (獨立基線列，金額與幣別全寬顯示永不截斷)
          {
            type: "box",
            layout: "baseline",
            spacing: "xs",
            margin: "sm",
            contents: [
              { type: "text", text: "應繳金額", size: "xxs", color: "#64748B", flex: 0 },
              { type: "text", text: "NT$", size: "xs", color: amountColor, weight: "bold", flex: 0 },
              {
                type: "text",
                text: ` ${amountStr}`,
                size: "xxl",
                weight: "bold",
                color: amountColor,
                wrap: true,
                flex: 1
              }
            ]
          },
          // 3. 到期日與備註列
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            margin: "xs",
            contents: [
              {
                type: "text",
                text: `📅 繳費期限：${dueDateClean || '依約定'}`,
                size: "xs",
                color: isOverdue ? "#DC2626" : "#64748B",
                weight: isOverdue ? "bold" : "regular"
              }
            ]
          },
          ...(p.note ? [
            {
              type: "text",
              text: `📝 備註：${p.note}`,
              size: "xxs",
              color: "#64748B",
              wrap: true,
              margin: "xs"
            }
          ] : []),
          // 4. 按鈕或狀態確認
          !isSubmitted ? {
            type: "button",
            style: "primary",
            color: isOverdue ? "#DC2626" : "#D97706",
            height: "sm",
            margin: "sm",
            action: {
              type: "postback",
              label: "📝 回報此筆繳款",
              data: `action=select_bill&id=${p.id}&title=${encodeURIComponent(title)}&amount=${p.amount}`
            }
          } : {
            type: "box",
            layout: "horizontal",
            backgroundColor: "#EFF6FF",
            cornerRadius: "8px",
            paddingAll: "8px",
            margin: "sm",
            contents: [
              {
                type: "text",
                text: `🔍 已回報末五碼 [${p.transfer_last5 || '已報'}]，房東核對入帳中`,
                size: "xxs",
                color: "#2563EB",
                weight: "bold",
                wrap: true
              }
            ]
          }
        ]
      });
    });

    return {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#B45309",
        paddingAll: "16px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            contents: [
              { type: "text", text: "智慧租屋 · 待繳納帳單", color: "#FEF3C7", size: "xs", weight: "bold" },
              { type: "text", text: `共 ${sortedPayments.length} 筆`, color: "#FDE68A", size: "xs", weight: "bold" }
            ]
          },
          {
            type: "text",
            text: totalPages > 1 ? `待處理帳單 (${pageIndex + 1}/${totalPages})` : `待處理帳單 (共 ${sortedPayments.length} 筆)`,
            color: "#FFFFFF",
            size: "xl",
            weight: "bold",
            margin: "xs"
          },
          {
            type: "box",
            layout: "baseline",
            spacing: "xs",
            margin: "xs",
            contents: [
              { type: "text", text: "待繳總計", size: "xs", color: "#FEF3C7", flex: 0 },
              { type: "text", text: "NT$", size: "xs", color: "#FFFFFF", weight: "bold", flex: 0 },
              { type: "text", text: ` ${totalPending.toLocaleString()}`, size: "lg", color: "#FFFFFF", weight: "bold", wrap: true, flex: 1 }
            ]
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        contents: billBoxes
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "14px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: { type: "message", label: "🏦 房東帳號", text: "匯款帳號" }
              },
              {
                type: "button",
                style: "primary",
                color: "#4F46E5",
                height: "sm",
                action: { type: "message", label: "📋 我的租約", text: "租約狀況" }
              }
            ]
          },
          ...(totalPages > 1 ? [
            {
              type: "text",
              text: `👉 左右滑動查看其餘帳單 (第 ${pageIndex + 1}/${totalPages} 頁)`,
              size: "xxs",
              color: "#94A3B8",
              align: "center",
              margin: "xs"
            }
          ] : [])
        ]
      }
    };
  };

  // 若只有 1 頁，直接回傳單一 Bubble 卡片
  if (totalPages <= 1) {
    return {
      type: "flex",
      altText: `📋 待處理帳單：共 ${sortedPayments.length} 筆，待繳總計 NT$ ${totalPending.toLocaleString()}`,
      contents: buildPageBubble(0)
    };
  }

  // 多於 1 頁時，產生左右滑動之 Carousel 輪播卷軸（最多 10 頁）
  const carouselBubbles = [];
  const maxPages = Math.min(totalPages, 10);
  for (let i = 0; i < maxPages; i++) {
    carouselBubbles.push(buildPageBubble(i));
  }

  return {
    type: "flex",
    altText: `📋 待處理帳單：共 ${sortedPayments.length} 筆，待繳總計 NT$ ${totalPending.toLocaleString()} (左右滑動翻頁)`,
    contents: {
      type: "carousel",
      contents: carouselBubbles
    }
  };
}

// 4. 回報成功 Flex Message
function buildReportSuccessFlex(payment: any, last5: string | null, isCash: boolean = false) {
  const cat = getCategoryMeta(payment?.bill_type || payment?.billType);
  const displayTitle = getPaymentTitle(payment);
  const methodDesc = isCash ? "現金交付" : `末五碼 ${last5}`;
  return {
    type: "flex",
    altText: `🎉 繳款回報成功：${cat.icon} ${displayTitle} (${methodDesc})`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#059669",
        paddingAll: "18px",
        contents: [
          { type: "text", text: "🎉 繳款回報完成", color: "#A7F3D0", size: "xs", weight: "bold" },
          { type: "text", text: "已送交房東核對確認", color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            alignItems: "center",
            contents: [
              { type: "text", text: "費用類別", size: "xs", color: "#64748B", flex: 3 },
              {
                type: "box",
                layout: "horizontal",
                alignItems: "center",
                backgroundColor: cat.bg,
                borderColor: cat.border,
                borderWidth: "1px",
                cornerRadius: "6px",
                paddingStart: "8px",
                paddingEnd: "8px",
                paddingTop: "2px",
                paddingBottom: "2px",
                flex: 0,
                contents: [
                  { type: "text", text: `${cat.icon} ${cat.label}`, size: "xxs", color: cat.color, weight: "bold" }
                ]
              }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "回報項目", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: displayTitle, size: "xs", color: "#1E293B", weight: "bold", wrap: true, flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "回報金額", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `NT$ ${Number(payment?.amount || 0).toLocaleString()}`, size: "sm", color: "#059669", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: isCash ? "繳款方式" : "轉帳末五碼", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: isCash ? "💵 現金交付" : `●●●●● ${last5}`, size: "xs", color: isCash ? "#059669" : "#1E293B", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "審核狀態", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: "🔍 房東審核中", size: "xs", color: "#3B82F6", weight: "bold", flex: 7 }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "text",
            text: isCash
              ? "💡 房東查收現金並核對入帳後，系統將自動開立電子收據，並自尚餘租金中扣減。"
              : "💡 房東核對入帳後，系統將自動開立電子收據，並自尚餘租金中扣減。",
            size: "xxs",
            color: "#64748B",
            wrap: true,
            margin: "sm"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        paddingAll: "14px",
        contents: [
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "message", label: "⏳ 待繳帳單", text: "待繳帳單" }
          },
          {
            type: "button",
            style: "primary",
            color: "#4F46E5",
            height: "sm",
            action: { type: "message", label: "📋 我的租約", text: "租約狀況" }
          }
        ]
      }
    }
  };
}

// 5. 房東帳號 Flex Message
function buildBankInfoFlex(landlord: any) {
  const bank = parseLandlordBank(landlord);
  return {
    type: "flex",
    altText: `🏦 房東匯款帳戶資訊 - ${bank.landlordName}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1E293B",
        paddingAll: "18px",
        contents: [
          { type: "text", text: "智慧租屋 · 約定收款帳戶", color: "#94A3B8", size: "xs", weight: "bold" },
          { type: "text", text: "房東銀行轉帳資訊", color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "收款銀行", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: bank.bankName, size: "xs", color: "#0F172A", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "銀行帳號", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: bank.bankAccount, size: "sm", color: "#4F46E5", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "帳戶戶名", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: bank.accountName, size: "xs", color: "#0F172A", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "出租房東", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `${bank.landlordName} (${bank.landlordPhone})`, size: "xs", color: "#475569", flex: 7 }
            ]
          },
          ...(bank.note ? [
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "備註說明", size: "xs", color: "#64748B", flex: 3 },
                { type: "text", text: bank.note, size: "xs", color: "#0F172A", wrap: true, flex: 7 }
              ]
            }
          ] : []),
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#F1F5F9",
            cornerRadius: "8px",
            paddingAll: "10px",
            contents: [
              { type: "text", text: "💡 轉帳完成後，請於此處直接輸入「回報 您的帳號末五碼」（例如：88621），系統將自動送交房東核帳！", size: "xxs", color: "#475569", wrap: true }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        paddingAll: "14px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#D97706",
            height: "sm",
            action: { type: "message", label: "📝 回報繳款", text: "回報繳費" }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "message", label: "⏳ 待繳帳單", text: "待繳帳單" }
          }
        ]
      }
    }
  };
}

const LIFF_REGISTRATION_URL = Deno.env.get("LIFF_REGISTRATION_URL") || "";
const SITE_URL = Deno.env.get("SITE_URL") || Deno.env.get("APP_URL") || "https://liyeh3230-art.github.io/tenant-system";

function getRegisterUrl(lineUserId: string = "", displayName: string = ""): string {
  if (LIFF_REGISTRATION_URL) {
    return LIFF_REGISTRATION_URL;
  }
  const cleanBase = (SITE_URL || "https://liyeh3230-art.github.io/tenant-system").replace(/\/$/, "");
  const encodedName = encodeURIComponent(displayName || "");
  return `${cleanBase}/?mode=line_register&line_uid=${lineUserId}&displayName=${encodedName}`;
}

// 6. 主功能導覽選單 Flex Message
function buildMenuFlex(profile: any, lineUserId = "", displayName = "") {
  const registerUrl = getRegisterUrl(lineUserId, displayName || profile?.name || "");

  return {
    type: "flex",
    altText: "🤖 智慧租屋小幫手 · 快速功能選單",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#4F46E5",
        paddingAll: "18px",
        contents: [
          { type: "text", text: `您好，${profile?.name || displayName || '租客朋友'}！`, color: "#C7D2FE", size: "xs", weight: "bold" },
          { type: "text", text: "智慧租屋服務選單", color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            height: "sm",
            action: {
              type: "uri",
              label: "📝 註冊會員",
              uri: registerUrl
            }
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                color: "#4F46E5",
                height: "sm",
                action: { type: "message", label: "📋 我的租約", text: "租約狀況" }
              },
              {
                type: "button",
                style: "primary",
                color: "#D97706",
                height: "sm",
                action: { type: "message", label: "⏳ 待繳帳單", text: "待繳帳單" }
              }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                color: "#059669",
                height: "sm",
                action: { type: "message", label: "💰 已繳紀錄", text: "已繳金額" }
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: { type: "message", label: "🏦 匯款帳號", text: "匯款帳號" }
              }
            ]
          },
          { type: "separator", margin: "md" },
          {
            type: "text",
            text: "💡 提示：點擊上方「註冊會員」即可綁定與設定密碼；若已轉帳可輸入「末五碼 12345」或「現金交付」快速回報！",
            size: "xxs",
            color: "#64748B",
            wrap: true,
            margin: "xs"
          }
        ]
      }
    },
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "message",
            label: "📝 註冊會員",
            text: "註冊會員"
          }
        },
        {
          type: "action",
          action: {
            type: "message",
            label: "⏳ 待繳帳單",
            text: "待繳帳單"
          }
        },
        {
          type: "action",
          action: {
            type: "message",
            label: "📋 我的租約",
            text: "租約狀況"
          }
        },
        {
          type: "action",
          action: {
            type: "message",
            label: "🏦 匯款帳號",
            text: "匯款帳號"
          }
        }
      ]
    }
  };
}

// 7. 未綁定帳號提示 Flex Message (支援方案 B 快速開通與設定密碼)
function buildUnboundGuideFlex(lineUserId = "", displayName = "") {
  const registerUrl = getRegisterUrl(lineUserId, displayName);

  return {
    type: "flex",
    altText: "👋 歡迎！請點選「註冊會員」開通專屬服務",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#06C755",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "智慧租屋 · 會員系統", color: "#E0F2FE", size: "xs", weight: "bold" },
          { type: "text", text: "開通專屬租客會員", color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          { type: "text", text: displayName ? `您好，${displayName}！歡迎使用智慧租屋 LINE 小幫手！` : "您好！歡迎使用智慧租屋 LINE 服務小幫手！", size: "sm", color: "#1E293B", weight: "bold" },
          { type: "text", text: "為了能即時為您推播租金帳單、合約到期提醒與繳費收據，請點擊下方按鈕進行「註冊會員」（包含設定網站登入密碼）：", size: "xs", color: "#64748B", wrap: true },
          {
            type: "button",
            style: "primary",
            color: "#06C755",
            height: "md",
            action: {
              type: "uri",
              label: "註冊會員",
              uri: registerUrl
            }
          },
          { type: "separator", margin: "sm" },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            margin: "sm",
            contents: [
              { type: "text", text: "💡 提示：", size: "xs", color: "#4F46E5", weight: "bold" },
              { type: "text", text: "完成註冊後，您既能在 LINE 即時接收通知與對帳，也能隨時使用【手機號碼 + 密碼】登入電腦或手機網站！", size: "xxs", color: "#64748B", wrap: true }
            ]
          }
        ]
      }
    },
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "message",
            label: "📝 註冊會員",
            text: "註冊會員"
          }
        },
        {
          type: "action",
          action: {
            type: "message",
            label: "📋 功能選單",
            text: "選單"
          }
        }
      ]
    }
  };
}

// -----------------------------------------------------------------------------
// Database Context Fetcher
// -----------------------------------------------------------------------------

async function getTenantContext(supabase: any, lineUserId: string) {
  // 1. 查詢 line_bindings
  const { data: binding } = await supabase
    .from("line_bindings")
    .select("*")
    .eq("line_user_id", lineUserId)
    .eq("status", "active")
    .maybeSingle();

  if (!binding || !binding.tenant_id) {
    return null;
  }

  // 2. 查詢 profiles
  const { data: profs } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", binding.tenant_id);

  const profile = profs?.[0] || null;
  const cleanPhone = profile?.phone ? String(profile.phone).replace(/[^0-9]/g, "") : "";

  // 3. 查詢進行中租約 (active leases)
  let query = supabase
    .from("leases")
    .select("*")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (cleanPhone) {
    query = query.or(`phone.eq.${cleanPhone},co_phone.eq.${cleanPhone}`);
  }

  const { data: leases } = await query;
  const activeLease = leases?.[0] || null;

  // 4. 查詢關聯房源與房東
  let property: any = null;
  let landlord: any = null;

  if (activeLease) {
    if (activeLease.property_id) {
      const { data: p } = await supabase
        .from("properties")
        .select("*")
        .eq("id", activeLease.property_id)
        .maybeSingle();
      property = p;
    }
    if (activeLease.landlord_id) {
      const { data: l } = await supabase
        .from("landlords")
        .select("*")
        .eq("id", activeLease.landlord_id)
        .maybeSingle();
      landlord = l;
    }
  }

  // 若 activeLease 無 landlord_id，嘗試從物業查詢
  if (!landlord && property?.landlord_id) {
    const { data: l } = await supabase
      .from("landlords")
      .select("*")
      .eq("id", property.landlord_id)
      .maybeSingle();
    landlord = l;
  }

  // 兜底方案：若仍查無房東，取得系統預設首位房東資料，確保匯款帳號不為空
  if (!landlord) {
    const { data: allLnds } = await supabase
      .from("landlords")
      .select("*")
      .is("deleted_at", null)
      .limit(1);
    landlord = allLnds?.[0] || null;
  }

  return {
    binding,
    profile,
    lease: activeLease,
    leases: leases || [],
    property,
    landlord,
    cleanPhone
  };
}

// -----------------------------------------------------------------------------
// HTTP Request Server
// -----------------------------------------------------------------------------

serve(async (req: Request) => {
  // Support GET (health check / browser check)
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", service: "line-webhook" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature");

  let bodyData: any = {};
  try {
    bodyData = JSON.parse(rawBody);
  } catch {
    bodyData = {};
  }

  // 1. LINE Developers Console "Verify" test button sends: { "events": [] }
  // When events is empty (or verify probe), return 200 OK immediately so LINE Console displays "Success"!
  if (!bodyData.events || bodyData.events.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "Webhook verified successfully" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Signature verification (if LINE_CHANNEL_SECRET is configured)
  if (LINE_CHANNEL_SECRET) {
    const isValid = await verifyLineSignature(rawBody, signature, LINE_CHANNEL_SECRET);
    if (!isValid) {
      console.warn("Signature verification failed. Please verify LINE_CHANNEL_SECRET in Supabase Secrets.");
      return new Response(JSON.stringify({ error: "Invalid signature (Unauthorized)" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const events = bodyData.events || [];

  for (const event of events) {
    const lineUserId = event.source?.userId;
    if (!lineUserId) continue;

    // Rate limit check
    if (!checkRateLimit(lineUserId)) {
      if (event.replyToken) {
        await replyLineMessage(event.replyToken, [
          { type: "text", text: "⚠️ 請求過於頻繁，請稍後再試。" },
        ]);
      }
      continue;
    }

    const replyToken = event.replyToken;
    if (!replyToken) continue;

    // -------------------------------------------------------------------------
    // 0. 處理 FOLLOW 事件（使用者加入 LINE BOT 好友或解除封鎖）
    // -------------------------------------------------------------------------
    if (event.type === "follow") {
      const userProfile = await getLineUserProfile(lineUserId);
      const displayName = userProfile?.displayName || "租客朋友";

      const { data: binding } = await supabase
        .from("line_bindings")
        .select("tenant_id, line_display_name")
        .eq("line_user_id", lineUserId)
        .maybeSingle();

      if (!binding) {
        // 未綁定新租客加入好友 -> 自動推播快速註冊會員卡片 (含「註冊會員」按鈕)
        await replyLineMessage(replyToken, [buildUnboundGuideFlex(lineUserId, displayName)]);
        continue;
      }

      const welcomeName = binding?.line_display_name || displayName;

      await replyLineMessage(replyToken, [
        {
          type: "text",
          text: `🎉 歡迎您加入智慧租屋管家系統！\n\n您好，${welcomeName}！您已成功連動 LINE 官方帳號服務。\n\n日後有任何新帳單、待繳費用產生或繳費確認，系統將在此為您進行即時推播通知！\n\n您可隨時點擊下方快捷按鈕查詢當前租屋資訊：`,
          quickReply: {
            items: [
              {
                type: "action",
                action: {
                  type: "message",
                  label: "📝 註冊會員",
                  text: "註冊會員"
                }
              },
              {
                type: "action",
                action: {
                  type: "message",
                  label: "📋 查詢當期帳單",
                  text: "帳單查詢"
                }
              },
              {
                type: "action",
                action: {
                  type: "message",
                  label: "📜 查詢租約狀況",
                  text: "租約狀況"
                }
              }
            ]
          }
        }
      ]);
      continue;
    }

    // -------------------------------------------------------------------------
    // A. 處理 POSTBACK 事件（按鈕回調）
    // -------------------------------------------------------------------------
    if (event.type === "postback") {
      const dataStr = event.postback?.data || "";
      const params = new URLSearchParams(dataStr);
      const action = params.get("action");

      if (action === "select_bill") {
        const title = decodeURIComponent(params.get("title") || "待繳帳單");
        const amount = params.get("amount") || "";
        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: `📌 已為您鎖定帳單：【${title}】\n應繳金額：NT$ ${Number(amount || 0).toLocaleString()}\n\n請直接在此輸入您的【轉帳末五碼】（5 位數字，例如直接輸入 88621）或是輸入「現金交付」，系統將自動為您完成回報對帳！`,
            quickReply: {
              items: [
                {
                  type: "action",
                  action: {
                    type: "message",
                    label: "💵 現金交付",
                    text: "現金交付"
                  }
                }
              ]
            }
          }
        ]);
        continue;
      }
    }

    // -------------------------------------------------------------------------
    // B. 處理 MESSAGE 事件 (文字 / 圖片)
    // -------------------------------------------------------------------------
    if (event.type === "message") {
      // 圖片訊息：提示收到轉帳憑證，請租客補上末五碼
      if (event.message?.type === "image") {
        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: "📷 已收到您的轉帳憑證截圖！\n\n請直接在下方回覆您的【轉帳末五碼】（5 位數字，例如：88621）或是輸入「現金交付」，系統將立即為您完成繳費回報，送交房東核帳！",
            quickReply: {
              items: [
                {
                  type: "action",
                  action: {
                    type: "message",
                    label: "💵 現金交付",
                    text: "現金交付"
                  }
                }
              ]
            }
          }
        ]);
        continue;
      }

      // 文字訊息
      if (event.message?.type === "text") {
        const text = event.message.text.trim();

        // 0. 優先處理「註冊 / 開通 / 會員」指令
        if (text === "註冊" || text === "註冊會員" || text.includes("註冊") || text.includes("開通") || text.includes("我要註冊") || text === "0") {
          const userProfile = await getLineUserProfile(lineUserId);
          const displayName = userProfile?.displayName || "租客朋友";
          await replyLineMessage(replyToken, [
            buildUnboundGuideFlex(lineUserId, displayName)
          ]);
          continue;
        }

        // 1. 帳號手動綁定指令: "綁定 <TOKEN>"
        if (text.startsWith("綁定") || text.toUpperCase().startsWith("BIND")) {
          const parts = text.split(/\s+/);
          const token = parts[1];

          if (!token || token.length < 6) {
            await replyLineMessage(replyToken, [
              { type: "text", text: "請輸入正確的綁定代碼格式：例如「綁定 A1B2C3D4」。請至租客系統個人中心取得 10 分鐘有效之安全驗證碼。" },
            ]);
            continue;
          }

          const { error } = await supabase.rpc("verify_and_bind_line", {
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
                text: "🎉 恭喜！您已成功綁定智慧租屋系統帳號！\n\n您可以隨時在此輸入：\n👉「租約狀況」：查看承租房源與起訖期間\n👉「待繳帳單」：檢視應繳租金與快捷回報\n👉「已繳金額」：查看歷史已繳款項與電子收據\n👉「匯款帳號」：取得房東收款銀行帳號",
              },
            ]);
          }
          continue;
        }

        // 2. 獲取租客資料庫上下文
        const context = await getTenantContext(supabase, lineUserId);
        if (!context) {
          const userProfile = await getLineUserProfile(lineUserId);
          const displayName = userProfile?.displayName || "租客朋友";
          await replyLineMessage(replyToken, [
            buildUnboundGuideFlex(lineUserId, displayName)
          ]);
          continue;
        }

        const leaseIds = context.leases.map((l: any) => l.id);

        // 3. 繳款回報判斷：轉帳後五碼偵測 (例如: "88621", "回報 88621") 或 現金交付 (例如: "現金交付", "現金")
        const last5Match = text.match(/(?:後五碼|末五碼|回報|轉帳)\s*(\d{5})\b|^\s*(\d{5})\s*$/);
        const isCash = /^(現金|現金交付|付現|現金繳費|現金支付|已付現金)$/i.test(text.replace(/\s+/g, '')) || text.includes("現金交付");

        if (last5Match || isCash) {
          const matchedLast5 = last5Match ? (last5Match[1] || last5Match[2]) : null;
          const reportMethod = isCash ? "現金交付" : "銀行轉帳";

          // 尋找此租約最近一筆待繳帳單 (pending)
          let targetPayment: any = null;
          if (leaseIds.length > 0) {
            const { data: pendingPayments } = await supabase
              .from("payments")
              .select("*")
              .in("lease_id", leaseIds)
              .eq("status", "pending")
              .is("deleted_at", null)
              .order("due_date", { ascending: true });

            if (pendingPayments && pendingPayments.length > 0) {
              targetPayment = pendingPayments[0];
            }
          }

          if (!targetPayment) {
            // 檢查是否已有審核中帳單
            const { data: submittedPayments } = await supabase
              .from("payments")
              .select("*")
              .in("lease_id", leaseIds)
              .in("status", ["tenant_submitted", "pending_approval"])
              .is("deleted_at", null);

            if (submittedPayments && submittedPayments.length > 0) {
              const prevTitle = getPaymentTitle(submittedPayments[0]);
              const prevDesc = submittedPayments[0].payment_method === '現金交付'
                ? '現金交付'
                : `轉帳末五碼：${submittedPayments[0].transfer_last5 || '已登記'}`;
              await replyLineMessage(replyToken, [
                {
                  type: "text",
                  text: `🔍 您先前已送交【${prevTitle}】之繳款回報（${prevDesc}），房東正在核對入帳中，請耐心等候開立收據！`
                }
              ]);
            } else {
              await replyLineMessage(replyToken, [
                {
                  type: "text",
                  text: "🎉 您目前沒有任何待繳納之帳單！感謝您的準時繳納。如需核對歷史紀錄，請輸入「已繳金額」。"
                }
              ]);
            }
            continue;
          }

          // 更新 payment 狀態為 tenant_submitted
          const todayStr = new Date().toISOString().split("T")[0];
          const { error: updateErr } = await supabase
            .from("payments")
            .update({
              status: "tenant_submitted",
              payment_method: reportMethod,
              transfer_last5: matchedLast5,
              paid_date: todayStr,
              updated_at: new Date().toISOString()
            })
            .eq("id", targetPayment.id);

          if (updateErr) {
            await replyLineMessage(replyToken, [
              { type: "text", text: `❌ 回報更新失敗：${updateErr.message || "請稍後再試或直接向房東反映。"}` }
            ]);
          } else {
            await replyLineMessage(replyToken, [
              buildReportSuccessFlex(targetPayment, matchedLast5, isCash)
            ]);
          }
          continue;
        }

        // 4. 指令分支：租約狀況
        if (text.includes("租約") || text.includes("合約") || text.includes("房源") || text.includes("入住") || text === "1") {
          if (!context.lease) {
            await replyLineMessage(replyToken, [
              { type: "text", text: "⚠️ 目前查無您生效中的租約資料。若已簽訂新約，請洽詢房東完成系統登記。" }
            ]);
          } else {
            await replyLineMessage(replyToken, [
              buildLeaseFlex(context.lease, context.property, context.landlord, context.profile)
            ]);
          }
          continue;
        }

        // 5. 指令分支：已繳金額／歷史收據
        if (text.includes("已繳") || text.includes("收據") || text.includes("繳款紀錄") || text === "3") {
          let paidPayments: any[] = [];
          let query = supabase
            .from("payments")
            .select("*")
            .eq("status", "paid")
            .is("deleted_at", null)
            .order("created_at", { ascending: false });

          if (leaseIds.length > 0) {
            query = query.in("lease_id", leaseIds);
          } else if (context.profile?.name) {
            query = query.eq("tenant_name", context.profile.name);
          }

          const { data: pData } = await query;
          paidPayments = pData || [];

          await replyLineMessage(replyToken, [
            buildPaidPaymentsFlex(paidPayments, context.profile)
          ]);
          continue;
        }

        // 6. 指令分支：待繳帳單
        if (text.includes("帳單") || text.includes("待繳") || text.includes("應繳") || text.includes("未繳") || text.includes("查詢") || text === "2") {
          let pendingPayments: any[] = [];
          if (leaseIds.length > 0) {
            const { data: pData } = await supabase
              .from("payments")
              .select("*")
              .in("lease_id", leaseIds)
              .in("status", ["pending", "pending_approval", "tenant_submitted"])
              .is("deleted_at", null)
              .order("due_date", { ascending: true });
            pendingPayments = pData || [];
          }

          await replyLineMessage(replyToken, [
            buildPendingBillsFlex(pendingPayments, context.profile)
          ]);
          continue;
        }

        // 7. 指令分支：回報繳費導覽
        if (text.includes("回報") || text.includes("繳款")) {
          let pendingPayments: any[] = [];
          if (leaseIds.length > 0) {
            const { data: pData } = await supabase
              .from("payments")
              .select("*")
              .in("lease_id", leaseIds)
              .eq("status", "pending")
              .is("deleted_at", null)
              .order("due_date", { ascending: true });
            pendingPayments = pData || [];
          }

          if (pendingPayments.length === 0) {
            await replyLineMessage(replyToken, [
              { type: "text", text: "🎉 您目前沒有待回報之未繳帳單！若已匯款且有其他款項，請直接傳送帳號後五碼或洽詢房東。" }
            ]);
          } else {
            await replyLineMessage(replyToken, [
              buildPendingBillsFlex(pendingPayments, context.profile),
              {
                type: "text",
                text: "💡 回報方式：請點選上方帳單卡片上的【📝 回報此筆繳款】，或直接在此回傳您的【轉帳末五碼】（例如輸入 88621），系統將自動送交房東核帳！"
              }
            ]);
          }
          continue;
        }

        // 8. 指令分支：匯款帳號／房東帳戶
        if (text.includes("匯款") || text.includes("帳戶") || text.includes("銀行") || text === "4") {
          await replyLineMessage(replyToken, [
            buildBankInfoFlex(context.landlord)
          ]);
          continue;
        }

        // 9. 預設回覆：主功能導覽選單
        const userProfile = await getLineUserProfile(lineUserId);
        const displayName = userProfile?.displayName || context?.profile?.name || "租客會員";
        await replyLineMessage(replyToken, [
          buildMenuFlex(context.profile, lineUserId, displayName)
        ]);
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
