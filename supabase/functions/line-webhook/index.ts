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

// 記憶體快取：紀錄每位租客最新鎖定之待繳帳單 (有效期限 1 小時)
const lockedBillsByUser = new Map<string, { billId: string; timestamp: number }>();

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

// Helper: 統一費用項目呈現格式（例："租金 (10月份)", "電費 (2月份)", "押金"）
function formatFeeItemName(title?: string | null, billType?: string | null, dueDate?: string | null): string {
  const typeMap: Record<string, string> = {
    rent: '租金',
    deposit: '押金',
    electricity: '電費',
    power: '電費',
    water: '水費',
    gas: '瓦斯費',
    utilities: '水電瓦斯',
    management: '管理費',
    parking: '車位費',
    maintenance: '修繕費',
    repair: '修繕費',
    other: '雜支'
  };

  const bType = String(billType || '').toLowerCase().trim();
  let baseType = typeMap[bType] || '費用';
  const raw = (title || '').trim();

  // 若屬綜合水電或雜支，依字樣細分基底
  if (bType === 'utilities' || bType === 'other') {
    if (raw.includes('電')) baseType = '電費';
    else if (raw.includes('水')) baseType = '水費';
    else if (raw.includes('瓦斯')) baseType = '瓦斯費';
    else if (raw.includes('管理')) baseType = '管理費';
    else if (raw.includes('租金')) baseType = '租金';
    else if (raw.includes('押金')) baseType = '押金';
    else if (raw.includes('車位')) baseType = '車位費';
    else if (raw.includes('修繕') || raw.includes('維修')) baseType = '修繕費';
  }

  // 若已經是統一格式 "項目 (期別/說明)"
  const alreadyFormatted = raw.match(/^([^\(\)]+)\s*\((.+)\)$/);
  if (alreadyFormatted) {
    let normMain = alreadyFormatted[1].trim();
    const subPart = alreadyFormatted[2].trim();
    if (normMain === '房屋租金') normMain = '租金';
    if (normMain === '用電費用') normMain = '電費';
    if (normMain === '大樓管理費') normMain = '管理費';
    if (normMain === '押金保證金') normMain = '押金';
    const subNumMatch = subPart.match(/^([0-9]{1,2})$/);
    if (subNumMatch) {
      return `${normMain} (${subNumMatch[1]}月份)`;
    }
    return `${normMain} (${subPart})`;
  }

  // 若以月份數字開頭，例 "10", "10月份", "11電費", "2月"
  const monthLeadMatch = raw.match(/^([0-9]{1,2})(.*)$/);
  if (monthLeadMatch) {
    const num = monthLeadMatch[1];
    const rest = monthLeadMatch[2].replace(/[\s月(份)?]/g, '');
    let resolvedBase = baseType;
    if (rest.includes('電') || bType === 'electricity') resolvedBase = '電費';
    else if (rest.includes('水') || bType === 'water') resolvedBase = '水費';
    else if (rest.includes('瓦斯') || bType === 'gas') resolvedBase = '瓦斯費';
    else if (rest.includes('租') || bType === 'rent') resolvedBase = '租金';
    else if (rest.includes('管') || bType === 'management') resolvedBase = '管理費';
    const cleanRest = rest.replace(/(?:電費|水費|瓦斯費|租金|管理費|費用)/g, '').trim();
    if (cleanRest) {
      return `${resolvedBase} (${num}月份 · ${cleanRest})`;
    }
    return `${resolvedBase} (${num}月份)`;
  }

  // 若包含月份字樣，例 "10月份租金", "9月份電費", "租金10月份"
  const combinedMatch = raw.match(/([0-9]{1,2})\s*月(?:份)?/);
  if (combinedMatch) {
    const mStr = `${combinedMatch[1]}月份`;
    const cleanSub = raw.replace(/([0-9]{1,2})\s*月(?:份)?/, '').replace(/[\s\-_/]/g, '');
    if (!cleanSub || cleanSub === baseType || cleanSub === '租金' || cleanSub === '電費' || cleanSub === '水費' || cleanSub === '瓦斯費' || cleanSub === '管理費' || cleanSub === '房屋租金') {
      return `${baseType} (${mStr})`;
    } else {
      return `${baseType} (${mStr} · ${cleanSub})`;
    }
  }

  // 若未填寫，自動依據期限或建立日推導期別月份
  if (!raw) {
    if (dueDate && ['rent', 'electricity', 'power', 'water', 'gas', 'utilities', 'management'].includes(bType)) {
      const d = new Date(dueDate);
      if (!isNaN(d.getTime())) {
        const m = d.getMonth() + 1;
        return `${baseType} (${m}月份)`;
      }
    }
    return baseType;
  }

  // 若與基底相同直接回傳
  if (raw === baseType || raw === '押金保證金' || raw === '房屋租金' || raw === '大樓管理費') {
    return baseType;
  }

  return `${baseType} (${raw})`;
}

