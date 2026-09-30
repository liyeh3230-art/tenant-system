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
  if ((!bankName || !bankAccount) && landlord?.company_name) {
    try {
      const parsed = JSON.parse(landlord.company_name);
      if (parsed.bankName) bankName = parsed.bankName;
      if (parsed.bankAccount) bankAccount = parsed.bankAccount;
    } catch {}
  }
  return {
    bankName: bankName || "未填寫銀行名稱",
    bankAccount: bankAccount || "未填寫銀行帳號",
    landlordName: landlord?.name || "房東",
    landlordPhone: landlord?.phone || "未提供電話"
  };
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
                  { type: "text", text: "約定每月租金", size: "xxs", color: "#64748B" },
                  { type: "text", text: `NT$ ${Number(lease.monthly_rent || 0).toLocaleString()}`, size: "sm", weight: "bold", color: "#4F46E5" }
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
              { type: "text", text: `${bankInfo.landlordName} (${bankInfo.landlordPhone})`, size: "xs", color: "#334155", weight: "bold", flex: 7 }
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

// 2. 已繳金額與收據 Flex Message (支援多頁左右滑動 Carousel 卷軸)
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
            { type: "text", text: "智慧租屋 · 歷史繳費清單", color: "#A7F3D0", size: "xs", weight: "bold" },
            { type: "text", text: "已繳款項與電子收據", color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" }
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

  // 排序：最新新增或最新繳納的款項排在最前面
  const sortedPayments = [...payments].sort((a, b) => {
    const timeA = new Date(a.created_at || a.paid_date || 0).getTime();
    const timeB = new Date(b.created_at || b.paid_date || 0).getTime();
    if (timeA !== timeB) return timeB - timeA;
    const dateA = a.paid_date || a.due_date || "";
    const dateB = b.paid_date || b.due_date || "";
    return dateB.localeCompare(dateA);
  });

  const ITEMS_PER_PAGE = 4;
  const totalPages = Math.ceil(sortedPayments.length / ITEMS_PER_PAGE);

  const getCatIcon = (type: string) => {
    switch (type) {
      case "rent": return "🏠";
      case "deposit": return "🔒";
      case "utilities": return "⚡";
      case "management": return "🏢";
      default: return "📋";
    }
  };

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
          layout: "vertical",
          backgroundColor: "#ECFDF5",
          borderColor: "#A7F3D0",
          borderWidth: "1px",
          cornerRadius: "12px",
          paddingAll: "12px",
          contents: [
            { type: "text", text: "累計已核銷繳納總額", size: "xxs", color: "#065F46", weight: "bold" },
            { type: "text", text: `NT$ ${totalPaid.toLocaleString()}`, size: "xl", weight: "bold", color: "#047857", margin: "xs" },
            { type: "text", text: `共 ${sortedPayments.length} 筆已核銷 · 左右滑動可翻頁檢視`, size: "xxs", color: "#059669", margin: "xs" }
          ]
        },
        { type: "separator", margin: "md" }
      );
    }

    // 每一筆已繳費用清單
    pageItems.forEach((p, idx) => {
      const catIcon = getCatIcon(p.bill_type || p.billType || "rent");
      const title = p.title || "租金帳單";
      const amtStr = Number(p.amount || 0).toLocaleString();
      const paidDate = p.paid_date || p.due_date || "已結清";
      const last5 = p.transfer_last5 ? `末五碼：${p.transfer_last5}` : "✅ 已核銷入帳";

      bodyContents.push({
        type: "box",
        layout: "vertical",
        margin: idx > 0 || isFirstPage ? "md" : "none",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            alignItems: "center",
            contents: [
              {
                type: "text",
                text: `${catIcon} ${title}`,
                size: "xs",
                weight: "bold",
                color: "#1E293B",
                flex: 1,
                wrap: true
              },
              {
                type: "text",
                text: `NT$ ${amtStr}`,
                size: "sm",
                weight: "bold",
                color: "#059669",
                align: "end"
              }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            margin: "xs",
            contents: [
              {
                type: "text",
                text: `繳納日：${paidDate}`,
                size: "xxs",
                color: "#64748B"
              },
              {
                type: "text",
                text: last5,
                size: "xxs",
                color: "#10B981",
                weight: "bold"
              }
            ]
          }
        ]
      });

      if (idx < pageItems.length - 1) {
        bodyContents.push({ type: "separator", margin: "sm" });
      }
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
          action: { type: "message", label: "📝 回報繳款", text: "回報繳費" }
        }
      ]
    });

    return {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: isFirstPage ? "#059669" : "#0D9488",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: isFirstPage ? "智慧租屋 · 歷史繳費清單" : "智慧租屋 · 前期繳費存根",
            color: isFirstPage ? "#A7F3D0" : "#99F6E4",
            size: "xs",
            weight: "bold"
          },
          {
            type: "text",
            text: isFirstPage ? "最新已繳核銷款項" : `歷史繳款存根 (頁 ${pageIndex + 1})`,
            color: "#FFFFFF",
            size: "xl",
            weight: "bold",
            margin: "xs"
          },
          {
            type: "text",
            text: `● 顯示第 ${startIdx + 1} ~ ${startIdx + pageItems.length} 筆 · 共 ${sortedPayments.length} 筆 (頁 ${pageIndex + 1}/${totalPages})`,
            color: isFirstPage ? "#A7F3D0" : "#CCFBF1",
            size: "xs",
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

  // 若只有 1 頁（<= 4 筆），以單卡呈現
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

// 3. 待繳帳單 Flex Message
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

  const billBoxes: any[] = [];
  payments.forEach((p, idx) => {
    const isSubmitted = (p.status === "tenant_submitted" || p.status === "pending_approval");
    billBoxes.push({
      type: "box",
      layout: "vertical",
      backgroundColor: isSubmitted ? "#F8FAFC" : "#FFFBEB",
      borderColor: isSubmitted ? "#CBD5E1" : "#FDE68A",
      borderWidth: "1px",
      cornerRadius: "12px",
      paddingAll: "12px",
      margin: idx > 0 ? "md" : "none",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          justifyContent: "space-between",
          contents: [
            { type: "text", text: p.title || "租金帳單", size: "sm", weight: "bold", color: "#1E293B", flex: 1, wrap: true },
            { type: "text", text: `NT$ ${Number(p.amount || 0).toLocaleString()}`, size: "sm", weight: "bold", color: isSubmitted ? "#475569" : "#D97706", align: "end" }
          ]
        },
        {
          type: "box",
          layout: "horizontal",
          justifyContent: "space-between",
          margin: "xs",
          contents: [
            { type: "text", text: `到期日：${p.due_date || '依約定'}`, size: "xs", color: "#64748B" },
            {
              type: "text",
              text: isSubmitted ? `🔍 核帳中 (${p.transfer_last5 || '已報'})` : "⏳ 尚未繳納",
              size: "xs",
              weight: "bold",
              color: isSubmitted ? "#3B82F6" : "#DC2626"
            }
          ]
        },
        !isSubmitted ? {
          type: "button",
          style: "primary",
          color: "#D97706",
          height: "sm",
          margin: "sm",
          action: {
            type: "postback",
            label: "📝 回報此筆繳款",
            data: `action=select_bill&id=${p.id}&title=${encodeURIComponent(p.title || '租金帳單')}&amount=${p.amount}`
          }
        } : {
          type: "text",
          text: "房東正在核對銀行入帳中，請耐心等候開立收據。",
          size: "xxs",
          color: "#64748B",
          margin: "xs"
        }
      ]
    });
  });

  return {
    type: "flex",
    altText: `📋 您有 ${payments.length} 筆待繳帳單，請查看明細`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#D97706",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "智慧租屋 · 待繳納帳單", color: "#FEF3C7", size: "xs", weight: "bold" },
          { type: "text", text: `待處理帳單 (共 ${payments.length} 筆)`, color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" }
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
        layout: "horizontal",
        spacing: "sm",
        paddingAll: "14px",
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
      }
    }
  };
}

