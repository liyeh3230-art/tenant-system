// Supabase Edge Function: line-push
// Real-time Push Notification service via LINE Messaging API
// Sends high-aesthetic Flex Message notices when landlords add bills, utilities, or updates

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const LINE_CHANNEL_ACCESS_TOKEN =
  Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ||
  "3tRsfe2hSYJvT0Ygrvvu+vbkpgd+CkMbv0335PxTeGq+L7nklrr2/6e2ENGlpwZoHc+LVnmOzgPQPl1KUGr7byBd0PsjoQFhcJ8YastIH29ANr8RSWDR9kz97+6zlhpGIqofGT/lBL41ohwsH1MFDQdB04t89/1O/w1cDnyilFU=";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://hpphlfmtyxrulirpyejp.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

// Helper: category info
function getCategoryMeta(billType: string) {
  const type = String(billType || "").toLowerCase().trim();
  const meta: Record<string, { label: string; icon: string; color: string; bg: string }> = {
    rent: { label: "房屋租金", icon: "🏠", color: "#4F46E5", bg: "#EEF2FF" },
    deposit: { label: "押金保證金", icon: "🔒", color: "#0D9488", bg: "#F0FDFA" },
    utilities: { label: "水電瓦斯費", icon: "⚡", color: "#D97706", bg: "#FFFBEB" },
    electricity: { label: "用電費用", icon: "⚡", color: "#D97706", bg: "#FFFBEB" },
    power: { label: "用電費用", icon: "⚡", color: "#D97706", bg: "#FFFBEB" },
    water: { label: "自來水費", icon: "💧", color: "#0284C7", bg: "#F0F9FF" },
    gas: { label: "天然瓦斯", icon: "🔥", color: "#EA580C", bg: "#FFF7ED" },
    management: { label: "大樓管理費", icon: "🏢", color: "#2563EB", bg: "#EFF6FF" },
    parking: { label: "車位租金", icon: "🅿️", color: "#7C3AED", bg: "#F5F3FF" },
    maintenance: { label: "修繕雜費", icon: "🔧", color: "#B45309", bg: "#FEF3C7" },
    other: { label: "其他雜項費用", icon: "📋", color: "#7C3AED", bg: "#F5F3FF" },
  };
  return meta[type] || meta.other;
}

// Helper: extract landlord bank info
function parseLandlordBank(landlord: any) {
  let bankName = landlord?.bank_name || "";
  let bankAccount = landlord?.bank_account || "";
  // ⚠️ 嚴格區分：landlordName 永遠代表合約出租人法定房東本人，絕不能被受款戶名 (accountName) 覆蓋！
  let landlordName = landlord?.name || "房東";
  let accountName = landlord?.name || "房東";
  let landlordPhone = landlord?.phone || "";
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
    bankName: bankName || "請洽詢房東",
    bankAccount: bankAccount || "請洽詢房東",
    accountName: accountName,       // 銀行收款戶名（公司/他人/代理人）
    landlordName: landlordName,     // 合約出租甲方房東本人
    landlordPhone: landlordPhone,
    note: note
  };
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

  // 若未填寫，自動依據期限推導期別月份
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