// Helper: 取得款項項目正確名稱（優先使用自訂標題，全系統統一呈現：如「租金 (10月份)」、「電費 (2月份)」、「押金」）
function getPaymentTitle(payment: any): string {
  return formatFeeItemName(payment?.title, payment?.bill_type || payment?.billType, payment?.due_date || payment?.paid_date);
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

  const tenantName = lease.tenant_name || lease.tenantName || profile?.name || "租客";
  const tenantPhone = lease.phone || profile?.phone || "未提供電話";
  const rawCoName = String(lease.co_tenant_name || lease.coTenantName || "").trim();
  const coTenantName = (rawCoName === "null" || rawCoName === "undefined" || rawCoName === "無" || rawCoName === "無同住人") ? "" : rawCoName;
  const rawCoPhone = String(lease.co_phone || lease.coPhone || "").trim();
  const coTenantPhone = (rawCoPhone === "null" || rawCoPhone === "undefined" || rawCoPhone === "無") ? "" : rawCoPhone;
  const hasCoTenant = !!coTenantName || !!coTenantPhone;
  const coTenantDisplay = (coTenantName && coTenantPhone)
    ? `${coTenantName} (${coTenantPhone})`
    : (coTenantName || coTenantPhone);

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
            alignItems: "flex-start",
            contents: [
              { type: "text", text: "👤 出租甲方", size: "xs", color: "#64748B", flex: 4, wrap: true },
              { type: "text", text: `${landlord?.name || bankInfo.landlordName || '房東'} (${landlord?.phone || bankInfo.landlordPhone || '未提供電話'})`, size: "xs", color: "#334155", weight: "bold", wrap: true, flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            alignItems: "flex-start",
            contents: [
              { type: "text", text: "👤 承租乙方", size: "xs", color: "#64748B", flex: 4, wrap: true },
              { type: "text", text: `${tenantName} (${tenantPhone})`, size: "xs", color: "#334155", weight: "bold", wrap: true, flex: 7 }
            ]
          },
          ...(hasCoTenant ? [
            {
              type: "box",
              layout: "horizontal",
              alignItems: "flex-start",
              contents: [
                { type: "text", text: "👥 同住承租人", size: "xs", color: "#64748B", flex: 4, wrap: true },
                { type: "text", text: coTenantDisplay, size: "xs", color: "#334155", weight: "bold", wrap: true, flex: 7 }
              ]
            }
          ] : [])
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

  // 排序：依確認入帳時間 (updated_at) 遞減，最後確認的在最上面
  const getPaidSortTimestamp = (item: any) => {
    if (item.updated_at) {
      const t = new Date(item.updated_at).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (item.paid_date) {
      const t = new Date(item.paid_date).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (item.created_at) {
      const t = new Date(item.created_at).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (typeof item.id === 'string') {
      const digits = item.id.replace(/\D/g, '');
      if (digits.length >= 10) {
        const t = parseInt(digits.substring(0, 13), 10);
        if (!isNaN(t) && t > 1000000000000) return t;
      }
    }
    return 0;
  };

  const sortedPayments = [...payments].sort((a, b) => {
    const timeA = getPaidSortTimestamp(a);
    const timeB = getPaidSortTimestamp(b);
    if (timeA !== timeB) return timeB - timeA;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });

  const ITEMS_PER_PAGE = 5; // 每頁 5 筆，簡約收據直覺清單呈現，一目了然
  const totalPages = Math.ceil(sortedPayments.length / ITEMS_PER_PAGE);

  const buildPageBubble = (pageIndex: number) => {
    const startIdx = pageIndex * ITEMS_PER_PAGE;
    const pageItems = sortedPayments.slice(startIdx, startIdx + ITEMS_PER_PAGE);
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === totalPages - 1;

    const bodyContents: any[] = [];

    // 第一頁顯示累計已繳總額概況看板（上下雙層排版，金額獨立整行寬敞展示，永不截斷）
    if (isFirstPage) {
      bodyContents.push(
        {
          type: "box",
          layout: "vertical",
          backgroundColor: "#ECFDF5",
          cornerRadius: "12px",
          paddingAll: "14px",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              justifyContent: "space-between",
              alignItems: "center",
              contents: [
                {
                  type: "box",
                  layout: "horizontal",
                  alignItems: "center",
                  spacing: "xs",
                  contents: [
                    { type: "text", text: "📊", size: "xs", flex: 0 },
                    { type: "text", text: "累計已核銷總額", size: "xs", color: "#065F46", weight: "bold", flex: 0 }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  backgroundColor: "#D1FAE5",
                  cornerRadius: "10px",
                  paddingStart: "8px",
                  paddingEnd: "8px",
                  paddingTop: "3px",
                  paddingBottom: "3px",
                  contents: [
                    {
                      type: "text",
                      text: `共 ${sortedPayments.length} 筆已結清`,
                      size: "xxs",
                      color: "#047857",
                      weight: "bold"
                    }
                  ]
                }
              ]
            },
            {
              type: "box",
              layout: "baseline",
              margin: "sm",
              spacing: "xs",
              contents: [
                {
                  type: "text",
                  text: "NT$",
                  size: "sm",
                  color: "#047857",
                  weight: "bold",
                  flex: 0
                },
                {
                  type: "text",
                  text: totalPaid.toLocaleString(),
                  size: "xxl",
                  color: "#047857",
                  weight: "bold",
                  wrap: true,
                  flex: 1
                }
              ]
            }
          ]
        },
        { type: "separator", margin: "md" }
      );
    }

    // 每一筆已繳費用清單（簡潔俐落清單：費用項目、金額、日期、方式，一目了然，去除多餘框框）
    pageItems.forEach((p, idx) => {
      const cat = getCategoryMeta(p.bill_type || p.billType);
      const itemTitle = getPaymentTitle(p);
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

  // 1. 統計待繳總額並排序（依開立時間遞減排序，最後開立的排在最上面）
  const totalPending = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const todayStr = new Date().toISOString().split("T")[0];

  const getPendingSortTimestamp = (item: any) => {
    if (item.created_at) {
      const t = new Date(item.created_at).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (typeof item.id === 'string') {
      const digits = item.id.replace(/\D/g, '');
      if (digits.length >= 10) {
        const t = parseInt(digits.substring(0, 13), 10);
        if (!isNaN(t) && t > 1000000000000) return t;
      }
    }
    if (item.due_date) {
      const t = new Date(item.due_date).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    return 0;
  };

  const sortedPayments = [...payments].sort((a, b) => {
    const timeA = getPendingSortTimestamp(a);
    const timeB = getPendingSortTimestamp(b);
    if (timeA !== timeB) return timeB - timeA;
    return String(b.id || "").localeCompare(String(a.id || ""));
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
                text: (p.payment_method === '現金交付' || String(p.payment_method || '').includes('現金'))
                  ? "🔍 已回報 [現金交付]，房東核對入帳中"
                  : (p.transfer_last5
                    ? `🔍 已回報末五碼 [${p.transfer_last5}]，房東核對入帳中`
                    : "🔍 已回報，房東核對入帳中"),
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

// 4-1. 鎖定待繳帳單 Flex Message (仿網頁版雙管道繳費樣式)
function buildLockedBillFlex(payment: any, landlord: any, fallbackTitle?: string, fallbackAmount?: string | number) {
  const cat = getCategoryMeta(payment?.bill_type || payment?.billType);
  const displayTitle = payment ? getPaymentTitle(payment) : (fallbackTitle || "待繳帳單");
  const rawAmt = payment?.amount !== undefined ? payment.amount : (fallbackAmount || 0);
  const amountStr = Number(rawAmt).toLocaleString();
  const dueDateClean = payment?.due_date ? String(payment.due_date).split("T")[0] : "";
  const bank = parseLandlordBank(landlord);
  const cleanAccount = bank.bankAccount ? bank.bankAccount.replace(/[\s-]/g, "") : "";
  const hasBank = !!(bank.bankAccount && bank.bankAccount !== "未填寫銀行帳號");

  return {
    type: "flex",
    altText: `📌 已為您鎖定帳單：【${displayTitle}】NT$ ${amountStr}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#312E81", // Indigo 900 典雅深靛藍
        paddingAll: "18px",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            justifyContent: "space-between",
            alignItems: "center",
            contents: [
              { type: "text", text: "智慧租屋 · 帳單繳款回報", color: "#C7D2FE", size: "xs", weight: "bold" },
              {
                type: "box",
                layout: "horizontal",
                backgroundColor: cat.bg,
                borderColor: cat.border,
                borderWidth: "1px",
                cornerRadius: "6px",
                paddingStart: "8px",
                paddingEnd: "8px",
                paddingTop: "2px",
                paddingBottom: "2px",
                contents: [
                  { type: "text", text: `${cat.icon} ${cat.label}`, size: "xxs", color: cat.color, weight: "bold" }
                ]
              }
            ]
          },
          {
            type: "text",
            text: "📌 已鎖定繳款帳單",
            color: "#FFFFFF",
            size: "xl",
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
          // 1. 帳單明細焦點區塊 (仿網頁版頂部項目與金額)
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#F8FAFC",
            cornerRadius: "12px",
            paddingAll: "14px",
            borderColor: "#E2E8F0",
            borderWidth: "1px",
            contents: [
              {
                type: "text",
                text: displayTitle,
                size: "md",
                weight: "bold",
                color: "#1E293B",
                wrap: true
              },
              {
                type: "box",
                layout: "baseline",
                spacing: "xs",
                margin: "sm",
                contents: [
                  { type: "text", text: "應繳金額", size: "xs", color: "#64748B", flex: 0 },
                  { type: "text", text: "NT$", size: "sm", color: "#4F46E5", weight: "bold", flex: 0 },
                  { type: "text", text: ` ${amountStr}`, size: "xxl", color: "#4F46E5", weight: "bold", flex: 1 }
                ]
              },
              ...(dueDateClean ? [
                {
                  type: "text",
                  text: `📅 繳費期限：${dueDateClean}`,
                  size: "xs",
                  color: "#64748B",
                  margin: "xs"
                }
              ] : [])
            ]
          },

          // 2. 管道一：銀行轉帳 (ATM / 網路網銀轉帳)
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#EEF2FF",
            cornerRadius: "12px",
            paddingAll: "14px",
            borderColor: "#C7D2FE",
            borderWidth: "1px",
            spacing: "xs",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                alignItems: "center",
                contents: [
                  { type: "text", text: "🏦 管道 1：銀行轉帳 (ATM / 網銀)", size: "xs", color: "#3730A3", weight: "bold" }
                ]
              },
              ...(hasBank ? [
                {
                  type: "box",
                  layout: "horizontal",
                  margin: "sm",
                  contents: [
                    { type: "text", text: "收款銀行", size: "xs", color: "#6366F1", flex: 3 },
                    { type: "text", text: bank.bankName, size: "xs", color: "#1E1B4B", weight: "bold", flex: 7 }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "text", text: "收款帳號", size: "xs", color: "#6366F1", flex: 3 },
                    { type: "text", text: bank.bankAccount, size: "sm", color: "#4338CA", weight: "bold", flex: 7 }
                  ]
                },
                {
                  type: "box",
                  layout: "horizontal",
                  contents: [
                    { type: "text", text: "帳戶戶名", size: "xs", color: "#6366F1", flex: 3 },
                    { type: "text", text: bank.accountName || bank.landlordName, size: "xs", color: "#1E1B4B", weight: "bold", flex: 7 }
                  ]
                },
                ...(bank.note ? [
                  {
                    type: "box",
                    layout: "horizontal",
                    contents: [
                      { type: "text", text: "轉帳備註", size: "xs", color: "#6366F1", flex: 3 },
                      { type: "text", text: bank.note, size: "xs", color: "#475569", wrap: true, flex: 7 }
                    ]
                  }
                ] : [])
              ] : [
                {
                  type: "text",
                  text: "房東尚未設定收款銀行帳號，若已線下取得帳號並匯款，請直接填報末五碼以供對帳。",
                  size: "xxs",
                  color: "#6366F1",
                  wrap: true,
                  margin: "xs"
                }
              ]),
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#FFFFFF",
                cornerRadius: "8px",
                paddingAll: "8px",
                margin: "sm",
                contents: [
                  {
                    type: "text",
                    text: "👉 轉帳後：請在此直接輸入【末五碼】（5 位數字，例如輸入 88621），系統將自動完成回報對帳！",
                    size: "xxs",
                    color: "#4338CA",
                    wrap: true,
                    weight: "bold"
                  }
                ]
              }
            ]
          },

          // 3. 管道二：現金交付指引
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#ECFDF5",
            cornerRadius: "12px",
            paddingAll: "14px",
            borderColor: "#A7F3D0",
            borderWidth: "1px",
            spacing: "xs",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                alignItems: "center",
                contents: [
                  { type: "text", text: "💵 管道 2：現金交付 (現場繳交)", size: "xs", color: "#065F46", weight: "bold" }
                ]
              },
              {
                type: "text",
                text: "請將現金款項親自交付房東收取。送出繳費回報後，房東點交確認收到即可核准入帳並開立電子收據憑單。",
                size: "xxs",
                color: "#047857",
                wrap: true,
                margin: "xs"
              }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "14px",
        contents: [
          // 現金回報快捷按鈕
          {
            type: "button",
            style: "primary",
            color: "#059669",
            height: "sm",
            action: {
              type: "postback",
              label: "💵 現金交付",
              data: `action=report_cash&id=${payment?.id || ""}&title=${encodeURIComponent(displayTitle)}&amount=${rawAmt}`
            }
          },
          // 複製帳號按鈕（若有帳號）
          ...(cleanAccount ? [
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: {
                type: "clipboard",
                label: "📋 複製收款帳號",
                clipboardText: cleanAccount
              }
            }
          ] : []),
          // 返回待繳帳單
          {
            type: "button",
            style: "link",
            height: "sm",
            action: {
              type: "message",
              label: "⏳ 返回待繳帳單清單",
              text: "待繳帳單"
            }
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
            label: "💵 現金交付",
            text: "現金交付"
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
            label: "🏦 匯款帳號",
            text: "匯款帳號"
          }
        }
      ]
    }
  };
}

// 5-0. 無租約提示 Flex Message (依合約安全保護房東約定收款資訊)
function buildNoLeaseBankInfoFlex(profile: any) {
  const userName = profile?.name || "租客";
  return {
    type: "flex",
    altText: "⚠️ 尚未簽訂租賃合約 - 目前無約定匯款帳號",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#D97706", // Amber 600 醒目暖橘色
        paddingAll: "18px",
        contents: [
          { type: "text", text: "智慧租屋 · 匯款帳號查詢", color: "#FEF3C7", size: "xs", weight: "bold" },
          { type: "text", text: "⚠️ 尚未簽訂租賃合約", color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: `${userName} 您好：`,
            size: "sm",
            weight: "bold",
            color: "#1E293B"
          },
          {
            type: "text",
            text: "系統目前查無您生效中的租賃合約資料。依租約安全規範，只有在雙方正式簽署合約後，系統才會為您顯示該合約所屬房東的約定轉帳資訊。",
            size: "xs",
            color: "#475569",
            wrap: true,
            lineSpacing: "4px"
          },
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#FFFBEB",
            borderColor: "#FDE68A",
            borderWidth: "1px",
            cornerRadius: "8px",
            paddingAll: "12px",
            margin: "md",
            contents: [
              {
                type: "text",
                text: "💡 溫馨提醒：若您已與房東完成簽約，請請房東於管理系統確認合約啟用並登記您的手機號碼，系統將即時為您開通專屬匯款帳戶與帳單明細！",
                size: "xs",
                color: "#92400E",
                wrap: true,
                lineSpacing: "3px"
              }
            ]
          }
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
            color: "#4F46E5",
            height: "sm",
            action: { type: "message", label: "📋 查詢我的租約", text: "我的租約" }
          }
        ]
      }
    }
  };
}

// 5. 房東帳號 Flex Message
function buildBankInfoFlex(landlord: any) {
  if (!landlord) {
    return buildNoLeaseBankInfoFlex(null);
  }
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


// -----------------------------------------------------------------------------
// DUAL-ROLE RICH MENU & LINE MESSAGING API CONSTANTS (3-TIER ARCHITECTURE)
// -----------------------------------------------------------------------------
const TENANT_STANDARD_RICH_MENU_ID = "richmenu-cfddd338cb4c727d0ac9c86274615a2a"; // 純租客專屬選單（第 6 格：點選發送 postback「申請成為房東」，跳出 LINE 申請導引卡片）
const TENANT_DUAL_RICH_MENU_ID = "richmenu-807a761a05e49395cbc09886f5cda6e7";     // 雙身分租客選單（第 6 格：切換為房東）
const LANDLORD_RICH_MENU_ID = "richmenu-0cf19bf04cf49c2df9b24f69c2cfa5b0";        // 房東經營選單（第 6 格：切換為租客）
const LIFF_LANDLORD_APPLICATION_URL = Deno.env.get("LIFF_LANDLORD_APPLICATION_URL") || Deno.env.get("LIFF_APPLY_LANDLORD_URL") || "https://liff.line.me/2011231660-Jgip7AQv";

// Helper to push message to a specific LINE User ID
async function pushLineMessage(to: string, messages: any[]): Promise<Response> {
  return await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to,
      messages,
    }),
  });
}

// Helper to link a user to a specific Rich Menu on LINE API
async function linkUserRichMenu(userId: string, richMenuId: string): Promise<Response> {
  return await fetch(`https://api.line.me/v2/bot/user/${userId}/richmenu/${richMenuId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
  });
}

// -----------------------------------------------------------------------------
// SMART QUICK REPLY BUILDER (DUAL-TRACK: RICH MENU + FLOATING ACTION BUTTONS)
// -----------------------------------------------------------------------------
function buildSmartQuickReply(role: string = "tenant", isLandlord: boolean = false) {
  if (role === "landlord") {
    return {
      items: [
        {
          type: "action",
          action: { type: "message", label: "📊 經營概況", text: "經營概況" }
        },
        {
          type: "action",
          action: { type: "message", label: "⏳ 待核帳單", text: "待核帳單" }
        },
        {
          type: "action",
          action: { type: "message", label: "🏠 房源現況", text: "房源現況" }
        },
        {
          type: "action",
          action: { type: "message", label: "📋 租客名冊", text: "租客名冊" }
        },
        {
          type: "action",
          action: { type: "postback", label: "🔄 切換租客", data: "action=switch_role&target=tenant", displayText: "🔄 切換為租客模式" }
        }
      ]
    };
  }

  // 租客模式：依據是否有房東權限，動態呈現「切換為房東」或「申請成為房東」
  const roleButton = isLandlord
    ? { type: "action", action: { type: "postback", label: "🔄 切換為房東", data: "action=switch_role&target=landlord", displayText: "🔄 切換為房東模式" } }
    : { type: "action", action: { type: "message", label: "📝 申請成為房東", text: "申請成為房東" } };

  return {
    items: [
      {
        type: "action",
        action: { type: "message", label: "⏳ 待繳帳單", text: "待繳帳單" }
      },
      {
        type: "action",
        action: { type: "message", label: "📋 我的租約", text: "租約狀況" }
      },
      {
        type: "action",
        action: { type: "message", label: "💰 已繳金額", text: "已繳金額" }
      },
      {
        type: "action",
        action: { type: "message", label: "🏦 匯款帳號", text: "匯款帳號" }
      },
      roleButton
    ]
  };
}

// -----------------------------------------------------------------------------
// LANDLORD FLEX MESSAGE BUILDERS
// -----------------------------------------------------------------------------

// 1. 申請成為房東專屬導引卡片 (含一鍵跳出申請表單，支援 LIFF 內嵌彈窗與動態狀態識別)
function buildLandlordApplicationGuideFlex(userCtx: any, fallbackLineUserId: string = "") {
  const cleanBase = (SITE_URL || "https://liyeh3230-art.github.io/tenant-system").replace(/\/$/, "");
  const phone = userCtx?.cleanPhone || "";
  const name = userCtx?.userName || "";
  const lineUid = userCtx?.lineUserId || fallbackLineUserId || "";
  const appStatus = userCtx?.landlordApplicationStatus || "";
  const queryParams = `mode=apply_landlord&phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&uid=${encodeURIComponent(lineUid)}&_t=${Date.now()}`;

  // 優先使用 LIFF 內嵌彈窗網址 (若有配置 LIFF_LANDLORD_APPLICATION_URL)
  let applyUrl = `${cleanBase}/?${queryParams}`;
  if (LIFF_LANDLORD_APPLICATION_URL) {
    applyUrl = LIFF_LANDLORD_APPLICATION_URL.includes("?")
      ? `${LIFF_LANDLORD_APPLICATION_URL}&${queryParams}`
      : `${LIFF_LANDLORD_APPLICATION_URL}?${queryParams}`;
  }

  const isPending = appStatus === "pending";
  const isRejected = appStatus === "rejected";

  const headerBg = isPending ? "#78350F" : isRejected ? "#881337" : "#1E1B4B";
  const headerSubtitle = isPending
    ? "⏳ 房東申請審核中 (Pending)"
    : isRejected
    ? "❌ 房東申請未通過 (Rejected)"
    : "智慧租屋 · 房東權限開通申請";
  const headerTitle = isPending
    ? "⏳ 房東申請審核中"
    : isRejected
    ? "❌ 房東申請未通過"
    : "📝 申請成為房東";
  const headerDesc = isPending
    ? "管理員正在查核身分，可點選下方查看進度"
    : isRejected
    ? "資料需要修正，可點選下方查看原因並重新送審"
    : "享有智慧物業管理 · 一鍵對帳 · 即時催繳";

  let statusText = "租客 (未申請房東身分)";
  let statusColor = "#64748B";

  if (isPending) {
    statusText = "租客 (房東審核狀態：審核中)";
    statusColor = "#D97706"; // 琥珀黃警示色
  } else if (isRejected) {
    statusText = "租客 (房東審核狀態：未通過)";
    statusColor = "#B91C1C"; // 深紅色醒目色
  }

  const btnText = "填寫房東申請表";
  const btnColor = isPending ? "#D97706" : isRejected ? "#B91C1C" : "#4F46E5";

  return {
    type: "flex",
    altText: isPending ? "⏳ 房東申請審核中 · 查看進度" : isRejected ? "❌ 房東申請未通過 · 重新送審" : "📝 申請成為房東 · 線上填表開通物業管理權限",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: headerBg,
        paddingAll: "18px",
        contents: [
          { type: "text", text: headerSubtitle, color: "#FDE68A", size: "xs", weight: "bold" },
          { type: "text", text: headerTitle, color: "#FFFFFF", size: "xl", weight: "bold", margin: "xs" },
          { type: "text", text: headerDesc, color: "#C7D2FE", size: "xs", margin: "xs" }
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
            layout: "vertical",
            backgroundColor: "#F8FAFC",
            cornerRadius: "10px",
            borderColor: "#E2E8F0",
            borderWidth: "1px",
            paddingAll: "12px",
            spacing: "xs",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "👤 申請人", size: "xs", color: "#64748B", flex: 3 },
                  { type: "text", text: `${name || '租客會員'}`, size: "xs", color: "#0F172A", weight: "bold", flex: 7 }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "📞 聯絡手機", size: "xs", color: "#64748B", flex: 3 },
                  { type: "text", text: `${phone || '未登記手機'}`, size: "xs", color: "#0F172A", weight: "bold", flex: 7 }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                contents: [
                  { type: "text", text: "🛡️ 目前身分", size: "xs", color: "#64748B", flex: 3 },
                  { type: "text", text: statusText, size: "xs", color: statusColor, weight: "bold", flex: 7, wrap: true }
                ]
              }
            ]
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            contents: [
              { type: "text", text: "✨ 開通房東權限專享功能：", size: "xs", color: "#334155", weight: "bold" },
              { type: "text", text: "• 📊 房東即時經營看板（出租率、實收總額）", size: "xxs", color: "#64748B" },
              { type: "text", text: "• ⏳ 租客繳費回報一鍵審核（自動開立電子收據）", size: "xxs", color: "#64748B" },
              { type: "text", text: "• 🏠 旗下物業房間招租、房客合約到期追蹤", size: "xxs", color: "#64748B" }
            ]
          },
          { type: "separator", margin: "xs" },
          {
            type: "text",
            text: isPending
              ? "您的申請已送出並由管理員查核中，點選下方按鈕即可於彈窗查看已提交資料與狀態說明。"
              : isRejected
              ? "您先前的申請未通過，點選下方按鈕即可查看原因並載入原資料直接修改重新送審。"
              : "點擊下方按鈕即可直接於 LINE 內嵌彈窗填寫認證資料（姓名與手機已為您自動代入），管理員核准後 LINE BOT 將自動為您切換為房東 6 宮格管理後台！",
            size: "xxs",
            color: "#64748B",
            wrap: true
          },
          {
            type: "button",
            style: "primary",
            color: btnColor,
            height: "md",
            action: {
              type: "uri",
              label: btnText,
              uri: applyUrl
            }
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
            action: { type: "message", label: "📋 我的租約", text: "租約狀況" }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "message", label: "⏳ 待繳帳單", text: "待繳帳單" }
          }
        ]
      }
    },
    quickReply: buildSmartQuickReply("tenant", false)
  };
}

// 2. 身分切換成功提示卡片
function buildRoleSwitchSuccessFlex(targetRole: string, userName: string = "", isLandlord: boolean = false) {
  const isTargetLandlord = targetRole === "landlord";
  const title = isTargetLandlord ? "👑 已切換為【房東經營模式】" : "🏠 已切換為【租客生活模式】";
  const themeColor = isTargetLandlord ? "#0F172A" : "#064E3B";
  const desc = isTargetLandlord
    ? `您好，${userName || "房東"}！已為您成功切換至房東身分。\n\n📱 底部 6 宮格選單與下方快捷按鈕已即時切換為【房東經營後台】，您可隨時查閱即時出租率、物業概況與一鍵入帳審核！`
    : `您好，${userName || "租客"}！已為您成功切換至租客身分。\n\n📱 底部 6 宮格選單與下方快捷按鈕已即時切換為【租客生活選單】，您可隨時查閱合約、待繳帳單與電子繳費收據！`;

  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: themeColor,
        paddingAll: "18px",
        contents: [
          { type: "text", text: "智慧租屋 · 身分切換成功", color: isTargetLandlord ? "#94A3B8" : "#A7F3D0", size: "xs", weight: "bold" },
          { type: "text", text: title, color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "18px",
        spacing: "md",
        contents: [
          { type: "text", text: desc, size: "sm", color: "#334155", wrap: true },
          { type: "separator", margin: "md" },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "primary",
                color: isTargetLandlord ? "#4F46E5" : "#059669",
                height: "sm",
                action: {
                  type: "message",
                  label: isTargetLandlord ? "📊 經營概況" : "⏳ 待繳帳單",
                  text: isTargetLandlord ? "經營概況" : "待繳帳單"
                }
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: {
                  type: "message",
                  label: isTargetLandlord ? "⏳ 待核帳單" : "📋 我的租約",
                  text: isTargetLandlord ? "待核帳單" : "租約狀況"
                }
              }
            ]
          }
        ]
      }
    },
    quickReply: buildSmartQuickReply(targetRole, isLandlord)
  };
}