// 4. 回報成功 Flex Message
function buildReportSuccessFlex(payment: any, last5: string) {
  return {
    type: "flex",
    altText: `🎉 繳款回報成功：${payment?.title || '租金帳單'} (末五碼 ${last5})`,
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
            contents: [
              { type: "text", text: "回報項目", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: payment?.title || "租金帳單", size: "xs", color: "#1E293B", weight: "bold", wrap: true, flex: 7 }
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
              { type: "text", text: "轉帳末五碼", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `●●●●● ${last5}`, size: "xs", color: "#1E293B", weight: "bold", flex: 7 }
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
            text: "💡 房東核對入帳後，系統將自動開立電子收據，並自尚餘租金中扣減。",
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
              { type: "text", text: "戶名／房東", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `${bank.landlordName} (${bank.landlordPhone})`, size: "xs", color: "#0F172A", weight: "bold", flex: 7 }
            ]
          },
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

// 6. 主功能導覽選單 Flex Message
function buildMenuFlex(profile: any) {
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
          { type: "text", text: `您好，${profile?.name || '租客會員'}！`, color: "#C7D2FE", size: "xs", weight: "bold" },
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
            text: "💡 提示：若已完成轉帳，可直接輸入「末五碼 12345」快速回報！",
            size: "xxs",
            color: "#64748B",
            wrap: true,
            margin: "xs"
          }
        ]
      }
    }
  };
}

