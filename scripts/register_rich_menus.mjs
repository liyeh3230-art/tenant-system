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

const tenantMenuDef = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "Tenant Service Menu",
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
  console.log("=== Registering LINE Rich Menus ===");
  
  // 1. Create Tenant Rich Menu
  console.log("1. Creating Tenant Rich Menu...");
  const tenantMenuId = await createRichMenu(tenantMenuDef);
  console.log(`   Tenant Rich Menu ID: ${tenantMenuId}`);
  
  console.log("2. Uploading Tenant Rich Menu Image...");
  await uploadRichMenuImage(tenantMenuId, "public/richmenu_tenant.png");
  console.log("   Tenant Image uploaded successfully!");

  // 2. Create Landlord Rich Menu
  console.log("3. Creating Landlord Rich Menu...");
  const landlordMenuId = await createRichMenu(landlordMenuDef);
  console.log(`   Landlord Rich Menu ID: ${landlordMenuId}`);
  
  console.log("4. Uploading Landlord Rich Menu Image...");
  await uploadRichMenuImage(landlordMenuId, "public/richmenu_landlord.png");
  console.log("   Landlord Image uploaded successfully!");

  // 3. Set Tenant Rich Menu as default for all users
  console.log("5. Setting Tenant Rich Menu as default...");
  await setDefaultRichMenu(tenantMenuId);
  console.log("   Default rich menu set to Tenant Menu!");

  // 4. Save to config file for Edge Function
  const config = {
    tenantRichMenuId: tenantMenuId,
    landlordRichMenuId: landlordMenuId,
    updatedAt: new Date().toISOString()
  };

  const configPath = "supabase/functions/line-webhook/rich_menu_ids.json";
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  console.log(`Config written to ${configPath}:`, config);

  console.log("=== ALL RICH MENUS SUCCESSFULLY REGISTERED & LINKED! ===");
}

main().catch(err => {
  console.error("Error registering rich menus:", err);
  process.exit(1);
});