// 3. 房東經營概況看板
function buildLandlordDashboardFlex(
  landlord: any,
  properties: any[],
  leases: any[],
  pendingBills: any[],
  monthlyExpectedRent: number,
  monthlyCollectedRent: number
) {
  const totalProps = properties.length;
  const activeCount = leases.length;
  const vacantCount = Math.max(0, totalProps - activeCount);
  const occupancyRate = totalProps > 0 ? Math.round((activeCount / totalProps) * 100) : 0;
  const pendingCount = pendingBills.length;
  const collectionRate = monthlyExpectedRent > 0 ? Math.round((monthlyCollectedRent / monthlyExpectedRent) * 100) : 0;

  return {
    type: "flex",
    altText: `📊 房東經營概況看板 - 出租率 ${occupancyRate}%`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0F172A",
        paddingAll: "18px",
        contents: [
          { type: "text", text: "智慧租屋 · 房東經營概況", color: "#94A3B8", size: "xs", weight: "bold" },
          { type: "text", text: `${landlord?.name || '物業經營中心'} · 即時經營數據`, color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" },
          { type: "text", text: `房源總數 ${totalProps} 間 · 出租率 ${occupancyRate}%`, color: "#38BDF8", size: "xs", weight: "bold", margin: "xs" }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          // 房源與出租狀態方塊
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#F1F5F9",
                cornerRadius: "8px",
                paddingAll: "10px",
                flex: 1,
                contents: [
                  { type: "text", text: "🟢 已出租", size: "xxs", color: "#059669", weight: "bold" },
                  { type: "text", text: `${activeCount} 間`, size: "lg", weight: "bold", color: "#0F172A", margin: "xs" }
                ]
              },
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#FEF3C7",
                cornerRadius: "8px",
                paddingAll: "10px",
                flex: 1,
                contents: [
                  { type: "text", text: "🟡 空置招租", size: "xxs", color: "#D97706", weight: "bold" },
                  { type: "text", text: `${vacantCount} 間`, size: "lg", weight: "bold", color: "#0F172A", margin: "xs" }
                ]
              },
              {
                type: "box",
                layout: "vertical",
                backgroundColor: "#EEF2FF",
                cornerRadius: "8px",
                paddingAll: "10px",
                flex: 1,
                contents: [
                  { type: "text", text: "⏳ 待審核", size: "xxs", color: "#4F46E5", weight: "bold" },
                  { type: "text", text: `${pendingCount} 筆`, size: "lg", weight: "bold", color: "#4F46E5", margin: "xs" }
                ]
              }
            ]
          },
          { type: "separator", margin: "sm" },
          // 財務營收方塊
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#F8FAFC",
            cornerRadius: "10px",
            borderColor: "#E2E8F0",
            borderWidth: "1px",
            paddingAll: "12px",
            spacing: "xs",
            contents: [
              {
                type: "box",
                layout: "horizontal",
                justifyContent: "space-between",
                contents: [
                  { type: "text", text: "💰 本月預期總租金", size: "xs", color: "#64748B" },
                  { type: "text", text: `NT$ ${monthlyExpectedRent.toLocaleString()}`, size: "sm", weight: "bold", color: "#0F172A" }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                justifyContent: "space-between",
                contents: [
                  { type: "text", text: "💵 本月已實收租金", size: "xs", color: "#059669", weight: "bold" },
                  { type: "text", text: `NT$ ${monthlyCollectedRent.toLocaleString()}`, size: "sm", weight: "bold", color: "#059669" }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                justifyContent: "space-between",
                contents: [
                  { type: "text", text: "📈 實收達成率", size: "xxs", color: "#94A3B8" },
                  { type: "text", text: `${collectionRate}%`, size: "xs", weight: "bold", color: "#4F46E5" }
                ]
              }
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
            action: { type: "message", label: "⏳ 待核帳單", text: "待核帳單" }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "message", label: "🏠 房源現況", text: "房源現況" }
          }
        ]
      }
    },
    quickReply: buildSmartQuickReply("landlord", true)
  };
}