// 7. 未綁定帳號提示 Flex Message
function buildUnboundGuideFlex() {
  return {
    type: "flex",
    altText: "⚠️ 您的 LINE 帳號尚未綁定租客身分",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#6366F1",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "智慧租屋 · 會員綁定指引", color: "#E0E7FF", size: "xs", weight: "bold" },
          { type: "text", text: "尚未綁定租客身分", color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          { type: "text", text: "歡迎使用智慧租屋 LINE 服務小幫手！", size: "sm", color: "#1E293B", weight: "bold" },
          { type: "text", text: "請透過以下任一方式完成帳號綁定，即可隨時查閱租約與帳單：", size: "xs", color: "#64748B" },
          { type: "separator", margin: "sm" },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            margin: "sm",
            contents: [
              { type: "text", text: "👉 方式 1：登入網站點「LINE 登入」", size: "xs", color: "#4F46E5", weight: "bold" },
              { type: "text", text: "於租客系統登入頁面點選 LINE 登入，系統將自動無縫完成帳號綁定。", size: "xxs", color: "#64748B" }
            ]
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            margin: "sm",
            contents: [
              { type: "text", text: "👉 方式 2：輸入綁定驗證碼", size: "xs", color: "#4F46E5", weight: "bold" },
              { type: "text", text: "至租客系統個人中心取得 6 碼驗證代碼，並於此輸入「綁定 <代碼>」（例如：綁定 A1B2C3）。", size: "xxs", color: "#64748B" }
            ]
          }
        ]
      }
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
    // A. 處理 POSTBACK 事件（按鈕回調）
    // -------------------------------------------------------------------------
    if (event.type === "postback") {
      const dataStr = event.postback?.data || "";
      const params = new URLSearchParams(dataStr);
      const action = params.get("action");

      if (action === "select_bill") {
        const title = decodeURIComponent(params.get("title") || "租金帳單");
        const amount = params.get("amount") || "";
        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: `📌 已為您鎖定帳單：【${title}】\n應繳金額：NT$ ${Number(amount || 0).toLocaleString()}\n\n請直接在此輸入您的【轉帳末五碼】（5 位數字，例如直接輸入 88621），系統將自動為您完成回報對帳！`
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
            text: "📷 已收到您的轉帳憑證截圖！\n\n請直接在下方回覆您的【轉帳末五碼】（5 位數字，例如：88621），系統將立即為您完成繳費回報，送交房東核帳！"
          }
        ]);
        continue;
      }

      // 文字訊息
      if (event.message?.type === "text") {
        const text = event.message.text.trim();

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
          await replyLineMessage(replyToken, [buildUnboundGuideFlex()]);
          continue;
        }

        const leaseIds = context.leases.map((l: any) => l.id);

        // 3. 繳款回報後五碼偵測 (例如: "88621", "回報 88621", "末五碼 88621")
        const last5Match = text.match(/(?:後五碼|末五碼|回報|轉帳)\s*(\d{5})\b|^\s*(\d{5})\s*$/);
        if (last5Match) {
          const matchedLast5 = last5Match[1] || last5Match[2];

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
              await replyLineMessage(replyToken, [
                {
                  type: "text",
                  text: `🔍 您先前已送交【${submittedPayments[0].title}】之繳款回報（末五碼：${submittedPayments[0].transfer_last5 || '已登記'}），房東正在核對入帳中，請耐心等候開立收據！`
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
              buildReportSuccessFlex(targetPayment, matchedLast5)
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
          if (leaseIds.length > 0) {
            const { data: pData } = await supabase
              .from("payments")
              .select("*")
              .in("lease_id", leaseIds)
              .eq("status", "paid")
              .is("deleted_at", null)
              .order("created_at", { ascending: false });
            paidPayments = pData || [];
          }

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
        await replyLineMessage(replyToken, [
          buildMenuFlex(context.profile)
        ]);
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