// -----------------------------------------------------------------------------
// LINE Flex Message Builder: New Bill / Utility Notification
// -----------------------------------------------------------------------------
function buildNewBillFlex(params: {
  payment: any;
  lease: any;
  property: any;
  landlord: any;
  tenantName: string;
}) {
  const { payment, lease, property, landlord, tenantName } = params;
  const isDirectlyPaid = payment.status === "paid";
  const cat = getCategoryMeta(payment.bill_type || payment.billType || "utilities");
  const bank = parseLandlordBank(landlord);
  const amountStr = Number(payment.amount || 0).toLocaleString();
  const titleStr = formatFeeItemName(payment.title, payment.bill_type || payment.billType, payment.due_date || payment.dueDate);
  const dueDateStr = payment.due_date || payment.dueDate || "依約定繳款";
  const propName = property?.name || lease?.property_name || "承租房源";
  const noteStr = payment.note ? String(payment.note).trim() : "";

  const headerBgColor = isDirectlyPaid ? "#059669" : "#D97706";
  const headerSubText = isDirectlyPaid ? "🧾 智慧租屋 · 費用入帳收據憑證" : "🔔 智慧租屋 · 待處理帳單提醒";
  const headerTitle = isDirectlyPaid ? "款項已入帳結清" : "待繳帳單通知";
  const statusBadge = isDirectlyPaid ? "● 已收訖入帳" : "● 待租客繳納";
  const statusColor = isDirectlyPaid ? "#A7F3D0" : "#FEF08A";

  const postbackData = `action=select_bill&title=${encodeURIComponent(titleStr)}&amount=${payment.amount || 0}&billId=${payment.id || ""}`;

  const bodyContents: any[] = [
    // 房源與承租人資訊
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: "🏠 承租房源", size: "xs", color: "#64748B", flex: 3 },
        { type: "text", text: `${propName} (${tenantName})`, size: "xs", color: "#1E293B", weight: "bold", wrap: true, flex: 7 }
      ]
    },
    // 費用項目
    {
      type: "box",
      layout: "horizontal",
      contents: [
        { type: "text", text: "📋 費用項目", size: "xs", color: "#64748B", flex: 3 },
        { type: "text", text: `${cat.icon} ${titleStr}`, size: "xs", color: "#1E293B", weight: "bold", wrap: true, flex: 7 }
      ]
    },
    // 應繳金額突出區塊 (針對行動裝置重新排版，保證金額與幣別永不被截斷)
    {
      type: "box",
      layout: "vertical",
      backgroundColor: isDirectlyPaid ? "#ECFDF5" : "#FFFBEB",
      cornerRadius: "14px",
      paddingAll: "14px",
      margin: "md",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          justifyContent: "space-between",
          alignItems: "center",
          contents: [
            {
              type: "text",
              text: isDirectlyPaid ? "● 已收訖結清" : "● 本期應繳金額",
              size: "xs",
              color: isDirectlyPaid ? "#047857" : "#B45309",
              weight: "bold",
              flex: 5
            },
            {
              type: "text",
              text: isDirectlyPaid ? (payment.paid_date || dueDateStr) : `${dueDateStr} 前`,
              size: "xs",
              color: isDirectlyPaid ? "#059669" : "#B45309",
              align: "end",
              weight: "bold",
              flex: 5
            }
          ]
        },
        {
          type: "box",
          layout: "baseline",
          spacing: "xs",
          margin: "sm",
          contents: [
            {
              type: "text",
              text: "NT$",
              size: "sm",
              color: isDirectlyPaid ? "#065F46" : "#92400E",
              weight: "bold",
              flex: 0
            },
            {
              type: "text",
              text: amountStr,
              size: "xxl",
              color: isDirectlyPaid ? "#065F46" : "#92400E",
              weight: "bold",
              wrap: true,
              flex: 1
            }
          ]
        },
        {
          type: "separator",
          margin: "sm",
          color: isDirectlyPaid ? "#A7F3D0" : "#FDE68A"
        },
        {
          type: "box",
          layout: "horizontal",
          justifyContent: "space-between",
          margin: "xs",
          contents: [
            {
              type: "text",
              text: "繳費狀態",
              size: "xxs",
              color: isDirectlyPaid ? "#059669" : "#B45309"
            },
            {
              type: "text",
              text: isDirectlyPaid ? "已入帳結清" : "待繳納",
              size: "xxs",
              color: isDirectlyPaid ? "#065F46" : "#92400E",
              weight: "bold",
              align: "end"
            }
          ]
        }
      ]
    }
  ];

  // 房東備註說明 (若有填寫)
  if (noteStr) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      backgroundColor: "#F8FAFC",
      cornerRadius: "10px",
      paddingAll: "10px",
      margin: "sm",
      contents: [
        { type: "text", text: "📝 房東備註：", size: "xxs", color: "#64748B", weight: "bold" },
        { type: "text", text: noteStr, size: "xs", color: "#334155", wrap: true, margin: "xs" }
      ]
    });
  }

  // 匯款帳號 (若為待繳款)
  if (!isDirectlyPaid) {
    bodyContents.push(
      { type: "separator", margin: "md" },
      {
        type: "box",
        layout: "vertical",
        margin: "sm",
        spacing: "xs",
        contents: [
          { type: "text", text: "🏦 房東收款帳戶", size: "xxs", color: "#64748B", weight: "bold" },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "銀行：", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: bank.bankName, size: "xs", color: "#1E293B", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "帳號：", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: bank.bankAccount, size: "xs", color: "#4F46E5", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "戶名：", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: bank.accountName, size: "xs", color: "#1E293B", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "房東：", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: `${bank.landlordName} (${bank.landlordPhone || '未提供電話'})`, size: "xs", color: "#64748B", flex: 7 }
            ]
          }
        ]
      }
    );
  }

  // Footer 按鈕
  const footerContents: any[] = [];
  if (!isDirectlyPaid) {
    footerContents.push(
      {
        type: "button",
        style: "primary",
        color: "#4F46E5",
        height: "sm",
        action: {
          type: "postback",
          label: "📝 匯款完成 · 回報末五碼",
          data: postbackData,
          displayText: `回報繳款【${titleStr}】`
        }
      },
      {
        type: "button",
        style: "link",
        height: "sm",
        action: {
          type: "message",
          label: "💬 詢問房東 / 說明",
          text: `您好，關於剛才新增的帳單【${titleStr}】，我想詢問一些細節。`
        }
      }
    );
  } else {
    footerContents.push({
      type: "button",
      style: "secondary",
      color: "#059669",
      height: "sm",
      action: {
        type: "message",
        label: "🔍 查詢所有已繳紀錄",
        text: "已繳金額"
      }
    });
  }

  return {
    type: "flex",
    altText: `🔔 ${headerTitle}：${titleStr} NT$ ${amountStr}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: headerBgColor,
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: headerSubText,
            color: "#FFFFFF",
            size: "xs",
            weight: "bold"
          },
          {
            type: "text",
            text: headerTitle,
            color: "#FFFFFF",
            size: "xl",
            weight: "bold",
            margin: "xs"
          },
          {
            type: "text",
            text: statusBadge,
            color: statusColor,
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
        spacing: "sm",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        spacing: "xs",
        contents: footerContents
      }
    }
  };
}

// -----------------------------------------------------------------------------
// LINE Messaging API Push sender
// -----------------------------------------------------------------------------
async function pushLineMessage(lineUserId: string, messages: any[]): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      to: lineUserId,
      messages,
    }),
  });

  const bodyText = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    body: bodyText,
  };
}

// -----------------------------------------------------------------------------
// Main HTTP Handler
// -----------------------------------------------------------------------------
serve(async (req: Request) => {
  // 1. Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(JSON.stringify({ status: "ok", service: "line-push" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const payload = await req.json();
    const { action = "push_bill", payment, lease, property } = payload;

    if (!payment) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: payment" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Locate the target lease
    let targetLease = lease;
    const leaseId = payment.lease_id || payment.leaseId || lease?.id;
    if (!targetLease && leaseId) {
      const { data: lData } = await supabase
        .from("leases")
        .select("*")
        .eq("id", leaseId)
        .maybeSingle();
      targetLease = lData;
    }

    const tenantPhone = targetLease?.phone || payment.tenantPhone;
    const cleanPhone = tenantPhone ? String(tenantPhone).replace(/[^0-9]/g, "") : "";
    const tenantName = targetLease?.tenant_name || targetLease?.tenantName || payment.tenant_name || payment.tenantName || "房客";

    // 2. Find tenant profile & LINE binding
    let lineUserId = "";
    let targetProfileId = targetLease?.tenant_id;

    if (cleanPhone) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, name, phone")
        .eq("phone", cleanPhone)
        .is("deleted_at", null);

      if (profs && profs.length > 0) {
        targetProfileId = profs[0].id;
      }
    }

    if (targetProfileId) {
      const { data: bindings } = await supabase
        .from("line_bindings")
        .select("line_user_id, status")
        .eq("tenant_id", targetProfileId)
        .eq("status", "active");

      if (bindings && bindings.length > 0) {
        // Find binding that is a genuine LINE User ID (starts with 'U' and not 'fb_')
        const activeBinding = bindings.find((b: any) => b.line_user_id && b.line_user_id.startsWith("U") && !b.line_user_id.startsWith("fb_"));
        if (activeBinding) {
          lineUserId = activeBinding.line_user_id;
        }
      }
    }

    // If still not found, check if line_bindings has any entry directly by tenant phone or search
    if (!lineUserId && cleanPhone) {
      const { data: allActiveBindings } = await supabase
        .from("line_bindings")
        .select("line_user_id, tenant_id")
        .eq("status", "active")
        .like("line_user_id", "U%");

      if (allActiveBindings && allActiveBindings.length > 0) {
        for (const b of allActiveBindings) {
          const { data: p } = await supabase
            .from("profiles")
            .select("phone")
            .eq("id", b.tenant_id)
            .maybeSingle();
          if (p && String(p.phone).replace(/[^0-9]/g, "") === cleanPhone) {
            lineUserId = b.line_user_id;
            break;
          }
        }
      }
    }

    // If tenant has not bound LINE, return notice without error
    if (!lineUserId) {
      return new Response(
        JSON.stringify({
          success: true,
          pushed: false,
          reason: "tenant_not_bound",
          message: `房客「${tenantName}」尚未綁定 LINE 帳號，已略過推播。`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Locate Property & Landlord
    let targetProperty = property;
    if (!targetProperty && targetLease?.property_id) {
      const { data: pData } = await supabase
        .from("properties")
        .select("*")
        .eq("id", targetLease.property_id)
        .maybeSingle();
      targetProperty = pData;
    }

    let landlord: any = null;
    const landlordId = targetLease?.landlord_id || targetLease?.landlordId;
    if (landlordId) {
      const { data: lnd } = await supabase
        .from("landlords")
        .select("*")
        .eq("id", landlordId)
        .maybeSingle();
      landlord = lnd;
    }

    if (!landlord) {
      const { data: allLnds } = await supabase
        .from("landlords")
        .select("*")
        .is("deleted_at", null)
        .limit(1);
      landlord = allLnds?.[0] || null;
    }

    // 4. Construct Flex Message
    const flexMessage = buildNewBillFlex({
      payment,
      lease: targetLease,
      property: targetProperty,
      landlord,
      tenantName
    });

    // 5. Send Push Notification via LINE Messaging API
    const pushResult = await pushLineMessage(lineUserId, [flexMessage]);

    if (!pushResult.ok) {
      console.error("LINE Push failed:", pushResult.status, pushResult.body);
      return new Response(
        JSON.stringify({
          success: false,
          pushed: false,
          error: `LINE Push API Error (${pushResult.status}): ${pushResult.body}`,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        pushed: true,
        lineUserId,
        tenantName,
        billTitle: formatFeeItemName(payment.title, payment.bill_type || payment.billType, payment.due_date || payment.dueDate),
        amount: payment.amount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("line-push execution error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