// 4. 待核帳單 Flex Message (支援一鍵確認入帳與駁回)
function buildLandlordAuditBillsFlex(pendingPayments: any[]) {
  if (!pendingPayments || pendingPayments.length === 0) {
    return {
      type: "flex",
      altText: "🎉 目前沒有任何待審核的帳單！",
      contents: {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#0F172A",
          paddingAll: "18px",
          contents: [
            { type: "text", text: "智慧租屋 · 待核帳單管理", color: "#94A3B8", size: "xs", weight: "bold" },
            { type: "text", text: "🎉 全數帳單已核對完畢", color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" }
          ]
        },
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "20px",
          contents: [
            { type: "text", text: "目前沒有租客回報之待核帳單。", size: "sm", color: "#334155", weight: "bold" },
            { type: "text", text: "當租客回傳末五碼或現金繳款時，系統將即時通知您在此一鍵確認入帳並開立收據！", size: "xs", color: "#64748B", margin: "sm", wrap: true }
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
              action: { type: "message", label: "📊 經營概況", text: "經營概況" }
            },
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: { type: "message", label: "🏠 房源現況", text: "房源現況" }
            }
          ]
        }
      },
      quickReply: buildSmartQuickReply("landlord", true)
    };
  }

  // 排序：依租客回報時間 (updated_at) 遞減，最後回報的在最上面
  const getAuditSortTimestamp = (item: any) => {
    if (item.updated_at) {
      const t = new Date(item.updated_at).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    if (item.created_at) {
      const t = new Date(item.created_at).getTime();
      if (!isNaN(t) && t > 0) return t;
    }
    return 0;
  };

  const sortedAuditBills = [...pendingPayments].sort((a, b) => {
    const timeA = getAuditSortTimestamp(a);
    const timeB = getAuditSortTimestamp(b);
    if (timeA !== timeB) return timeB - timeA;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });

  // Build carousel bubbles (max 10 bills)
  const bubbles = sortedAuditBills.slice(0, 10).map((bill) => {
    const title = getPaymentTitle(bill);
    const amt = Number(bill.amount || 0).toLocaleString();
    const isCash = bill.payment_method === "現金交付";
    const reportDesc = isCash ? "💵 現金交付" : `🏦 轉帳末五碼：${bill.transfer_last5 || "未填"}`;

    return {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#D97706",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "⏳ 租客繳款待審核", color: "#FEF3C7", size: "xs", weight: "bold" },
          { type: "text", text: title, color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" }
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
            contents: [
              { type: "text", text: "👤 承租人", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: bill.tenant_name || "租客", size: "xs", color: "#1E293B", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "💰 應收金額", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `NT$ ${amt}`, size: "sm", color: "#059669", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "📝 回報方式", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: reportDesc, size: "xs", color: "#D97706", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "📅 回報日期", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: bill.paid_date || bill.due_date || "當日", size: "xs", color: "#334155", flex: 7 }
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
            color: "#059669",
            height: "sm",
            action: {
              type: "postback",
              label: "✅ 確認入帳",
              data: `action=approve_payment&id=${bill.id}`,
              displayText: `確認入帳：${title}`
            }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: {
              type: "postback",
              label: "❌ 駁回",
              data: `action=reject_payment&id=${bill.id}`,
              displayText: `駁回回報：${title}`
            }
          }
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: `⏳ 共有 ${pendingPayments.length} 筆帳單待審核`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
    quickReply: buildSmartQuickReply("landlord", true)
  };
}

// 5. 旗下房源現況 Flex Message
function buildLandlordPropertiesFlex(properties: any[], leases: any[]) {
  if (!properties || properties.length === 0) {
    return {
      type: "flex",
      altText: "🏠 目前尚無登錄之房源",
      contents: {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#0F172A",
          paddingAll: "18px",
          contents: [
            { type: "text", text: "智慧租屋 · 房源現況", color: "#94A3B8", size: "xs", weight: "bold" },
            { type: "text", text: "尚無房源資料", color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" }
          ]
        },
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "20px",
          contents: [
            { type: "text", text: "您目前尚未在系統登錄出租物業房源，請至管理後台新增。", size: "sm", color: "#64748B", wrap: true }
          ]
        }
      },
      quickReply: buildSmartQuickReply("landlord", true)
    };
  }

  const bubbles = properties.slice(0, 10).map((prop) => {
    const activeLease = leases.find((l) => l.property_id === prop.id && l.status === "active");
    const isRented = !!activeLease;
    const rentAmt = Number(prop.rent || activeLease?.monthly_rent || 0).toLocaleString();

    return {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: isRented ? "#0F172A" : "#1E293B",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: isRented ? "🟢 已出租履行中" : "🟡 空置招租中",
            color: isRented ? "#A7F3D0" : "#FDE68A",
            size: "xs",
            weight: "bold"
          },
          {
            type: "text",
            text: `${prop.name || "房號"} · NT$ ${rentAmt}/月`,
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
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "📍 物業地址", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: prop.address || "未填地址", size: "xs", color: "#1E293B", weight: "bold", wrap: true, flex: 7 }
            ]
          },
          ...(isRented ? [
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "👤 當前租客", size: "xs", color: "#64748B", flex: 3 },
                { type: "text", text: `${activeLease.tenant_name || "租客"} (${activeLease.phone || ""})`, size: "xs", color: "#059669", weight: "bold", flex: 7 }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "🗓️ 合約到期", size: "xs", color: "#64748B", flex: 3 },
                { type: "text", text: activeLease.end_date || "未載", size: "xs", color: "#D97706", weight: "bold", flex: 7 }
              ]
            }
          ] : [
            {
              type: "box",
              layout: "horizontal",
              contents: [
                { type: "text", text: "✨ 招租現況", size: "xs", color: "#64748B", flex: 3 },
                { type: "text", text: "隨時可起租預約", size: "xs", color: "#D97706", weight: "bold", flex: 7 }
              ]
            }
          ])
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: `🏠 旗下房源現況 (共 ${properties.length} 間)`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
    quickReply: buildSmartQuickReply("landlord", true)
  };
}

