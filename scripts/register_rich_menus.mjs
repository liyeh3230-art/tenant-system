import fs from 'fs';
import path from 'path';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "3tRsfe2hSYJvT0Ygrvvu+vbkpgd+CkMbv0335PxTeGq+L7nklrr2/6e2ENGlpwZoHc+LVnmOzgPQPl1KUGr7byBd0PsjoQFhcJ8YastIH29ANr8RSWDR9kz97+6zlhpGIqofGT/lBL41ohwsH1MFDQdB04t89/1O/w1cDnyilFU=";

// 6 grids coordinates (2500 x 1686)
const bounds = [
  { x: 0, y: 0, width: 833, height: 843 },
  { x: 833, y: 0, width: 833, height: 843 },
  { x: 1666, y: 0, width: 834, height: 843 },
  { x: 0, y: 843, width: 833, height: 843 },
  { x: 833, y: 843, width: 833, height: 843 },
  { x: 1666, y: 843, width: 834, height: 843 },
];

// 1. 純租客標準選單（第 6 格：申請成為房東）
const tenantStandardMenuDef = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "Tenant Standard Menu",
  chatBarText: "📋 租客生活選單",
  areas: [
    { bounds: bounds[0], action: { type: "message", text: "我的租約" } },
    { bounds: bounds[1], action: { type: "message", text: "待繳帳單" } },
    { bounds: bounds[2], action: { type: "message", text: "已繳金額" } },
    { bounds: bounds[3], action: { type: "message", text: "匯款帳號" } },
    { bounds: bounds[4], action: { type: "uri", uri: "https://liyeh3230-art.github.io/tenant-system/" } },
    { bounds: bounds[5], action: { type: "postback", data: "action=apply_landlord", displayText: "📝 申請成為房東" } }
  ]
};

// 2. 雙身分租客選單（具房東身分者：第 6 格：切換為房東）
const tenantDualMenuDef = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "Tenant Dual Menu",
  chatBarText: "📋 租客生活選單",
  areas: [
    { bounds: bounds[0], action: { type: "message", text: "我的租約" } },
    { bounds: bounds[1], action: { type: "message", text: "待繳帳單" } },
    { bounds: bounds[2], action: { type: "message", text: "已繳金額" } },
    { bounds: bounds[3], action: { type: "message", text: "匯款帳號" } },
    { bounds: bounds[4], action: { type: "uri", uri: "https://liyeh3230-art.github.io/tenant-system/" } },
    { bounds: bounds[5], action: { type: "postback", data: "action=switch_role&target=landlord", displayText: "🔄 切換為房東模式" } }
  ]
};

// 3. 房東經營選單（第 6 格：切換為租客）
const landlordMenuDef = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "Landlord Management Menu",
  chatBarText: "📊 房東管理選單",
  areas: [
    { bounds: bounds[0], action: { type: "message", text: "經營概況" } },
    { bounds: bounds[1], action: { type: "message", text: "待核帳單" } },
    { bounds: bounds[2], action: { type: "message", text: "房源現況" } },
    { bounds: bounds[3], action: { type: "message", text: "租客名冊" } },
    { bounds: bounds[4], action: { type: "uri", uri: "https://liyeh3230-art.github.io/tenant-system/" } },
    { bounds: bounds[5], action: { type: "postback", data: "action=switch_role&target=tenant", displayText: "🔄 切換為租客模式" } }
  ]
};

async function createRichMenu(menuDef) {
  const res = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(menuDef)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to create rich menu: ${JSON.stringify(data)}`);
  }
  return data.richMenuId;
}

async function uploadRichMenuImage(richMenuId, imagePath) {
  const imageBuffer = fs.readFileSync(imagePath);
  const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "image/png"
    },
    body: imageBuffer
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload rich menu image: ${text}`);
  }
  return true;
}

async function setDefaultRichMenu(richMenuId) {
  const res = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to set default rich menu: ${text}`);
  }
}

async function main() {
  console.log("=== Registering 3-Tier Dynamic LINE Rich Menus ===");
  
  // 1. Create Standard Tenant Rich Menu (For pure tenants: Grid 5 is 申請成為房東)
  console.log("1. Creating Standard Tenant Rich Menu (申請成為房東)...");
  const tenantStandardMenuId = await createRichMenu(tenantStandardMenuDef);
  console.log(`   Tenant Standard Menu ID: ${tenantStandardMenuId}`);
  
  console.log("2. Uploading Standard Tenant Image...");
  await uploadRichMenuImage(tenantStandardMenuId, "public/richmenu_tenant_standard.png");
  console.log("   Standard Tenant Image uploaded successfully!");

  // 2. Create Dual Tenant Rich Menu (For landlords in tenant mode: Grid 5 is 切換為房東)
  console.log("3. Creating Dual Tenant Rich Menu (切換為房東)...");
  const tenantDualMenuId = await createRichMenu(tenantDualMenuDef);
  console.log(`   Tenant Dual Menu ID: ${tenantDualMenuId}`);
  
  console.log("4. Uploading Dual Tenant Image...");
  await uploadRichMenuImage(tenantDualMenuId, "public/richmenu_tenant.png");
  console.log("   Dual Tenant Image uploaded successfully!");

  // 3. Create Landlord Rich Menu
  console.log("5. Creating Landlord Rich Menu...");
  const landlordMenuId = await createRichMenu(landlordMenuDef);
  console.log(`   Landlord Menu ID: ${landlordMenuId}`);
  
  console.log("6. Uploading Landlord Image...");
  await uploadRichMenuImage(landlordMenuId, "public/richmenu_landlord.png");
  console.log("   Landlord Image uploaded successfully!");

  // 4. Set Standard Tenant Rich Menu as default for all general users
  console.log("7. Setting Standard Tenant Rich Menu as default...");
  await setDefaultRichMenu(tenantStandardMenuId);
  console.log("   Default rich menu set to Tenant Standard Menu!");

  // 5. Save to config file for Edge Function
  const config = {
    tenantStandardRichMenuId: tenantStandardMenuId,
    tenantDualRichMenuId: tenantDualMenuId,
    landlordRichMenuId: landlordMenuId,
    updatedAt: new Date().toISOString()
  };

  const configPath = "supabase/functions/line-webhook/rich_menu_ids.json";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  console.log(`Config written to ${configPath}:`, config);

  console.log("=== ALL 3 RICH MENUS SUCCESSFULLY REGISTERED & CONFIGURED! ===");
}

main().catch(err => {
  console.error("Error registering rich menus:", err);
  process.exit(1);
});
