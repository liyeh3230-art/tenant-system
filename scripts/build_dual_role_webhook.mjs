import fs from 'fs';

// Read the first 1843 lines of backup file
const backupContent = fs.readFileSync('supabase/functions/line-webhook/index.ts.backup_stable', 'utf8');
const backupLines = backupContent.split('\n');

// Find line where getTenantContext begins
const splitIndex = backupLines.findIndex(l => l.includes('async function getTenantContext'));
if (splitIndex === -1) {
  console.error("Could not find getTenantContext in backup!");
  process.exit(1);
}

const baseHeader = backupLines.slice(0, splitIndex).join('\n');

const newCode = `
// -----------------------------------------------------------------------------
// DUAL-ROLE RICH MENU & LINE MESSAGING API CONSTANTS
// -----------------------------------------------------------------------------
const TENANT_RICH_MENU_ID = "richmenu-aa6b131d849fa8ed0fa259bc9a1f714b";
const LANDLORD_RICH_MENU_ID = "richmenu-a980c99ad846b07beb0bc17fdf827cb0";

// Helper to push message to a specific LINE User ID
async function pushLineMessage(to: string, messages: any[]): Promise<Response> {
  return await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: \`Bearer \${LINE_CHANNEL_ACCESS_TOKEN}\`,
    },
    body: JSON.stringify({
      to,
      messages,
    }),
  });
}

// Helper to link a user to a specific Rich Menu on LINE API
async function linkUserRichMenu(userId: string, richMenuId: string): Promise<Response> {
  return await fetch(\`https://api.line.me/v2/bot/user/\${userId}/richmenu/\${richMenuId}\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${LINE_CHANNEL_ACCESS_TOKEN}\`,
    },
  });
}

// -----------------------------------------------------------------------------
// SMART QUICK REPLY BUILDER (DUAL-TRACK: RICH MENU + FLOATING ACTION BUTTONS)
// -----------------------------------------------------------------------------
function buildSmartQuickReply(role: string = "tenant") {
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

  // Tenant Quick Reply
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
      {
        type: "action",
        action: { type: "postback", label: "🔄 切換房東", data: "action=switch_role&target=landlord", displayText: "🔄 切換為房東模式" }
      }
    ]
  };
}

// -----------------------------------------------------------------------------
// LANDLORD FLEX MESSAGE BUILDERS
// -----------------------------------------------------------------------------

// 1. 身分切換成功提示卡片
function buildRoleSwitchSuccessFlex(targetRole: string, userName: string = "") {
  const isLandlord = targetRole === "landlord";
  const title = isLandlord ? "👑 已切換為【房東經營模式】" : "🏠 已切換為【租客生活模式】";
  const themeColor = isLandlord ? "#0F172A" : "#064E3B";
  const desc = isLandlord
    ? \`您好，\${userName || "房東"}！已為您成功切換至房東身分。\\n\\n📱 底部 6 宮格選單與下方快捷按鈕已即時切換為【房東經營後台】，您可隨時查閱即時出租率、物業概況與一鍵入帳審核！\`
    : \`您好，\${userName || "租客"}！已為您成功切換至租客身分。\\n\\n📱 底部 6 宮格選單與下方快捷按鈕已即時切換為【租客生活選單】，您可隨時查閱合約、待繳帳單與電子繳費收據！\`;

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
          { type: "text", text: "智慧租屋 · 身分切換成功", color: isLandlord ? "#94A3B8" : "#A7F3D0", size: "xs", weight: "bold" },
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
                color: isLandlord ? "#4F46E5" : "#059669",
                height: "sm",
                action: {
                  type: "message",
                  label: isLandlord ? "📊 經營概況" : "⏳ 待繳帳單",
                  text: isLandlord ? "經營概況" : "待繳帳單"
                }
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                action: {
                  type: "message",
                  label: isLandlord ? "⏳ 待核帳單" : "📋 我的租約",
                  text: isLandlord ? "待核帳單" : "租約狀況"
                }
              }
            ]
          }
        ]
      }
    },
    quickReply: buildSmartQuickReply(targetRole)
  };
}

// 2. 房東經營概況看板
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
    altText: \`📊 房東經營概況看板 - 出租率 \${occupancyRate}%\`,
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
          { type: "text", text: \`\${landlord?.name || '物業經營中心'} · 即時經營數據\`, color: "#FFFFFF", size: "lg", weight: "bold", margin: "xs" },
          { type: "text", text: \`房源總數 \${totalProps} 間 · 出租率 \${occupancyRate}%\`, color: "#38BDF8", size: "xs", weight: "bold", margin: "xs" }
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
                  { type: "text", text: \`\${activeCount} 間\`, size: "lg", weight: "bold", color: "#0F172A", margin: "xs" }
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
                  { type: "text", text: \`\${vacantCount} 間\`, size: "lg", weight: "bold", color: "#0F172A", margin: "xs" }
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
                  { type: "text", text: \`\${pendingCount} 筆\`, size: "lg", weight: "bold", color: "#4F46E5", margin: "xs" }
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
                  { type: "text", text: \`NT$ \${monthlyExpectedRent.toLocaleString()}\`, size: "sm", weight: "bold", color: "#0F172A" }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                justifyContent: "space-between",
                contents: [
                  { type: "text", text: "💵 本月已實收租金", size: "xs", color: "#059669", weight: "bold" },
                  { type: "text", text: \`NT$ \${monthlyCollectedRent.toLocaleString()}\`, size: "sm", weight: "bold", color: "#059669" }
                ]
              },
              {
                type: "box",
                layout: "horizontal",
                justifyContent: "space-between",
                contents: [
                  { type: "text", text: "📈 實收達成率", size: "xxs", color: "#94A3B8" },
                  { type: "text", text: \`\${collectionRate}%\`, size: "xs", weight: "bold", color: "#4F46E5" }
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
    quickReply: buildSmartQuickReply("landlord")
  };
}

// 3. 待核帳單 Flex Message (支援一鍵確認入帳與駁回)
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
      quickReply: buildSmartQuickReply("landlord")
    };
  }

  // Build carousel bubbles (max 10 bills)
  const bubbles = pendingPayments.slice(0, 10).map((bill) => {
    const title = getPaymentTitle(bill);
    const amt = Number(bill.amount || 0).toLocaleString();
    const isCash = bill.payment_method === "現金交付";
    const reportDesc = isCash ? "💵 現金交付" : \`🏦 轉帳末五碼：\${bill.transfer_last5 || "未填"}\`;

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
              { type: "text", text: \`NT$ \${amt}\`, size: "sm", color: "#059669", weight: "bold", flex: 7 }
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
              data: \`action=approve_payment&id=\${bill.id}\`,
              displayText: \`確認入帳：\${title}\`
            }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: {
              type: "postback",
              label: "❌ 駁回",
              data: \`action=reject_payment&id=\${bill.id}\`,
              displayText: \`駁回回報：\${title}\`
            }
          }
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: \`⏳ 共有 \${pendingPayments.length} 筆帳單待審核\`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
    quickReply: buildSmartQuickReply("landlord")
  };
}

// 4. 旗下房源現況 Flex Message
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
      quickReply: buildSmartQuickReply("landlord")
    };
  }

  // Create bubbles for properties (up to 10 in carousel)
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
            text: \`\${prop.name || "房號"} · NT$ \${rentAmt}/月\`,
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
                { type: "text", text: \`\${activeLease.tenant_name || "租客"} (\${activeLease.phone || ""})\`, size: "xs", color: "#059669", weight: "bold", flex: 7 }
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
    altText: \`🏠 旗下房源現況 (共 \${properties.length} 間)\`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
    quickReply: buildSmartQuickReply("landlord")
  };
}

// 5. 租客名冊 Flex Message
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
      quickReply: buildSmartQuickReply("landlord")
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
          { type: "text", text: \`房號：\${prop?.name || '承租房源'}\`, color: "#38BDF8", size: "xs", weight: "bold" },
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
              { type: "text", text: \`\${l.start_date} ~ \${l.end_date}\`, size: "xs", color: "#334155", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "⏳ 剩餘天數", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: \`倒數 \${daysRemaining} 天 (\${duration.formatted})\`, size: "xs", color: daysRemaining < 30 ? "#DC2626" : "#059669", weight: "bold", flex: 7 }
            ]
          },
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: "💵 每月租金", size: "xs", color: "#64748B", flex: 3 },
              { type: "text", text: \`NT$ \${Number(l.monthly_rent || 0).toLocaleString()}\`, size: "xs", color: "#4F46E5", weight: "bold", flex: 7 }
            ]
          }
        ]
      }
    };
  });

  return {
    type: "flex",
    altText: \`📋 旗下租客合約名冊 (共 \${leases.length} 戶)\`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: "carousel", contents: bubbles },
    quickReply: buildSmartQuickReply("landlord")
  };
}

// -----------------------------------------------------------------------------
// DUAL-ROLE INTELLIGENT USER CONTEXT FETCHER
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

  // 3. 判斷房東資格 (Landlord Eligibility)
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

  if (!landlordRecord && (profile?.role === "landlord" || profile?.role === "superadmin")) {
    const { data: lFirst } = await supabase
      .from("landlords")
      .select("*")
      .eq("status", "approved")
      .is("deleted_at", null)
      .limit(1);
    if (lFirst && lFirst[0]) landlordRecord = lFirst[0];
  }

  if (!landlordRecord && userName) {
    const { data: allLnds } = await supabase
      .from("landlords")
      .select("*")
      .eq("status", "approved")
      .is("deleted_at", null);
    if (allLnds) {
      for (const l of allLnds) {
        if (l.name === userName || (l.company_name && l.company_name.includes(userName))) {
          landlordRecord = l;
          break;
        }
      }
    }
  }

  const isLandlord = !!landlordRecord;

  // 4. 判斷租客資格與進行中租約 (Tenant Eligibility)
  let leaseQuery = supabase
    .from("leases")
    .select("*")
    .eq("status", "active")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (cleanPhone) {
    leaseQuery = leaseQuery.or(\`phone.eq.\${cleanPhone},co_phone.eq.\${cleanPhone}\`);
  }

  const { data: tenantLeases } = await leaseQuery;
  const isTenant = tenantLeases && tenantLeases.length > 0;
  const activeLease = tenantLeases?.[0] || null;

  // 5. 智慧判斷當前作用中模式 (Active Role)
  let currentRole = "tenant";
  if (binding.status === "active:landlord") {
    currentRole = "landlord";
  } else if (binding.status === "active:tenant") {
    currentRole = "tenant";
  } else {
    // 預設身分自動指派
    if (isLandlord && !isTenant) {
      currentRole = "landlord";
    } else {
      currentRole = "tenant";
    }
  }

  const isDualRole = isLandlord && isTenant;

  // 6. 若具備房東身分，查詢房東旗下房源與合約
  let landlordProperties: any[] = [];
  let landlordManagedLeases: any[] = [];
  if (isLandlord && landlordRecord) {
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

  // 7. 若為租客，查詢關聯房源與房東資訊
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
    if (activeLease.landlord_id) {
      const { data: l } = await supabase
        .from("landlords")
        .select("*")
        .eq("id", activeLease.landlord_id)
        .maybeSingle();
      tenantLandlord = l;
    }
  }
  if (!tenantLandlord) {
    const { data: allLnds } = await supabase
      .from("landlords")
      .select("*")
      .is("deleted_at", null)
      .limit(1);
    tenantLandlord = allLnds?.[0] || null;
  }

  return {
    binding,
    profile,
    userName,
    cleanPhone,
    isLandlord,
    isTenant,
    isDualRole,
    currentRole,
    landlordRecord,
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
    return new Response(JSON.stringify({ status: "ok", service: "line-webhook", version: "dual-role-v2" }), {
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

    // 獲取使用者完整上下文 (雙身分判斷)
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

      // 已綁定用戶，根據目前身分同步綁定專屬 Rich Menu
      try {
        if (userCtx.currentRole === "landlord") {
          await linkUserRichMenu(lineUserId, LANDLORD_RICH_MENU_ID);
        } else {
          await linkUserRichMenu(lineUserId, TENANT_RICH_MENU_ID);
        }
      } catch (err) {
        console.warn("Follow event link rich menu error:", err);
      }

      const welcomeName = userCtx.userName || displayName;
      const isLandlord = userCtx.currentRole === "landlord";

      await replyLineMessage(replyToken, [
        {
          type: "text",
          text: \`🎉 歡迎您使用智慧租屋管家系統！\\n\\n您好，\${welcomeName}！您目前處於【\${isLandlord ? '房東經營模式' : '租客生活模式'}】。\\n\\n日後有任何新帳單、繳費回報或審核確認，系統將在此為您進行即時推播通知！\\n\\n您可點擊下方 6 宮格選單或快捷按鈕開始使用：\`,
          quickReply: buildSmartQuickReply(userCtx.currentRole)
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

      // 1. 身分切換 Postback
      if (action === "switch_role") {
        const target = params.get("target") || "tenant";
        const displayName = userCtx?.userName || "使用者";

        if (target === "landlord") {
          if (!userCtx?.isLandlord) {
            await replyLineMessage(replyToken, [
              {
                type: "text",
                text: "⚠️ 您目前尚未具備房東管理權限。\\n\\n若您已持有出租物業，請登入網頁後台填寫房東申請資料，審核通過後即可開啟完整經營功能！",
                quickReply: buildSmartQuickReply("tenant")
              }
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
            buildRoleSwitchSuccessFlex("landlord", displayName)
          ]);
          continue;
        }

        if (target === "tenant") {
          // 更新 line_bindings 為 active:tenant
          await supabase
            .from("line_bindings")
            .update({ status: "active:tenant", updated_at: new Date().toISOString() })
            .eq("line_user_id", lineUserId);

          // 切換 LINE Rich Menu 為租客選單
          await linkUserRichMenu(lineUserId, TENANT_RICH_MENU_ID);

          await replyLineMessage(replyToken, [
            buildRoleSwitchSuccessFlex("tenant", displayName)
          ]);
          continue;
        }
      }

      // 2. 房東確認入帳 (Approve Payment)
      if (action === "approve_payment") {
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
          await replyLineMessage(replyToken, [{ type: "text", text: \`✅ 帳單【\${getPaymentTitle(bill)}】先前已確認入帳結清！\` }]);
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
          await replyLineMessage(replyToken, [{ type: "text", text: \`❌ 核帳失敗：\${updErr.message}\` }]);
          continue;
        }

        const title = getPaymentTitle(bill);
        const amt = Number(bill.amount || 0).toLocaleString();

        // 立即推播收據確認給承租人 (Instant Push to Tenant)
        try {
          // 透過 lease 查詢承租人
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
                      text: \`🎉【繳費核銷成功通知】\\n\\n您繳納的【\${title}】(金額 NT$ \${amt}) 房東已確認入帳，電子收據已正式開立完成！\\n\\n感謝您的準時繳納，您可隨時輸入「已繳金額」查看歷史紀錄。\`
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
            text: \`✅ 帳單【\${title}】(金額 NT$ \${amt}) 已成功確認入帳！\\n\\n電子收據已即時開立，並已推播通知承租人。如需查看更多，請點選下方選單：\`,
            quickReply: buildSmartQuickReply("landlord")
          }
        ]);
        continue;
      }

      // 3. 房東駁回繳款回報 (Reject Payment)
      if (action === "reject_payment") {
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
          await replyLineMessage(replyToken, [{ type: "text", text: \`❌ 駁回失敗：\${updErr.message}\` }]);
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
                      text: \`⚠️【繳款回報退回提醒】\\n\\n您回報的【\${title}】款項經房東核對未查得入帳紀錄，已退回為待繳狀態。\\n\\n請重新確認轉帳末五碼或與房東聯繫協助！\`
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
            text: \`❌ 已駁回帳單【\${title}】之回報，該筆帳單已重置為待繳狀態，並已推播通知租客重新核對。\\n\\n如需查看其他帳單，請點選下方選單：\`,
            quickReply: buildSmartQuickReply("landlord")
          }
        ]);
        continue;
      }

      // 4. 租客選擇帳單鎖定 (select_bill)
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
              text: \`✅ 帳單【\${getPaymentTitle(payment)}】已於 \${payment.paid_date || "先前"} 完成結清！如需查看收據，請輸入「已繳金額」。\`,
              quickReply: buildSmartQuickReply("tenant")
            }
          ]);
          continue;
        }

        if (payment && (payment.status === "tenant_submitted" || payment.status === "pending_approval")) {
          const prevDesc = payment.payment_method === '現金交付'
            ? '現金交付'
            : \`轉帳末五碼：\${payment.transfer_last5 || '已登記'}\`;
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: \`🔍 帳單【\${getPaymentTitle(payment)}】先前已回報（\${prevDesc}），房東正在核對入帳中，請耐心等候開立收據！\`,
              quickReply: buildSmartQuickReply("tenant")
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

      // 5. 租客現金回報 (report_cash)
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
              text: \`✅ 帳單【\${getPaymentTitle(targetPayment)}】已於 \${targetPayment.paid_date || "先前"} 完成結清！如需查看收據，請輸入「已繳金額」。\`,
              quickReply: buildSmartQuickReply("tenant")
            }
          ]);
          continue;
        }

        if (targetPayment && (targetPayment.status === "tenant_submitted" || targetPayment.status === "pending_approval")) {
          const prevTitle = getPaymentTitle(targetPayment);
          const prevDesc = targetPayment.payment_method === '現金交付' ? '現金交付' : \`轉帳末五碼：\${targetPayment.transfer_last5 || '已登記'}\`;
          await replyLineMessage(replyToken, [
            {
              type: "text",
              text: \`🔍 帳單【\${prevTitle}】您先前已完成回報（\${prevDesc}），房東正在核對入帳中！\`,
              quickReply: buildSmartQuickReply("tenant")
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
            { type: "text", text: "🎉 您目前沒有待繳納之帳單！如需核對歷史紀錄，請輸入「已繳金額」。", quickReply: buildSmartQuickReply("tenant") }
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
            { type: "text", text: \`❌ 現金回報更新失敗：\${updateErr.message || "請稍後再試或直接向房東反映。"}\`, quickReply: buildSmartQuickReply("tenant") }
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
                      text: \`🔔【租客現金繳款回報通知】\\n\\n承租人：\${userCtx.userName || targetPayment.tenant_name || "租客"}\\n項目：\${getPaymentTitle(targetPayment)}\\n金額：NT$ \${Number(targetPayment.amount || 0).toLocaleString()}\\n方式：💵 現金交付\\n\\n請點選下方選單「⏳ 待核帳單」即可一鍵確認入帳並開立收據！\`,
                      quickReply: buildSmartQuickReply("landlord")
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
            text: "📷 已收到您的轉帳憑證截圖！\\n\\n請直接在下方回覆您的【轉帳末五碼】（5 位數字，例如：88621）或是輸入「現金交付」，系統將立即為您完成繳費回報，送交房東核帳！",
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

        // 1. 身分切換指令判斷
        const isSwitchToLandlord = /^(切換為房東|切換房東|房東模式|我是房東|房東)$/i.test(text.replace(/\\s+/g, ''));
        const isSwitchToTenant = /^(切換為租客|切換租客|租客模式|我是租客|租客)$/i.test(text.replace(/\\s+/g, ''));
        const isToggleRole = /^(切換身分|身分切換|切換模式|切換)$/i.test(text.replace(/\\s+/g, ''));

        if (isSwitchToLandlord || (isToggleRole && !isLandlordRole)) {
          if (!userCtx.isLandlord) {
            await replyLineMessage(replyToken, [
              {
                type: "text",
                text: "⚠️ 您目前尚未具備房東管理權限。\\n\\n若您已持有出租物業，請登入網頁後台填寫房東申請資料，審核通過後即可開啟完整經營功能！",
                quickReply: buildSmartQuickReply("tenant")
              }
            ]);
            continue;
          }

          // 更新 DB status 為 active:landlord
          await supabase
            .from("line_bindings")
            .update({ status: "active:landlord", updated_at: new Date().toISOString() })
            .eq("line_user_id", lineUserId);

          // 切換 Rich Menu
          await linkUserRichMenu(lineUserId, LANDLORD_RICH_MENU_ID);

          await replyLineMessage(replyToken, [
            buildRoleSwitchSuccessFlex("landlord", userCtx.userName)
          ]);
          continue;
        }

        if (isSwitchToTenant || (isToggleRole && isLandlordRole)) {
          // 更新 DB status 為 active:tenant
          await supabase
            .from("line_bindings")
            .update({ status: "active:tenant", updated_at: new Date().toISOString() })
            .eq("line_user_id", lineUserId);

          // 切換 Rich Menu
          await linkUserRichMenu(lineUserId, TENANT_RICH_MENU_ID);

          await replyLineMessage(replyToken, [
            buildRoleSwitchSuccessFlex("tenant", userCtx.userName)
          ]);
          continue;
        }

        // 2. 房東功能分支
        if (isLandlordRole) {
          // 2.1 經營概況
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

              // 計算當前月份已繳總金額
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

          // 2.2 待核帳單
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
                .order("due_date", { ascending: true });
              pendingPayments = pData || [];
            }

            await replyLineMessage(replyToken, [
              buildLandlordAuditBillsFlex(pendingPayments)
            ]);
            continue;
          }

          // 2.3 房源現況
          if (text.includes("房源") || text.includes("房間") || text.includes("物業") || text === "3") {
            await replyLineMessage(replyToken, [
              buildLandlordPropertiesFlex(userCtx.landlordProperties, userCtx.landlordManagedLeases)
            ]);
            continue;
          }

          // 2.4 租客名冊
          if (text.includes("名冊") || text.includes("房客") || text.includes("名單") || text === "4") {
            await replyLineMessage(replyToken, [
              buildLandlordTenantsFlex(userCtx.landlordManagedLeases, userCtx.landlordProperties)
            ]);
            continue;
          }
        }

        // 3. 租客功能分支 (或房東模式下查詢租客個人相關合約)
        const leaseIds = userCtx.leases.map((l: any) => l.id);

        // 3.1 繳款回報：末五碼或現金
        const last5Match = text.match(/(?:後五碼|末五碼|回報|轉帳)\\s*(\\d{5})\\b|^\\s*(\\d{5})\\s*$/);
        const isCash = /^(現金|現金交付|付現|現金繳費|現金支付|已付現金)$/i.test(text.replace(/\\s+/g, '')) || text.includes("現金交付");

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
                : \`轉帳末五碼：\${submittedPayments[0].transfer_last5 || '已登記'}\`;
              await replyLineMessage(replyToken, [
                {
                  type: "text",
                  text: \`🔍 您先前已送交【\${prevTitle}】之繳款回報（\${prevDesc}），房東正在核對入帳中，請耐心等候開立收據！\`,
                  quickReply: buildSmartQuickReply(userCtx.currentRole)
                }
              ]);
            } else {
              await replyLineMessage(replyToken, [
                {
                  type: "text",
                  text: "🎉 您目前沒有任何待繳納之帳單！感謝您的準時繳納。如需核對歷史紀錄，請輸入「已繳金額」。",
                  quickReply: buildSmartQuickReply(userCtx.currentRole)
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
              { type: "text", text: \`❌ 回報更新失敗：\${updateErr.message || "請稍後再試或直接向房東反映。"}\`, quickReply: buildSmartQuickReply(userCtx.currentRole) }
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
                    const payDesc = isCash ? "💵 現金交付" : \`🏦 轉帳末五碼：\${matchedLast5}\`;
                    await pushLineMessage(lBind.line_user_id, [
                      {
                        type: "text",
                        text: \`🔔【租客繳費回報提醒】\\n\\n承租人：\${userCtx.userName || targetPayment.tenant_name || "租客"}\\n項目：\${getPaymentTitle(targetPayment)}\\n金額：NT$ \${Number(targetPayment.amount || 0).toLocaleString()}\\n方式：\${payDesc}\\n\\n請點選下方「⏳ 待核帳單」即可一鍵確認入帳並開立收據！\`,
                        quickReply: buildSmartQuickReply("landlord")
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

        // 3.2 租約狀況
        if (text.includes("租約") || text.includes("合約") || text.includes("我的租約")) {
          if (!userCtx.lease) {
            await replyLineMessage(replyToken, [
              {
                type: "text",
                text: "⚠️ 目前查無您生效中的租約資料。若已簽訂新約，請洽詢房東完成系統登記。",
                quickReply: buildSmartQuickReply(userCtx.currentRole)
              }
            ]);
          } else {
            await replyLineMessage(replyToken, [
              buildLeaseFlex(userCtx.lease, userCtx.property, userCtx.landlord, userCtx.profile)
            ]);
          }
          continue;
        }

        // 3.3 已繳金額 / 歷史收據
        if (text.includes("已繳") || text.includes("收據") || text.includes("繳款紀錄")) {
          let paidPayments: any[] = [];
          let query = supabase
            .from("payments")
            .select("*")
            .eq("status", "paid")
            .is("deleted_at", null)
            .order("created_at", { ascending: false });

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

        // 3.4 待繳帳單
        if (text.includes("帳單") || text.includes("待繳") || text.includes("應繳") || text.includes("未繳")) {
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
            buildPendingBillsFlex(pendingPayments, userCtx.profile)
          ]);
          continue;
        }

        // 3.5 匯款帳號
        if (text.includes("匯款") || text.includes("帳戶") || text.includes("銀行")) {
          await replyLineMessage(replyToken, [
            buildBankInfoFlex(userCtx.landlord)
          ]);
          continue;
        }

        // 4. 預設導覽
        if (isLandlordRole) {
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
`;

const finalFileContent = baseHeader + '\n' + newCode;
fs.writeFileSync('supabase/functions/line-webhook/index.ts', finalFileContent, 'utf8');
console.log(`Successfully updated supabase/functions/line-webhook/index.ts! Total lines: ${finalFileContent.split('\n').length}`);