// 6. 租客名冊 Flex Message
function buildLandlordTenantsFlex(leases: any[], properties: any[]) {
  if (!leases || leases.length === 0) {
    return {
      type: "flex",
      altText: "📋 目前尚無進行中合約",
      contents: {
        type: "bubble",
        size: "mega",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#0F172A",
          paddingAll: "18px",
          contents: [
            { type: "text", text: "智慧租屋 · 租客名冊", color: "#94A3B8", size: "xs", weight: "bold" },
            { type: "text", text: "目前無簽約租客", color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" }
          ]
        },
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "20px",
          contents: [
            { type: "text", text: "目前所有房源皆為空置或尚未登錄生效中之合約。", size: "sm", color: "#64748B" }
          ]
        }
      },
      quickReply: buildSmartQuickReply("landlord", true)
    };
  }

  const bubbles = leases.slice(0, 10).map((l) => {
    const prop = properties.find((p) => p.id === l.property_id);
    const duration = calculateContractDuration(l.start_date, l.end_date);
    const today = new Date();
    const dEnd = new Date(l.end_date);
    const daysRemaining = Math.max(0, Math.round((dEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1E293B",
        paddingAll: "16px",
        contents: [
          { type: "text", text: `房號：${prop?.name || '承租房源'}`, color: "#38BDF8", size: "xs", weight: "bold" },
          { type: "text", text: l.tenant_name || "承租人", color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" }
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
            contents: [
              { type: "text", text: "📞 聯絡電話", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: l.phone || "未填電話", size: "xs", color: "#1E293B", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "🗓️ 合約起訖", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `${l.start_date} ~ ${l.end_date}`, size: "xs", color: "#334155", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "⏳ 剩餘天數", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `倒數 ${daysRemaining} 天 (${duration.formatted})`, size: "xs", color: daysRemaining < 30 ? "#DC2626" : "#059669", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "💵 每月租金", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `NT$ ${Number(l.monthly_rent || 0).toLocaleString()}`, size: "xs", color: "#4F46E5", weight: "bold", flex: 7 }
            ]
          }
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: `📋 旗下租客合約名冊 (共 ${leases.length} 戶)`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
    quickReply: buildSmartQuickReply("landlord", true)
  };
}

// -----------------------------------------------------------------------------
// DUAL-ROLE STRICT USER CONTEXT FETCHER (ZERO LEAKAGE / STRICT AUTH)
// -----------------------------------------------------------------------------
async function getUserContext(supabase: any, lineUserId: string) {
  // 1. 查詢 line_bindings (支援 status: active, active:landlord, active:tenant)
  const { data: binding } = await supabase
    .from("line_bindings")
    .select("*")
    .eq("line_user_id", lineUserId)
    .like("status", "active%")
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
  const userName = profile?.name || binding.line_display_name || "";

  // 3. 嚴格判定房東身分 (Strict Landlord Verification)
  // 核心安全規則：
  // - 嚴格禁止任何模糊姓名比對或備註文字比對！
  // - 使用者必須在 landlords 表擁有 status === 'approved' 且未刪除之紀錄
  // - 比對基準僅限：profile.id === landlords.id 或 cleanPhone === landlords.phone
  let landlordRecord: any = null;

  if (profile?.id) {
    const { data: lById } = await supabase
      .from("landlords")
      .select("*")
      .eq("id", profile.id)
      .eq("status", "approved")
      .is("deleted_at", null)
      .maybeSingle();
    if (lById) landlordRecord = lById;
  }

  if (!landlordRecord && cleanPhone) {
    const { data: lByPhone } = await supabase
      .from("landlords")
      .select("*")
      .eq("phone", cleanPhone)
      .eq("status", "approved")
      .is("deleted_at", null)
      .maybeSingle();
    if (lByPhone) landlordRecord = lByPhone;
  }

  // 若使用者 profiles 角色的確為 superadmin，才允許管理存取
  if (!landlordRecord && profile?.role === "superadmin") {
    const { data: lFirst } = await supabase
      .from("landlords")
      .select("*")
      .eq("status", "approved")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    if (lFirst && lFirst[0]) landlordRecord = lFirst[0];
  }

  // 判定是否為房東：必須有 landlordRecord 且 (角色為 landlord/superadmin 或電話精確相符)
  const isLandlord = !!landlordRecord && (
    profile?.role === "superadmin" ||
    (landlordRecord.id === profile?.id) ||
    (landlordRecord.phone && String(landlordRecord.phone).replace(/[^0-9]/g, "") === cleanPhone)
  );

  // 3.5 查詢是否有審核中 (pending) 或被駁回 (rejected) 之房東身分申請
  let landlordApplicationStatus: string | null = null;
  if (!isLandlord && (cleanPhone || profile?.id)) {
    let appQuery = supabase
      .from("landlords")
      .select("status, company_name, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);

    if (profile?.id && cleanPhone) {
      appQuery = appQuery.or(`id.eq.${profile.id},phone.eq.${cleanPhone},id.eq.usr_${cleanPhone}`);
    } else if (cleanPhone) {
      appQuery = appQuery.or(`phone.eq.${cleanPhone},id.eq.usr_${cleanPhone}`);
    } else if (profile?.id) {
      appQuery = appQuery.eq("id", profile.id);
    }

    const { data: apps } = await appQuery;
    if (apps && apps.length > 0) {
      landlordApplicationStatus = apps[0].status;
    }
  }

  // 4. 判斷租客資格與進行中租約 (Tenant Eligibility)
  let leaseQuery = supabase
    .from("leases")
    .select("*")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (cleanPhone) {
    leaseQuery = leaseQuery.or(`phone.eq.${cleanPhone},co_phone.eq.${cleanPhone}`);
  }

  const { data: tenantLeases } = await leaseQuery;
  const isTenant = tenantLeases && tenantLeases.length > 0;
  const activeLease = tenantLeases?.[0] || null;

  // 5. 智慧模式判定與安全防護 (Active Role Enforcement)
  let currentRole = "tenant";

  if (isLandlord) {
    if (binding.status === "active:landlord") {
      currentRole = "landlord";
    } else if (binding.status === "active:tenant") {
      currentRole = "tenant";
    } else {
      currentRole = "landlord";
    }
  } else {
    // ⚠️ 嚴格安全原則：非房東帳號一律強制鎖定為租客模式！
    currentRole = "tenant";

    // 若資料庫內曾記錄為 active:landlord，自動自我修復修正回 active:tenant 並綁定標準租客 Rich Menu
    if (binding.status === "active:landlord") {
      await supabase
        .from("line_bindings")
        .update({ status: "active:tenant", updated_at: new Date().toISOString() })
        .eq("line_user_id", lineUserId);
      try {
        await linkUserRichMenu(lineUserId, TENANT_STANDARD_RICH_MENU_ID);
      } catch {}
    }
  }

  const isDualRole = isLandlord && isTenant;

  // 6. 房東專屬物業資料 (嚴格鎖定此房東 ID，若非房東則完全為空陣列)
  let landlordProperties: any[] = [];
  let landlordManagedLeases: any[] = [];
  if (isLandlord && landlordRecord?.id) {
    const { data: props } = await supabase
      .from("properties")
      .select("*")
      .eq("landlord_id", landlordRecord.id)
      .is("deleted_at", null);
    landlordProperties = props || [];

    const propIds = landlordProperties.map((p) => p.id);
    if (propIds.length > 0) {
      const { data: mLeases } = await supabase
        .from("leases")
        .select("*")
        .in("property_id", propIds)
        .eq("status", "active")
        .is("deleted_at", null);
      landlordManagedLeases = mLeases || [];
    }
  }

  // 7. 租客承租關聯房東資料（僅在存在生效租約時嚴格關聯該合約所屬房東）
  let tenantProperty: any = null;
  let tenantLandlord: any = null;
  if (activeLease) {
    if (activeLease.property_id) {
      const { data: p } = await supabase
        .from("properties")
        .select("*")
        .eq("id", activeLease.property_id)
        .maybeSingle();
      tenantProperty = p;
    }
    const targetLandlordId = activeLease.landlord_id || tenantProperty?.landlord_id;
    if (targetLandlordId) {
      const { data: l } = await supabase
        .from("landlords")
        .select("*")
        .eq("id", targetLandlordId)
        .maybeSingle();
      tenantLandlord = l;
    }
  }
  // ⚠️ 嚴格安全原則：若租客無租約或租約無關聯房東，tenantLandlord 必須嚴格保持為 null！
  // 嚴格禁止任何跨租約 fallback（如 SELECT * FROM landlords LIMIT 1），以維護不同房東個資與轉帳安全！

  return {
    lineUserId,
    binding,
    profile,
    userName,
    cleanPhone,
    isLandlord,
    landlordApplicationStatus,
    isTenant,
    isDualRole,
    currentRole,
    landlordRecord: isLandlord ? landlordRecord : null,
    landlordProperties,
    landlordManagedLeases,
    lease: activeLease,
    leases: tenantLeases || [],
    property: tenantProperty,
    landlord: tenantLandlord,
  };
}

// -----------------------------------------------------------------------------
// HTTP REQUEST SERVER & DUAL-ROLE WEBHOOK DISPATCHER
// -----------------------------------------------------------------------------
serve(async (req: Request) => {
  // Support GET (health check / browser check)
  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", service: "line-webhook", version: "dual-role-v3-dynamic" }), {
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
  if (!bodyData.events || bodyData.events.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "Webhook verified successfully" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Signature verification
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

    // 獲取使用者完整上下文 (雙身分嚴格判斷)
    const userCtx = await getUserContext(supabase, lineUserId);

    // -------------------------------------------------------------------------
    // 0. 處理 FOLLOW 事件（使用者加入 LINE BOT 好友或解除封鎖）
    // -------------------------------------------------------------------------
    if (event.type === "follow") {
      const userProfile = await getLineUserProfile(lineUserId);
      const displayName = userProfile?.displayName || "智慧租屋朋友";

      if (!userCtx) {
        // 未綁定新用戶 -> 自動推播快速註冊會員卡片
        await replyLineMessage(replyToken, [buildUnboundGuideFlex(lineUserId, displayName)]);
        continue;
      }

      // 依據是否具備房東權限與當前身分，精確綁定專屬 Rich Menu
      try {
        if (userCtx.currentRole === "landlord") {
          await linkUserRichMenu(lineUserId, LANDLORD_RICH_MENU_ID);
        } else if (userCtx.isLandlord) {
          await linkUserRichMenu(lineUserId, TENANT_DUAL_RICH_MENU_ID);
        } else {
          await linkUserRichMenu(lineUserId, TENANT_STANDARD_RICH_MENU_ID);
        }
      } catch (err) {
        console.warn("Follow event link rich menu error:", err);
      }

      const welcomeName = userCtx.userName || displayName;
      const isLandlordMode = userCtx.currentRole === "landlord";

      await replyLineMessage(replyToken, [
        {
          type: "text",
          text: `🎉 歡迎您使用智慧租屋管家系統！\n\n您好，${welcomeName}！您目前處於【${isLandlordMode ? '房東經營模式' : '租客生活模式'}】。\n\n日後有任何新帳單、繳費回報或審核確認，系統將在此為您進行即時推播通知！\n\n您可點擊下方 6 宮格選單或快捷按鈕開始使用：`,
          quickReply: buildSmartQuickReply(userCtx.currentRole, userCtx.isLandlord)
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

      // 1. 申請成為房東 Postback
      if (action === "apply_landlord") {
        if (userCtx?.isLandlord) {
          await linkUserRichMenu(lineUserId, LANDLORD_RICH_MENU_ID);
          await supabase
            .from("line_bindings")
            .update({ status: "active:landlord", updated_at: new Date().toISOString() })
            .eq("line_user_id", lineUserId);

          await replyLineMessage(replyToken, [
            buildRoleSwitchSuccessFlex("landlord", userCtx?.userName || "房東", true)
          ]);
          continue;
        }

        await replyLineMessage(replyToken, [
          buildLandlordApplicationGuideFlex(userCtx, lineUserId)
        ]);
        continue;
      }

      // 2. 身分切換 Postback
      if (action === "switch_role") {
        const target = params.get("target") || "tenant";
        const displayName = userCtx?.userName || "使用者";

        if (target === "landlord") {
          // 嚴格權限防護：非房東帳號嚴禁切換，導引申請成為房東
          if (!userCtx?.isLandlord) {
            await linkUserRichMenu(lineUserId, TENANT_STANDARD_RICH_MENU_ID);
            await replyLineMessage(replyToken, [
              buildLandlordApplicationGuideFlex(userCtx, lineUserId)
            ]);
            continue;
          }

          // 更新 line_bindings 為 active:landlord
          await supabase
            .from("line_bindings")
            .update({ status: "active:landlord", updated_at: new Date().toISOString() })
            .eq("line_user_id", lineUserId);

          // 切換 LINE Rich Menu 為房東選單
          await linkUserRichMenu(lineUserId, LANDLORD_RICH_MENU_ID);

          await replyLineMessage(replyToken, [
            buildRoleSwitchSuccessFlex("landlord", displayName, true)
          ]);
          continue;
        }

        if (target === "tenant") {
          // 更新 line_bindings 為 active:tenant
          await supabase
            .from("line_bindings")
            .update({ status: "active:tenant", updated_at: new Date().toISOString() })
            .eq("line_user_id", lineUserId);

          // 切換 LINE Rich Menu 為對應之租客選單 (具房東者用 dual，純租客用 standard)
          const targetMenu = userCtx?.isLandlord ? TENANT_DUAL_RICH_MENU_ID : TENANT_STANDARD_RICH_MENU_ID;
          await linkUserRichMenu(lineUserId, targetMenu);

          await replyLineMessage(replyToken, [
            buildRoleSwitchSuccessFlex("tenant", displayName, userCtx?.isLandlord)
          ]);
          continue;
        }
      }

      // 3. 房東確認入帳 (Approve Payment) - 嚴格限房東
      if (action === "approve_payment") {
        if (!userCtx?.isLandlord) {
          await replyLineMessage(replyToken, [
            { type: "text", text: "⚠️ 權限不足：您未具備房東管理權限，無法執行審核操作！", quickReply: buildSmartQuickReply("tenant", false) }
          ]);
          continue;
        }

        const billId = params.get("id");
        if (!billId) {
          await replyLineMessage(replyToken, [{ type: "text", text: "❌ 缺少帳單識別碼。" }]);
          continue;
        }

        const { data: bill } = await supabase
          .from("payments")
          .select("*")
          .eq("id", billId)
          .maybeSingle();

        if (!bill) {
          await replyLineMessage(replyToken, [{ type: "text", text: "⚠️ 查無此筆帳單資料。" }]);
          continue;
        }

        if (bill.status === "paid") {
          await replyLineMessage(replyToken, [{ type: "text", text: `✅ 帳單【${getPaymentTitle(bill)}】先前已確認入帳結清！` }]);
          continue;
        }

        const todayStr = new Date().toISOString().split("T")[0];
        const { error: updErr } = await supabase
          .from("payments")
          .update({
            status: "paid",
            paid_date: bill.paid_date || todayStr,
            updated_at: new Date().toISOString()
          })
          .eq("id", billId);

        if (updErr) {
          await replyLineMessage(replyToken, [{ type: "text", text: `❌ 核帳失敗：${updErr.message}` }]);
          continue;
        }

        const title = getPaymentTitle(bill);
        const amt = Number(bill.amount || 0).toLocaleString();

        // 立即推播收據確認給承租人 (Instant Push to Tenant)
        try {
          if (bill.lease_id) {
            const { data: lse } = await supabase.from("leases").select("tenant_name, phone, co_phone").eq("id", bill.lease_id).maybeSingle();
            const tPhone = lse?.phone ? String(lse.phone).replace(/[^0-9]/g, "") : "";
            if (tPhone) {
              const { data: tProfiles } = await supabase.from("profiles").select("id").eq("phone", tPhone);
              if (tProfiles && tProfiles[0]) {
                const { data: tBinding } = await supabase.from("line_bindings").select("line_user_id").eq("tenant_id", tProfiles[0].id).like("status", "active%").maybeSingle();
                if (tBinding?.line_user_id) {
                  await pushLineMessage(tBinding.line_user_id, [
                    {
                      type: "text",
                      text: `🎉【繳費核銷成功通知】\n\n您繳納的【${title}】(金額 NT$ ${amt}) 房東已確認入帳，電子收據已正式開立完成！\n\n感謝您的準時繳納，您可隨時輸入「已繳金額」查看歷史紀錄。`
                    }
                  ]);
                }
              }
            }
          }
        } catch (pushErr) {
          console.warn("Push to tenant error:", pushErr);
        }

        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: `✅ 帳單【${title}】(金額 NT$ ${amt}) 已成功確認入帳！\n\n電子收據已即時開立，並已推播通知承租人。如需查看更多，請點選下方選單：`,
            quickReply: buildSmartQuickReply("landlord", true)
          }
        ]);
        continue;
      }

      // 4. 房東駁回繳款回報 (Reject Payment) - 嚴格限房東
      if (action === "reject_payment") {
        if (!userCtx?.isLandlord) {
          await replyLineMessage(replyToken, [
            { type: "text", text: "⚠️ 權限不足：您未具備房東管理權限，無法執行審核操作！", quickReply: buildSmartQuickReply("tenant", false) }
          ]);
          continue;
        }

        const billId = params.get("id");
        if (!billId) {
          await replyLineMessage(replyToken, [{ type: "text", text: "❌ 缺少帳單識別碼。" }]);
          continue;
        }

        const { data: bill } = await supabase.from("payments").select("*").eq("id", billId).maybeSingle();
        if (!bill) {
          await replyLineMessage(replyToken, [{ type: "text", text: "⚠️ 查無此筆帳單資料。" }]);
          continue;
        }

        const { error: updErr } = await supabase
          .from("payments")
          .update({
            status: "pending",
            payment_method: null,
            transfer_last5: null,
            updated_at: new Date().toISOString()
          })
          .eq("id", billId);

        if (updErr) {
          await replyLineMessage(replyToken, [{ type: "text", text: `❌ 駁回失敗：${updErr.message}` }]);
          continue;
        }

        const title = getPaymentTitle(bill);

        // 立即推播退回提醒給承租人 (Instant Push to Tenant)
        try {
          if (bill.lease_id) {
            const { data: lse } = await supabase.from("leases").select("phone").eq("id", bill.lease_id).maybeSingle();
            const tPhone = lse?.phone ? String(lse.phone).replace(/[^0-9]/g, "") : "";
            if (tPhone) {
              const { data: tProfiles } = await supabase.from("profiles").select("id").eq("phone", tPhone);
              if (tProfiles && tProfiles[0]) {
                const { data: tBinding } = await supabase.from("line_bindings").select("line_user_id").eq("tenant_id", tProfiles[0].id).like("status", "active%").maybeSingle();
                if (tBinding?.line_user_id) {
                  await pushLineMessage(tBinding.line_user_id, [
                    {
                      type: "text",
                      text: `⚠️【繳款回報退回提醒】\n\n您回報的【${title}】款項經房東核對未查得入帳紀錄，已退回為待繳狀態。\n\n請重新確認轉帳末五碼或與房東聯繫協助！`
                    }
                  ]);
                }
              }
            }
          }
        } catch (pushErr) {
          console.warn("Push to tenant error:", pushErr);
        }

        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: `❌ 已駁回帳單【${title}】之回報，該筆帳單已重置為待繳狀態，並已推播通知租客重新核對。\n\n如需查看其他帳單，請點選下方選單：`,
            quickReply: buildSmartQuickReply("landlord", true)
          }
        ]);
        continue;
      }

      // 5. 租客選擇帳單鎖定 (select_bill)
      if (action === "select_bill") {
        const title = decodeURIComponent(params.get("title") || "待繳帳單");
        const amount = params.get("amount") || "";
        const billId = params.get("id") || params.get("billId") || "";

        let payment: any = null;
        if (billId) {
          const { data: p } = await supabase.from("payments").select("*").eq("id", billId).maybeSingle();
          payment = p;
        }

        if (payment && payment.status === "paid") {
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: `✅ 帳單【${getPaymentTitle(payment)}】已於 ${payment.paid_date || "先前"} 完成結清！如需查看收據，請輸入「已繳金額」。`,
              quickReply: buildSmartQuickReply("tenant", userCtx?.isLandlord)
            }
          ]);
          continue;
        }

        if (payment && (payment.status === "tenant_submitted" || payment.status === "pending_approval")) {
          const prevDesc = payment.payment_method === '現金交付'
            ? '現金交付'
            : `轉帳末五碼：${payment.transfer_last5 || '已登記'}`;
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: `🔍 帳單【${getPaymentTitle(payment)}】先前已回報（${prevDesc}），房東正在核對入帳中，請耐心等候開立收據！`,
              quickReply: buildSmartQuickReply("tenant", userCtx?.isLandlord)
            }
          ]);
          continue;
        }

        const targetId = payment?.id || billId;
        if (targetId) {
          lockedBillsByUser.set(lineUserId, {
            billId: targetId,
            timestamp: Date.now()
          });
        }

        await replyLineMessage(replyToken, [
          buildLockedBillFlex(payment, userCtx?.landlord, title, amount)
        ]);
        continue;
      }

      // 6. 租客現金回報 (report_cash)
      if (action === "report_cash") {
        const billId = params.get("id") || params.get("billId");
        const leaseIds = userCtx ? userCtx.leases.map((l: any) => l.id) : [];

        let targetPayment: any = null;
        if (billId) {
          const { data: p } = await supabase.from("payments").select("*").eq("id", billId).maybeSingle();
          targetPayment = p;
        }

        if (targetPayment && targetPayment.status === "paid") {
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: `✅ 帳單【${getPaymentTitle(targetPayment)}】已於 ${targetPayment.paid_date || "先前"} 完成結清！如需查看收據，請輸入「已繳金額」。`,
              quickReply: buildSmartQuickReply("tenant", userCtx?.isLandlord)
            }
          ]);
          continue;
        }

        if (targetPayment && (targetPayment.status === "tenant_submitted" || targetPayment.status === "pending_approval")) {
          const prevTitle = getPaymentTitle(targetPayment);
          const prevDesc = targetPayment.payment_method === '現金交付' ? '現金交付' : `轉帳末五碼：${targetPayment.transfer_last5 || '已登記'}`;
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: `🔍 帳單【${prevTitle}】您先前已完成回報（${prevDesc}），房東正在核對入帳中！`,
              quickReply: buildSmartQuickReply("tenant", userCtx?.isLandlord)
            }
          ]);
          continue;
        }

        if (!targetPayment || targetPayment.status !== "pending") {
          if (leaseIds.length > 0) {
            const { data: pendingPayments } = await supabase
              .from("payments")
              .select("*")
              .in("lease_id", leaseIds)
              .eq("status", "pending")
              .is("deleted_at", null)
              .order("due_date", { ascending: true });
            targetPayment = pendingPayments?.[0] || null;
          }
        }

        if (!targetPayment) {
          await replyLineMessage(replyToken, [
            { type: "text", text: "🎉 您目前沒有待繳納之帳單！如需核對歷史紀錄，請輸入「已繳金額」。", quickReply: buildSmartQuickReply("tenant", userCtx?.isLandlord) }
          ]);
          continue;
        }

        const todayStr = new Date().toISOString().split("T")[0];
        const { error: updateErr } = await supabase
          .from("payments")
          .update({
            status: "tenant_submitted",
            payment_method: "現金交付",
            transfer_last5: null,
            paid_date: todayStr,
            updated_at: new Date().toISOString()
          })
          .eq("id", targetPayment.id)
          .eq("status", "pending");

        if (updateErr) {
          await replyLineMessage(replyToken, [
            { type: "text", text: `❌ 現金回報更新失敗：${updateErr.message || "請稍後再試或直接向房東反映。"}`, quickReply: buildSmartQuickReply("tenant", userCtx?.isLandlord) }
          ]);
        } else {
          lockedBillsByUser.delete(lineUserId);

          // 立即推播通知房東審核 (Instant Push to Landlord)
          try {
            if (userCtx?.landlord?.phone) {
              const lPhone = String(userCtx.landlord.phone).replace(/[^0-9]/g, "");
              const { data: lProfs } = await supabase.from("profiles").select("id").eq("phone", lPhone);
              if (lProfs && lProfs[0]) {
                const { data: lBind } = await supabase.from("line_bindings").select("line_user_id").eq("tenant_id", lProfs[0].id).like("status", "active%").maybeSingle();
                if (lBind?.line_user_id) {
                  await pushLineMessage(lBind.line_user_id, [
                    {
                      type: "text",
                      text: `🔔【租客現金繳款回報通知】\n\n承租人：${userCtx.userName || targetPayment.tenant_name || "租客"}\n項目：${getPaymentTitle(targetPayment)}\n金額：NT$ ${Number(targetPayment.amount || 0).toLocaleString()}\n方式：💵 現金交付\n\n請點選下方選單「⏳ 待核帳單」即可一鍵確認入帳並開立收據！`,
                      quickReply: buildSmartQuickReply("landlord", true)
                    }
                  ]);
                }
              }
            }
          } catch (pushErr) {
            console.warn("Push to landlord error:", pushErr);
          }

          await replyLineMessage(replyToken, [
            buildReportSuccessFlex(targetPayment, null, true)
          ]);
        }
        continue;
      }
    }

    // -------------------------------------------------------------------------
    // B. 處理 MESSAGE 事件 (文字 / 圖片)
    // -------------------------------------------------------------------------
    if (event.type === "message") {
      // 圖片訊息
      if (event.message?.type === "image") {
        await replyLineMessage(replyToken, [
          {
            type: "text",
            text: "📷 已收到您的轉帳憑證截圖！\n\n請直接在下方回覆您的【轉帳末五碼】（5 位數字，例如：88621）或是輸入「現金交付」，系統將立即為您完成繳費回報，送交房東核帳！",
            quickReply: {
              items: [
                {
                  type: "action",
                  action: { type: "message", label: "💵 現金交付", text: "現金交付" }
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

        // 0. 未綁定用戶導引
        if (!userCtx) {
          const userProfile = await getLineUserProfile(lineUserId);
          const displayName = userProfile?.displayName || "智慧租屋朋友";
          await replyLineMessage(replyToken, [
            buildUnboundGuideFlex(lineUserId, displayName)
          ]);
          continue;
        }

        const isLandlordRole = userCtx.currentRole === "landlord";

        // 1. 申請成為房東指令
        const isApplyLandlord = /^(?:📝|✍️)?\s*(申請成為房東|申請房東|我要當房東|成為房東|我要申請房東|開通房東)$/i.test(text.replace(/[\s\uFE0F]/g, ''));
        if (isApplyLandlord) {
          if (userCtx.isLandlord) {
            await linkUserRichMenu(lineUserId, LANDLORD_RICH_MENU_ID);
            await supabase
              .from("line_bindings")
              .update({ status: "active:landlord", updated_at: new Date().toISOString() })
              .eq("line_user_id", lineUserId);

            await replyLineMessage(replyToken, [
              buildRoleSwitchSuccessFlex("landlord", userCtx?.userName || "房東", true)
            ]);
            continue;
          }

          await replyLineMessage(replyToken, [
            buildLandlordApplicationGuideFlex(userCtx, lineUserId)
          ]);
          continue;
        }

        // 2. 身分切換指令判斷
        const isSwitchToLandlord = /^(切換為房東|切換房東|房東模式|我是房東|房東)$/i.test(text.replace(/\s+/g, ''));
        const isSwitchToTenant = /^(切換為租客|切換租客|租客模式|我是租客|租客)$/i.test(text.replace(/\s+/g, ''));
        const isToggleRole = /^(切換身分|身分切換|切換模式|切換)$/i.test(text.replace(/\s+/g, ''));

        if (isSwitchToLandlord || (isToggleRole && !isLandlordRole)) {
          // 嚴格拒絕非房東切換，自動引導申請成為房東
          if (!userCtx.isLandlord) {
            await linkUserRichMenu(lineUserId, TENANT_STANDARD_RICH_MENU_ID);
            await replyLineMessage(replyToken, [
              buildLandlordApplicationGuideFlex(userCtx, lineUserId)
            ]);
            continue;
          }

          // 更新 DB status 為 active:landlord
          await supabase
            .from("line_bindings")
            .update({ status: "active:landlord", updated_at: new Date().toISOString() })
            .eq("line_user_id", lineUserId);

          // 切換 Rich Menu 為房東選單
          await linkUserRichMenu(lineUserId, LANDLORD_RICH_MENU_ID);

          await replyLineMessage(replyToken, [
            buildRoleSwitchSuccessFlex("landlord", userCtx.userName, true)
          ]);
          continue;
        }

        if (isSwitchToTenant || (isToggleRole && isLandlordRole)) {
          // 更新 DB status 為 active:tenant
          await supabase
            .from("line_bindings")
            .update({ status: "active:tenant", updated_at: new Date().toISOString() })
            .eq("line_user_id", lineUserId);

          // 切換 Rich Menu 為對應之租客選單
          const targetMenu = userCtx.isLandlord ? TENANT_DUAL_RICH_MENU_ID : TENANT_STANDARD_RICH_MENU_ID;
          await linkUserRichMenu(lineUserId, targetMenu);

          await replyLineMessage(replyToken, [
            buildRoleSwitchSuccessFlex("tenant", userCtx.userName, userCtx.isLandlord)
          ]);
          continue;
        }

        // 3. 房東功能分支 (嚴格限房東身分，非房東直接拒絕)
        const isLandlordCommand = /^(經營概況|概況|統計|儀表板|待核帳單|待核|審核|核帳|房源現況|房源|房間|物業|租客名冊|名冊|房客|名單)$/.test(text) ||
          text.includes("經營") || text.includes("待核") || text.includes("名冊");

        if (isLandlordCommand && !userCtx.isLandlord) {
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: "⚠️ 權限不足：您目前為【租客身分】，無法查閱物業經營管理資料。\n\n如您持有出租物業，請點擊下方「📝 申請成為房東」送出開通申請：",
              quickReply: buildSmartQuickReply("tenant", false)
            }
          ]);
          continue;
        }

        if (isLandlordRole && userCtx.isLandlord) {
          // 3.1 經營概況
          if (text.includes("概況") || text.includes("統計") || text.includes("儀表板") || text.includes("經營") || text === "1") {
            const props = userCtx.landlordProperties;
            const leases = userCtx.landlordManagedLeases;
            const leaseIds = leases.map((l: any) => l.id);

            let pendingAuditBills: any[] = [];
            let monthlyExpectedRent = leases.reduce((sum: number, l: any) => sum + Number(l.monthly_rent || 0), 0);
            let monthlyCollectedRent = 0;

            if (leaseIds.length > 0) {
              const { data: bills } = await supabase
                .from("payments")
                .select("*")
                .in("lease_id", leaseIds)
                .is("deleted_at", null);

              const allBills = bills || [];
              pendingAuditBills = allBills.filter((b: any) => b.status === "tenant_submitted" || b.status === "pending_approval");

              const currentMonthPrefix = new Date().toISOString().substring(0, 7);
              monthlyCollectedRent = allBills
                .filter((b: any) => b.status === "paid" && (b.paid_date?.startsWith(currentMonthPrefix) || b.due_date?.startsWith(currentMonthPrefix)))
                .reduce((sum: number, b: any) => sum + Number(b.amount || 0), 0);
            }

            await replyLineMessage(replyToken, [
              buildLandlordDashboardFlex(
                userCtx.landlordRecord,
                props,
                leases,
                pendingAuditBills,
                monthlyExpectedRent,
                monthlyCollectedRent
              )
            ]);
            continue;
          }

          // 3.2 待核帳單
          if (text.includes("待核") || text.includes("審核") || text.includes("核帳") || text === "2") {
            const leaseIds = userCtx.landlordManagedLeases.map((l: any) => l.id);
            let pendingPayments: any[] = [];

            if (leaseIds.length > 0) {
              const { data: pData } = await supabase
                .from("payments")
                .select("*")
                .in("lease_id", leaseIds)
                .in("status", ["tenant_submitted", "pending_approval"])
                .is("deleted_at", null)
                .order("updated_at", { ascending: false });
              pendingPayments = pData || [];
            }

            await replyLineMessage(replyToken, [
              buildLandlordAuditBillsFlex(pendingPayments)
            ]);
            continue;
          }

          // 3.3 房源現況
          if (text.includes("房源") || text.includes("房間") || text.includes("物業") || text === "3") {
            await replyLineMessage(replyToken, [
              buildLandlordPropertiesFlex(userCtx.landlordProperties, userCtx.landlordManagedLeases)
            ]);
            continue;
          }

          // 3.4 租客名冊
          if (text.includes("名冊") || text.includes("房客") || text.includes("名單") || text === "4") {
            await replyLineMessage(replyToken, [
              buildLandlordTenantsFlex(userCtx.landlordManagedLeases, userCtx.landlordProperties)
            ]);
            continue;
          }
        }

        // 4. 租客功能分支
        const leaseIds = userCtx.leases.map((l: any) => l.id);

        // 4.1 繳款回報：末五碼或現金
        const last5Match = text.match(/(?:後五碼|末五碼|回報|轉帳)\s*(\d{5})\b|^\s*(\d{5})\s*$/);
        const isCash = /^(現金|現金交付|付現|現金繳費|現金支付|已付現金)$/i.test(text.replace(/\s+/g, '')) || text.includes("現金交付");

        if (last5Match || isCash) {
          const matchedLast5 = last5Match ? (last5Match[1] || last5Match[2]) : null;
          const reportMethod = isCash ? "現金交付" : "銀行轉帳";

          let targetPayment: any = null;
          const lockedInfo = lockedBillsByUser.get(lineUserId);
          if (lockedInfo && (Date.now() - lockedInfo.timestamp < 3600000)) {
            const { data: lp } = await supabase
              .from("payments")
              .select("*")
              .eq("id", lockedInfo.billId)
              .eq("status", "pending")
              .is("deleted_at", null)
              .maybeSingle();
            if (lp) targetPayment = lp;
          }

          if (!targetPayment && leaseIds.length > 0) {
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
                  text: `🔍 您先前已送交【${prevTitle}】之繳款回報（${prevDesc}），房東正在核對入帳中，請耐心等候開立收據！`,
                  quickReply: buildSmartQuickReply(userCtx.currentRole, userCtx.isLandlord)
                }
              ]);
            } else {
              await replyLineMessage(replyToken, [
                {
                  type: "text",
                  text: "🎉 您目前沒有任何待繳納之帳單！感謝您的準時繳納。如需核對歷史紀錄，請輸入「已繳金額」。",
                  quickReply: buildSmartQuickReply(userCtx.currentRole, userCtx.isLandlord)
                }
              ]);
            }
            continue;
          }

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
              { type: "text", text: `❌ 回報更新失敗：${updateErr.message || "請稍後再試或直接向房東反映。"}`, quickReply: buildSmartQuickReply(userCtx.currentRole, userCtx.isLandlord) }
            ]);
          } else {
            lockedBillsByUser.delete(lineUserId);

            // 立即推播通知房東審核 (Instant Push to Landlord)
            try {
              if (userCtx?.landlord?.phone) {
                const lPhone = String(userCtx.landlord.phone).replace(/[^0-9]/g, "");
                const { data: lProfs } = await supabase.from("profiles").select("id").eq("phone", lPhone);
                if (lProfs && lProfs[0]) {
                  const { data: lBind } = await supabase.from("line_bindings").select("line_user_id").eq("tenant_id", lProfs[0].id).like("status", "active%").maybeSingle();
                  if (lBind?.line_user_id) {
                    const payDesc = isCash ? "💵 現金交付" : `🏦 轉帳末五碼：${matchedLast5}`;
                    await pushLineMessage(lBind.line_user_id, [
                      {
                        type: "text",
                        text: `🔔【租客繳費回報提醒】\n\n承租人：${userCtx.userName || targetPayment.tenant_name || "租客"}\n項目：${getPaymentTitle(targetPayment)}\n金額：NT$ ${Number(targetPayment.amount || 0).toLocaleString()}\n方式：${payDesc}\n\n請點選下方「⏳ 待核帳單」即可一鍵確認入帳並開立收據！`,
                        quickReply: buildSmartQuickReply("landlord", true)
                      }
                    ]);
                  }
                }
              }
            } catch (pushErr) {
              console.warn("Push to landlord error:", pushErr);
            }

            await replyLineMessage(replyToken, [
              buildReportSuccessFlex(targetPayment, matchedLast5, isCash)
            ]);
          }
          continue;
        }

        // 4.2 租約狀況
        if (text.includes("租約") || text.includes("合約") || text.includes("我的租約")) {
          if (!userCtx.lease) {
            await replyLineMessage(replyToken, [
              {
                type: "text",
                text: "⚠️ 目前查無您生效中的租約資料。若已簽訂新約，請洽詢房東完成系統登記。",
                quickReply: buildSmartQuickReply(userCtx.currentRole, userCtx.isLandlord)
              }
            ]);
          } else {
            await replyLineMessage(replyToken, [
              buildLeaseFlex(userCtx.lease, userCtx.property, userCtx.landlord, userCtx.profile)
            ]);
          }
          continue;
        }

        // 4.3 已繳金額 / 歷史收據
        if (text.includes("已繳") || text.includes("收據") || text.includes("繳款紀錄")) {
          let paidPayments: any[] = [];
          let query = supabase
            .from("payments")
            .select("*")
            .eq("status", "paid")
            .is("deleted_at", null)
            .order("updated_at", { ascending: false });

          if (leaseIds.length > 0) {
            query = query.in("lease_id", leaseIds);
          } else if (userCtx.profile?.name) {
            query = query.eq("tenant_name", userCtx.profile.name);
          }

          const { data: pData } = await query;
          paidPayments = pData || [];

          await replyLineMessage(replyToken, [
            buildPaidPaymentsFlex(paidPayments, userCtx.profile)
          ]);
          continue;
        }

        // 4.4 待繳帳單
        if (text.includes("帳單") || text.includes("待繳") || text.includes("應繳") || text.includes("未繳")) {
          let pendingPayments: any[] = [];
          if (leaseIds.length > 0) {
            const { data: pData } = await supabase
              .from("payments")
              .select("*")
              .in("lease_id", leaseIds)
              .in("status", ["pending", "pending_approval", "tenant_submitted"])
              .is("deleted_at", null)
              .order("created_at", { ascending: false });
            pendingPayments = pData || [];
          }

          await replyLineMessage(replyToken, [
            buildPendingBillsFlex(pendingPayments, userCtx.profile)
          ]);
          continue;
        }

        // 4.5 匯款帳號
        if (text.includes("匯款") || text.includes("帳戶") || text.includes("銀行")) {
          if (!userCtx.lease || !userCtx.landlord) {
            await replyLineMessage(replyToken, [
              buildNoLeaseBankInfoFlex(userCtx.profile)
            ]);
          } else {
            await replyLineMessage(replyToken, [
              buildBankInfoFlex(userCtx.landlord)
            ]);
          }
          continue;
        }

        // 5. 預設導覽
        if (isLandlordRole && userCtx.isLandlord) {
          const props = userCtx.landlordProperties;
          const leases = userCtx.landlordManagedLeases;
          const leaseIds = leases.map((l: any) => l.id);

          let pendingAuditBills: any[] = [];
          let monthlyExpectedRent = leases.reduce((sum: number, l: any) => sum + Number(l.monthly_rent || 0), 0);
          let monthlyCollectedRent = 0;

          if (leaseIds.length > 0) {
            const { data: bills } = await supabase.from("payments").select("*").in("lease_id", leaseIds).is("deleted_at", null);
            const allBills = bills || [];
            pendingAuditBills = allBills.filter((b: any) => b.status === "tenant_submitted" || b.status === "pending_approval");
            const currentMonthPrefix = new Date().toISOString().substring(0, 7);
            monthlyCollectedRent = allBills
              .filter((b: any) => b.status === "paid" && (b.paid_date?.startsWith(currentMonthPrefix) || b.due_date?.startsWith(currentMonthPrefix)))
              .reduce((sum: number, b: any) => sum + Number(b.amount || 0), 0);
          }

          await replyLineMessage(replyToken, [
            buildLandlordDashboardFlex(
              userCtx.landlordRecord,
              props,
              leases,
              pendingAuditBills,
              monthlyExpectedRent,
              monthlyCollectedRent
            )
          ]);
        } else {
          const userProfile = await getLineUserProfile(lineUserId);
          const displayName = userProfile?.displayName || userCtx?.profile?.name || "租客會員";
          await replyLineMessage(replyToken, [
            buildMenuFlex(userCtx.profile, lineUserId, displayName)
          ]);
        }
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
